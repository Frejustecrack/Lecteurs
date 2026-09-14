# CDLJ — Gestion des Lecteurs Juniors

Application de gestion interne de la **Communauté Diocésaine des Lecteurs Juniors (CDLJ)** —
Paroisse Sainte Famille d'Akogbato, Archidiocèse de Cotonou (Bénin).

> « Lecteurs, sel et lumière nous sommes »

SPA **React 19 + TypeScript + Tailwind CSS 4**, branchée directement sur **Supabase**
(PostgreSQL + Auth + Row Level Security). Aucun serveur intermédiaire : les règles
métier et les droits d'accès sont appliqués **dans la base de données**, pas seulement
dans l'interface. Le cahier des charges de référence est `CDC_CDLJ_Definitif.pdf`.

---

## 1. Démarrage rapide

```bash
npm install          # installe les dépendances
cp .env.example .env # puis renseignez les deux variables (voir §2)
npm run dev          # serveur de développement Vite (http://localhost:5173)
```

| Commande | Rôle |
| --- | --- |
| `npm run dev` | serveur de développement avec rechargement à chaud |
| `npm run build` | vérification TypeScript (`tsc --noEmit`) **puis** bundle de production dans `dist/` |
| `npm run preview` | sert le bundle de production localement (port 4173) |
| `npm run verif` | exécute `scripts/verif.ts` : 91 contrôles sur la logique métier pure (samedis et gel, samedis arrivés, validation des années, traduction des erreurs, récapitulatif du module Suivis) |

Prérequis : Node.js 20 ou plus récent (`npm run verif` utilise l'exécution native du
TypeScript par Node — aucune dépendance supplémentaire).

## 2. Visuels

**Fond d'écran de la page de connexion** : déposez l'image dans `src/assets/` sous le nom
`fond-connexion` (`.jpg`, `.jpeg`, `.png` ou `.webp`). Elle est détectée automatiquement
au build — aucune modification de code nécessaire. En son absence, le dégradé bleu CDLJ
s'affiche. Ce fond ne concerne **que** la page de connexion.

## 3. Configuration (`.env`)

Les valeurs se trouvent dans le dashboard Supabase → **Project Settings → API**.

```env
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOi...
```

La clé publishable (anon) est faite pour être publique : **la sécurité repose sur les
politiques RLS** décrites dans `supabase/migrations/`. Ne mettez jamais la clé `service_role`
dans ce fichier — elle contournerait toutes les protections.

Le fichier `.env` est ignoré par Git (voir `.gitignore`).

## 4. Base de données

Le schéma vit dans [`supabase/migrations/`](supabase/migrations) : 14 tables, 41 politiques
RLS, triggers d'audit et fonctions métier. Voir [`supabase/README.md`](supabase/README.md)
pour la synchronisation GitHub ↔ Supabase et la création des comptes
(`supabase/seed-comptes.sql`).

## 5. Modules

| Module | Page | Contenu |
| --- | --- | --- |
| Tableau de bord | `/` | indicateurs clés, courbes sur 6 mois, avancement des événements |
| Lecteurs | `/lecteurs`, `/lecteurs/:id` | fiches, matricule automatique `LEC100…`, archivage, grade et historique, appréciations |
| Fraternités | `/fraternites` | sous-groupes et responsables, suppression seulement si vide |
| Présences | `/presences` | pointage en **vue mensuelle** (3 à 5 samedis) ou **vue hebdomadaire** (une seule case devant chaque lecteur), **gel automatique** des samedis passés |
| Suivis | `/suivis` | récapitulatif présences/absences — vue hebdomadaire ou mensuelle, filtres « absents », « présents tout le long », « saisie incomplète », samedi précis, fraternité, colonnes triables |
| Cotisations | `/cotisations` | 50 F / lecteur / samedi (paramétrable), saisie réservée aux Caissiers, vue mensuelle ou hebdomadaire, pas de gel |
| Événements | `/evenements`, `/evenements/:id` | création par le CO, inscription par matricule, paiements en tranches, clôture |
| Caisse | `/caisse` | caisse générale (cotisations + encaissements − décaissements) et décaissements |
| Administration | `/admin` | journal des actions, comptes et rôles, montant de la cotisation — Admin uniquement |

**Présences et cotisations — règle du « à preuve du contraire » :** un samedi
**arrivé** non pointé est affiché en **rouge** et compte comme une absence (respectivement
comme une cotisation **due**). Tant que la case n'a pas été basculée au vert, le lecteur
est considéré comme absent / non payé. Un samedi **à venir** n'est jamais comptabilisé :
sa case reste neutre et n'entre dans aucun total. Les listes de présents et d'absents se
consultent dans l'onglet **Suivis**.

Cinq documents PDF sont générés côté client (`src/pdf/export.ts`) : fiche mensuelle des
cotisations, fiche mensuelle des présences, bilan d'événement, état de caisse, fiche
individuelle d'un lecteur. Chaque export est tracé dans les logs.

## 6. Rôles et droits

`admin` · `co` (Chargé des Opérations) · `caissier` · `responsable` — la matrice complète
figure au §5 du cahier des charges. En résumé :

| Action | Admin | CO | Caissier | Responsable |
| --- | :-: | :-: | :-: | :-: |
| Gérer les comptes et consulter les logs | ✅ | — | — | — |
| Modifier une fiche lecteur / archiver | ✅ | ✅ | — | — |
| Créer un lecteur, une fraternité, une appréciation | ✅ | ✅ | ✅ | ✅ |
| Enregistrer les présences | ✅ | ✅ | ✅ | ✅ |
| Corriger une présence gelée | ✅ | — | — | — |
| Saisir les cotisations | — | — | ✅ | — |
| Créer / clôturer un événement, encaisser un paiement | — | ✅ | — | — |
| Créer un décaissement | — | ✅ | — | — |
| Exporter les fiches PDF mensuelles et l'état de caisse | ✅ | ✅ | ✅ | — |
| Exporter le bilan d'événement et la fiche individuelle | ✅ | ✅ | — | — |

Les droits sont appliqués **deux fois** : dans l'interface (boutons masqués, messages
explicites) et dans la base (RLS). Un utilisateur qui contourne l'interface se heurte
tout de même à la base, qui renvoie alors un message clair du type
« Vous n'êtes pas autorisé à … » (`src/lib/errors.ts`).

## 7. Règles métier structurantes

- **Matricule** `LEC100, LEC101…` attribué automatiquement à la création, jamais réattribué,
  même après archivage. C'est la clé de saisie de tous les modules.
- **Archivage** : un lecteur qui quitte le groupe n'est jamais supprimé ; ses données et son
  historique restent consultables. Restauration par l'Admin.
- **Gel des présences** : un samedi passé est verrouillé (côté base). Seule une correction
  de l'Admin passe, et elle est tracée dans les logs.
- **Samedis à venir** : un samedi qui n'est pas encore arrivé n'est pris en compte nulle
  part (ni présence, ni absence, ni cotisation due).
- **Cotisations** : l'absence ne dispense pas du paiement — elle génère une cotisation due.
  Les mois passés restent modifiables par les Caissiers.
- **Événements** : cycle `en_cours → termine`. La clôture est irréversible, sauf réouverture
  par l'Admin (tracée). Les paiements en tranches ne peuvent pas dépasser le montant de
  participation (contrôle par trigger en base).
- **Caisses séparées** : la caisse générale et la caisse de chaque événement sont distinctes.
- **Conservation** : historique des grades, appréciations « supprimées » (masquées mais
  conservées) et logs ne sont jamais purgés.

## 8. Organisation du code

```
src/
├─ App.tsx               routes + gardes d'authentification et de rôle
├─ main.tsx              point d'entrée React
├─ index.css             thème Tailwind (couleurs CDLJ, animations)
├─ context/AuthContext   session + profil (rôle) de l'utilisateur connecté
├─ lib/
│  ├─ supabase.ts        client Supabase
│  ├─ types.ts           types TypeScript miroir des tables
│  ├─ dates.ts           samedis du mois, semaines, gel, samedis arrivés, formats F CFA
│  ├─ recap.ts           récapitulatif présences/absences (module Suivis)
│  ├─ errors.ts          traduction des erreurs techniques en messages lisibles
│  └─ validation.ts      contrôles de saisie (années de naissance / adhésion)
├─ assets/               visuels (dont le fond de la page de connexion)
├─ components/           Layout (sidebar + drawer mobile) et composants d'UI partagés
├─ pages/                une page par module
└─ pdf/export.ts         génération des documents PDF
supabase/
├─ migrations/           schéma initial (appliqué automatiquement par Supabase)
└─ seed-comptes.sql      attribution des rôles (SQL Editor, une seule fois)
```

## 9. Vérifications

```bash
npm run verif    # logique métier pure : dates, validation, erreurs, récapitulatif Suivis
npm run build    # typage complet (tsc --noEmit) + bundle de production
```

La syntaxe SQL se valide avec le parseur PostgreSQL (`libpg_query`) :

```bash
pip install pglast
python3 -c "import pglast,sys; pglast.parse_sql(open(sys.argv[1]).read()); print('OK')" \
  supabase/migrations/20260913000000_initial_schema.sql
```

## 10. Déploiement

Application statique : `npm run build` produit le dossier `dist/`, à publier sur Vercel
(ou tout hébergeur statique). Déclarez `VITE_SUPABASE_URL` et
`VITE_SUPABASE_PUBLISHABLE_KEY` dans les variables d'environnement de l'hébergeur.
