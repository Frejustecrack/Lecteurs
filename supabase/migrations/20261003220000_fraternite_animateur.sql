-- Fraternité système « Animateur » et tarif hebdomadaire distinct.
-- Créée une fois par le système. Si un Admin la supprime lorsqu'elle est vide,
-- elle n'est pas recréée automatiquement (décision métier).

alter table public.fraternites
  add column if not exists system_key text;
create unique index if not exists fraternites_system_key_unique
  on public.fraternites (system_key) where system_key is not null;

-- Si une fraternité ordinaire portant déjà ce nom existe, le système l'adopte
-- afin de ne pas échouer sur la contrainte d'unicité du nom.
update public.fraternites
   set system_key = 'animateur'
 where lower(btrim(nom)) = 'animateur'
   and system_key is null
   and not exists (select 1 from public.fraternites where system_key = 'animateur');

insert into public.fraternites (nom, responsables, system_key)
select 'Animateur', array[]::text[], 'animateur'
where not exists (select 1 from public.fraternites where system_key = 'animateur');

insert into public.app_settings (key, value)
values ('montant_cotisation_animateur', '100')
on conflict (key) do nothing;

-- Le tarif dépend de la fraternité actuelle du lecteur.
create or replace function public.montant_cotisation_lecteur(p_lecteur uuid)
returns int language sql stable security definer set search_path = public as $$
  select case when f.system_key = 'animateur'
    then coalesce((select value::int from public.app_settings where key = 'montant_cotisation_animateur'), 100)
    else coalesce((select value::int from public.app_settings where key = 'montant_cotisation'), 50)
  end
  from public.lecteurs l
  left join public.fraternites f on f.id = l.fraternite_id
  where l.id = p_lecteur;
$$;
grant execute on function public.montant_cotisation_lecteur(uuid) to authenticated;

create or replace function public.fixer_montant_cotisation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.paye and (tg_op = 'INSERT' or not old.paye) then
    new.montant := coalesce(public.montant_cotisation_lecteur(new.lecteur_id), public.montant_cotisation_courant());
    new.paid_at := coalesce(new.paid_at, now());
  end if;
  if not new.paye then
    new.montant := 0;
    new.paid_at := null;
  end if;
  return new;
end;
$$;

-- Entrer dans Animateur ou en sortir est réservé strictement au CO paroissial.
-- Le changement recalcule tout l'historique payé, conformément à la règle métier.
create or replace function public.changer_fraternite(p_lecteur uuid, p_fraternite uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_matricule text;
  v_ancienne uuid;
  v_ancienne_speciale boolean;
  v_nouvelle_speciale boolean;
begin
  if auth.uid() is null then raise exception 'Session expirée — reconnectez-vous'; end if;

  select matricule, fraternite_id into v_matricule, v_ancienne
    from public.lecteurs where id = p_lecteur;
  if v_matricule is null then raise exception 'Lecteur introuvable'; end if;
  if p_fraternite is not null and not exists (select 1 from public.fraternites where id = p_fraternite) then
    raise exception 'Fraternité invalide';
  end if;

  v_ancienne_speciale := exists(select 1 from public.fraternites where id = v_ancienne and system_key = 'animateur');
  v_nouvelle_speciale := exists(select 1 from public.fraternites where id = p_fraternite and system_key = 'animateur');
  if (v_ancienne_speciale or v_nouvelle_speciale)
     and public.current_role() is distinct from 'co_paroissial' then
    raise exception 'Seul le CO paroissial peut ajouter ou retirer un membre de la fraternité Animateur';
  end if;

  update public.lecteurs set fraternite_id = p_fraternite, updated_at = now() where id = p_lecteur;

  perform public.log_action('lecteur.fraternite', 'lecteur', v_matricule,
    jsonb_build_object('ancienne_fraternite', v_ancienne, 'nouvelle_fraternite', p_fraternite,
                       'historique_cotisations_recalcule', v_ancienne_speciale is distinct from v_nouvelle_speciale));
end;
$$;
revoke execute on function public.changer_fraternite(uuid, uuid) from public, anon;
grant execute on function public.changer_fraternite(uuid, uuid) to authenticated;

-- Bloque aussi les contournements par INSERT/UPDATE direct.
create or replace function public.proteger_affectation_animateur()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_old_special boolean := false; v_new_special boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_old_special := exists(select 1 from public.fraternites where id = old.fraternite_id and system_key = 'animateur');
  end if;
  v_new_special := exists(select 1 from public.fraternites where id = new.fraternite_id and system_key = 'animateur');
  if (v_old_special or v_new_special)
     and (tg_op = 'INSERT' or new.fraternite_id is distinct from old.fraternite_id)
     and public.current_role() is distinct from 'co_paroissial' then
    raise exception 'Seul le CO paroissial peut gérer les membres de la fraternité Animateur';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_proteger_affectation_animateur on public.lecteurs;
create trigger trg_proteger_affectation_animateur
  before insert or update of fraternite_id on public.lecteurs
  for each row execute function public.proteger_affectation_animateur();

-- Le recalcul est un trigger afin de couvrir le RPC comme toute éventuelle
-- mise à jour directe autorisée au CO paroissial.
create or replace function public.recalculer_cotisations_changement_animateur()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_old_special boolean; v_new_special boolean; v_tarif int;
begin
  v_old_special := exists(select 1 from public.fraternites where id = old.fraternite_id and system_key = 'animateur');
  v_new_special := exists(select 1 from public.fraternites where id = new.fraternite_id and system_key = 'animateur');
  if v_old_special is distinct from v_new_special then
    v_tarif := coalesce(public.montant_cotisation_lecteur(new.id), public.montant_cotisation_courant());
    update public.cotisations set montant = v_tarif where lecteur_id = new.id and paye;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_recalcul_cotisations_animateur on public.lecteurs;
create trigger trg_recalcul_cotisations_animateur
  after update of fraternite_id on public.lecteurs
  for each row when (new.fraternite_id is distinct from old.fraternite_id)
  execute function public.recalculer_cotisations_changement_animateur();

-- Le nom et les responsables restent modifiables selon les règles ordinaires,
-- mais le marqueur système ne peut jamais être ajouté, retiré ou transféré via
-- un compte applicatif.
create or replace function public.proteger_system_key_fraternite()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
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
drop trigger if exists trg_proteger_system_key_fraternite on public.fraternites;
create trigger trg_proteger_system_key_fraternite
  before insert or update of system_key on public.fraternites
  for each row execute function public.proteger_system_key_fraternite();

-- Une fraternité avec membres reste protégée par la FK. Animateur vide ne peut
-- être supprimée que par l'Admin ; les règles ordinaires restent inchangées.
create or replace function public.proteger_fraternite_animateur()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.system_key = 'animateur' and not public.is_admin() then
    raise exception 'Seul l''Admin peut supprimer la fraternité Animateur lorsqu''elle est vide';
  end if;
  return old;
end;
$$;
drop trigger if exists trg_proteger_fraternite_animateur on public.fraternites;
create trigger trg_proteger_fraternite_animateur
  before delete on public.fraternites for each row execute function public.proteger_fraternite_animateur();

-- Seul l'Admin modifie les deux paramètres ; cette policy existe déjà mais est
-- réaffirmée pour documenter le nouveau tarif.
drop policy if exists settings_update on public.app_settings;
create policy settings_update on public.app_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Les écrans Cotisations ouverts se mettent à jour dès qu'un Admin change un tarif.
do $$
begin
  alter publication supabase_realtime add table public.app_settings;
exception when duplicate_object then null;
end $$;
alter table public.app_settings replica identity full;
