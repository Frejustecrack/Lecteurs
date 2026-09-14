-- Autoriser le Chargé des Opérations (co / co_paroissial) et l'Admin à supprimer un événement
-- Le CDC prévoit que le CO crée/gère les événements ; la suppression manquait au RLS

-- 1) Élargir la contrainte de rôle pour accepter 'co_paroissial' (alias de 'co')
-- DROP IF EXISTS : si la migration est rejouée (ou appliquée sur une base où la
-- contrainte porte déjà ce nom), l'ancien bloc DO $$ … like '%role in%' laissait
-- parfois subsister une contrainte héritée plus restrictive, qui continuait de
-- rejeter 'co_paroissial' alors que la nouvelle contrainte l'autorisait.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin','co','co_paroissial','caissier','responsable'));

-- 2) Mettre à jour le helper is_co() pour accepter les deux libellés
create or replace function public.is_co()
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_role() in ('co','co_paroissial'), false);
$$;

-- 3) Politique de suppression : Admin ou CO (les deux libellés)
drop policy if exists evenements_delete on public.evenements;
create policy evenements_delete on public.evenements
  for delete to authenticated
  using (public.is_admin() or public.is_co());

