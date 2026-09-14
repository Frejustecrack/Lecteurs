-- ============================================================================
-- CORRECTIF MANUEL — journal automatique (audit_trigger)
--
-- À coller dans Supabase → SQL Editor → Run, si l'intégration GitHub n'a pas
-- encore appliqué la migration 20260914150700_fix_audit_trigger.sql.
-- Contenu identique à cette migration. Script idempotent.
--
-- ⚠ À exécuter EN PRIORITÉ : sans lui, aucun insert ne passe sur
--   fraternites / lecteurs / presences / cotisations / evenements…
--   (ERROR: record "new" has no field "matricule")
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
