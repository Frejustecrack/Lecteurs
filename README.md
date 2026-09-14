# CDLJ — Gestion des Lecteurs Juniors

Application de gestion interne de la **Communauté Diocésaine des Lecteurs Juniors (CDLJ)** — Paroisse Sainte Famille d'Akogbato, Archidiocèse de Cotonou (Bénin).

> « Lecteurs, sel et lumière nous sommes »

[![React 19](https://img.shields.io/badge/React-19-61dafb?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6?logo=typescript)](https://www.typescriptlang.org)
[![Tailwind CSS 4](https://img.shields.io/badge/Tailwind-4-06b6d4?logo=tailwindcss)](https://tailwindcss.com)
[![Supabase](https://img.shields.io/badge/Supabase-RLS-3ecf8e?logo=supabase)](https://supabase.com)
[![Vite](https://img.shields.io/badge/Vite-6-646cff?logo=vite)](https://vitejs.dev)
[![Deploy](https://img.shields.io/badge/Deploy-Cloudflare_Pages-orange?logo=cloudflare)](https://lecteurs.pages.dev)

SPA **React 19 + TypeScript + Tailwind CSS 4 + Vite**, branchée directement sur **Supabase** (PostgreSQL + Auth + Row Level Security). **Aucun serveur Node intermédiaire** : les règles métier et les droits sont appliqués **dans la base**, pas seulement dans l'UI. Le cahier des charges de référence est [`CDC_CDLJ_Definitif.pdf`](./CDC_CDLJ_Definitif.pdf).

**Production :** https://lecteurs.pages.dev — Front sur **Cloudflare Pages**, back sur **Supabase**.

---

## Table des matières

- [1. Démarrage rapide](#1-démarrage-rapide)
- [2. Prérequis](#2-prérequis)
- [3. Configuration](#3-configuration)
- [4. Base de données & migrations](#4-base-de-données--migrations)
- [5. Comptes, rôles & mots de passe](#5-comptes-rôles--mots-de-passe)
- [6. Modules](#6-modules)
- [7. Règles métier](#7-règles-métier-structurantes)
- [8. Organisation du code](#8-organisation-du-code)
- [9. UI/UX](#9-uiux)
- [10. Sécurité](#10-sécurité)
- [11. Temps réel & synchronisation](#11-temps-réel--synchronisation)
- [12. Déploiement](#12-déploiement)
- [13. Livraison — remise à zéro](#13-livraison--remise-à-zéro)
- [14. Vérifications & qualité](#14-vérifications--qualité)
- [15. Dépannage](#15-dépannage)

---

## 1. Démarrage rapide

```bash
git clone https://github.com/Frejustecrack/Lecteurs.git
cd Lecteurs
npm install
cp .env.example .env   # renseigne les 2 variables Supabase
npm run dev            # http://localhost:5173
```

| Commande | Rôle |
|---|---|
| `npm run dev` | Vite dev + HMR (port 5173) |
| `npm run build` | `tsc --noEmit` + bundle `dist/` |
| `npm run preview` | sert `dist/` localement (port 4173) |
| `npm run verif` | 91 tests logiques pures (sans DB) |

## 2. Prérequis

- **Node.js 20+** ( `npm run verif` utilise le stripping TypeScript natif de Node, pas de `ts-node` )
- Un projet **Supabase** (gratuit suffit)
- Compte **Cloudflare** si vous déployez le front

## 3. Configuration

### 3.1 Variables d'environnement

Créez `.env` à la racine (jamais commité, voir `.gitignore`) :

```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOi...
```

Dashboard Supabase → **Project Settings → API** → `URL` et `anon public`. La clé `publishable` est faite pour être exposée au navigateur : **la sécurité repose sur le RLS**, pas sur le secret. Ne mettez **jamais** `service_role` côté front.

Vérification locale sans `.env` : l'app affiche un écran “Connexion à la base non configurée” au lieu d'un écran blanc.

### 3.2 Fond de connexion

Déposez une image dans `src/assets/` nommée `fond-connexion` (`.jpg/.jpeg/.png/.webp`). Elle est détectée automatiquement via `import.meta.glob` et affichée en plein écran derrière le formulaire de login avec voile sombre + carte en verre dépoli. Sans image, le dégradé bleu CDLJ s'affiche. Le fichier est émis en `dist/assets/fond-connexion-*.jpg` au build.

## 4. Base de données & migrations

Le schéma vit dans [`supabase/migrations/`](supabase/migrations) — **versionné dans Git, appliqué par Supabase**.

| Fichier | Contenu |
|---|---|
| `20260913000000_initial_schema.sql` | 14 tables, 41 RLS, triggers, fonctions |
| `20260914150000_fraternites_delete_any.sql` | suppression fraternité vide ouverte à tout rôle |
| `20260914150100_enable_realtime.sql` | publication `supabase_realtime` + `replica identity full` |
| `20260914150200_evenements_delete_co.sql` | `co`/`co_paroissial` peut supprimer un événement + élargit la contrainte `profiles_role_check` |
| `20260914150300_clean_test_data.sql` | remise à zéro pour livraison (voir §13) |
| `20260914150400_security_hardening.sql` | durcissement RLS, contraintes, révocations |

**Synchronisation GitHub → Supabase (intégration officielle) :**
Dashboard Supabase → **Settings → Integrations → GitHub** → Connecter `Frejustecrack/Lecteurs` sur la branche `main`. Chaque nouveau fichier `supabase/migrations/*.sql` poussé sur `main` est appliqué automatiquement.

> **Règle d'or :** une migration appliquée ne se modifie jamais. On crée une **nouvelle** migration `AAAAMMJJHHMMSS_description.sql`.

Vérifier la syntaxe SQL localement :

```bash
pip install pglast
python3 -c "import pglast,sys; pglast.parse_sql(open(sys.argv[1]).read()); print('OK')" supabase/migrations/20260913000000_initial_schema.sql
```

## 5. Comptes, rôles & mots de passe

### 5.1 Rôles

`admin` · `co` / `co_paroissial` (Chargé des Opérations, alias) · `caissier` · `responsable`

| Action | Admin | CO | Caissier | Responsable |
|---|:-:|:-:|:-:|:-:|
| Gérer comptes / voir logs | ✅ | — | — | — |
| Modifier fiche lecteur / archiver / changer grade | ✅ | ✅ | — | — |
| Créer lecteur / fraternité / appréciation | ✅ | ✅ | ✅ | ✅ |
| Supprimer fraternité **vide** | ✅ | ✅ | ✅ | ✅ |
| Pointer présences | ✅ | ✅ | ✅ | ✅ |
| Corriger présence gelée | ✅ | — | — | — |
| Saisir cotisations | — | — | ✅ | — |
| Créer / modifier / **supprimer** événement, encaisser tranche, gérer caisse | — | ✅ | — | — |
| Clôturer événement | — | ✅ | — | — |
| Réouvrir événement terminé | ✅ | — | — | — |
| Exporter PDF présences/cotisations/caisse | ✅ | ✅ | ✅ | — |
| Exporter bilan événement / fiche lecteur | ✅ | ✅ | — | — |

Le **CO paroissial** (`co` ou `co_paroissial`) a les mêmes droits que `co` — le helper `is_co()` accepte les deux libellés, la contrainte DB les autorise, et le RLS `evenements_delete` l'autorise.

### 5.2 Créer les comptes

1. Supabase Dashboard → **Authentication → Users → Add user** (cocher *Auto confirm user*). Email sous la forme `<identifiant>@lecteurs.cdlj` (domaine interne, aucun mail n'est envoyé).
2. Copier l'**UUID** du compte, puis dans **SQL Editor** :

```sql
select public.set_role('UUID', 'admin', 'Nom Prénom');
-- rôles : admin | co | co_paroissial | caissier | responsable
```

Le fichier [`supabase/seed-comptes.sql`](supabase/seed-comptes.sql) permet de le faire en lot. `set_role` est `SECURITY DEFINER` et **révoquée** pour `anon`/`authenticated` — seuls `postgres`/`supabase_admin` peuvent l'appeler depuis le SQL Editor.

Recommandé : **Authentication → Settings** → désactiver *Enable email signups*.

### 5.3 Mot de passe — chaque compte gère le sien

- **Username affiché est fixe** (issu de `profiles.username`, jamais éditable côté app). Aucun formulaire ne permet de le modifier ; seul l'Admin peut changer le rôle.
- **Mot de passe :** tout utilisateur connecté peut le modifier via le menu latéral **“Mot de passe”** (sidebar desktop + drawer mobile → `Layout.tsx`). Le formulaire appelle `supabase.auth.updateUser({ password })` (8 caractères min, confirmation obligatoire). Aucune déconnexion forcée, un toast confirme. Le mot de passe n'est **jamais** loggé ni stocké en clair — géré intégralement par Supabase Auth.

## 6. Modules

| Module | Route | Points clés |
|---|---|---|
| **Tableau de bord** | `/` | KPIs mois en cours (actifs, taux présence, présents/samedi, taux cotisation, caisse générale, événements en cours) + 3 graphiques 6 mois (présences/absences, effectif, cotisations) + avancement paiements événements. Temps réel. |
| **Lecteurs** | `/lecteurs`, `/lecteurs/:id` | Matricule auto `LEC100…` jamais réattribué, archivage (pas de delete), changement de grade historisé via `changer_grade()`, appréciations soft-delete, export fiche PDF. |
| **Fraternités** | `/fraternites` | Nom + responsables (simples noms). Création par tous, renommage admin/co, **suppression par tout rôle si vide** (FK bloque si des lecteurs y sont encore). |
| **Présences** | `/presences` | **Vue mensuelle** (3-5 samedis, `overflow-x`) ou **hebdomadaire** (1 samedi, **cartes sur mobile sans scroll**, tableau compact sur desktop). Gel automatique des samedis passés (RLS `dernier_samedi()`), correction Admin tracée. |
| **Suivis** | `/suivis` | Récap `present/absent/nonSaisi/taux` via `src/lib/recap.ts`. Filtres *absents / assidus / saisie incomplète*, filtre samedi précis, fraternité, recherche, tri colonnes. Cartes sur mobile, tableau sur desktop. |
| **Cotisations** | `/cotisations` | 50 F / samedi / lecteur (paramétrable dans `app_settings`). Vue mensuelle/hebdo (même UX que Présences). Saisie **Caissier uniquement**, pas de gel, mois passés modifiables. |
| **Événements** | `/evenements`, `/evenements/:id` | Création par CO, inscription par matricule, paiements en tranches (trigger `check_tranche` : total ≤ participation), **suppression par CO/Admin** (cascade participants/paiements/caisse + log `evenement.suppression`), clôture `en_cours→termine` + réouverture Admin. |
| **Caisse** | `/caisse` | Caisse générale = cotisations payées + encaissements − décaissements (`event_id IS NULL`). Opérations CO uniquement. Export PDF. |
| **Administration** | `/admin` | Logs (400 derniers), comptes & rôles, montant cotisation — **Admin uniquement** (RLS `is_admin()`). |

**Règle “à preuve du contraire” :** un samedi **arrivé** non pointé = **rouge** = absence (ou cotisation due). Un samedi **à venir** = neutre = non comptabilisé. Les samedis à venir n'entrent dans aucun total (KPIs, graphiques, Suivis).

Cinq PDFs côté client (`src/pdf/export.ts` + `jspdf`/`jspdf-autotable`) : présences, cotisations, bilan événement, état de caisse, fiche lecteur. Chaque export est `log_action('export.pdf')`.

## 7. Règles métier structurantes

- **Matricule** `LEC100, LEC101…` via trigger `gen_matricule()` + `prochain_matricule()`. Jamais réattribué, même après archivage.
- **Archivage** : `lecteurs.archived` + `archived_at`. Pas de `DELETE` physique. Restauration Admin.
- **Gel** : `public.dernier_samedi()` (samedi courant ou précédent). RLS `presences_insert/update` refuse si `date_samedi < dernier_samedi()` sauf `is_admin()`.
- **Samedis à venir** : `samediEstArrive()` / `samedisArrives()` — un samedi futur n'est pas une absence ni une cotisation due.
- **Cotisations** : l'absence ne dispense pas. Le montant est dans `app_settings.montant_cotisation` (Admin).
- **Événements** : `en_cours ↔ termine` via RLS `statut`. Paiements en tranches bloqués si `sum(montant) + new.montant > montant_participation`.
- **Caisses séparées** : générale (`event_id IS NULL`) vs une par événement.
- **Conservation** : `lecteur_grades`, `appreciations` soft-delete, `logs` jamais purgés (sauf remise à zéro livraison).

## 8. Organisation du code

```
src/
├─ App.tsx               routes + RequireAuth / RequireAdmin + ConfigManquante
├─ main.tsx              React 19 createRoot
├─ index.css             Tailwind 4 theme (cdlj, alerte, fond) + animations
├─ assets/               fond-connexion.jpg (optionnel)
├─ context/AuthContext   session Supabase + profile (rôle) + refresh
├─ lib/
│  ├─ supabase.ts        createClient (autoRefresh, persistSession)
│  ├─ types.ts           miroir des tables + ROLE_LABELS
│  ├─ dates.ts           samedisDuMois, samedisSemaine, dernierSamedi, estGelee, samediEstArrive, fmt…
│  ├─ recap.ts           calculerRecaps, absencesEffectives, filtre/tri (testé à 91)
│  ├─ errors.ts          traduireErreur (jamais de code technique à l'utilisateur)
│  └─ validation.ts      bornes années naissance/adhésion
├─ components/
│  ├─ Layout.tsx         sidebar + drawer mobile + changement mot de passe
│  ├─ ErrorBoundary.tsx
│  └─ ui.tsx             Btn*, Badge, StatCard, Modal, Field, Segmented, StepNav…
├─ pages/                10 pages, une par module
└─ pdf/export.ts         jsPDF + autoTable

supabase/
├─ migrations/           *.sql versionnés, appliqués auto par Supabase
├─ seed-comptes.sql      set_role en lot (une fois)
├─ clean_test_data_manual.sql  script manuel pour remise à zéro
└─ README.md             détail migrations

scripts/verif.ts         91 vérifications logiques pures (sans DB)
```

## 9. UI/UX

- **Design system :** Tailwind 4, couleur principale `cdlj #1a56db`, `Inter` partout, coins `2xl`, ombres douces, `backdrop-blur` sur sidebar/header/modales.
- **Fluidité :** `pressCls` (`active:scale-[0.96]`), `iconPressCls`, transitions `150ms`, `will-change-transform`, animations `cdlj-toast-in` / `cdlj-modal-in` / `cdlj-drawer-in`, `scroll-behavior:smooth`, `prefers-reduced-motion` respecté.
- **Mobile first :** drawer avec `cdlj-drawer` + `cdlj-backdrop`, tableaux `overflow-x-auto` uniquement en **mensuel**, **cartes** en **hebdomadaire** (Présences/Cotisations) et en **Suivis** → aucun scroll horizontal imposé pour 1 samedi.
- **Accessibilité :** `focus-visible:ring`, `aria-*`, labels, `touch-manipulation`.

## 10. Sécurité

- **RLS partout** — 14 tables, `enable row level security`, ~45 politiques. Les droits sont vérifiés **dans la base**, pas seulement dans l'UI. Un bypass front se heurte au 403 traduit en `Vous n'êtes pas autorisé à…`.
- **Clés :** seule `VITE_SUPABASE_PUBLISHABLE_KEY` (anon) côté front. `service_role` **jamais** commité, RLS contourné uniquement côté SQL Editor.
- **Fonctions sensibles :** `set_role` révoquée pour `anon/authenticated`, `log_action` et `changer_grade` `security definer` avec checks internes.
- **Gel & contraintes :** `estGelee` + RLS date, `check_tranche`, `evenements_montant_check`, `profiles_username_not_empty`, FK `lecteurs.fraternite_id` (bloque suppression fraternité non vide), `appreciations` soft-delete.
- **Mots de passe :** gérés par Supabase Auth (`updateUser`), jamais en clair, jamais loggés.
- **XSS/CSRF :** pas de `dangerouslySetInnerHTML`, pas de cookies d'auth, Supabase JWT en `localStorage` avec `autoRefreshToken`.

Voir `supabase/migrations/20260914150400_security_hardening.sql` pour le durcissement idempotent.

## 11. Temps réel & synchronisation

Depuis `20260914150100_enable_realtime.sql`, les tables `presences`, `cotisations`, `lecteurs`, `fraternites` sont dans la publication `supabase_realtime` (`replica identity full`).

Chaque page qui affiche des présences s'abonne :

```ts
supabase.channel('realtime-presences')
  .on('postgres_changes', { event:'*', schema:'public', table:'presences' }, () => load())
  .subscribe()
```

+ `window focus` / `visibilitychange` → refetch si l'onglet revient. Une modification de présence est visible **partout** (Dashboard KPIs, Suivis, fiche lecteur) sans F5, même si deux utilisateurs pointent en même temps.

## 12. Déploiement

**Front statique** `dist/` → **Cloudflare Pages** (actuel : `lecteurs.pages.dev`).

- Build command : `npm run build`
- Output : `dist`
- Env (Production + Preview) :
  ```
  VITE_SUPABASE_URL=...
  VITE_SUPABASE_PUBLISHABLE_KEY=...
  ```
- SPA : ajouter `public/_redirects` contenant `/* /index.html 200` (ou équivalent Cloudflare) pour que `/lecteurs/:id` ne 404 pas au refresh.

**Supabase** : connecter le repo (Settings → Git) sur `main` pour que les migrations s'appliquent auto. Sinon exécuter les fichiers `supabase/migrations/*.sql` manuellement dans le SQL Editor, dans l'ordre chronologique.

## 13. Livraison — remise à zéro

Pour livrer avec **tous les compteurs à 0** tout en conservant les comptes et le paramétrage :

**Option A — automatique (recommandé, via Git) :** merger la PR contenant `20260914150300_clean_test_data.sql` sur `main` → Supabase l'applique et tronque `presences, cotisations, evenements, lecteurs, fraternites, logs…` (cascade) et remet `montant_cotisation` à 50.

**Option B — manuelle :** dans Supabase **SQL Editor**, exécutez `supabase/clean_test_data_manual.sql` (même contenu que la migration) **une seule fois** :

```sql
truncate table public.evenement_paiements, public.evenement_participants,
  public.caisse_operations, public.cotisations, public.presences,
  public.appreciations, public.lecteur_grades, public.logs
restart identity cascade;
truncate table public.evenements, public.lecteurs, public.fraternites
restart identity cascade;
```

Vérification : `select count(*) from public.lecteurs;` doit être 0, le prochain matricule sera `LEC100`.

> Les `profiles` (comptes), `grades` et `app_settings` ne sont **pas** purgés.

## 14. Vérifications & qualité

```bash
npm run verif   # 91 tests : samedis, gel, samedisArrives, validation années, erreurs, recap Suivis
npm run build   # tsc --noEmit + vite build (échoue si une erreur de typage)
npx tsc --noEmit # typage seul
```

Le script `scripts/verif.ts` importe le **vrai** code de `src/lib/` (pas une copie) — toute régression y fait échouer la CI.

## 15. Dépannage

- **Écran “Connexion à la base non configurée”** → `.env` manquant ou variables vides.
- **“Vous n'êtes pas autorisé à…”** → RLS a bloqué. Vérifier le rôle dans `profiles` et la politique dans `supabase/migrations/`.
- **Présence gelée** → seul Admin peut corriger un samedi `< dernier_samedi()`.
- **Matricule déjà pris** → `LEC…` unique, ne jamais le forcer manuellement.
- **Realtime ne se déclenche pas** → vérifier que `supabase_realtime` contient bien la table (migration `20260914150100`) et que le projet Supabase a Realtime activé (Database → Realtime).

---

*Projet livré par la CDLJ Akogbato — “Lecteurs, sel et lumière nous sommes”.*
