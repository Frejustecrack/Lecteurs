# Supabase — structure du dossier

```
supabase/
├── README.md
├── migrations/
│   └── 20260913000000_initial_schema.sql   ← schéma initial (déjà appliqué sur la prod)
└── seed-comptes.sql   (généré séparément, à exécuter UNE fois — crée les 9 comptes)
```

## Synchronisation GitHub ↔ Supabase (intégration Git)

L'intégration est **unidirectionnelle** : GitHub → Supabase.

1. Dashboard Supabase → **Settings → Git → Connect to GitHub**
   → autoriser → choisir le repo `Frejustecrack/Lecteurs` → brancher
   (branche courante : `arena/01a09a56-lecteurs` ; après fusion, `main`).
2. Ensuite, **chaque nouveau fichier** ajouté dans `migrations/`
   (nom : `AAAAJJJHHMMSS_description.sql`) est appliqué automatiquement
   à la base quand il est poussé sur la branche connectée.

Règles :
- Une migration déjà appliquée est **jamais modifiée** : on crée une
  nouvelle migration (ex. `20260920120000_nouvelle_colonne.sql`).
- Les **données** (lecteurs, présences, cotisations…) ne sont JAMAIS
  synchronisées — elles vivent dans Supabase. Seul le **schéma** suit le repo.
- Le `seed-comptes.sql` (création des 9 comptes + rôles) est une
  opération à part, exécutée une seule fois dans le SQL Editor.

## Ajouter une évolution de base de données

Exemple — ajouter une colonne à `lecteurs` :

```sql
-- supabase/migrations/20260920120000_ajouter_colonne_note.sql
alter table public.lecteurs add column if not exists note text;
```

Puis `git push` : Supabase applique la migration automatiquement.
