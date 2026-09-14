-- Synchronisation temps réel : les modifications de présences/cotisations doivent se refléter partout sans refresh
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'presences'
  ) then
    alter publication supabase_realtime add table public.presences;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cotisations'
  ) then
    alter publication supabase_realtime add table public.cotisations;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fraternites'
  ) then
    alter publication supabase_realtime add table public.fraternites;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lecteurs'
  ) then
    alter publication supabase_realtime add table public.lecteurs;
  end if;
end $$;

-- Nécessaire pour que les UPDATE/DELETE soient diffusés avec l'ancienne ligne
alter table public.presences replica identity full;
alter table public.cotisations replica identity full;
alter table public.fraternites replica identity full;
alter table public.lecteurs replica identity full;
