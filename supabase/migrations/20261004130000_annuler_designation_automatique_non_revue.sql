-- ============================================================================
-- Annulation de la désignation automatique non révisée par un humain
--
-- ERREUR CORRIGÉE
--   La migration précédente (20261004120000) appelait automatiquement
--   `reparer_designation_fraternite_animateur()` au déploiement, SANS
--   confirmation d'un Admin. Elle a désigné toute une fraternité sur la seule
--   foi d'un nom évocateur (« …animateur… ») et du fait qu'elle avait des
--   membres — sans jamais vérifier que CHACUN de ses membres est bien un
--   animateur. Résultat signalé : des lecteurs qui ne sont PAS des animateurs
--   se sont retrouvés facturés 100 F au lieu de 50 F, sans qu'aucun humain
--   n'ait validé ce changement. Une décision qui touche à l'argent ne doit
--   jamais s'appliquer sans qu'un Admin ne la vérifie et la confirme.
--
-- CORRECTIF
--   Annule précisément CETTE application automatique si elle est toujours en
--   place et que personne n'a agi depuis (le dernier journal
--   `fraternite.tarif_animateur` porte encore `origine = 'reparation_automatique'`).
--   Si un Admin a déjà confirmé ou changé la désignation depuis (un journal
--   plus récent existe, sans cette origine), on ne touche à RIEN : sa
--   décision, prise en connaissance de cause, prévaut.
--
--   Après cette migration, plus aucune fraternité n'est automatiquement
--   désignée par le système. `reparer_designation_fraternite_animateur()`
--   reste disponible (Admin uniquement) pour SUGGÉRER un candidat — jamais
--   pour l'appliquer tout seul. La désignation reste un acte conscient : écran
--   Fraternités, avec confirmation explicite avant tout recalcul de cotisations.
--
-- Script idempotent : sans effet si déjà appliqué, ou si rien à annuler.
-- ============================================================================

do $$
declare
  v_last_detail jsonb;
  v_marked      uuid;
  v_marked_nom  text;
  v_tarif_normal int;
begin
  select detail into v_last_detail
  from public.logs
  where action = 'fraternite.tarif_animateur'
  order by id desc
  limit 1;

  if v_last_detail is null or coalesce(v_last_detail->>'origine', '') <> 'reparation_automatique' then
    -- Rien n'a jamais été désigné automatiquement, ou un Admin a déjà agi
    -- APRÈS coup (confirmé ou changé) : on ne revient pas sur sa décision.
    return;
  end if;

  v_marked := nullif(v_last_detail->>'nouvelle_fraternite', '')::uuid;
  if v_marked is null then
    return;
  end if;

  -- La désignation automatique est-elle toujours en place ?
  select nom into v_marked_nom from public.fraternites
   where id = v_marked and system_key = 'animateur';
  if v_marked_nom is null then
    return;
  end if;

  perform set_config('cdlj.designation_animateur', '1', true);
  update public.fraternites set system_key = null where id = v_marked;
  perform set_config('cdlj.designation_animateur', '0', true);

  v_tarif_normal := coalesce(
    (select value::int from public.app_settings where key = 'montant_cotisation'), 50);

  update public.cotisations c set montant = v_tarif_normal
    from public.lecteurs l
   where l.id = c.lecteur_id and l.fraternite_id = v_marked and c.paye;

  perform public.log_action(
    'fraternite.tarif_animateur', 'fraternite', v_marked_nom,
    jsonb_build_object(
      'ancienne_fraternite', v_marked, 'nouvelle_fraternite', null,
      'origine', 'annulation_designation_non_revue',
      'raison', 'Désignation automatique du 04/10 annulée : elle facturait toute la fraternité sans vérification humaine que chaque membre est bien animateur.'
    )
  );
end $$;
