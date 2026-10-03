-- ============================================================================
-- Désignation de la fraternité au tarif « Animateur »
--
-- PROBLÈME CORRIGÉ
--   Le tarif spécial ne se déclenche pas sur le NOM d'une fraternité mais sur
--   le marqueur technique `system_key = 'animateur'`, posé une seule fois par
--   la migration 20261003220000 sur une fraternité nommée « Animateur ».
--
--   Dès que la communauté utilise une AUTRE fraternité pour ses animateurs
--   (créée à la main, nommée « Fraternité animateur », ou recréée après que
--   l'Admin eut supprimé l'originale vide — cas explicitement prévu par la
--   migration : « elle n'est pas recréée automatiquement »), ce marqueur
--   n'existe plus nulle part. Conséquence observée en production : les
--   animateurs sont facturés 50 F au lieu de 100 F, et RIEN dans l'interface
--   ne permet de réparer — `proteger_system_key_fraternite` interdit (à juste
--   titre) de poser le marqueur depuis un compte applicatif.
--
--   Le tarif Animateur devenait donc définitivement inapplicable.
--
-- SOLUTION
--   Un point d'entrée unique, réservé à l'Admin, qui DÉPLACE le marqueur d'une
--   fraternité à l'autre. Le marqueur reste impossible à poser par un UPDATE
--   direct : seule cette fonction peut le faire, via un drapeau de session que
--   le trigger de protection reconnaît.
--
--   Le déplacement recalcule l'historique des cotisations déjà payées des DEUX
--   côtés (ceux qui entrent dans le tarif spécial, ceux qui en sortent),
--   exactement comme le fait déjà un changement de fraternité individuel.
--
-- Script idempotent : ré-exécutable sans effet de bord.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Le trigger de protection accepte le drapeau posé par la fonction officielle
--
--    `current_setting(..., true)` renvoie NULL si le paramètre n'a jamais été
--    posé : pas d'erreur. Le drapeau est posé avec `is_local => true`, il
--    disparaît donc à la fin de la transaction — il ne peut pas « fuir » vers
--    une requête ultérieure de la même connexion.
-- ----------------------------------------------------------------------------
create or replace function public.proteger_system_key_fraternite()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and coalesce(current_setting('cdlj.designation_animateur', true), '') <> '1' then
    if tg_op = 'INSERT' and new.system_key is not null then
      raise exception 'Le statut système d''une fraternité est réservé au système';
    end if;
    if tg_op = 'UPDATE' and new.system_key is distinct from old.system_key then
      raise exception 'Le statut système d''une fraternité ne peut pas être modifié';
    end if;
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2) Déplacement du marqueur — Admin uniquement
--    p_fraternite = NULL retire le tarif spécial à tout le monde.
-- ----------------------------------------------------------------------------
create or replace function public.definir_fraternite_animateur(p_fraternite uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_ancienne uuid;
  v_nom      text;
  v_tarif_normal   int;
  v_tarif_special  int;
begin
  if auth.uid() is null then
    raise exception 'Session expirée — reconnectez-vous';
  end if;
  if not public.is_admin() then
    raise exception 'Droits insuffisants : seul l''Administrateur peut désigner la fraternité au tarif Animateur';
  end if;

  select id into v_ancienne from public.fraternites where system_key = 'animateur';

  if p_fraternite is not null then
    select nom into v_nom from public.fraternites where id = p_fraternite;
    if v_nom is null then
      raise exception 'Fraternité invalide';
    end if;
  end if;

  -- Rien à faire : on sort sans journaliser un non-événement.
  if v_ancienne is not distinct from p_fraternite then
    return;
  end if;

  perform set_config('cdlj.designation_animateur', '1', true);

  -- L'index unique partiel impose de libérer le marqueur avant de le reposer.
  if v_ancienne is not null then
    update public.fraternites set system_key = null where id = v_ancienne;
  end if;
  if p_fraternite is not null then
    update public.fraternites set system_key = 'animateur' where id = p_fraternite;
  end if;

  perform set_config('cdlj.designation_animateur', '0', true);

  -- ---- Recalcul de l'historique payé, des deux côtés du déplacement.
  -- `montant_cotisation_lecteur` relit la fraternité courante : on ne peut pas
  -- l'appeler avant d'avoir déplacé le marqueur, d'où cet ordre.
  v_tarif_normal := coalesce(
    (select value::int from public.app_settings where key = 'montant_cotisation'), 50);
  v_tarif_special := coalesce(
    (select value::int from public.app_settings where key = 'montant_cotisation_animateur'), 100);

  if v_ancienne is not null then
    update public.cotisations c
       set montant = v_tarif_normal
      from public.lecteurs l
     where l.id = c.lecteur_id
       and l.fraternite_id = v_ancienne
       and c.paye;
  end if;

  if p_fraternite is not null then
    update public.cotisations c
       set montant = v_tarif_special
      from public.lecteurs l
     where l.id = c.lecteur_id
       and l.fraternite_id = p_fraternite
       and c.paye;
  end if;

  perform public.log_action(
    'fraternite.tarif_animateur', 'fraternite',
    coalesce(v_nom, '—'),
    jsonb_build_object(
      'ancienne_fraternite', v_ancienne,
      'nouvelle_fraternite', p_fraternite,
      'tarif_special', v_tarif_special,
      'tarif_normal', v_tarif_normal
    )
  );
end;
$$;

revoke execute on function public.definir_fraternite_animateur(uuid) from public, anon;
grant execute on function public.definir_fraternite_animateur(uuid) to authenticated;

comment on function public.definir_fraternite_animateur(uuid) is
  'Déplace le marqueur system_key = ''animateur''. Admin uniquement. Recalcule les cotisations payées des deux fraternités concernées.';
