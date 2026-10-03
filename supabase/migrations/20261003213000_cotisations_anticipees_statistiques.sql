-- Clarifier la séparation entre paiement anticipé et cotisation arrivée.
--
-- Un Caissier peut encaisser une cotisation pour un samedi futur. Cet argent
-- entre immédiatement dans la caisse et reste visible dans les cumuls
-- financiers. En revanche, ce paiement ne doit pas gonfler le taux de
-- cotisation du mois avant que le samedi concerné soit arrivé.

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
     and c.date_samedi <= public.aujourdhui_benin()
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

comment on view public.v_cotisations_par_mois is
  'Statistiques des cotisations dont le samedi est arrivé. Les paiements anticipés restent dans la caisse mais n''entrent dans ce taux qu''à leur date.';
