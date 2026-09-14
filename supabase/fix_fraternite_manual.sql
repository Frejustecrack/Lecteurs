-- ============================================================================
-- CORRECTIF MANUEL — changement de fraternité ouvert à tous les rôles
--
-- À coller dans Supabase → SQL Editor → Run, si l'intégration GitHub n'a pas
-- encore appliqué la migration 20260914150600_allow_fraternity_change.sql.
-- Contenu identique à cette migration. Script idempotent.
-- ============================================================================

-- 1) Fonction : changer la fraternité d'un lecteur (tout rôle authentifié)
--    p_fraternite = NULL retire le lecteur de sa fraternité
-- ----------------------------------------------------------------------------
create or replace function public.changer_fraternite(p_lecteur uuid, p_fraternite uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_matricule text;
  v_ancienne  uuid;
begin
  if auth.uid() is null then
    raise exception 'Session expirée — reconnectez-vous';
  end if;

  select matricule, fraternite_id into v_matricule, v_ancienne
    from public.lecteurs where id = p_lecteur;

  if v_matricule is null then
    raise exception 'Lecteur introuvable';
  end if;

  if p_fraternite is not null
     and not exists (select 1 from public.fraternites where id = p_fraternite) then
    raise exception 'Fraternité invalide';
  end if;

  update public.lecteurs
     set fraternite_id = p_fraternite,
         updated_at    = now()
   where id = p_lecteur;

  perform public.log_action(
    'lecteur.fraternite', 'lecteur', v_matricule,
    jsonb_build_object(
      'ancienne_fraternite', v_ancienne,
      'nouvelle_fraternite', p_fraternite
    )
  );
end;
$$;

revoke execute on function public.changer_fraternite(uuid, uuid) from public, anon;
grant execute on function public.changer_fraternite(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2) Garde-fou : contrôle colonne par colonne sur UPDATE
--    Admin  → tout autorisé
--    CO     → tout sauf le matricule (jamais réattribué)
--    Autres → fraternite_id (et updated_at) UNIQUEMENT
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

  if new.id             is distinct from old.id
     or new.matricule      is distinct from old.matricule
     or new.nom            is distinct from old.nom
     or new.prenom         is distinct from old.prenom
     or new.date_naissance is distinct from old.date_naissance
     or new.grade_id       is distinct from old.grade_id
     or new.annee_adhesion is distinct from old.annee_adhesion
     or new.adresse        is distinct from old.adresse
     or new.contact_parent is distinct from old.contact_parent
     or new.archived       is distinct from old.archived
     or new.archived_at    is distinct from old.archived_at
     or new.created_at     is distinct from old.created_at then
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

-- ----------------------------------------------------------------------------
-- 3) Politique d'ouverture : l'UPDATE est autorisé à tout connecté,
--    le trigger ci-dessus fait le filtrage réel.
--    (Les politiques RLS ne peuvent pas porter sur une seule colonne.)
-- ----------------------------------------------------------------------------
drop policy if exists lecteurs_update_fraternite on public.lecteurs;
create policy lecteurs_update_fraternite on public.lecteurs
  for update to authenticated
  using (true)
  with check (true);
