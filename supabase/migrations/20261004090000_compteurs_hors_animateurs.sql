-- ============================================================================
-- Compteurs d'effectif : distinguer lecteurs et animateurs
--
-- PROBLÈME CORRIGÉ
--   Les écrans Présences, Cotisations et Suivis excluent désormais les
--   animateurs de leur vue globale : ce sont des encadrants, à tarif distinct,
--   et les compter avec les lecteurs fausse effectif, dû et taux de présence.
--
--   Le tableau de bord, lui, lit `v_lecteurs_compteurs`, qui compte TOUS les
--   non-archivés. Deux écrans de la même application annonçaient donc deux
--   effectifs différents pour la même communauté, sans que rien ne l'explique.
--
-- CE QUI N'EST VOLONTAIREMENT PAS CHANGÉ
--   Les vues d'argent (`v_caisse_totaux`, `v_cotisations_par_mois`,
--   `v_cotisations_par_annee`) continuent d'inclure les animateurs : une
--   cotisation encaissée est encaissée, quel que soit le payeur. Retirer les
--   animateurs d'un total de caisse le rendrait faux.
--
--   La correction porte donc sur l'EFFECTIF, pas sur la trésorerie.
--
-- Script idempotent : ré-exécutable sans effet de bord.
-- ============================================================================

create or replace view public.v_lecteurs_compteurs
with (security_invoker = true)
as
select
  count(*) filter (where not l.archived)::int as actifs,
  count(*) filter (where l.archived)::int     as archives,
  -- Animateurs actifs : membres de la fraternité portant le marqueur système.
  count(*) filter (
    where not l.archived and f.system_key = 'animateur'
  )::int                                      as animateurs,
  -- Effectif tel que l'affichent les vues globales de suivi hebdomadaire.
  count(*) filter (
    where not l.archived and (f.system_key is distinct from 'animateur')
  )::int                                      as actifs_hors_animateurs
from public.lecteurs l
left join public.fraternites f on f.id = l.fraternite_id;

grant select on public.v_lecteurs_compteurs to authenticated;

comment on view public.v_lecteurs_compteurs is
  'Effectifs. `actifs` = tous les non-archivés (compatibilité). `actifs_hors_animateurs` = périmètre des vues globales Présences/Cotisations/Suivis.';
