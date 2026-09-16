-- ============================================================================
-- Sécurité — journal infalsifiable, WITH CHECK systématique, fermeture de
-- l'UPDATE libre sur lecteurs, agrégats de caisse.
--
-- Constats corrigés par cette migration :
--
--   1. `log_action` était exécutable par tout compte connecté : n'importe qui
--      pouvait écrire de faux logs (connexion d'un autre compte, faux export…)
--      depuis la console du navigateur. Le journal perdait toute valeur.
--      → `log_action` redevient interne (révoquée pour `authenticated`).
--      → `journal_client()` : seul point d'entrée côté application, liste
--        blanche d'actions purement client (connexion, déconnexion, export
--        PDF), `user_id` et référence forcés à `auth.uid()`.
--      → Les événements métier (clôture/réouverture/suppression d'un
--        événement, correction d'une présence gelée) sont déduits par le
--        trigger d'audit à partir des données réelles — plus rien à déclarer
--        côté client, donc plus rien à falsifier.
--
--   2. Plusieurs policies UPDATE n'avaient qu'un USING : une ligne autorisée
--      pouvait être déplacée vers un état interdit (présence déplacée vers un
--      samedi gelé, opération de caisse rattachée à un événement clôturé…).
--      → WITH CHECK identique au USING partout.
--
--   3. `lecteurs_update_fraternite` ouvrait l'UPDATE de la table lecteurs à
--      tout le monde (using true / with check true) en s'en remettant à un
--      seul trigger. Le RPC `changer_fraternite` suffit et journalise.
--      → policy supprimée, trigger conservé en défense en profondeur.
--
--   4. `set_role` refusait `co_paroissial` alors que la contrainte et
--      `is_co()` l'acceptent. Aligné.
--
--   5. Dimensionnement : 200 lecteurs × ~52 samedis = ~10 000 cotisations
--      par an. Le tableau de bord et la caisse chargeaient TOUTES les
--      cotisations pour en faire la somme côté navigateur.
--      → vue `v_caisse_totaux` (agrégats calculés par PostgreSQL).
--
-- Script idempotent : ré-exécutable sans effet de bord.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. JOURNAL
-- ----------------------------------------------------------------------------

-- 1a. log_action : usage interne uniquement (fonctions SECURITY DEFINER).
revoke execute on function public.log_action(text, text, text, jsonb)
  from public, anon, authenticated;

-- 1b. Point d'entrée client, sur liste blanche.
--     L'auteur et la référence du compte ne sont JAMAIS pris du paramètre.
create or replace function public.journal_client(
  p_action text,
  p_objet_type text default null,
  p_objet_ref  text default null,
  p_detail     jsonb default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_ref  text := p_objet_ref;
  v_type text := p_objet_type;
begin
  if v_uid is null then
    raise exception 'Session expirée — reconnectez-vous';
  end if;

  if p_action not in ('compte.connexion', 'compte.deconnexion', 'export.pdf') then
    raise exception 'Action non journalisable depuis le client : %', p_action;
  end if;

  -- Les événements de compte portent toujours sur le compte appelant.
  if p_action like 'compte.%' then
    v_type := 'profiles';
    v_ref  := v_uid::text;
  end if;

  insert into public.logs (user_id, user_name, user_role, action, objet_type, objet_ref, detail)
  values (
    v_uid,
    (select full_name from public.profiles where id = v_uid),
    (select role      from public.profiles where id = v_uid),
    p_action, v_type, left(v_ref, 200), p_detail
  );
end;
$$;
revoke execute on function public.journal_client(text, text, text, jsonb) from public, anon;
grant  execute on function public.journal_client(text, text, text, jsonb) to authenticated;

-- 1c. Trigger d'audit : actions métier déduites des données réelles.
create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_op  text := case tg_op when 'INSERT' then 'create'
                           when 'UPDATE' then 'update'
                           when 'DELETE' then 'delete' end;
  v_new jsonb;
  v_old jsonb;
  v_ref text;
  v_uid uuid := auth.uid();
begin
  v_new := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old := case when tg_op = 'INSERT' then null else to_jsonb(old) end;

  v_ref := coalesce(
    v_new ->> 'matricule', v_old ->> 'matricule',
    v_new ->> 'id',        v_old ->> 'id'
  );

  -- Qualification métier (remplace les déclarations qui venaient du client).
  if tg_table_name = 'evenements' then
    if tg_op = 'DELETE' then
      v_op := 'evenement.suppression';
    elsif tg_op = 'UPDATE' and (v_old ->> 'statut') = 'en_cours' and (v_new ->> 'statut') = 'termine' then
      v_op := 'evenement.cloture';
    elsif tg_op = 'UPDATE' and (v_old ->> 'statut') = 'termine' and (v_new ->> 'statut') = 'en_cours' then
      v_op := 'evenement.reouverture';
    end if;
  elsif tg_table_name = 'presences' and tg_op in ('INSERT', 'UPDATE') then
    if (v_new ->> 'date_samedi')::date < public.dernier_samedi() then
      v_op := 'presence.correction_gelee';
    end if;
  end if;

  insert into public.logs (user_id, user_name, user_role, action, objet_type, objet_ref, detail)
  values (
    v_uid,
    (select full_name from public.profiles where id = v_uid),
    (select role      from public.profiles where id = v_uid),
    v_op, tg_table_name, v_ref,
    jsonb_build_object('avant', v_old, 'apres', v_new)
  );

  return coalesce(new, old);
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. WITH CHECK sur toutes les policies UPDATE qui n'en avaient pas
-- ----------------------------------------------------------------------------
drop policy if exists presences_update on public.presences;
create policy presences_update on public.presences
  for update to authenticated
  using      (public.is_admin() or date_samedi >= public.dernier_samedi())
  with check (public.is_admin() or date_samedi >= public.dernier_samedi());

drop policy if exists caisse_update on public.caisse_operations;
create policy caisse_update on public.caisse_operations
  for update to authenticated
  using      (public.is_admin() or (public.is_co() and (event_id is null or exists (
    select 1 from public.evenements e where e.id = event_id and e.statut = 'en_cours'))))
  with check (public.is_admin() or (public.is_co() and (event_id is null or exists (
    select 1 from public.evenements e where e.id = event_id and e.statut = 'en_cours'))));

drop policy if exists epaiements_update on public.evenement_paiements;
create policy epaiements_update on public.evenement_paiements
  for update to authenticated
  using      (public.is_admin() or (public.is_co() and exists (
    select 1 from public.evenements e where e.id = event_id and e.statut = 'en_cours')))
  with check (public.is_admin() or (public.is_co() and exists (
    select 1 from public.evenements e where e.id = event_id and e.statut = 'en_cours')));

-- Opérations de caisse : la suppression sur un événement clôturé est fermée
-- au CO (cohérent avec l'insert/update) ; l'Admin garde la main.
drop policy if exists caisse_delete on public.caisse_operations;
create policy caisse_delete on public.caisse_operations
  for delete to authenticated
  using (public.is_admin() or (public.is_co() and (event_id is null or exists (
    select 1 from public.evenements e where e.id = event_id and e.statut = 'en_cours'))));

-- ----------------------------------------------------------------------------
-- 2b. Un compte connecté SANS rôle (en attente d'activation par l'Admin) ne
--     doit rien pouvoir écrire. Les policies « ouvertes à tous » étaient
--     `with check (true)` : elles exigent désormais un rôle attribué.
-- ----------------------------------------------------------------------------
create or replace function public.a_un_role()
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_role() in ('admin', 'co', 'co_paroissial', 'caissier', 'responsable'), false);
$$;
grant execute on function public.a_un_role() to authenticated;

drop policy if exists fraternites_insert on public.fraternites;
create policy fraternites_insert on public.fraternites
  for insert to authenticated with check (public.a_un_role());

drop policy if exists fraternites_delete on public.fraternites;
create policy fraternites_delete on public.fraternites
  for delete to authenticated using (public.a_un_role());

drop policy if exists lecteurs_insert on public.lecteurs;
create policy lecteurs_insert on public.lecteurs
  for insert to authenticated with check (public.a_un_role());

drop policy if exists presences_insert on public.presences;
create policy presences_insert on public.presences
  for insert to authenticated
  with check (public.a_un_role() and (public.is_admin() or date_samedi >= public.dernier_samedi()));

drop policy if exists participants_insert on public.evenement_participants;
create policy participants_insert on public.evenement_participants
  for insert to authenticated
  with check (public.a_un_role() and exists (
    select 1 from public.evenements e
    where e.id = event_id and e.statut = 'en_cours'
  ));

drop policy if exists appreciations_insert on public.appreciations;
create policy appreciations_insert on public.appreciations
  for insert to authenticated with check (public.a_un_role());

-- Les RPC ouverts à « tout rôle » vérifient aussi qu'un rôle existe.
create or replace function public.changer_fraternite(p_lecteur uuid, p_fraternite uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_matricule text;
  v_ancienne  uuid;
begin
  if auth.uid() is null then
    raise exception 'Session expirée — reconnectez-vous';
  end if;
  if not public.a_un_role() then
    raise exception 'Droits insuffisants : aucun rôle attribué à ce compte';
  end if;

  select matricule, fraternite_id into v_matricule, v_ancienne
    from public.lecteurs where id = p_lecteur;

  if v_matricule is null then
    raise exception 'Lecteur introuvable';
  end if;

  if p_fraternite is not null
     and not exists (select 1 from public.fraternites where id = p_fraternite) then
    raise exception 'Fraternité invalide';
  end if;

  update public.lecteurs
     set fraternite_id = p_fraternite,
         updated_at    = now()
   where id = p_lecteur;

  perform public.log_action(
    'lecteur.fraternite', 'lecteur', v_matricule,
    jsonb_build_object(
      'ancienne_fraternite', v_ancienne,
      'nouvelle_fraternite', p_fraternite
    )
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. LECTEURS : plus d'UPDATE libre. Le changement de fraternité passe par le
--    RPC `changer_fraternite` (SECURITY DEFINER, journalisé). Le trigger
--    `check_lecteur_update` reste en place : même un Admin/CO ne peut plus
--    modifier un matricule.
-- ----------------------------------------------------------------------------
drop policy if exists lecteurs_update_fraternite on public.lecteurs;

-- ----------------------------------------------------------------------------
-- 4. set_role accepte l'alias co_paroissial (déjà admis par la contrainte)
-- ----------------------------------------------------------------------------
create or replace function public.set_role(p_user uuid, p_role text, p_full_name text default null)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if p_role not in ('admin', 'co', 'co_paroissial', 'caissier', 'responsable') then
    raise exception 'Rôle invalide : %', p_role;
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

-- ----------------------------------------------------------------------------
-- 5. AGRÉGATS DE CAISSE (calculés en base, pas dans le navigateur)
--    Vue en SECURITY INVOKER : les RLS des tables sous-jacentes s'appliquent
--    (lecture ouverte à tout connecté, comme les tables).
-- ----------------------------------------------------------------------------
create or replace view public.v_caisse_totaux
with (security_invoker = true)
as
select
  (select coalesce(sum(montant), 0) from public.cotisations where paye)                                          as total_cotisations,
  (select coalesce(sum(montant), 0) from public.caisse_operations where event_id is null and type = 'encaissement') as total_encaissements,
  (select coalesce(sum(montant), 0) from public.caisse_operations where event_id is null and type = 'decaissement') as total_decaissements;

grant select on public.v_caisse_totaux to authenticated;

-- Total des cotisations payées par année de samedi (cumul annuel de la caisse).
create or replace view public.v_cotisations_par_annee
with (security_invoker = true)
as
select extract(year from date_samedi)::int as annee, sum(montant)::bigint as total
  from public.cotisations
 where paye
 group by 1;

grant select on public.v_cotisations_par_annee to authenticated;

-- Index de confort pour les agrégats et les filtres (idempotents).
create index if not exists idx_cotisations_paye_date on public.cotisations (paye, date_samedi);
create index if not exists idx_cotisations_lecteur on public.cotisations (lecteur_id);
create index if not exists idx_presences_lecteur on public.presences (lecteur_id);
create index if not exists idx_caisse_type on public.caisse_operations (event_id, type);
create index if not exists idx_participants_lecteur on public.evenement_participants (lecteur_id);
create index if not exists idx_appreciations_lecteur on public.appreciations (lecteur_id);

comment on function public.journal_client(text, text, text, jsonb) is
  'Seul point de journalisation ouvert au client : actions purement client (connexion, déconnexion, export PDF) ; auteur forcé à auth.uid().';
comment on function public.log_action(text, text, text, jsonb) is
  'Usage interne (fonctions SECURITY DEFINER). Non exécutable par les comptes applicatifs.';
