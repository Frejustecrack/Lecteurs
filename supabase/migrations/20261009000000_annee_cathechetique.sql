-- ============================================================================
-- Année Catéchétique sur la fiche lecteur
--
-- Ajout d'une colonne `annee_cathechetique` à `lecteurs` : année de
-- catéchèse en cours du lecteur, choisie dans une liste fermée en
-- chiffres (1ère Année → 5ème Année). `NULL` signifie « Aucun » :
-- c'est la valeur par défaut à la création et pour tous les lecteurs
-- existants.
--
-- Droits : comme les autres champs de la fiche (nom, date de naissance,
-- grade…), la modification est réservée à l'Admin et au CO. Le trigger
-- `check_lecteur_update` est donc recréé avec la nouvelle colonne dans
-- sa liste de champs protégés (les autres rôles ne peuvent toujours
-- modifier que la fraternité, via le RPC `changer_fraternite`).
--
-- Le filtre par année catéchétique n'existe que dans l'écran Lecteurs ;
-- aucune vue ni statistique n'en dépend.
--
-- Script idempotent : ré-exécutable sans effet de bord.
-- ============================================================================

alter table public.lecteurs
  add column if not exists annee_cathechetique text;

-- Valeurs admises : les 5 années de catéchèse, en chiffres. NULL = « Aucun ».
alter table public.lecteurs
  drop constraint if exists lecteurs_annee_cathechetique_check;

alter table public.lecteurs
  add constraint lecteurs_annee_cathechetique_check
  check (
    annee_cathechetique is null
    or annee_cathechetique in (
      '1ère Année',
      '2ème Année',
      '3ème Année',
      '4ème Année',
      '5ème Année'
    )
  );

create index if not exists idx_lecteurs_annee_cathechetique
  on public.lecteurs (annee_cathechetique);

comment on column public.lecteurs.annee_cathechetique is
  'Année de catéchèse en cours (1ère Année → 5ème Année). NULL = Aucun.';

-- ----------------------------------------------------------------------------
-- Trigger de protection des champs de la fiche : la nouvelle colonne est
-- ajoutée à la liste des champs que seuls Admin / CO peuvent modifier.
-- (Recréation complète de la fonction, identique à la migration
-- 20260914150600 à l'exception de la ligne ajoutée.)
-- ----------------------------------------------------------------------------
create or replace function public.check_lecteur_update()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_role text;
begin
  v_role := public.current_role();

  if v_role = 'admin' then
    return new;
  end if;

  if v_role in ('co', 'co_paroissial') then
    if new.matricule is distinct from old.matricule then
      raise exception 'Le matricule est définitif et ne peut pas être modifié';
    end if;
    return new;
  end if;

  if new.id                   is distinct from old.id
     or new.matricule            is distinct from old.matricule
     or new.nom                  is distinct from old.nom
     or new.prenom               is distinct from old.prenom
     or new.date_naissance       is distinct from old.date_naissance
     or new.grade_id             is distinct from old.grade_id
     or new.annee_adhesion       is distinct from old.annee_adhesion
     or new.annee_cathechetique  is distinct from old.annee_cathechetique
     or new.adresse              is distinct from old.adresse
     or new.contact_parent       is distinct from old.contact_parent
     or new.archived             is distinct from old.archived
     or new.archived_at          is distinct from old.archived_at
     or new.created_at           is distinct from old.created_at then
    raise exception 'Droits insuffisants : votre rôle ne peut modifier que la fraternité. Adressez-vous à l''Admin ou au CO pour toute autre correction.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_check_lecteur_update on public.lecteurs;
create trigger trg_check_lecteur_update
  before update on public.lecteurs
  for each row
  execute function public.check_lecteur_update();
