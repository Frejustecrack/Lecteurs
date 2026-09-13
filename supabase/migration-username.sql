-- ============================================================================
-- MIGRATION : connexion par identifiant (username)
-- À exécuter UNE FOIS dans le SQL Editor, APRÈS le schéma principal
-- et AVANT la création des comptes.
-- ============================================================================

-- 1. Colonne username sur les profils
alter table public.profiles
  add column if not exists username text;

-- 2. Le profil récupère automatiquement le username à la création d'un compte
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, username)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'username',
      new.email
    ),
    new.raw_user_meta_data ->> 'username'
  );
  return new;
end;
$$;

-- Terminé. (Le trigger existant utilise automatiquement la nouvelle version.)
