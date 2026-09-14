-- Autoriser le Chargé des Opérations (co / co_paroissial) et l'Admin à supprimer un événement
-- Le CDC prévoit que le CO crée/gère les événements ; la suppression manquait au RLS

-- 1) Élargir la contrainte de rôle pour accepter 'co_paroissial' (alias de 'co')
do $$
declare
  cname text;
begin
  select conname into cname from pg_constraint
  where conrelid = 'public.profiles'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%role in%';
  if cname is not null then
    execute format('alter table public.profiles drop constraint %I', cname);
  end if;
end $$;
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

