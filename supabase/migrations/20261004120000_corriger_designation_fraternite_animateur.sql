-- ============================================================================
-- Réparation automatique de la désignation « fraternité Animateur »
--
-- PROBLÈME CONSTATÉ EN PRODUCTION
--   La migration 20261003234500 a ajouté un écran pour désigner la bonne
--   fraternité, mais cette désignation reste une action MANUELLE réservée à
--   l'Admin, sur un écran (Administration → Paramètres) séparé de celui où
--   les fraternités et leurs membres sont réellement gérés (Fraternités).
--
--   Cas réel : une « Fraternité animateur » a été créée à la main (11 membres,
--   cotisations déjà encaissées), sans jamais passer par l'écran de
--   désignation — personne ne savait qu'il existait. Le marqueur système
--   `system_key = 'animateur'` est donc resté sur la fraternité vide « Animateur »
--   créée automatiquement par la toute première migration, et ces 11 lecteurs
--   ont été facturés 50 F au lieu de 100 F, sans que rien ne le signale.
--
-- CORRECTIF
--   Une fonction de réparation, appelée UNE FOIS ci-dessous pour corriger
--   l'état actuel de la base, et réutilisable ensuite :
--     - à la main par un Admin (bouton « Rescanner » de l'écran Fraternités) ;
--     - automatiquement par toute mise à jour future qui voudrait la rejouer.
--
--   Elle ne devine JAMAIS à l'aveugle : elle n'agit que si un seul candidat
--   est trouvé. Si la fraternité déjà marquée a des membres, ou si plusieurs
--   fraternités pourraient convenir, elle ne touche à rien.
--
-- CE QUI EST SUPPRIMÉ DANS LE MÊME MOUVEMENT (voir migration suivante côté
-- interface) : le réglage de la fraternité Animateur quitte l'écran
-- Administration → Paramètres (où personne ne va le chercher) et devient une
-- action visible directement sur l'écran Fraternités, accompagnée d'une
-- alerte quand la situation ci-dessus se reproduit.
--
-- Script idempotent : ré-exécutable sans effet de bord (la seconde exécution
-- ne trouve plus de candidat puisque la désignation est déjà faite).
-- ============================================================================

create or replace function public.reparer_designation_fraternite_animateur()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_marked        uuid;
  v_marked_nom    text;
  v_marked_vide   boolean;
  v_candidats     uuid[];
  v_candidats_nom text[];
  v_candidate     uuid;
  v_candidate_nom text;
  v_tarif_normal  int;
  v_tarif_special int;
begin
  -- Comme pour definir_fraternite_animateur : action Admin si un compte est
  -- connecté, mais exécutable sans restriction depuis une migration (aucune
  -- session, auth.uid() = null) afin de pouvoir réparer la base existante.
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Droits insuffisants : réservé à l''Administrateur';
  end if;

  select id, nom into v_marked, v_marked_nom
    from public.fraternites where system_key = 'animateur';
  v_marked_vide := v_marked is null or not exists (
    select 1 from public.lecteurs where fraternite_id = v_marked
  );

  if not v_marked_vide then
    -- La fraternité déjà désignée a des membres : configuration saine,
    -- on ne devine rien par-dessus une décision déjà prise.
    return jsonb_build_object('action', 'aucune', 'raison', 'deja_designee', 'fraternite', v_marked_nom);
  end if;

  select array_agg(f.id), array_agg(f.nom order by f.nom)
    into v_candidats, v_candidats_nom
  from public.fraternites f
  where f.id is distinct from v_marked
    and f.nom ilike '%animateur%'
    and exists (select 1 from public.lecteurs l where l.fraternite_id = f.id);

  if coalesce(array_length(v_candidats, 1), 0) = 0 then
    return jsonb_build_object('action', 'aucune', 'raison', 'aucun_candidat');
  end if;

  if array_length(v_candidats, 1) > 1 then
    -- Plusieurs fraternités pourraient convenir : mieux vaut qu'un Admin
    -- tranche explicitement (écran Fraternités) que de choisir au hasard.
    return jsonb_build_object('action', 'ambigu', 'candidats', v_candidats_nom);
  end if;

  v_candidate := v_candidats[1];
  v_candidate_nom := v_candidats_nom[1];

  perform set_config('cdlj.designation_animateur', '1', true);
  if v_marked is not null then
    update public.fraternites set system_key = null where id = v_marked;
  end if;
  update public.fraternites set system_key = 'animateur' where id = v_candidate;
  perform set_config('cdlj.designation_animateur', '0', true);

  v_tarif_normal := coalesce(
    (select value::int from public.app_settings where key = 'montant_cotisation'), 50);
  v_tarif_special := coalesce(
    (select value::int from public.app_settings where key = 'montant_cotisation_animateur'), 100);

  if v_marked is not null then
    update public.cotisations c set montant = v_tarif_normal
      from public.lecteurs l
     where l.id = c.lecteur_id and l.fraternite_id = v_marked and c.paye;
  end if;

  update public.cotisations c set montant = v_tarif_special
    from public.lecteurs l
   where l.id = c.lecteur_id and l.fraternite_id = v_candidate and c.paye;

  perform public.log_action(
    'fraternite.tarif_animateur', 'fraternite', coalesce(v_candidate_nom, '—'),
    jsonb_build_object(
      'ancienne_fraternite', v_marked, 'nouvelle_fraternite', v_candidate,
      'origine', 'reparation_automatique'
    )
  );

  -- Nettoyage : l'« Animateur » vide créée automatiquement par le système
  -- (migration 20261003220000), devenue inutile, n'est pas laissée comme
  -- doublon trompeur dans la liste des fraternités.
  if v_marked is not null
     and lower(btrim(v_marked_nom)) = 'animateur'
     and not exists (select 1 from public.lecteurs where fraternite_id = v_marked) then
    delete from public.fraternites where id = v_marked;
  end if;

  return jsonb_build_object(
    'action', 'corrigee',
    'fraternite_designee', v_candidate_nom,
    'ancienne_fraternite', v_marked_nom
  );
end;
$$;

revoke execute on function public.reparer_designation_fraternite_animateur() from public, anon;
grant execute on function public.reparer_designation_fraternite_animateur() to authenticated;

comment on function public.reparer_designation_fraternite_animateur() is
  'Désigne automatiquement une fraternité « ...animateur... » avec membres quand aucune fraternité marquée n''en a. N''agit jamais en cas d''ambiguïté. Admin uniquement en session authentifiée, libre depuis une migration.';

-- Correction immédiate de l'état actuel de la base de production.
select public.reparer_designation_fraternite_animateur();
