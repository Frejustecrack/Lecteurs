-- Migration : le « premier samedi actif » est respecté PARTOUT dans les statistiques
--
-- La migration 20260919120000 a posé la règle (fonction `premier_samedi_actif`
-- + triggers de refus sur presences/cotisations) et filtré `v_presences_par_mois`.
-- Il restait deux angles morts, alors que le cahier des charges exige que les
-- samedis antérieurs au premier samedi actif « ne doivent jamais être
-- comptabilisés » ni « influencer les statistiques » :
--
--   1. Les vues de cotisations (v_cotisations_par_mois, v_cotisations_par_annee,
--      v_encaissements_par_mois, v_caisse_totaux) ne filtraient pas les lignes
--      antérieures au premier samedi actif du lecteur. Tant que les triggers
--      bloquent la création, c'est inoffensif sur une base saine ; mais les
--      statistiques devaient être garanties par la base partout, à l'image de
--      v_presences_par_mois (historique des cotisations, total attendu,
--      montants encaissés, caisse générale).
--   2. Le tableau de bord calculait le taux de présence avec le dénominateur
--      « lecteurs actifs × samedis du mois », donc il comptait les samedis
--      antérieurs au premier samedi actif des lecteurs inscrits en cours de
--      mois. Les deux vues mensuelles gagnent une colonne d'éligibilité :
--        - v_presences_par_mois.samedis_eligibles : nombre de paires
--          (lecteur actif, samedi arrivé du mois ≥ son premier samedi actif) ;
--        - v_cotisations_par_mois.lecteurs_eligibles : nombre de lecteurs
--          actifs ayant au moins un samedi arrivé du mois ≥ leur premier
--          samedi actif.
--
-- Sémantique caisse conservée : les jointures des vues de caisse sont faites
-- SANS filtre « not archived » — un lecteur archivé garde son argent compté
-- (l'archivage est un bannissement, pas une effacement du passé).
--
-- Idempotente : CREATE OR REPLACE VIEW + GRANT.

-- 1. v_presences_par_mois : + colonne samedis_eligibles
create or replace view public.v_presences_par_mois
with (security_invoker = true)
as
with mois_base as (
  select to_char(p.date_samedi, 'YYYY-MM')                        as mois,
         count(*) filter (where p.statut = 'present')::int        as presents,
         count(*) filter (where p.statut = 'absent')::int         as absents,
         count(distinct p.lecteur_id) filter (where p.statut = 'present')::int as lecteurs_presents,
         count(distinct p.date_samedi)::int                       as samedis_pointes
    from public.presences p
    join public.lecteurs l on l.id = p.lecteur_id and not l.archived
   where p.date_samedi <= public.aujourdhui_benin()
     and p.date_samedi >= public.premier_samedi_actif(l.created_at)
   group by 1
)
select m.mois,
       m.presents,
       m.absents,
       m.lecteurs_presents,
       m.samedis_pointes,
       (select count(*)::int
          from public.lecteurs l2,
               generate_series(
                 to_date(m.mois || '-01', 'YYYY-MM-DD')::date,
                 (to_date(m.mois || '-01', 'YYYY-MM-DD')::date + interval '1 month'
                  - interval '1 day')::date,
                 interval '1 day') g(d)
         where not l2.archived
           and extract(isodow from g.d::date) = 6
           and g.d::date <= public.aujourdhui_benin()
           and g.d::date >= public.premier_samedi_actif(l2.created_at)
       ) as samedis_eligibles
  from mois_base m;

grant select on public.v_presences_par_mois to authenticated;

-- 2. v_cotisations_par_mois : filtre premier samedi actif + lecteurs_eligibles
create or replace view public.v_cotisations_par_mois
with (security_invoker = true)
as
with mois_base as (
  select to_char(c.date_samedi, 'YYYY-MM')          as mois,
         sum(c.montant)::bigint                      as total,
         count(distinct c.lecteur_id)::int           as lecteurs_payes,
         count(*)::int                               as nb
    from public.cotisations c
    join public.lecteurs l on l.id = c.lecteur_id and not l.archived
   where c.paye
     and c.date_samedi >= public.premier_samedi_actif(l.created_at)
   group by 1
)
select m.mois,
       m.total,
       m.lecteurs_payes,
       m.nb,
       (select count(distinct l2.id)::int
          from public.lecteurs l2,
               generate_series(
                 to_date(m.mois || '-01', 'YYYY-MM-DD')::date,
                 (to_date(m.mois || '-01', 'YYYY-MM-DD')::date + interval '1 month'
                  - interval '1 day')::date,
                 interval '1 day') g(d)
         where not l2.archived
           and extract(isodow from g.d::date) = 6
           and g.d::date <= public.aujourdhui_benin()
           and g.d::date >= public.premier_samedi_actif(l2.created_at)
       ) as lecteurs_eligibles
  from mois_base m;

grant select on public.v_cotisations_par_mois to authenticated;

-- 3. v_encaissements_par_mois : filtre premier samedi actif (montants encaissés)
create or replace view public.v_encaissements_par_mois
with (security_invoker = true)
as
select to_char(c.paid_at at time zone 'Africa/Lagos', 'YYYY-MM') as mois,
       sum(c.montant)::bigint                                     as total
  from public.cotisations c
  join public.lecteurs l on l.id = c.lecteur_id
 where c.paye and c.paid_at is not null
   and c.date_samedi >= public.premier_samedi_actif(l.created_at)
 group by 1;

grant select on public.v_encaissements_par_mois to authenticated;

-- 4. v_cotisations_par_annee : filtre premier samedi actif (cumul annuel)
create or replace view public.v_cotisations_par_annee
with (security_invoker = true)
as
select extract(year from c.date_samedi)::int as annee,
       sum(c.montant)::bigint                as total
  from public.cotisations c
  join public.lecteurs l on l.id = c.lecteur_id
 where c.paye
   and c.date_samedi >= public.premier_samedi_actif(l.created_at)
 group by 1;

grant select on public.v_cotisations_par_annee to authenticated;

-- 5. v_caisse_totaux : idem sur le total des cotisations de la caisse générale
create or replace view public.v_caisse_totaux
with (security_invoker = true)
as
select
  (select coalesce(sum(c.montant), 0)
     from public.cotisations c
     join public.lecteurs l on l.id = c.lecteur_id
    where c.paye
      and c.date_samedi >= public.premier_samedi_actif(l.created_at))                                          as total_cotisations,
  (select coalesce(sum(montant), 0) from public.caisse_operations where event_id is null and type = 'encaissement') as total_encaissements,
  (select coalesce(sum(montant), 0) from public.caisse_operations where event_id is null and type = 'decaissement') as total_decaissements;

grant select on public.v_caisse_totaux to authenticated;
