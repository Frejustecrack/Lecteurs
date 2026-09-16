-- ============================================================================
-- Perf 200 lecteurs max : indexes composites pour les requêtes mensuelles
-- et fix du bug matricule race condition via SEQUENCE
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
