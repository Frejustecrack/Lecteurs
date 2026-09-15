-- ============================================================================
-- TEMPS RÉEL — caisse et événements
--
-- Deux manques constatés :
--   1. `Dashboard.tsx` s'abonne à `caisse_operations`, qui n'était PAS dans la
--      publication `supabase_realtime` (migration 20260914150100 n'y ajoute que
--      presences / cotisations / fraternites / lecteurs). Cet abonnement ne
--      pouvait donc jamais se déclencher : le KPI « Caisse générale » ne se
--      rafraîchissait pas en direct.
--   2. Les modules Événements, Fiche événement, Caisse et la liste Lecteurs
--      n'avaient aucun abonnement : deux Chargés des Opérations travaillant
--      ensemble ne voyaient pas leurs écritures respectives sans recharger.
--
-- La publication est filtrée par RLS côté Supabase : `caisse_select`,
-- `evenements_select`, `participants_select` et `epaiements_select` sont déjà
-- ouverts à tout compte authentifié (`using (true)`), cette migration
-- n'élargit donc aucun droit de lecture.
--
-- Script idempotent : il ne fait rien si les tables sont déjà publiées.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'caisse_operations'
  ) then
    alter publication supabase_realtime add table public.caisse_operations;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'evenements'
  ) then
    alter publication supabase_realtime add table public.evenements;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'evenement_participants'
  ) then
    alter publication supabase_realtime add table public.evenement_participants;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'evenement_paiements'
  ) then
    alter publication supabase_realtime add table public.evenement_paiements;
  end if;
end $$;

-- Nécessaire pour que les UPDATE/DELETE soient diffusés avec l'ancienne ligne
alter table public.caisse_operations     replica identity full;
alter table public.evenements            replica identity full;
alter table public.evenement_participants replica identity full;
alter table public.evenement_paiements    replica identity full;
