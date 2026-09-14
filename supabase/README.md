# Supabase — structure du dossier

```
supabase/
├── README.md
├── migrations/
│   └── 20260913000000_initial_schema.sql   ← schéma initial (déjà appliqué sur la prod)
└── seed-comptes.sql   ← attribution des rôles aux 9 comptes — à exécuter UNE fois
```

## Contenu du schéma

| Objet | Détail |
| --- | --- |
| 14 tables | `grades`, `profiles`, `fraternites`, `lecteurs`, `lecteur_grades`, `presences`, `cotisations`, `app_settings`, `evenements`, `evenement_participants`, `evenement_paiements`, `caisse_operations`, `appreciations`, `logs` |
| 41 politiques RLS | droits par rôle (`is_admin()`, `is_co()`, `is_caissier()`), gel des présences passées, clôture des événements |
| Triggers | matricule automatique `LEC100…`, historique de grade, plafond des tranches de paiement, `updated_at`, journal d'audit sur 10 tables |
| Fonctions sensibles | `changer_grade()` (Admin + CO), `log_action()` (tout compte connecté), `set_role()` (**SQL Editor uniquement**) |

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
- `seed-comptes.sql` **n'est pas** dans `migrations/` : ce n'est pas une migration.
  Il s'exécute manuellement dans le SQL Editor, une seule fois, car il appelle
  `public.set_role()` — fonction volontairement retirée aux comptes de l'application.

## Créer les comptes de l'application

1. Dashboard Supabase → **Authentication → Users → Add user** (cocher
   « Auto confirm user »). Un compte par personne. L'email suit toujours le modèle
   `<identifiant>@lecteurs.cdlj` (domaine interne : aucun courriel n'est jamais envoyé).
2. Renseigner `supabase/seed-comptes.sql` avec les identifiants et les noms réels,
   puis l'exécuter dans le SQL Editor. Le script refuse de s'exécuter tant que les
   mentions « À COMPLÉTER » n'ont pas été remplacées, et signale les comptes absents.
3. (Recommandé) Authentication → Settings → désactiver « Enable email signups » :
   seuls les comptes créés par l'Administrateur doivent exister.

Variante pour un compte isolé :

```sql
select public.set_role('UUID-DU-COMPTE', 'caissier', 'Nom Prénom');
-- rôles possibles : admin | co | caissier | responsable
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
