-- ============================================================================
-- Intégrité des données saisies + agrégats pour 200 lecteurs
--
--   1. AUTEUR FORCÉ EN BASE — `recorded_by`, `created_by`, `registered_by`
--      étaient envoyés par le navigateur : n'importe qui pouvait attribuer
--      une saisie à un autre compte. Un trigger BEFORE INSERT les remplace
--      par auth.uid(), quoi qu'envoie le client.
--
--   2. MONTANT DE COTISATION FORCÉ EN BASE — le Caissier envoyait `montant`
--      lu côté navigateur (onglet ouvert avant un changement de tarif → ancien
--      montant ; client modifié → 1 F). Le montant est posé depuis
--      app_settings au moment où la cotisation passe à « payée ».
--
--   3. CONTRAINTES MÉTIER — date_samedi doit être un samedi ; un lecteur
--      archivé ne peut être ni pointé, ni cotiser, ni s'inscrire.
--
--   4. FUSEAU — dernier_samedi() se calculait sur le fuseau du serveur (UTC).
--      Le samedi entre 23 h et minuit au Bénin (UTC+1), base et interface
--      divergeaient. Tout est désormais calculé en Africa/Lagos.
--
--   5. AGRÉGATS PAR MOIS — PostgREST tronque toute réponse à 1 000 lignes
--      (max_rows). À 200 lecteurs, 6 mois de présences = 5 200 lignes : le
--      tableau de bord affichait des chiffres faux sans aucune erreur. Les
--      statistiques mensuelles sont désormais calculées par PostgreSQL.
--
--   6. handle_new_user ne copie plus les métadonnées libres du compte.
--
-- Script idempotent : ré-exécutable sans effet de bord.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 4. Fuseau de référence : Africa/Lagos (Bénin, UTC+1, sans heure d'été)
-- ----------------------------------------------------------------------------
create or replace function public.aujourdhui_benin()
returns date language sql stable as $$
  select (now() at time zone 'Africa/Lagos')::date;
$$;
grant execute on function public.aujourdhui_benin() to authenticated;

create or replace function public.dernier_samedi()
returns date language sql stable as $$
  select case
           when extract(isodow from public.aujourdhui_benin()) >= 6
             then date_trunc('week', public.aujourdhui_benin())::date + 5
           else date_trunc('week', public.aujourdhui_benin())::date - 2
         end;
$$;

-- ----------------------------------------------------------------------------
-- 1. Auteur forcé à auth.uid()
-- ----------------------------------------------------------------------------
create or replace function public.forcer_auteur()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_new jsonb;
begin
  -- Depuis le SQL Editor (auth.uid() null), on laisse la valeur fournie.
  if v_uid is null then
    return new;
  end if;
  v_new := to_jsonb(new);
  if v_new ? 'recorded_by'   then v_new := v_new || jsonb_build_object('recorded_by',   v_uid); end if;
  if v_new ? 'created_by'    then v_new := v_new || jsonb_build_object('created_by',    v_uid); end if;
  if v_new ? 'registered_by' then v_new := v_new || jsonb_build_object('registered_by', v_uid); end if;
  new := jsonb_populate_record(new, v_new);
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'presences', 'cotisations', 'evenements', 'evenement_participants',
    'evenement_paiements', 'caisse_operations', 'appreciations'
  ]
  loop
    execute format('drop trigger if exists trg_auteur_%I on public.%I', t, t);
    execute format(
      'create trigger trg_auteur_%I before insert on public.%I
       for each row execute function public.forcer_auteur()', t, t);
  end loop;
end;
$$;

-- Sur UPDATE, l'auteur d'origine est conservé (created_by / registered_by) ;
-- recorded_by (présences, cotisations) suit le dernier modificateur.
create or replace function public.forcer_recorded_by_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.recorded_by := auth.uid();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_auteur_upd_presences on public.presences;
create trigger trg_auteur_upd_presences before update on public.presences
  for each row execute function public.forcer_recorded_by_update();
drop trigger if exists trg_auteur_upd_cotisations on public.cotisations;
create trigger trg_auteur_upd_cotisations before update on public.cotisations
  for each row execute function public.forcer_recorded_by_update();

-- ----------------------------------------------------------------------------
-- 2. Montant de cotisation posé par la base
-- ----------------------------------------------------------------------------
create or replace function public.montant_cotisation_courant()
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select value::int from public.app_settings where key = 'montant_cotisation'), 50);
$$;
grant execute on function public.montant_cotisation_courant() to authenticated;

create or replace function public.fixer_montant_cotisation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- À chaque passage à « payé » (insert payé, ou update non payé → payé),
  -- le montant et la date de paiement viennent de la base, pas du client.
  if new.paye and (tg_op = 'INSERT' or not old.paye) then
    new.montant := public.montant_cotisation_courant();
    new.paid_at := coalesce(new.paid_at, now());
  end if;
  if not new.paye then
    new.paid_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_montant_cotisation on public.cotisations;
create trigger trg_montant_cotisation before insert or update on public.cotisations
  for each row execute function public.fixer_montant_cotisation();

-- ----------------------------------------------------------------------------
-- 3. Contraintes métier
-- ----------------------------------------------------------------------------
-- 3a. date_samedi est un samedi (isodow = 6). Ajouté NOT VALID puis validé
--     séparément : si des données historiques violaient la règle, la
--     migration ne casse pas — la validation remonte alors l'anomalie.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'presences_date_est_samedi') then
    alter table public.presences
      add constraint presences_date_est_samedi check (extract(isodow from date_samedi) = 6) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cotisations_date_est_samedi') then
    alter table public.cotisations
      add constraint cotisations_date_est_samedi check (extract(isodow from date_samedi) = 6) not valid;
  end if;
end $$;
do $$
begin
  alter table public.presences   validate constraint presences_date_est_samedi;
  alter table public.cotisations validate constraint cotisations_date_est_samedi;
exception when check_violation then
  raise warning 'Des lignes historiques ont une date_samedi qui n''est pas un samedi : contrainte laissée NOT VALID (les nouvelles lignes sont contrôlées).';
end $$;

-- 3b. Lecteur archivé : aucune nouvelle saisie.
create or replace function public.refuser_lecteur_archive()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.lecteurs where id = new.lecteur_id and archived) then
    raise exception 'Ce lecteur est archivé : aucune saisie n''est possible sur sa fiche.';
  end if;
  return new;
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['presences', 'cotisations', 'evenement_participants', 'evenement_paiements']
  loop
    execute format('drop trigger if exists trg_archive_%I on public.%I', t, t);
    execute format(
      'create trigger trg_archive_%I before insert on public.%I
       for each row execute function public.refuser_lecteur_archive()', t, t);
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. handle_new_user : plus de métadonnées libres
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, username)
  values (new.id, new.email, split_part(coalesce(new.email, ''), '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Agrégats mensuels (calculés en base, jamais tronqués)
--    security_invoker : les RLS de lecture (tout connecté) s'appliquent.
-- ----------------------------------------------------------------------------

-- Présences par mois, lecteurs actifs uniquement, samedis arrivés uniquement.
create or replace view public.v_presences_par_mois
with (security_invoker = true)
as
select to_char(p.date_samedi, 'YYYY-MM')                       as mois,
       count(*) filter (where p.statut = 'present')::int        as presents,
       count(*) filter (where p.statut = 'absent')::int         as absents,
       count(distinct p.lecteur_id) filter (where p.statut = 'present')::int as lecteurs_presents,
       count(distinct p.date_samedi)::int                       as samedis_pointes
  from public.presences p
  join public.lecteurs l on l.id = p.lecteur_id and not l.archived
 where p.date_samedi <= public.aujourdhui_benin()
 group by 1;
grant select on public.v_presences_par_mois to authenticated;

-- Cotisations payées par mois de samedi (lecteurs actifs) — pour le taux
-- « lecteurs ayant payé ce mois ».
create or replace view public.v_cotisations_par_mois
with (security_invoker = true)
as
select to_char(c.date_samedi, 'YYYY-MM')          as mois,
       sum(c.montant)::bigint                      as total,
       count(distinct c.lecteur_id)::int           as lecteurs_payes,
       count(*)::int                               as nb
  from public.cotisations c
  join public.lecteurs l on l.id = c.lecteur_id and not l.archived
 where c.paye
 group by 1;
grant select on public.v_cotisations_par_mois to authenticated;

-- Cotisations encaissées par mois d'encaissement (paid_at) — pour la courbe
-- « argent rentré ce mois ».
create or replace view public.v_encaissements_par_mois
with (security_invoker = true)
as
select to_char(c.paid_at at time zone 'Africa/Lagos', 'YYYY-MM') as mois,
       sum(c.montant)::bigint                                     as total
  from public.cotisations c
 where c.paye and c.paid_at is not null
 group by 1;
grant select on public.v_encaissements_par_mois to authenticated;

-- Effectif (lecteurs non archivés) à la fin de chaque mois des 12 derniers.
create or replace view public.v_effectif_par_mois
with (security_invoker = true)
as
with mois as (
  select to_char(d, 'YYYY-MM') as mois,
         (date_trunc('month', d) + interval '1 month' - interval '1 day')::date as fin
    from generate_series(
           date_trunc('month', public.aujourdhui_benin()) - interval '11 months',
           date_trunc('month', public.aujourdhui_benin()),
           interval '1 month') d
)
select m.mois,
       (select count(*)::int from public.lecteurs l
         where (l.created_at at time zone 'Africa/Lagos')::date <= m.fin
           and (l.archived_at is null or (l.archived_at at time zone 'Africa/Lagos')::date > m.fin)) as effectif
  from mois m;
grant select on public.v_effectif_par_mois to authenticated;

-- Avancement des événements en cours (participants, collecté, attendu).
create or replace view public.v_evenements_avancement
with (security_invoker = true)
as
select e.id,
       (select count(*)::int from public.evenement_participants p where p.event_id = e.id) as participants,
       (select coalesce(sum(montant), 0)::bigint from public.evenement_paiements x where x.event_id = e.id) as paye
  from public.evenements e;
grant select on public.v_evenements_avancement to authenticated;

-- Nombre de lecteurs actifs (évite de charger la table pour un count).
create or replace view public.v_lecteurs_compteurs
with (security_invoker = true)
as
select count(*) filter (where not archived)::int as actifs,
       count(*) filter (where archived)::int     as archives
  from public.lecteurs;
grant select on public.v_lecteurs_compteurs to authenticated;

comment on function public.forcer_auteur() is
  'BEFORE INSERT : recorded_by / created_by / registered_by = auth.uid(), quoi qu''envoie le client.';
comment on function public.fixer_montant_cotisation() is
  'Le montant d''une cotisation payée vient de app_settings, jamais du client.';
