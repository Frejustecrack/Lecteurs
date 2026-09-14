-- ============================================================================
-- CORRECTIF MANUEL — RLS : rôle CO bivalent + clôture d'événement + fraternités
--
-- À coller dans Supabase → SQL Editor → Run, si l'intégration GitHub n'a pas
-- encore appliqué les migrations. Strictement équivalent aux migrations
--   20260914150200_evenements_delete_co.sql   (partie contrainte de rôle)
--   20260914150500_fix_rls_event_terminate.sql
-- Script idempotent : exécutable autant de fois que nécessaire.
-- ============================================================================

-- --- (issu de 20260914150200) contrainte de rôle : DROP IF EXISTS ------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin','co','co_paroissial','caissier','responsable'));

-- 1) Rôle CO bivalent : 'co' et 'co_paroissial' sont strictement équivalents
-- ----------------------------------------------------------------------------
create or replace function public.is_co()
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_role() in ('co', 'co_paroissial'), false);
$$;

-- ----------------------------------------------------------------------------
-- 2) Clôture d'événement par le CO : USING sur l'ancienne ligne,
--    WITH CHECK explicite sur la nouvelle ligne
-- ----------------------------------------------------------------------------
drop policy if exists evenements_update on public.evenements;
create policy evenements_update on public.evenements
  for update to authenticated
  -- Ancienne ligne : seul un événement encore ouvert est modifiable par le CO
  using (public.is_admin() or (public.is_co() and statut = 'en_cours'))
  -- Nouvelle ligne : le CO peut la laisser 'en_cours' ou la passer 'termine'.
  -- Un événement déjà terminé reste intouchable pour lui (testé par USING).
  with check (public.is_admin() or (public.is_co() and statut in ('en_cours', 'termine')));

-- Suppression : Admin ou CO (les deux libellés) — rappel de 14150200
drop policy if exists evenements_delete on public.evenements;
create policy evenements_delete on public.evenements
  for delete to authenticated
  using (public.is_admin() or public.is_co());

-- ----------------------------------------------------------------------------
-- 3) Suppression de fraternité : ouverte à tout connecté (rappel de 14150000).
--    La contrainte « fraternité vide » reste vérifiée côté application.
-- ----------------------------------------------------------------------------
drop policy if exists fraternites_delete on public.fraternites;
create policy fraternites_delete on public.fraternites
  for delete to authenticated using (true);
