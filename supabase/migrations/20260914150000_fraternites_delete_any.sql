-- Suppression de fraternité autorisée à tout utilisateur authentifié (fraternité vide uniquement)
-- La vérification "vide" reste applicative (comptage des lecteurs), la politique RLS ouvre le DELETE
drop policy if exists fraternites_delete on public.fraternites;
create policy fraternites_delete on public.fraternites
  for delete to authenticated using (true);
