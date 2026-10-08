-- ============================================================================
-- CDLJ — Saisie des cotisations ouverte au CO paroissial
--
-- Jusqu'ici, la saisie des cotisations (insert / update / delete sur
-- public.cotisations) était réservée au Caissier (policies cotisations_insert,
-- cotisations_update, cotisations_delete : `public.is_caissier()`).
--
-- Décision du 08/10/2026 : le CO paroissial (`co_paroissial`) dispose désormais
-- des MÊMES droits de saisie que le Caissier. Le Caissier conserve évidemment
-- tous ses droits — rien ne lui est retiré.
--
-- À dessein :
--   - `co` (diocésain) n'a PAS ce droit : comme pour la fraternité
--     « Animateur », la montée en gamme est réservée au seul CO paroissial ;
--   - `admin` et `responsable` ne saisissent pas de cotisations (matrice du
--     cahier des charges inchangée sur ce point) ;
--   - la lecture (SELECT) reste ouverte à tout compte authentifié (inchangé) ;
--   - le gel ne s'applique pas aux cotisations : les mois passés restent
--     modifiables, paiements anticipés autorisés (inchangé).
--
-- `is_caissier()` est laissée intacte : elle répond à la question « le rôle
-- est strictement caissier ? ». La nouvelle fonction
-- `peut_saisir_cotisations()` exprime « a le droit de saisir » — elle est le
-- miroir exact du helper `peutSaisirCotisations()` de `src/lib/types.ts`.
--
-- Idempotente : rejouable sans effet de bord (vérifié par `npm run verif:db`).
-- ============================================================================

create or replace function public.peut_saisir_cotisations()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_role() in ('caissier', 'co_paroissial'), false);
$$;

grant execute on function public.peut_saisir_cotisations() to authenticated;

comment on function public.peut_saisir_cotisations() is
  'Droit de saisie des cotisations : caissier + co_paroissial (20261008120000).';

-- INSERT : Caissier + CO paroissial (le Caissier garde son droit).
drop policy if exists cotisations_insert on public.cotisations;
create policy cotisations_insert on public.cotisations
  for insert to authenticated with check (public.peut_saisir_cotisations());

-- UPDATE : Caissier + CO paroissial (pas de gel : mois passés modifiables).
drop policy if exists cotisations_update on public.cotisations;
create policy cotisations_update on public.cotisations
  for update to authenticated
  using (public.peut_saisir_cotisations())
  with check (public.peut_saisir_cotisations());

-- DELETE : Caissier + CO paroissial.
drop policy if exists cotisations_delete on public.cotisations;
create policy cotisations_delete on public.cotisations
  for delete to authenticated using (public.peut_saisir_cotisations());
