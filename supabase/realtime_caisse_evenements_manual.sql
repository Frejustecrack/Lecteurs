-- ============================================================================
-- Correctif manuel — SQL Editor
-- Équivalent exact de la migration 20260915180000_realtime_caisse_evenements.sql
--
-- À exécuter si l'intégration GitHub n'a pas encore appliqué la migration.
-- Idempotent : peut être rejoué sans risque.
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

alter table public.caisse_operations      replica identity full;
alter table public.evenements             replica identity full;
alter table public.evenement_participants replica identity full;
alter table public.evenement_paiements    replica identity full;

-- Vérification : doit renvoyer 8 lignes (4 anciennes + 4 nouvelles).
-- select tablename from pg_publication_tables
--  where pubname = 'supabase_realtime' and schemaname = 'public' order by 1;
