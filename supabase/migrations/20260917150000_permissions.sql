-- ============================================================================
-- CDLJ — Module « Permissions » (absences autorisées)
-- Paroisse Sainte Famille — Lecteurs Juniors à Kobato
--
-- Une permission autorise l'absence d'un lecteur pour un ou plusieurs samedis
-- futurs. Le statut (en_cours / terminee) est calculé automatiquement à partir
-- des dates — aucun champ statut en base.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TABLE PERMISSIONS
-- ----------------------------------------------------------------------------
create table if not exists public.permissions (
  id              uuid primary key default gen_random_uuid(),
  lecteur_id      uuid not null references public.lecteurs (id) on delete cascade,
  type_permission text not null check (type_permission in ('un_samedi', 'plusieurs_samedis')),
  samedis         date[] not null check (array_length(samedis, 1) > 0),
  motif           text not null check (trim(motif) <> ''),
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);

-- Index pour les requêtes par lecteur (fiche individuelle)
create index if not exists idx_permissions_lecteur on public.permissions (lecteur_id);
-- Index pour les requêtes par date (calcul de statut, filtres)
create index if not exists idx_permissions_samedis on public.permissions using gin (samedis);

-- ----------------------------------------------------------------------------
-- 2. CONTRAINTE : pas de samedi passé
--    Un samedi de permission doit être >= le dernier samedi (gel).
--    On vérifie côté base qu'aucun samedi dans le tableau n'est antérieur
--    au samedi courant (= dernier_samedi()).
-- ----------------------------------------------------------------------------
create or replace function public.permissions_check_samedis_futurs()
returns trigger
language plpgsql
as $$
declare
  s date;
  dernier date;
begin
  dernier := public.dernier_samedi();
  foreach s in array new.samedis loop
    if s < dernier then
      raise exception 'Impossible de créer une permission pour un samedi déjà passé (%).', s
        using hint = 'Les permissions ne concernent que les samedis à venir.';
    end if;
    -- Vérifier que c'est bien un samedi
    if extract(dow from s) <> 6 then
      raise exception 'La date % n''est pas un samedi.', s;
    end if;
  end loop;

  -- Vérifier la cohérence type / nombre de samedis
  if new.type_permission = 'un_samedi' and array_length(new.samedis, 1) <> 1 then
    raise exception 'Le type « un_samedi » nécessite exactement un samedi (%, % reçu(s)).',
      new.type_permission, array_length(new.samedis, 1);
  end if;
  if new.type_permission = 'plusieurs_samedis' and array_length(new.samedis, 1) < 2 then
    raise exception 'Le type « plusieurs_samedis » nécessite au moins deux samedis (% reçu(s)).',
      array_length(new.samedis, 1);
  end if;

  -- Vérifier que le lecteur n'est pas archivé
  if (select archived from public.lecteurs where id = new.lecteur_id) then
    raise exception 'Impossible de créer une permission pour un lecteur archivé.';
  end if;

  return new;
end;
$$;

drop trigger if exists check_permissions_samedis on public.permissions;
create trigger check_permissions_samedis
  before insert on public.permissions
  for each row execute function permissions_check_samedis_futurs();

-- ----------------------------------------------------------------------------
-- 3. AUTEUR FORCÉ PAR LA BASE (trigger shared, même pattern que les autres
--    tables métier)
-- ----------------------------------------------------------------------------
create or replace function public.forcer_auteur_permissions()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.created_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists forcer_auteur_permissions on public.permissions;
create trigger forcer_auteur_permissions
  before insert on public.permissions
  for each row execute function forcer_auteur_permissions();

-- ----------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
alter table public.permissions enable row level security;

-- SELECT : tout utilisateur authentifié avec un rôle (même pattern que lecteurs)
drop policy if exists permissions_select on public.permissions;
create policy permissions_select on public.permissions
  for select to authenticated
  using (public.a_un_role());

-- INSERT : admin, co, co_paroissial (mêmes droits que les événements)
drop policy if exists permissions_insert on public.permissions;
create policy permissions_insert on public.permissions
  for insert to authenticated
  with check (
    public.is_admin()
    or public.is_co()
  );

-- Pas de UPDATE ni DELETE : les permissions sont immuables une fois créées.
-- Le statut est calculé dynamiquement côté client (comme pour les événements).

-- ----------------------------------------------------------------------------
-- 5. RÉALIMENTATION TEMPS RÉEL
-- ----------------------------------------------------------------------------
alter publication supabase_realtime add table public.permissions;

-- ----------------------------------------------------------------------------
-- 6. VUE : permissions avec lecteur join (perf, évite N+1)
-- ----------------------------------------------------------------------------
create or replace view public.v_permissions_lecteur as
select
  p.id,
  p.lecteur_id,
  l.matricule,
  l.nom,
  l.prenom,
  l.grade_id,
  l.fraternite_id,
  p.type_permission,
  p.samedis,
  p.motif,
  p.created_by,
  p.created_at
from public.permissions p
join public.lecteurs l on l.id = p.lecteur_id;

grant select on public.v_permissions_lecteur to authenticated;
