-- Interdire toute écriture applicative sur une présence future, Admin inclus.
-- Migration additive : aucune ligne existante n'est modifiée ni supprimée.
-- Les éventuelles présences futures historiques restent lisibles, mais figées
-- jusqu'au samedi concerné. Les cotisations ne sont pas concernées.
-- Policies RESTRICTIVE : s'ajoutent par AND aux droits existants (rôle, gel).

drop policy if exists presences_pas_futures_insert on public.presences;
create policy presences_pas_futures_insert on public.presences
  as restrictive for insert to authenticated
  with check (public.a_un_role() and date_samedi <= public.aujourdhui_benin());

drop policy if exists presences_pas_futures_update on public.presences;
create policy presences_pas_futures_update on public.presences
  as restrictive for update to authenticated
  using (public.a_un_role() and date_samedi <= public.aujourdhui_benin())
  with check (public.a_un_role() and date_samedi <= public.aujourdhui_benin());

drop policy if exists presences_pas_futures_delete on public.presences;
create policy presences_pas_futures_delete on public.presences
  as restrictive for delete to authenticated
  using (public.a_un_role() and date_samedi <= public.aujourdhui_benin());
