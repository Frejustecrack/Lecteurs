-- ============================================================================
-- CDLJ — Application de Gestion "Lecteurs, sel et lumière nous sommes"
-- Paroisse Sainte Famille d'Akogbato — Archidiocèse de Cotonou (Bénin)
--
-- MIGRATION INITIALE — SCHÉMA COMPLET (13 tables, RLS, triggers, logs)
--
-- Mode normal (intégration GitHub active) : rien à faire — cette migration
-- est appliquée automatiquement par Supabase lors du push.
--
-- NB : cette migration a déjà été exécutée manuellement sur la base de
-- production le 13/09/2026. Le script est idempotent (ré-exécutable).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. GRADES (référentiel fixe, 7 grades)
-- ----------------------------------------------------------------------------
create table if not exists public.grades (
  id  int primary key,
  nom text not null unique
);

insert into public.grades (id, nom) values
  (1, 'Postulat'),
  (2, 'Noviciat'),
  (3, 'Lectorat I'),
  (4, 'Lectorat II'),
  (5, 'Animation I'),
  (6, 'Animation II'),
  (7, 'Formation')
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 2. PROFILS (rôles applicatifs liés aux comptes Supabase Auth)
--    rôles : admin | co | caissier | responsable   (null = en attente)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  username   text,
  role       text check (role in ('admin', 'co', 'caissier', 'responsable')),
  created_at timestamptz not null default now()
);

-- Profils créés automatiquement à la création d'un compte auth (sans rôle)
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'username', new.email),
    new.raw_user_meta_data ->> 'username'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helpers de rôle (utilisés par les politiques RLS)
create or replace function public.current_role()
returns text language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_role() = 'admin', false);
$$;

create or replace function public.is_co()
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_role() = 'co', false);
$$;

create or replace function public.is_caissier()
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_role() = 'caissier', false);
$$;

-- ----------------------------------------------------------------------------
-- 3. FRATERNITÉS
--    responsables = simples noms (pas de comptes associés)
-- ----------------------------------------------------------------------------
create table if not exists public.fraternites (
  id           uuid primary key default gen_random_uuid(),
  nom          text not null unique,
  responsables text[] not null default '{}',
  created_at   timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 4. LECTEURS
--    matricule : LEC100, LEC101, ... généré automatiquement, jamais réattribué
--    archivage : archived = true (jamais de suppression physique)
-- ----------------------------------------------------------------------------
create table if not exists public.lecteurs (
  id             uuid primary key default gen_random_uuid(),
  matricule      text not null unique,
  nom            text not null,
  prenom         text not null,
  date_naissance date,
  grade_id       int not null default 1 references public.grades (id),
  annee_adhesion int,
  fraternite_id  uuid references public.fraternites (id),
  adresse        text,
  contact_parent text,
  archived       boolean not null default false,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create or replace function public.prochain_matricule()
returns text language plpgsql stable as $$
declare n int;
begin
  select coalesce(max(cast(substr(matricule, 4) as int)), 99) + 1
    into n
    from public.lecteurs;
  return 'LEC' || n;
end;
$$;

create or replace function public.gen_matricule()
returns trigger language plpgsql as $$
begin
  if new.matricule is null or new.matricule = '' then
    new.matricule := public.prochain_matricule();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_matricule on public.lecteurs;
create trigger trg_matricule
  before insert on public.lecteurs
  for each row
  execute function public.gen_matricule();

-- Historique des grades (permanente, jamais supprimée)
create table if not exists public.lecteur_grades (
  id         bigint generated always as identity primary key,
  lecteur_id uuid not null references public.lecteurs (id) on delete cascade,
  grade_id   int not null references public.grades (id),
  changed_at timestamptz not null default now()
);

-- Grade initial enregistré à la création du lecteur
create or replace function public.log_grade_initial()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.lecteur_grades (lecteur_id, grade_id)
  values (new.id, new.grade_id);
  return new;
end;
$$;

drop trigger if exists trg_grade_initial on public.lecteurs;
create trigger trg_grade_initial
  after insert on public.lecteurs
  for each row execute function public.log_grade_initial();

-- Changement de grade : Admin / CO uniquement (historique + log)
create or replace function public.changer_grade(p_lecteur uuid, p_grade int)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not (public.is_admin() or public.is_co()) then
    raise exception 'Droits insuffisants pour changer de grade';
  end if;
  if not exists (select 1 from public.lecteurs where id = p_lecteur) then
    raise exception 'Lecteur introuvable';
  end if;
  if not exists (select 1 from public.grades where id = p_grade) then
    raise exception 'Grade invalide';
  end if;
  update public.lecteurs
     set grade_id = p_grade, updated_at = now()
   where id = p_lecteur;
  insert into public.lecteur_grades (lecteur_id, grade_id) values (p_lecteur, p_grade);
  perform public.log_action(
    'lecteur.grade', 'lecteur',
    (select matricule from public.lecteurs where id = p_lecteur),
    jsonb_build_object('nouveau_grade', p_grade)
  );
end;
$$;
grant execute on function public.changer_grade(uuid, int) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. PRÉSENCES (samedis) — GEL : un samedi écoulé est verrouillé
--    (verrou depuis dimanche 00:00 — seule une correction Admin passe)
-- ----------------------------------------------------------------------------
create table if not exists public.presences (
  id          bigint generated always as identity primary key,
  lecteur_id  uuid not null references public.lecteurs (id) on delete cascade,
  date_samedi date not null,
  statut      text not null check (statut in ('present', 'absent')),
  recorded_by uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (lecteur_id, date_samedi)
);
create index if not exists idx_presences_date on public.presences (date_samedi);

-- Dernier samedi (aujourd'hui si aujourd'hui est samedi)
create or replace function public.dernier_samedi()
returns date language sql stable as $$
  select case
           when extract(isodow from current_date) >= 6
             then date_trunc('week', current_date)::date + 5
           else date_trunc('week', current_date)::date - 2
         end;
$$;

-- ----------------------------------------------------------------------------
-- 6. COTISATIONS (hebdomadaires) — PAS de gel : modifiable à tout moment
--    (mois passés inclus) ; seul les Caissiers saisissent
--    « due » = samedi du mois courant non payé (calculé côté application)
-- ----------------------------------------------------------------------------
create table if not exists public.cotisations (
  id          bigint generated always as identity primary key,
  lecteur_id  uuid not null references public.lecteurs (id) on delete cascade,
  date_samedi date not null,
  paye        boolean not null default false,
  montant     int not null default 50,
  paid_at     timestamptz,
  recorded_by uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (lecteur_id, date_samedi)
);
create index if not exists idx_cotisations_date on public.cotisations (date_samedi);

-- Paramètres applicatifs (montant de la cotisation, modifiable par l'Admin)
create table if not exists public.app_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (key, value) values ('montant_cotisation', '50')
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- 7. ÉVÉNEMENTS (uniquement le CO crée / modifie / clôture)
--    cycle : en_cours → termine (lecture seule)
-- ----------------------------------------------------------------------------
create table if not exists public.evenements (
  id                    uuid primary key default gen_random_uuid(),
  nom                   text not null,
  date_evenement        date not null,
  lieu                  text,
  montant_participation int not null default 0,
  statut                text not null default 'en_cours' check (statut in ('en_cours', 'termine')),
  created_by            uuid references public.profiles (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Participants (inscription par matricule, pas de doublon, seulement en_cours)
create table if not exists public.evenement_participants (
  id            bigint generated always as identity primary key,
  event_id      uuid not null references public.evenements (id) on delete cascade,
  lecteur_id    uuid not null references public.lecteurs (id) on delete cascade,
  registered_by uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  unique (event_id, lecteur_id)
);

-- Paiements en tranches (CO uniquement ; total ≤ montant de participation)
create table if not exists public.evenement_paiements (
  id          bigint generated always as identity primary key,
  event_id    uuid not null references public.evenements (id) on delete cascade,
  lecteur_id  uuid not null references public.lecteurs (id) on delete cascade,
  montant     int not null check (montant > 0),
  paye_at     timestamptz not null default now(),
  recorded_by uuid references public.profiles (id),
  created_at  timestamptz not null default now()
);
create index if not exists idx_epaiements_evt
  on public.evenement_paiements (event_id, lecteur_id);

create or replace function public.check_tranche()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_total      int;
  v_participe  int;
begin
  select coalesce(sum(montant), 0) + new.montant into v_total
    from public.evenement_paiements
   where event_id = new.event_id and lecteur_id = new.lecteur_id;
  select montant_participation into v_participe
    from public.evenements where id = new.event_id;
  if v_total > v_participe then
    raise exception 'Total payé (%@) supérieur au montant de participation (%@)',
      v_total, v_participe;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_check_tranche on public.evenement_paiements;
create trigger trg_check_tranche
  before insert on public.evenement_paiements
  for each row execute function public.check_tranche();

-- ----------------------------------------------------------------------------
-- 8. CAISSE (générale + une par événement)
--    event_id NULL  = caisse générale (cotisations + encaissements - décaissements)
--    event_id rempli = caisse de l'événement
-- ----------------------------------------------------------------------------
create table if not exists public.caisse_operations (
  id          bigint generated always as identity primary key,
  event_id    uuid references public.evenements (id) on delete cascade,
  type        text not null check (type in ('encaissement', 'decaissement')),
  montant     int not null check (montant > 0),
  motif       text not null,
  recorded_by uuid references public.profiles (id),
  created_at  timestamptz not null default now()
);
create index if not exists idx_caisse_evt on public.caisse_operations (event_id);

-- ----------------------------------------------------------------------------
-- 9. APPRÉCIATIONS (positive / avertissement / blâme)
--    suppression = "soft delete" (historique permanent)
-- ----------------------------------------------------------------------------
create table if not exists public.appreciations (
  id         bigint generated always as identity primary key,
  lecteur_id uuid not null references public.lecteurs (id) on delete cascade,
  nature     text not null check (nature in ('positive', 'avertissement', 'blame')),
  motif      text not null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false,
  deleted_at timestamptz
);

-- ----------------------------------------------------------------------------
-- 10. LOGS (traçabilité complète — lecture Admin uniquement, jamais purgés)
-- ----------------------------------------------------------------------------
create table if not exists public.logs (
  id         bigint generated always as identity primary key,
  user_id    uuid,
  user_name  text,
  user_role  text,
  action     text not null,
  objet_type text,
  objet_ref  text,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_logs_date on public.logs (created_at desc);

create or replace function public.log_action(
  p_action     text,
  p_objet_type text default null,
  p_objet_ref  text default null,
  p_detail     jsonb  default null
)
returns void language plpgsql security definer set search_path = public
as $$
begin
  insert into public.logs (user_id, user_name, user_role, action, objet_type, objet_ref, detail)
  values (
    auth.uid(),
    (select full_name from public.profiles where id = auth.uid()),
    (select role      from public.profiles where id = auth.uid()),
    p_action, p_objet_type, p_objet_ref, p_detail
  );
end;
$$;
grant execute on function public.log_action(text, text, text, jsonb) to authenticated;

-- Journal automatique des opérations CRUD
create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_op    text := case tg_op when 'INSERT' then 'create'
                             when 'UPDATE' then 'update'
                             when 'DELETE' then 'delete' end;
  v_ref   text;
  v_dtl   jsonb;
  v_uid   uuid := auth.uid();
begin
  v_ref := case
    when tg_table_name = 'lecteurs'
      then coalesce(new.matricule, old.matricule)
    else coalesce(new.id, old.id)::text
  end;

  if tg_op = 'UPDATE' then
    v_dtl := jsonb_build_object('avant', to_jsonb(old), 'apres', to_jsonb(new));
  elsif tg_op = 'INSERT' then
    v_dtl := jsonb_build_object('apres', to_jsonb(new));
  else
    v_dtl := jsonb_build_object('avant', to_jsonb(old));
  end if;

  insert into public.logs (user_id, user_name, user_role, action, objet_type, objet_ref, detail)
  values (
    v_uid,
    (select full_name from public.profiles where id = v_uid),
    (select role      from public.profiles where id = v_uid),
    v_op, tg_table_name, v_ref, v_dtl
  );

  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'fraternites', 'lecteurs', 'lecteur_grades',
    'presences', 'cotisations',
    'evenements', 'evenement_participants', 'evenement_paiements',
    'caisse_operations', 'appreciations'
  ]
  loop
    execute format('drop trigger if exists trg_audit_%I on public.%I', t, t);
    execute format(
      'create trigger trg_audit_%I after insert or update or delete on public.%I
       for each row execute function public.audit_trigger()', t, t);
  end loop;
end;
$$;

-- Mise à jour automatique de updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['lecteurs', 'presences', 'cotisations', 'evenements', 'appreciations', 'app_settings']
  loop
    execute format('drop trigger if exists trg_touch_%I on public.%I', t, t);
    execute format(
      'create trigger trg_touch_%I before update on public.%I
       for each row execute function public.touch_updated_at()', t, t);
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 11. ROW LEVEL SECURITY (sécurité par rôle, niveau ligne)
-- ----------------------------------------------------------------------------
alter table public.grades            enable row level security;
alter table public.profiles          enable row level security;
alter table public.fraternites       enable row level security;
alter table public.lecteurs          enable row level security;
alter table public.lecteur_grades    enable row level security;
alter table public.presences         enable row level security;
alter table public.cotisations       enable row level security;
alter table public.app_settings      enable row level security;
alter table public.evenements        enable row level security;
alter table public.evenement_participants enable row level security;
alter table public.evenement_paiements    enable row level security;
alter table public.caisse_operations      enable row level security;
alter table public.appreciations          enable row level security;
alter table public.logs                  enable row level security;

-- GRADES : lecture pour tout connecté
drop policy if exists grades_select on public.grades;
create policy grades_select on public.grades
  for select to authenticated using (true);

-- PROFILES : lecture pour tout connecté (noms nécessaires aux affichages :
-- auteur des appréciations, historique, etc.) ; écriture Admin uniquement
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete to authenticated using (public.is_admin());

-- FRATERNITÉS : création par tous ; renommage/suppression Admin + CO
drop policy if exists fraternites_select on public.fraternites;
create policy fraternites_select on public.fraternites
  for select to authenticated using (true);
drop policy if exists fraternites_insert on public.fraternites;
create policy fraternites_insert on public.fraternites
  for insert to authenticated with check (true);
drop policy if exists fraternites_update on public.fraternites;
create policy fraternites_update on public.fraternites
  for update to authenticated
  using (public.is_admin() or public.is_co())
  with check (public.is_admin() or public.is_co());
drop policy if exists fraternites_delete on public.fraternites;
create policy fraternites_delete on public.fraternites
  for delete to authenticated using (public.is_admin() or public.is_co());

-- LECTEURS : création par tous ; modification Admin + CO ;
-- archivage/restauration = update du flag (Admin + CO, restauration Admin)
drop policy if exists lecteurs_select on public.lecteurs;
create policy lecteurs_select on public.lecteurs
  for select to authenticated using (true);
drop policy if exists lecteurs_insert on public.lecteurs;
create policy lecteurs_insert on public.lecteurs
  for insert to authenticated with check (true);
drop policy if exists lecteurs_update on public.lecteurs;
create policy lecteurs_update on public.lecteurs
  for update to authenticated
  using (public.is_admin() or public.is_co())
  with check (public.is_admin() or public.is_co());
-- pas de suppression physique possible (archivage uniquement)

-- HISTORIQUE GRADES : lecture seule (écrit uniquement via triggers/fonctions)
drop policy if exists lecteur_grades_select on public.lecteur_grades;
create policy lecteur_grades_select on public.lecteur_grades
  for select to authenticated using (true);

-- PRÉSENCES : enregistrement par tous les rôles, mais GEL du samedi passé
-- (sauf correction Admin)
drop policy if exists presences_select on public.presences;
create policy presences_select on public.presences
  for select to authenticated using (true);
drop policy if exists presences_insert on public.presences;
create policy presences_insert on public.presences
  for insert to authenticated
  with check (public.is_admin() or date_samedi >= public.dernier_samedi());
drop policy if exists presences_update on public.presences;
create policy presences_update on public.presences
  for update to authenticated
  using (public.is_admin() or date_samedi >= public.dernier_samedi());
drop policy if exists presences_delete on public.presences;
create policy presences_delete on public.presences
  for delete to authenticated using (public.is_admin());

-- COTISATIONS : saisie / modification par les Caissiers uniquement
-- (pas de gel : les mois passés sont modifiables)
drop policy if exists cotisations_select on public.cotisations;
create policy cotisations_select on public.cotisations
  for select to authenticated using (true);
drop policy if exists cotisations_insert on public.cotisations;
create policy cotisations_insert on public.cotisations
  for insert to authenticated with check (public.is_caissier());
drop policy if exists cotisations_update on public.cotisations;
create policy cotisations_update on public.cotisations
  for update to authenticated using (public.is_caissier())
  with check (public.is_caissier());
drop policy if exists cotisations_delete on public.cotisations;
create policy cotisations_delete on public.cotisations
  for delete to authenticated using (public.is_caissier());

-- PARAMÈTRES : lecture par tous ; montant cotisation modifiable par l'Admin
drop policy if exists settings_select on public.app_settings;
create policy settings_select on public.app_settings
  for select to authenticated using (true);
drop policy if exists settings_update on public.app_settings;
create policy settings_update on public.app_settings
  for update to authenticated using (public.is_admin())
  with check (public.is_admin());

-- ÉVÉNEMENTS : gérés par le CO ; clôture irréversible (sauf Admin)
drop policy if exists evenements_select on public.evenements;
create policy evenements_select on public.evenements
  for select to authenticated using (true);
drop policy if exists evenements_insert on public.evenements;
create policy evenements_insert on public.evenements
  for insert to authenticated with check (public.is_co());
drop policy if exists evenements_update on public.evenements;
create policy evenements_update on public.evenements
  for update to authenticated
  using (public.is_admin() or (public.is_co() and statut = 'en_cours'));

-- PARTICIPANTS : inscription par tous (événement en cours uniquement)
drop policy if exists participants_select on public.evenement_participants;
create policy participants_select on public.evenement_participants
  for select to authenticated using (true);
drop policy if exists participants_insert on public.evenement_participants;
create policy participants_insert on public.evenement_participants
  for insert to authenticated
  with check (exists (
    select 1 from public.evenements e
    where e.id = event_id and e.statut = 'en_cours'
  ));
drop policy if exists participants_delete on public.evenement_participants;
create policy participants_delete on public.evenement_participants
  for delete to authenticated using (public.is_admin() or public.is_co());

-- PAIEMENTS ÉVÉNEMENTS : CO uniquement, tant que l'événement est en cours
drop policy if exists epaiements_select on public.evenement_paiements;
create policy epaiements_select on public.evenement_paiements
  for select to authenticated using (true);
drop policy if exists epaiements_insert on public.evenement_paiements;
create policy epaiements_insert on public.evenement_paiements
  for insert to authenticated
  with check (public.is_co() and exists (
    select 1 from public.evenements e
    where e.id = event_id and e.statut = 'en_cours'
  ));
drop policy if exists epaiements_update on public.evenement_paiements;
create policy epaiements_update on public.evenement_paiements
  for update to authenticated
  using (public.is_admin() or (public.is_co() and exists (
    select 1 from public.evenements e where e.id = event_id and e.statut = 'en_cours'
  )));
drop policy if exists epaiements_delete on public.evenement_paiements;
create policy epaiements_delete on public.evenement_paiements
  for delete to authenticated
  using (public.is_admin() or (public.is_co() and exists (
    select 1 from public.evenements e where e.id = event_id and e.statut = 'en_cours'
  )));

-- CAISSE (générale + événements) : opérations par le CO ; lecture par tous
drop policy if exists caisse_select on public.caisse_operations;
create policy caisse_select on public.caisse_operations
  for select to authenticated using (true);
drop policy if exists caisse_insert on public.caisse_operations;
create policy caisse_insert on public.caisse_operations
  for insert to authenticated
  with check (public.is_co() and (event_id is null or exists (
    select 1 from public.evenements e
    where e.id = event_id and e.statut = 'en_cours'
  )));
drop policy if exists caisse_update on public.caisse_operations;
create policy caisse_update on public.caisse_operations
  for update to authenticated using (public.is_admin() or public.is_co());
drop policy if exists caisse_delete on public.caisse_operations;
create policy caisse_delete on public.caisse_operations
  for delete to authenticated using (public.is_admin() or public.is_co());

-- APPRÉCIATIONS : ajout par tous ; modification/suppression Admin + CO
drop policy if exists appreciations_select on public.appreciations;
create policy appreciations_select on public.appreciations
  for select to authenticated using (true);
drop policy if exists appreciations_insert on public.appreciations;
create policy appreciations_insert on public.appreciations
  for insert to authenticated with check (true);
drop policy if exists appreciations_update on public.appreciations;
create policy appreciations_update on public.appreciations
  for update to authenticated
  using (public.is_admin() or public.is_co())
  with check (public.is_admin() or public.is_co());
drop policy if exists appreciations_delete on public.appreciations;
create policy appreciations_delete on public.appreciations
  for delete to authenticated using (public.is_admin() or public.is_co());

-- LOGS : lecture Admin uniquement ; aucune écriture directe
-- (les écritures passent par les triggers et log_action, SECURITY DEFINER)
drop policy if exists logs_select on public.logs;
create policy logs_select on public.logs
  for select to authenticated using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 12. FONCTIONS SENSIBLES (accès restreint)
-- ----------------------------------------------------------------------------
-- set_role : réservée à l'éditeur SQL (postgres) — jamais aux comptes de l'app
create or replace function public.set_role(p_user uuid, p_role text, p_full_name text default null)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if p_role not in ('admin', 'co', 'caissier', 'responsable') then
    raise exception 'Rôle invalide : %@', p_role;
  end if;
  insert into public.profiles (id, role, full_name)
  values (p_user, p_role, p_full_name)
  on conflict (id) do update
    set role = excluded.role,
        full_name = coalesce(excluded.full_name, public.profiles.full_name);
  insert into public.logs (user_id, user_name, user_role, action, objet_type, objet_ref, detail)
  values (auth.uid(), 'SQL Editor', null, 'compte.role', 'profiles', p_user::text,
          jsonb_build_object('nouveau_role', p_role));
end;
$$;
revoke execute on function public.set_role(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_role(uuid, text, text) to postgres, supabase_admin;

-- ============================================================================
-- INSTRUCTIONS — CRÉATION DES COMPTES (à faire APRÈS exécution du script)
-- ============================================================================
-- 1. Dans le dashboard Supabase : Authentication → Users → "Add user"
--    (coche "Auto confirm user" pour qu'il puisse se connecter immédiatement)
--    Créez un compte par personne : Admin, CO, 2 Caissiers, Responsables…
-- 2. Pour chaque compte, copiez son UUID (visible dans la liste des users),
--    puis exécutez ici dans le SQL Editor, par exemple :
--
--    select public.set_role('COLLER-UUID-ICI', 'admin', 'Nom Prénom');
--    select public.set_role('COLLER-UUID-ICI', 'co', 'Nom Prénom');
--    select public.set_role('COLLER-UUID-ICI', 'caissier', 'Nom Prénom');
--    select public.set_role('COLLER-UUID-ICI', 'responsable', 'Nom Prénom');
--
-- 3. (Recommandé) Authentication → Settings → désactivez "Enable email
--    signups" : seuls les comptes créés par l'Admin doivent exister.
-- ============================================================================
