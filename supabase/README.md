# Supabase — structure du dossier

```
supabase/
├── README.md
├── migrations/
│   ├── 20260913000000_initial_schema.sql
│   ├── 20260914150000_fraternites_delete_any.sql
│   ├── 20260914150100_enable_realtime.sql
│   ├── 20260914150200_evenements_delete_co.sql
│   ├── 20260914150300_clean_test_data.sql
│   ├── 20260914150400_security_hardening.sql
│   ├── 20260914150500_fix_rls_event_terminate.sql
│   ├── 20260914150600_allow_fraternity_change.sql
│   ├── 20260914150700_fix_audit_trigger.sql
│   ├── 20260915120000_rename_grades_animation.sql
│   └── 20260915180000_realtime_caisse_evenements.sql
│   ├── 20260916120000_securite_journal_rls.sql
│   └── 20260916150000_integrite_auteur_montant_agregats.sql
└── scripts/
    ├── seed-comptes.sql       ← attribution des rôles — à exécuter UNE fois (SQL Editor)
    └── clean_test_data.sql    ← remise à zéro — UNE fois, jamais en migration
```

## Contenu du schéma

| Objet | Détail |
| --- | --- |
| 14 tables | `grades`, `profiles`, `fraternites`, `lecteurs`, `lecteur_grades`, `presences`, `cotisations`, `app_settings`, `evenements`, `evenement_participants`, `evenement_paiements`, `caisse_operations`, `appreciations`, `logs` |
| Politiques RLS | droits par rôle (`is_admin()`, `is_co()`, `is_caissier()`), gel des présences passées, clôture des événements (WITH CHECK), suppression fraternité vide, `lecteurs_update_fraternite` |
| Triggers | matricule automatique `LEC100…`, historique de grade, plafond des tranches de paiement, `updated_at`, `check_lecteur_update`, journal d'audit sur 10 tables |
| Fonctions sensibles | `changer_grade()` (Admin + CO), `changer_fraternite()` (tout connecté), `log_action()` (tout compte connecté), `set_role()` (**SQL Editor uniquement**) |
| Realtime | publication `supabase_realtime` (8 tables, `replica identity full`) : `presences`, `cotisations`, `lecteurs`, `fraternites` + `caisse_operations`, `evenements`, `evenement_participants`, `evenement_paiements` |

## Migrations (ordre chronologique)

Une migration **déjà appliquée ne se modifie jamais**. On ajoute un nouveau fichier `AAAAMMJJHHMMSS_description.sql`.

| Fichier | Rôle |
| --- | --- |
| `20260913000000_initial_schema.sql` | Schéma initial (14 tables, RLS, triggers, fonctions). Idempotent. |
| `20260914150000_fraternites_delete_any.sql` | `fraternites_delete` ouvert à tout authentifié (fraternité vide : la FK bloque sinon). |
| `20260914150100_enable_realtime.sql` | Ajoute les 4 tables à `supabase_realtime` + `replica identity full`. |
| `20260914150200_evenements_delete_co.sql` | Contrainte `profiles_role_check` élargie (`co_paroissial`) ; `is_co()` bivalent ; `evenements_delete` Admin/CO. `DROP CONSTRAINT IF EXISTS` : rejouable. |
| `20260914150300_clean_test_data.sql` | **Neutralisée** (`select 1`). Contenait un `TRUNCATE` déjà exécuté en production ; le script vit dans `scripts/clean_test_data.sql`. Le fichier reste pour garder l'historique aligné. |
| `20260914150400_security_hardening.sql` | RLS forcé partout, `evenements_montant_check`, `profiles_username_not_empty`. |
| `20260914150500_fix_rls_event_terminate.sql` | `is_co()` bivalent ; `evenements_update` **WITH CHECK** (le CO peut clôturer `en_cours → termine`) ; `fraternites_delete` réaffirmé. |
| `20260914150600_allow_fraternity_change.sql` | `changer_fraternite(uuid, uuid)` SECURITY DEFINER + trigger `check_lecteur_update` + policy `lecteurs_update_fraternite` (cette dernière supprimée par `16120000`). |
| `20260914150700_fix_audit_trigger.sql` | `audit_trigger()` lit les colonnes via `to_jsonb()`. **Sans ce correctif, aucun INSERT ne passe** (`record "new" has no field "matricule"`). |
| `20260915120000_rename_grades_animation.sql` | Renomme les grades 5 et 6 (« Animation Grand I/II » → « Animation I/II ») pour alignement nomenclature CDLJ. |
| `20260915180000_realtime_caisse_evenements.sql` | Ajoute `caisse_operations`, `evenements`, `evenement_participants` et `evenement_paiements` à `supabase_realtime`. Le Dashboard écoutait déjà `caisse_operations`, qui n'était pas publiée : cet abonnement ne pouvait pas se déclencher. Aucune RLS modifiée — la diffusion reste filtrée par les policies de lecture existantes. |

| `20260916120000_securite_journal_rls.sql` | **Journal infalsifiable** : `log_action` révoquée aux comptes applicatifs ; `journal_client()` (liste blanche : connexion, déconnexion, export PDF ; auteur forcé à `auth.uid()`) ; le trigger d'audit qualifie lui-même `evenement.cloture` / `evenement.reouverture` / `evenement.suppression` / `presence.correction_gelee`. **`WITH CHECK`** sur `presences_update`, `caisse_update`, `epaiements_update` ; `caisse_delete` fermé au CO sur événement clôturé. `lecteurs_update_fraternite` supprimée (le RPC est la seule voie). `a_un_role()` : un compte sans rôle ne peut plus rien écrire. `set_role` accepte `co_paroissial`. Vues `v_caisse_totaux`, `v_cotisations_par_annee` (security invoker) + 6 index. Idempotente, vérifiée par `npm run verif:db`. |
| `20260916150000_integrite_auteur_montant_agregats.sql` | **Intégrité côté base** : triggers `forcer_auteur()` / `forcer_recorded_by_update()` (auteur = `auth.uid()`), `fixer_montant_cotisation()` (montant depuis `app_settings`, `paid_at` géré par la base), CHECK `isodow = 6` sur `presences` et `cotisations` (validée après contrôle, avertissement si violation historique), `refuser_lecteur_archive()`, `aujourdhui_benin()` / `dernier_samedi()` en `Africa/Lagos`, `handle_new_user` ne lit plus `raw_user_meta_data`. Vues `security_invoker` : `v_presences_par_mois`, `v_cotisations_par_mois`, `v_encaissements_par_mois`, `v_effectif_par_mois`, `v_evenements_avancement`, `v_lecteurs_compteurs`. Idempotente, vérifiée par `npm run verif:db` (203 lecteurs, > 10 000 lignes). |

### Scripts manuels (`scripts/`)

Ce ne sont **pas** des migrations : ils s'exécutent à la main, une fois, dans le SQL Editor.

| Script | Quand |
| --- | --- |
| `scripts/seed-comptes.sql` | Attribution des rôles aux 9 comptes, après création dans Authentication → Users. |
| `scripts/clean_test_data.sql` | Remise à zéro avant livraison (conserve `profiles`, `grades`, `app_settings`). |

## Synchronisation GitHub ↔ Supabase (intégration Git)

L'intégration est **unidirectionnelle** : GitHub → Supabase.

1. Dashboard Supabase → **Settings → Git → Connect to GitHub**
   → autoriser → choisir le repo `Frejustecrack/Lecteurs` → brancher sur la branche
   de travail (après fusion, `main`).
2. Ensuite, **chaque nouveau fichier** ajouté dans `migrations/`
   (nom : `AAAAMMJJHHMMSS_description.sql`) est appliqué automatiquement
   à la base quand il est poussé sur la branche connectée.

Règles :

- Une migration déjà appliquée est **jamais modifiée** : on crée une
  nouvelle migration (ex. `20260920120000_nouvelle_colonne.sql`).
- Les **données** (lecteurs, présences, cotisations…) ne sont JAMAIS
  synchronisées — elles vivent dans Supabase. Seul le **schéma** suit le repo.
- Les fichiers de `scripts/` **ne sont pas** dans `migrations/` : ce ne sont pas
  des migrations. Ils s'exécutent manuellement dans le SQL Editor.
- `npm run verif:db` rejoue toute la séquence de `migrations/` depuis une base
  vide et exerce les policies RLS rôle par rôle : à lancer avant tout push.

## Créer les comptes de l'application

1. Dashboard Supabase → **Authentication → Users → Add user** (cocher
   « Auto confirm user »). Un compte par personne. L'email suit toujours le modèle
   `<identifiant>@lecteurs.cdlj` (domaine interne : aucun courriel n'est jamais envoyé).
2. Renseigner `supabase/scripts/seed-comptes.sql` avec les identifiants et les noms réels,
   puis l'exécuter dans le SQL Editor. Le script refuse de s'exécuter tant que les
   mentions « À COMPLÉTER » n'ont pas été remplacées, et signale les comptes absents.
3. (Recommandé) Authentication → Settings → désactiver « Enable email signups » :
   seuls les comptes créés par l'Administrateur doivent exister.

Variante pour un compte isolé :

```sql
select public.set_role('UUID-DU-COMPTE', 'caissier', 'Nom Prénom');
-- rôles possibles : admin | co | co_paroissial | caissier | responsable
```

## Ajouter une évolution de base de données

Exemple — ajouter une colonne à `lecteurs` :

```sql
-- supabase/migrations/20260920120000_ajouter_colonne_note.sql
alter table public.lecteurs add column if not exists note text;
```

Puis `git push` : Supabase applique la migration automatiquement.

## Vérifier la syntaxe d'un fichier SQL

Avant de pousser, on peut valider un fichier avec le parseur PostgreSQL
(`libpg_query`, le même que celui de la base) :

```bash
pip install pglast
python3 -c "import pglast,sys; pglast.parse_sql(open(sys.argv[1]).read()); print('OK')" \
  supabase/migrations/20260913000000_initial_schema.sql
```
