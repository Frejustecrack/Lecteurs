-- Migration : Date d'entrée en vigueur d'un lecteur (Premier samedi actif)
--
-- Détermine le premier samedi actif à partir de la date d'inscription (created_at).
-- Bloque toute insertion/modification de présence ou cotisation antérieure à ce samedi.

-- 1. Fonction de calcul du premier samedi actif (heure du Bénin)
create or replace function public.premier_samedi_actif(p_created_at timestamptz)
returns date
language sql
immutable
as $$
  select case
           when p_created_at is null then '1970-01-01'::date
           else (p_created_at at time zone 'Africa/Lagos')::date
                + (case
                     when extract(dow from (p_created_at at time zone 'Africa/Lagos')) = 6 then 0
                     else (6 - extract(dow from (p_created_at at time zone 'Africa/Lagos'))::int)
                   end)
         end;
$$;

comment on function public.premier_samedi_actif(timestamptz) is
  'Calcule le premier samedi actif d''un lecteur selon sa date d''inscription (fuseau Bénin).';

-- 2. Trigger de protection sur les présences
create or replace function public.check_presence_apres_premier_samedi()
returns trigger
language plpgsql
as $$
declare
  v_created_at timestamptz;
  v_premier_samedi date;
begin
  select created_at into v_created_at
    from public.lecteurs
   where id = new.lecteur_id;

  if v_created_at is not null then
    v_premier_samedi := public.premier_samedi_actif(v_created_at);
    if new.date_samedi < v_premier_samedi then
      raise exception 'Impossible d''enregistrer une présence pour la date % : antérieure au premier samedi actif du lecteur (%)', new.date_samedi, v_premier_samedi;
    end if;
  end if;

  return new;
end;
$$;

-- 3. Trigger de protection sur les cotisations
create or replace function public.check_cotisation_apres_premier_samedi()
returns trigger
language plpgsql
as $$
declare
  v_created_at timestamptz;
  v_premier_samedi date;
begin
  select created_at into v_created_at
    from public.lecteurs
   where id = new.lecteur_id;

  if v_created_at is not null then
    v_premier_samedi := public.premier_samedi_actif(v_created_at);
    if new.date_samedi < v_premier_samedi then
      raise exception 'Impossible d''enregistrer une cotisation pour la date % : antérieure au premier samedi actif du lecteur (%)', new.date_samedi, v_premier_samedi;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists check_presence_premier_samedi on public.presences;
create trigger check_presence_premier_samedi
  before insert or update on public.presences
  for each row execute function public.check_presence_apres_premier_samedi();

drop trigger if exists check_cotisation_premier_samedi on public.cotisations;
create trigger check_cotisation_premier_samedi
  before insert or update on public.cotisations
  for each row execute function public.check_cotisation_apres_premier_samedi();

-- 4. Vue d'agrégation mise à jour
create or replace view public.v_presences_par_mois
with (security_invoker = true)
as
select to_char(p.date_samedi, 'YYYY-MM')                       as mois,
       count(*) filter (where p.statut = 'present')::int        as presents,
       count(*) filter (where p.statut = 'absent')::int         as absents,
       count(distinct p.lecteur_id) filter (where p.statut = 'present')::int as lecteurs_presents,
       count(distinct p.date_samedi)::int                       as samedis_pointes
  from public.presences p
  join public.lecteurs l on l.id = p.lecteur_id and not l.archived
 where p.date_samedi <= public.aujourdhui_benin()
   and p.date_samedi >= public.premier_samedi_actif(l.created_at)
 group by 1;
grant select on public.v_presences_par_mois to authenticated;
