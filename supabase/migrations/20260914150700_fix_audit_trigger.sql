-- ============================================================================
-- PR5 — Correctif BLOQUANT du journal automatique (audit_trigger)
--
-- ⚠ Anomalie PRÉ-EXISTANTE, présente depuis le schéma initial
--   (20260913000000_initial_schema.sql), détectée par exécution réelle des
--   migrations sous PostgreSQL. Elle n'est pas introduite par la PR5, mais elle
--   rend inutilisable la chaîne « fraternités » que la PR5 délivre : sur une
--   base créée depuis ces migrations, AUCUN insert ne passe.
--
-- Cause : public.audit_trigger() est UNE fonction partagée par 10 tables, mais
--   elle référence `new.matricule`, colonne qui n'existe QUE sur `lecteurs`.
--   PL/pgSQL résout toutes les références de champs d'une expression au moment
--   de sa planification, y compris celles de la branche de CASE non exécutée :
--     v_ref := case when tg_table_name = 'lecteurs'
--                   then coalesce(new.matricule, old.matricule) ...
--   → dès que le trigger se déclenche sur fraternites, presences, cotisations,
--     evenements, lecteur_grades… l'erreur est levée :
--       ERROR: record "new" has no field "matricule"
--   Et `lecteurs` échoue aussi : son trigger AFTER INSERT (trg_grade_initial)
--   insère dans lecteur_grades, dont l'audit se déclenche en premier.
--
-- Correctif : plus aucune référence de champ à la compilation. La ligne est
--   convertie en jsonb (to_jsonb accepte n'importe quel type de ligne) et la
--   référence est lue par clé — absente = NULL. Comportement identique :
--   `objet_ref` reste le matricule pour lecteurs, l'uuid sinon.
--
-- Script idempotent : ré-exécutable sans effet de bord.
-- ============================================================================

create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_op  text := case tg_op when 'INSERT' then 'create'
                           when 'UPDATE' then 'update'
                           when 'DELETE' then 'delete' end;
  v_new jsonb;
  v_old jsonb;
  v_ref text;
  v_uid uuid := auth.uid();
begin
  -- to_jsonb() accepte n'importe quel type de ligne : aucune résolution de
  -- champ à la planification, donc aucune dépendance au nom des colonnes.
  v_new := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old := case when tg_op = 'INSERT' then null else to_jsonb(old) end;

  -- Matricule quand la table en a un (lecteurs), identifiant technique sinon.
  v_ref := coalesce(
    v_new ->> 'matricule', v_old ->> 'matricule',
    v_new ->> 'id',        v_old ->> 'id'
  );

  insert into public.logs (user_id, user_name, user_role, action, objet_type, objet_ref, detail)
  values (
    v_uid,
    (select full_name from public.profiles where id = v_uid),
    (select role      from public.profiles where id = v_uid),
    v_op, tg_table_name, v_ref,
    jsonb_build_object('avant', v_old, 'apres', v_new)
  );

  return coalesce(new, old);
end;
$$;

-- Les triggers pointent déjà sur public.audit_trigger() : la nouvelle version
-- prend effet immédiatement, aucune recréation de trigger n'est nécessaire.
