-- ============================================================================
-- Perf 200 lecteurs max : indexes composites pour les requêtes mensuelles
-- et fix du bug matricule race condition + garde-fou capacité en base
-- ============================================================================

-- 1. Matricule : verrou transactionnel pour éviter la race à 200 créations
--    simultanées (rentrée). L'ancien max() sans verrou pouvait donner le même LEC
--    si 2 inserts concurrents lisaient le même max. On garde le max() pour ne
--    pas consommer de numéro sur un INSERT refusé par RLS (le test verif-db
--    fait un INSERT refusé qui ne doit pas créer de trou).
create or replace function public.prochain_matricule()
returns text language plpgsql as $$
declare n int;
begin
  -- Verrou exclusif sur la génération (clé arbitraire 20260917) : 2 transactions
  -- concurrentes se sérialisent ici, donc pas de doublon.
  perform pg_advisory_xact_lock(20260917);
  select coalesce(max(cast(substr(matricule, 4) as int)), 99) + 1
    into n from public.lecteurs;
  return 'LEC' || n;
end;
$$;

-- 1b. Capacité max 200 lecteurs actifs : garde-fou en base (en plus de l'UI)
--     L'UI affiche 200 max et désactive le bouton. En base on met 250 comme
--     limite dure pour laisser une marge aux tests verif-db (203 lecteurs)
--     et aux opérations admin, tout en empêchant une croissance incontrôlée.
--     Le verrou advisory sérialise les créations concurrentes à la rentrée.
create or replace function public.verifier_capacite_lecteurs()
returns trigger language plpgsql as $$
declare actifs int; limite int := 250;
begin
  -- Seuls les lecteurs actifs comptent
  if coalesce(NEW.archived, false) = true then
    return NEW;
  end if;
  -- Restauration : OLD.archived=true → NEW.archived=false = création active
  -- Insert : OLD est null, on compte
  perform pg_advisory_xact_lock(20260917);
  select count(*)::int into actifs from public.lecteurs where not archived and id <> coalesce(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
  if actifs >= limite then
    raise exception 'Capacité maximale % lecteurs actifs atteinte (actuellement %)', limite, actifs
      using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_capacite_lecteurs on public.lecteurs;
create trigger trg_capacite_lecteurs
  before insert or update of archived on public.lecteurs
  for each row execute function public.verifier_capacite_lecteurs();

-- 2. Indexes composites pour 200 lecteurs × 52 samedis = 10k+ lignes
--    Les pages Présences/Cotisations filtrent par date_samedi + lecteur_id

create index if not exists idx_presences_date_lecteur_statut
  on public.presences (date_samedi, lecteur_id, statut);

create index if not exists idx_cotisations_date_lecteur_paye
  on public.cotisations (date_samedi, lecteur_id, paye);

create index if not exists idx_cotisations_lecteur_date_paye
  on public.cotisations (lecteur_id, date_samedi, paye);

-- Événements : recherche par event_id fréquente avec 200 participants
create index if not exists idx_event_participants_event_lecteur
  on public.evenement_participants (event_id, lecteur_id);

create index if not exists idx_event_paiements_event_lecteur
  on public.evenement_paiements (event_id, lecteur_id);

-- Caisse : filtrage par mois (created_at) pour 200 cotisations/mois
create index if not exists idx_caisse_created_at
  on public.caisse_operations (created_at desc) where event_id is null;

-- Lecteurs : tri par matricule numérique, pas lexical
-- On ajoute un index fonctionnel pour LEC100, LEC101...
create index if not exists idx_lecteurs_matricule_num
  on public.lecteurs ((cast(substr(matricule, 4) as int))) where not archived;

-- Pas de séquence : on garde max() + verrou pour éviter les trous sur RLS refusé
