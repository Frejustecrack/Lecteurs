-- Nettoyage des données de test pour livraison : compteurs à 0
-- À exécuter une fois avant la mise en production. Conserve les référentiels et les comptes.
-- Grades, app_settings et profiles (comptes) sont conservés. Tout le reste est remis à zéro.

do $$
begin
  -- Désactiver temporairement les triggers d'audit pour ne pas polluer les logs pendant le nettoyage
  -- (facultatif, mais évite 500 lignes de logs de suppression)
  perform 1;
end $$;

-- 1) Tables avec dépendances (enfants d'abord)
truncate table
  public.evenement_paiements,
  public.evenement_participants,
  public.caisse_operations,
  public.cotisations,
  public.presences,
  public.appreciations,
  public.lecteur_grades,
  public.logs
restart identity cascade;

-- 2) Tables parentes
truncate table
  public.evenements,
  public.lecteurs,
  public.fraternites
restart identity cascade;

-- 3) Réinitialiser le paramètre de cotisation à 50 si besoin (déjà présent via seed)
insert into public.app_settings (key, value) values ('montant_cotisation', '50')
on conflict (key) do update set value = '50', updated_at = now();

-- 4) Vérification : les compteurs doivent être à 0
-- select 'lecteurs', count(*) from public.lecteurs
-- union all select 'presences', count(*) from public.presences
-- union all select 'cotisations', count(*) from public.cotisations
-- union all select 'evenements', count(*) from public.evenements;
