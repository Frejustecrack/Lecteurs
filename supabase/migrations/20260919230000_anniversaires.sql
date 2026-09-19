-- Anniversaires : uniquement le mois courant au Bénin, lecteurs actifs.
-- Additif : aucune colonne ni donnée existante modifiée.
create index if not exists idx_lecteurs_mois_naissance_actifs
  on public.lecteurs ((extract(month from date_naissance)))
  where not archived and date_naissance is not null;

-- Pas de date de naissance complète, de coordonnées ou d'informations familiales
-- envoyées au navigateur : uniquement ce qui sert à la liste et à la carte.
create or replace view public.v_anniversaires_mois
with (security_invoker = true)
as
select l.id, l.matricule, l.nom, l.prenom,
       extract(day from l.date_naissance)::int as jour,
       extract(month from l.date_naissance)::int as mois,
       extract(year from public.aujourdhui_benin())::int as annee,
       (extract(year from public.aujourdhui_benin()) - extract(year from l.date_naissance))::int as age_atteint
  from public.lecteurs l
 where public.a_un_role()
   and not l.archived
   and l.date_naissance is not null
   and isfinite(l.date_naissance)
   and l.date_naissance >= date '0001-01-01'
   and l.date_naissance <= public.aujourdhui_benin()
   and extract(month from l.date_naissance) = extract(month from public.aujourdhui_benin());

revoke all on public.v_anniversaires_mois from public, anon, authenticated;
grant select on public.v_anniversaires_mois to authenticated;

-- Relecture individuelle au clic : droits d'export vérifiés côté serveur aussi.
-- SECURITY INVOKER conserve les RLS de la table lecteurs et les restrictions
-- de la vue (pas d'export d'un lecteur archivé ou d'un autre mois).
create or replace function public.carte_anniversaire(p_lecteur uuid)
returns setof public.v_anniversaires_mois
language plpgsql stable security invoker set search_path = public
as $$
begin
  if auth.uid() is null or not coalesce(public.current_role() in ('admin', 'co', 'co_paroissial', 'caissier'), false) then
    raise exception 'Vous n''êtes pas autorisé à télécharger une carte d''anniversaire.' using errcode = '42501';
  end if;
  return query select * from public.v_anniversaires_mois where id = p_lecteur;
end;
$$;
revoke all on function public.carte_anniversaire(uuid) from public, anon;
grant execute on function public.carte_anniversaire(uuid) to authenticated;
