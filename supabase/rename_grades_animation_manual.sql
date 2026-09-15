-- ============================================================================
-- CORRECTIF MANUEL — renommage des grades Animation Grand I/II en Animation I/II
--
-- À coller dans Supabase → SQL Editor → Run, si l'intégration GitHub n'a pas
-- encore appliqué la migration 20260915120000_rename_grades_animation.sql.
-- Contenu identique à cette migration. Script idempotent.
-- ============================================================================

update public.grades
   set nom = 'Animation I'
 where id = 5;

update public.grades
   set nom = 'Animation II'
 where id = 6;
