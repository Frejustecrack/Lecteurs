-- ============================================================================
-- PR5 — Correctifs RLS : rôle CO bivalent, clôture d'événement, fraternités
--
-- Trois anomalies constatées en production :
--   1) is_co() ne reconnaissait que 'co' ; les comptes libellés
--      'co_paroissial' perdaient tous leurs droits (la contrainte de rôle les
--      accepte pourtant depuis la migration 14150200).
--   2) evenements_update n'avait PAS de clause WITH CHECK : PostgreSQL réutilise
--      alors USING pour tester la NOUVELLE ligne. Le CO qui clôturait un
--      événement passait le test sur l'ancienne ligne (statut = 'en_cours') puis
--      échouait sur la nouvelle (statut = 'termine') → « new row violates
--      row-level security policy ». La clôture était donc impossible sans Admin.
--   3) fraternites_delete devait rester ouvert à tout connecté (fraternité vide),
--      conformément à la migration 14150000 — on le ré-affirme au cas où un
--      correctif manuel appliqué entre-temps l'aurait refermé.
--
-- Script idempotent : ré-exécutable sans effet de bord.
-- ============================================================================

-- ----------------------------------------------------------------------------
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
