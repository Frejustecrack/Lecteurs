-- ============================================================================
-- PR8 — Renommage des grades « Animation Grand I / II » en « Animation I / II »
--
-- Rectification de nomenclature : les grades 5 et 6 deviennent :
--   - id 5 : 'Animation I'  (auparavant 'Animation Grand I')
--   - id 6 : 'Animation II' (auparavant 'Animation Grand II')
--
-- Les clés primaires (id = 5, 6) étant inchangées, aucune rupture de clé
-- étrangère n'intervient sur `lecteurs` (grade_id) ni `lecteur_grades` (grade_id).
-- Les fiches lecteurs et historiques existants affichent automatiquement
-- les nouveaux libellés.
--
-- Script idempotent : ré-exécutable sans effet de bord.
-- ============================================================================

update public.grades
   set nom = 'Animation I'
 where id = 5;

update public.grades
   set nom = 'Animation II'
 where id = 6;
