-- Durcissement sécurité sans casser la structure existante
-- Correctifs des failles les plus visibles

-- 1) S'assurer que RLS est bien actif partout (idempotent)
alter table public.grades enable row level security;
alter table public.profiles enable row level security;
alter table public.fraternites enable row level security;
alter table public.lecteurs enable row level security;
alter table public.lecteur_grades enable row level security;
alter table public.presences enable row level security;
alter table public.cotisations enable row level security;
alter table public.app_settings enable row level security;
alter table public.evenements enable row level security;
alter table public.evenement_participants enable row level security;
alter table public.evenement_paiements enable row level security;
alter table public.caisse_operations enable row level security;
alter table public.appreciations enable row level security;
alter table public.logs enable row level security;

-- 2) Vérifier que les montants ne peuvent pas être négatifs (défense en profondeur)
-- caisse_operations a déjà check (montant > 0), on ajoute pour evenements
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'evenements_montant_check' and conrelid = 'public.evenements'::regclass
  ) then
    alter table public.evenements add constraint evenements_montant_check check (montant_participation >= 0);
  end if;
end $$;

-- 3) Empêcher qu'un username soit vide si fourni (les comptes applicatifs ont toujours username)
-- On ne bloque pas null (compatibilité anciens comptes) mais on interdit la chaîne vide
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_username_not_empty' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles add constraint profiles_username_not_empty check (username is null or length(trim(username)) > 0);
  end if;
end $$;

-- 4) S'assurer que set_role reste inaccessible aux comptes applicatifs (défense en profondeur, déjà révoqué)
revoke execute on function public.set_role(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_role(uuid, text, text) to postgres, supabase_admin;

-- 5) S'assurer que la fonction log_action ne peut pas être usurpée (security definer déjà, mais on restreint)
revoke execute on function public.log_action(text, text, text, jsonb) from public, anon;
grant execute on function public.log_action(text, text, text, jsonb) to authenticated;

-- 6) Nettoyer les politiques orphelines si jamais une ancienne migration en a laissé
-- (aucune action destructive, juste un garde-fou)

-- 7) Commentaires pour l'audit
comment on table public.presences is 'Gel automatique : RLS autorise insert/update seulement si date_samedi >= dernier_samedi() ou is_admin()';
comment on table public.logs is 'Lecture Admin uniquement, écriture via triggers et log_action (security definer) uniquement';
