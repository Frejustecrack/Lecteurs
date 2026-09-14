-- ============================================================================
-- CDLJ — Attribution des rôles aux comptes de l'application
-- Fichier « seed » : à exécuter UNE SEULE FOIS, dans le SQL Editor Supabase,
-- APRÈS la migration initiale (20260913000000_initial_schema.sql) et APRÈS
-- création des comptes dans Authentication → Users.
--
-- Les 9 comptes prévus au cahier des charges (§4) :
--   1 Administrateur système · 1 CO · 2 Caissiers · 5 Responsables
--
-- PRINCIPE
--   Les comptes (email + mot de passe) sont créés dans le dashboard Supabase :
--   Authentication → Users → « Add user » (cocher « Auto confirm user »).
--   L'email d'un compte est toujours  <identifiant>@lecteurs.cdlj
--   (domaine interne : il ne sert jamais à envoyer un courriel).
--   Ce script se contente d'associer un RÔLE applicatif à chaque compte.
--
-- SÉCURITÉ
--   public.set_role() est volontairement retirée aux rôles anon/authenticated :
--   seul l'éditeur SQL (postgres) peut l'exécuter. Ce script n'est donc PAS
--   appliqué automatiquement par l'intégration GitHub, et c'est voulu.
-- ============================================================================

do $$
declare
  rec       record;
  manquants text := '';
  nb_ok     int  := 0;
begin
  for rec in
    with comptes(identifiant, nom, role) as (
      values
        -- ── Administrateur système (1) ──────────────────────────────────────
        ('admin',   'À COMPLÉTER — Administrateur système', 'admin'),
        -- ── Chargé des Opérations (1) ───────────────────────────────────────
        ('co',      'À COMPLÉTER — Chargé des Opérations',  'co'),
        -- ── Responsables Caisse (2) ─────────────────────────────────────────
        ('caisse1', 'À COMPLÉTER — Responsable Caisse 1',   'caissier'),
        ('caisse2', 'À COMPLÉTER — Responsable Caisse 2',   'caissier'),
        -- ── Responsables standards (5) ──────────────────────────────────────
        ('resp1',   'À COMPLÉTER — Responsable 1',          'responsable'),
        ('resp2',   'À COMPLÉTER — Responsable 2',          'responsable'),
        ('resp3',   'À COMPLÉTER — Responsable 3',          'responsable'),
        ('resp4',   'À COMPLÉTER — Responsable 4',          'responsable'),
        ('resp5',   'À COMPLÉTER — Responsable 5',          'responsable')
    )
    select c.identifiant, c.nom, c.role, u.id as user_id
      from comptes c
      left join auth.users u
        on lower(u.email) = lower(c.identifiant || '@lecteurs.cdlj')
  loop
    if position('À COMPLÉTER' in rec.nom) > 0 then
      raise exception
        'Fichier non complété : remplacez les « À COMPLÉTER » par les vrais noms avant exécution.';
    end if;

    if rec.user_id is null then
      manquants := manquants || case when manquants = '' then '' else ', ' end
                   || rec.identifiant;
    else
      perform public.set_role(rec.user_id, rec.role, rec.nom);
      nb_ok := nb_ok + 1;
    end if;
  end loop;

  raise notice 'Rôles attribués à % compte(s).', nb_ok;
  if manquants <> '' then
    raise warning
      'Compte(s) introuvable(s) dans auth.users (à créer dans le dashboard) : %',
      manquants;
  end if;
end;
$$;

-- Vérification : liste des comptes et de leur rôle
-- select username, full_name, role from public.profiles order by role, full_name;
