/**
 * Vérification de la BASE : migrations + Row Level Security + triggers.
 *
 * Exécution :  npm run verif:db
 *
 * Un vrai PostgreSQL (PGlite, WebAssembly, aucune installation) est démarré
 * en mémoire ; les migrations de `supabase/migrations/` sont rejouées DANS
 * L'ORDRE depuis une base vide — exactement ce que fait Supabase sur une
 * nouvelle instance. Puis chaque règle de droits est exercée avec chaque rôle,
 * en se faisant passer pour un utilisateur connecté (comme PostgREST :
 * `set role authenticated` + claim JWT `sub`).
 *
 * Ce que ce script attrape et que `tsc` / `verif.ts` ne voient pas :
 *   - une migration qui ne s'applique pas (syntaxe, dépendance, ordre) ;
 *   - une policy RLS trop permissive ou trop stricte ;
 *   - un trigger métier cassé (matricule, gel, journal…).
 *
 * Il ne remplace pas un test sur la vraie instance Supabase (Realtime, Auth),
 * mais il garantit que le SQL versionné fait ce qu'on croit.
 */
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const dossierMigrations = join(racine, 'supabase', 'migrations');

let reussites = 0;
const echecs = [];
function ok(nom) {
  reussites++;
  console.log(`  ✓ ${nom}`);
}
function ko(nom, detail) {
  echecs.push(`${nom}${detail ? ` — ${detail}` : ''}`);
  console.log(`  ✗ ${nom}${detail ? `\n      ${detail}` : ''}`);
}
function section(t) {
  console.log(`\n${t}`);
}

const db = new PGlite();

// ---------------------------------------------------------------------------
// Émulation minimale de l'environnement Supabase (schéma auth, rôles).
// ---------------------------------------------------------------------------
await db.exec(`
  create schema if not exists auth;
  create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb default '{}'::jsonb
  );
  create or replace function auth.uid() returns uuid
    language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin;
  create role authenticated nologin;
  create role supabase_admin nologin;
  create publication supabase_realtime;
`);

// ---------------------------------------------------------------------------
// 1. Migrations, dans l'ordre, depuis zéro.
// ---------------------------------------------------------------------------
section('1. Migrations (rejouées depuis une base vide)');
const fichiers = readdirSync(dossierMigrations)
  .filter((f) => f.endsWith('.sql'))
  .sort();
for (const f of fichiers) {
  try {
    await db.exec(readFileSync(join(dossierMigrations, f), 'utf8'));
    ok(f);
  } catch (e) {
    ko(f, e.message);
  }
}
// Supabase accorde par défaut les privilèges de table aux rôles applicatifs
// (« default privileges » du schéma public) ; la sécurité réelle repose sur
// les policies RLS. On reproduit cet environnement.
await db.exec(`
  grant usage on schema public to anon, authenticated;
  grant all on all tables in schema public to authenticated;
  grant all on all sequences in schema public to authenticated;
  grant execute on all functions in schema public to authenticated;
  -- Les révocations explicites des migrations doivent primer : on les rejoue.
  revoke execute on function public.set_role(uuid, text, text) from authenticated;
  revoke execute on function public.log_action(text, text, text, jsonb) from authenticated;
`);

// Idempotence : la dernière migration doit être rejouable sans erreur.
try {
  await db.exec(readFileSync(join(dossierMigrations, fichiers.at(-1)), 'utf8'));
  ok(`${fichiers.at(-1)} est rejouable (idempotente)`);
} catch (e) {
  ko(`${fichiers.at(-1)} n'est pas idempotente`, e.message);
}

// ---------------------------------------------------------------------------
// Utilisateurs de test (un par rôle) — via auth.users → trigger handle_new_user
// puis set_role, comme en production.
// ---------------------------------------------------------------------------
const U = {
  admin: '00000000-0000-0000-0000-000000000001',
  co: '00000000-0000-0000-0000-000000000002',
  caissier: '00000000-0000-0000-0000-000000000003',
  responsable: '00000000-0000-0000-0000-000000000004',
  co_paroissial: '00000000-0000-0000-0000-000000000005',
  sans_role: '00000000-0000-0000-0000-000000000006',
  nouveau: '00000000-0000-0000-0000-000000000007',
};
for (const [role, id] of Object.entries(U)) {
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}@lecteurs.cdlj`]);
  if (role !== 'sans_role' && role !== 'nouveau') {
    await db.query(`select public.set_role($1, $2, $3)`, [id, role, `Test ${role}`]);
  }
}

/**
 * Exécute `sql` en se faisant passer pour l'utilisateur `role` (comme
 * PostgREST). Retourne { rows } ou { error }. Chaque appel est une transaction
 * isolée, annulée en cas d'erreur, pour ne pas polluer la suite.
 */
async function en(role, sql, params = []) {
  const uid = U[role];
  try {
    return await db.transaction(async (tx) => {
      await tx.exec(`set local role authenticated;`);
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
      const r = await tx.query(sql, params);
      return { rows: r.rows };
    });
  } catch (e) {
    return { error: e };
  }
}
/** Idem, en tant que propriétaire (SQL Editor). */
async function enAdminSql(sql, params = []) {
  return (await db.query(sql, params)).rows;
}

async function attendRefus(nom, role, sql, params) {
  const r = await en(role, sql, params);
  if (r.error) ok(`${nom} → refusé (${r.error.code ?? r.error.message.slice(0, 40)})`);
  else if (r.rows && r.rows.length === 0 && /^\s*(update|delete)/i.test(sql)) ok(`${nom} → aucune ligne touchée`);
  else ko(nom, 'AUTORISÉ alors qu\'il devrait être refusé');
  return r;
}
async function attendOk(nom, role, sql, params) {
  const r = await en(role, sql, params);
  if (r.error) ko(nom, r.error.message);
  else ok(nom);
  return r;
}
/** UPDATE/DELETE : succès uniquement si au moins une ligne a été touchée. */
async function attendLignes(nom, role, sql, params) {
  const r = await en(role, sql, params);
  if (r.error) ko(nom, r.error.message);
  else if (!r.rows || r.rows.length === 0) ko(nom, 'aucune ligne touchée (RLS silencieux)');
  else ok(nom);
  return r;
}

// ---------------------------------------------------------------------------
// 2. Rôles & helpers
// ---------------------------------------------------------------------------
section('2. Rôles');
for (const role of ['admin', 'co', 'co_paroissial', 'caissier', 'responsable']) {
  const r = await en(role, `select public.current_role() as r, public.is_admin() a, public.is_co() c, public.is_caissier() k`);
  const x = r.rows?.[0];
  const attendu = {
    a: role === 'admin',
    c: role === 'co' || role === 'co_paroissial',
    k: role === 'caissier',
  };
  if (x && x.r === role && x.a === attendu.a && x.c === attendu.c && x.k === attendu.k) ok(`${role} : helpers cohérents`);
  else ko(`${role} : helpers`, JSON.stringify(x));
}
await attendRefus('responsable ne peut pas appeler set_role', 'responsable', `select public.set_role($1, 'admin')`, [U.responsable]);
await attendRefus('responsable ne peut pas s\'auto-promouvoir (UPDATE profiles)', 'responsable', `update public.profiles set role = 'admin' where id = $1 returning id`, [U.responsable]);
await attendLignes('admin peut changer un rôle', 'admin', `update public.profiles set role = 'responsable' where id = $1 returning id`, [U.nouveau]);
{
  // Compte authentifié mais sans rôle : lecture possible (l'app affiche
  // « compte en attente »), mais aucune écriture.
  await attendRefus('compte sans rôle ne crée pas de lecteur', 'sans_role',
    `insert into public.lecteurs (nom, prenom, matricule) values ('X', 'Y', '') returning id`);
}

// ---------------------------------------------------------------------------
// 3. Lecteurs & fraternités
// ---------------------------------------------------------------------------
section('3. Lecteurs, matricules, fraternités');
const frat = await attendOk('responsable crée une fraternité', 'responsable', `insert into public.fraternites (nom) values ('Saint Jean') returning id`);
const fratId = frat.rows[0].id;
const frat2 = (await attendOk('caissier crée une fraternité', 'caissier', `insert into public.fraternites (nom) values ('Sainte Thérèse') returning id`)).rows[0].id;

// created_at reculé au 01/01/2020 : les sections 4–5 saisissent des lignes sur
// le samedi « gelé » (dernier samedi − 7). Avec la règle « premier samedi
// actif » (entrée en vigueur), un lecteur inscrit aujourd'hui ne peut plus
// avoir d'historique — backdater évite aussi les faux positifs (refus venant
// du trigger entrée en vigueur au lieu du gel testé).
const l1 = (await attendOk('responsable crée un lecteur (matricule auto)', 'responsable',
  `insert into public.lecteurs (nom, prenom, matricule, fraternite_id, created_at) values ('DOSSOU', 'Marc', '', $1, '2020-01-01') returning id, matricule`, [fratId])).rows[0];
const l2 = (await attendOk('caissier crée un second lecteur', 'caissier',
  `insert into public.lecteurs (nom, prenom, matricule, created_at) values ('AHOUANSOU', 'Léa', '', '2020-01-01') returning id, matricule`)).rows[0];
if (l1.matricule === 'LEC100' && l2.matricule === 'LEC101') ok(`matricules séquentiels : ${l1.matricule}, ${l2.matricule}`);
else ko('matricules séquentiels', `${l1.matricule}, ${l2.matricule}`);

await attendRefus('responsable ne modifie pas le nom d\'un lecteur', 'responsable', `update public.lecteurs set nom = 'X' where id = $1 returning id`, [l1.id]);
await attendRefus('caissier ne modifie pas le grade directement', 'caissier', `update public.lecteurs set grade_id = 3 where id = $1 returning id`, [l1.id]);
await attendRefus('responsable ne peut plus faire d\'UPDATE direct de fraternite_id (policy fermée)', 'responsable',
  `update public.lecteurs set fraternite_id = $2 where id = $1 returning id`, [l1.id, frat2]);
await attendOk('responsable change la fraternité via le RPC', 'responsable', `select public.changer_fraternite($1, $2)`, [l1.id, frat2]);
{
  const r = await enAdminSql(`select fraternite_id from public.lecteurs where id = $1`, [l1.id]);
  if (r[0].fraternite_id === frat2) ok('la fraternité a bien changé');
  else ko('la fraternité a bien changé');
}
await attendLignes('CO modifie la fiche (nom, grade)', 'co', `update public.lecteurs set nom = 'DOSSOU-YOVO', grade_id = 2 where id = $1 returning id`, [l1.id]);
await attendRefus('CO ne modifie pas le matricule (définitif)', 'co', `update public.lecteurs set matricule = 'LEC999' where id = $1 returning id`, [l1.id]);
await attendLignes('CO paroissial a les mêmes droits que CO', 'co_paroissial', `update public.lecteurs set adresse = 'Akogbato' where id = $1 returning id`, [l1.id]);
await attendOk('CO change le grade via RPC (historisé)', 'co', `select public.changer_grade($1, 3)`, [l1.id]);
await attendRefus('caissier ne change pas le grade via RPC', 'caissier', `select public.changer_grade($1, 4)`, [l1.id]);
{
  const r = await enAdminSql(`select count(*)::int n from public.lecteur_grades where lecteur_id = $1`, [l1.id]);
  if (r[0].n === 2) ok('historique des grades : initial + changement = 2 lignes');
  else ko('historique des grades', `${r[0].n} lignes`);
}
await attendRefus('personne ne supprime un lecteur (archivage seulement)', 'admin', `delete from public.lecteurs where id = $1 returning id`, [l1.id]);
await attendLignes('CO archive un lecteur', 'co', `update public.lecteurs set archived = true, archived_at = now() where id = $1 returning id`, [l2.id]);
await attendRefus('responsable ne supprime pas une fraternité non vide', 'responsable', `delete from public.fraternites where id = $1 returning id`, [frat2]);
await attendLignes('responsable supprime une fraternité vide', 'responsable', `delete from public.fraternites where id = $1 returning id`, [fratId]);

// ---------------------------------------------------------------------------
// 4. Présences — gel
// ---------------------------------------------------------------------------
section('4. Présences (gel des samedis passés)');
const { dernier } = (await enAdminSql(`select public.dernier_samedi()::text as dernier`))[0];
const gele = (await enAdminSql(`select (public.dernier_samedi() - 7)::text d`))[0].d;
const futur = (await enAdminSql(`select (public.dernier_samedi() + 7)::text d`))[0].d;
console.log(`  (dernier samedi = ${dernier}, gelé = ${gele})`);

await attendOk('responsable pointe le dernier samedi', 'responsable',
  `insert into public.presences (lecteur_id, date_samedi, statut) values ($1, $2, 'present') on conflict (lecteur_id, date_samedi) do update set statut = excluded.statut returning id`, [l1.id, dernier]);
await attendRefus('responsable ne pointe pas un samedi gelé', 'responsable',
  `insert into public.presences (lecteur_id, date_samedi, statut) values ($1, $2, 'present') returning id`, [l1.id, gele]);
await attendRefus('responsable ne DÉPLACE pas une présence vers un samedi gelé (WITH CHECK)', 'responsable',
  `update public.presences set date_samedi = $2 where lecteur_id = $1 returning id`, [l1.id, gele]);
await attendOk('admin corrige un samedi gelé', 'admin',
  `insert into public.presences (lecteur_id, date_samedi, statut) values ($1, $2, 'absent') returning id`, [l1.id, gele]);
{
  const r = await enAdminSql(`select action from public.logs where objet_type = 'presences' order by id desc limit 1`);
  if (r[0]?.action === 'presence.correction_gelee') ok('la correction gelée est journalisée par le trigger (presence.correction_gelee)');
  else ko('journal correction gelée', JSON.stringify(r[0]));
}
// Toute présence future est verrouillée pour TOUS les rôles, Admin inclus.
section('4b. Présences futures interdites, données historiques préservées');
for (const role of ['admin', 'co', 'co_paroissial', 'caissier', 'responsable', 'sans_role']) {
  await attendRefus(`${role} ne peut pas créer une présence future`, role,
    `insert into public.presences (lecteur_id, date_samedi, statut) values ($1, $2, 'present') returning id`, [l1.id, futur]);
  await attendRefus(`${role} ne peut pas déplacer une présence vers le futur`, role,
    `update public.presences set date_samedi = $2 where lecteur_id = $1 and date_samedi = $3 returning id`, [l1.id, futur, dernier]);
}
// Simule une ligne déjà présente en production AVANT la nouvelle règle.
await enAdminSql(`insert into public.presences (lecteur_id, date_samedi, statut) values ($1, $2, 'present')`, [l1.id, futur]);
await db.exec(readFileSync(join(dossierMigrations, '20260919200000_interdire_presences_futures.sql'), 'utf8'));
for (const role of ['admin', 'co', 'co_paroissial', 'caissier', 'responsable', 'sans_role']) {
  await attendRefus(`${role} ne modifie pas une présence future existante`, role,
    `update public.presences set statut = 'absent' where lecteur_id = $1 and date_samedi = $2 returning id`, [l1.id, futur]);
  await attendRefus(`${role} ne supprime pas une présence future existante`, role,
    `delete from public.presences where lecteur_id = $1 and date_samedi = $2 returning id`, [l1.id, futur]);
  await attendRefus(`${role} ne contourne pas la règle par upsert`, role,
    `insert into public.presences (lecteur_id, date_samedi, statut) values ($1, $2, 'absent')
     on conflict (lecteur_id, date_samedi) do update set statut = excluded.statut returning id`, [l1.id, futur]);
}
await attendRefus('Admin ne déplace pas une ancienne présence future vers le passé', 'admin',
  `update public.presences set date_samedi = $3::date - 14 where lecteur_id = $1 and date_samedi = $2 returning id`, [l1.id, futur, dernier]);
const historiqueFutur = await en('admin', `select statut from public.presences where lecteur_id=$1 and date_samedi=$2`, [l1.id, futur]);
if (historiqueFutur.rows?.[0]?.statut === 'present') ok('migration non destructive : présence future historique préservée et lisible');
else ko('présence future historique préservée');
await enAdminSql(`delete from public.presences where lecteur_id=$1 and date_samedi=$2`, [l1.id, futur]);
await attendRefus('compte sans rôle ne modifie pas non plus le samedi courant', 'sans_role',
  `update public.presences set statut = 'absent' where lecteur_id=$1 and date_samedi=$2 returning id`, [l1.id, dernier]);
await attendOk('Caissier peut toujours payer une cotisation future', 'caissier',
  `insert into public.cotisations (lecteur_id, date_samedi, paye) values ($1, $2, true) returning id`, [l1.id, futur]);
await en('caissier', `delete from public.cotisations where lecteur_id=$1 and date_samedi=$2`, [l1.id, futur]);

await attendRefus('responsable ne supprime pas une présence', 'responsable', `delete from public.presences where lecteur_id = $1 returning id`, [l1.id]);

// ---------------------------------------------------------------------------
// 5. Cotisations — caissier uniquement
// ---------------------------------------------------------------------------
section('5. Cotisations');
await attendRefus('responsable ne saisit pas de cotisation', 'responsable',
  `insert into public.cotisations (lecteur_id, date_samedi, paye, montant, paid_at) values ($1, $2, true, 50, now()) returning id`, [l1.id, dernier]);
await attendRefus('CO ne saisit pas de cotisation', 'co',
  `insert into public.cotisations (lecteur_id, date_samedi, paye, montant, paid_at) values ($1, $2, true, 50, now()) returning id`, [l1.id, dernier]);
await attendOk('caissier saisit une cotisation (samedi gelé : pas de gel)', 'caissier',
  `insert into public.cotisations (lecteur_id, date_samedi, paye, montant, paid_at) values ($1, $2, true, 50, now()) returning id`, [l1.id, gele]);
await attendOk('caissier saisit une cotisation (dernier samedi)', 'caissier',
  `insert into public.cotisations (lecteur_id, date_samedi, paye, montant, paid_at) values ($1, $2, true, 50, now()) returning id`, [l1.id, dernier]);
await attendRefus('doublon lecteur+samedi refusé (unique)', 'caissier',
  `insert into public.cotisations (lecteur_id, date_samedi, paye, montant) values ($1, $2, true, 50) returning id`, [l1.id, dernier]);
await attendRefus('responsable ne modifie pas le montant de cotisation (app_settings)', 'responsable',
  `update public.app_settings set value = '1' where key = 'montant_cotisation' returning key`);
await attendLignes('admin modifie le montant de cotisation', 'admin',
  `update public.app_settings set value = '100' where key = 'montant_cotisation' returning key`);

section('5b. Auteur et montant forcés par la base');
const l3 = (await enAdminSql(`insert into public.lecteurs (nom, prenom, matricule, created_at) values ('KPOSSOU', 'Ida', '', '2020-01-01') returning id`))[0];
{
  // Le client envoie montant = 1 et recorded_by = admin : la base impose 100 et le caissier.
  const r = await attendOk('caissier envoie montant=1, recorded_by=admin', 'caissier',
    `insert into public.cotisations (lecteur_id, date_samedi, paye, montant, recorded_by) values ($1, $2, true, 1, $3) returning montant, recorded_by, paid_at`, [l3.id, dernier, U.admin]);
  const x = r.rows?.[0];
  if (x && x.montant === 100) ok('montant forcé au tarif courant (100)'); else ko('montant forcé', JSON.stringify(x));
  if (x && x.recorded_by === U.caissier) ok('recorded_by forcé à auth.uid() (caissier)'); else ko('recorded_by forcé', JSON.stringify(x));
  if (x && x.paid_at) ok('paid_at posé par la base'); else ko('paid_at', JSON.stringify(x));
  // Passage à non payé : paid_at effacé ; repassage à payé : montant recalculé.
  await attendLignes('caissier annule le paiement', 'caissier', `update public.cotisations set paye = false where lecteur_id = $1 and date_samedi = $2 returning id`, [l3.id, dernier]);
  const r2 = await enAdminSql(`select paid_at, montant from public.cotisations where lecteur_id = $1 and date_samedi = $2`, [l3.id, dernier]);
  if (r2[0].paid_at === null) ok('paid_at effacé à l\'annulation'); else ko('paid_at effacé', JSON.stringify(r2[0]));
  await enAdminSql(`update public.app_settings set value = '75' where key = 'montant_cotisation'`);
  await attendLignes('caissier ré-encaisse après changement de tarif (75)', 'caissier', `update public.cotisations set paye = true where lecteur_id = $1 and date_samedi = $2 returning id`, [l3.id, dernier]);
  const r3 = await enAdminSql(`select montant, recorded_by from public.cotisations where lecteur_id = $1 and date_samedi = $2`, [l3.id, dernier]);
  if (r3[0].montant === 75) ok('montant recalculé au nouveau tarif (75)'); else ko('montant recalculé', JSON.stringify(r3[0]));
  await enAdminSql(`update public.app_settings set value = '50' where key = 'montant_cotisation'`);

  // Présence : recorded_by forcé.
  const rp = await attendOk('responsable envoie recorded_by=admin sur une présence', 'responsable',
    `insert into public.presences (lecteur_id, date_samedi, statut, recorded_by) values ($1, $2, 'present', $3) on conflict (lecteur_id, date_samedi) do update set statut = 'present' returning recorded_by`, [l3.id, dernier, U.admin]);
  if (rp.rows?.[0]?.recorded_by === U.responsable) ok('presences.recorded_by forcé au responsable'); else ko('presences.recorded_by', JSON.stringify(rp.rows?.[0]));
}

section('5c. Contraintes métier');
{
  const mardi = (await enAdminSql(`select (public.dernier_samedi() + 3)::text d`))[0].d;
  await attendRefus('présence un mardi refusée', 'admin', `insert into public.presences (lecteur_id, date_samedi, statut) values ($1, $2, 'present') returning id`, [l1.id, mardi]);
  await attendRefus('cotisation un mardi refusée', 'caissier', `insert into public.cotisations (lecteur_id, date_samedi, paye) values ($1, $2, true) returning id`, [l1.id, mardi]);
  // l2 est archivé (§3) : le samedi courant isole bien le refus pour archivage, pas la règle des présences futures.
  await attendRefus('présence sur lecteur archivé refusée', 'admin', `insert into public.presences (lecteur_id, date_samedi, statut) values ($1, $2, 'present') returning id`, [l2.id, dernier]);
  await attendRefus('cotisation sur lecteur archivé refusée', 'caissier', `insert into public.cotisations (lecteur_id, date_samedi, paye) values ($1, $2, true) returning id`, [l2.id, futur]);
  const auj = (await enAdminSql(`select public.aujourdhui_benin()::text a, (now() at time zone 'Africa/Lagos')::date::text b`))[0];
  if (auj.a === auj.b) ok(`aujourdhui_benin() = ${auj.a} (Africa/Lagos)`); else ko('aujourdhui_benin', JSON.stringify(auj));
}

// ---------------------------------------------------------------------------
// 6. Événements — cycle de vie, tranches, caisse
// ---------------------------------------------------------------------------
section('6. Événements');
await attendRefus('responsable ne crée pas d\'événement', 'responsable',
  `insert into public.evenements (nom, date_evenement, montant_participation) values ('Pèlerinage', current_date, 1000) returning id`);
const ev = (await attendOk('CO crée un événement', 'co',
  `insert into public.evenements (nom, date_evenement, montant_participation, created_by) values ('Pèlerinage', current_date, 1000, $1) returning id`, [U.co])).rows[0].id;
{
  const c = await enAdminSql(`select created_by from public.evenements where id = $1`, [ev]);
  if (c[0].created_by === U.co) ok('evenements.created_by forcé au CO'); else ko('created_by', JSON.stringify(c[0]));
}
const rIns = await attendOk('responsable inscrit un participant (registered_by=admin envoyé)', 'responsable',
  `insert into public.evenement_participants (event_id, lecteur_id, registered_by) values ($1, $2, $3) returning registered_by`, [ev, l1.id, U.admin]);
if (rIns.rows?.[0]?.registered_by === U.responsable) ok('registered_by forcé au responsable'); else ko('registered_by', JSON.stringify(rIns.rows?.[0]));
await attendRefus('inscription d\'un lecteur archivé refusée', 'responsable',
  `insert into public.evenement_participants (event_id, lecteur_id) values ($1, $2) returning id`, [ev, l2.id]);
await attendRefus('inscription en double refusée', 'responsable',
  `insert into public.evenement_participants (event_id, lecteur_id) values ($1, $2) returning id`, [ev, l1.id]);
await attendRefus('responsable n\'encaisse pas de tranche', 'responsable',
  `insert into public.evenement_paiements (event_id, lecteur_id, montant) values ($1, $2, 400) returning id`, [ev, l1.id]);
await attendOk('CO encaisse une tranche de 400', 'co',
  `insert into public.evenement_paiements (event_id, lecteur_id, montant) values ($1, $2, 400) returning id`, [ev, l1.id]);
await attendRefus('tranche qui dépasse le montant (400 + 700 > 1000) refusée', 'co',
  `insert into public.evenement_paiements (event_id, lecteur_id, montant) values ($1, $2, 700) returning id`, [ev, l1.id]);
await attendOk('CO complète (400 + 600 = 1000)', 'co',
  `insert into public.evenement_paiements (event_id, lecteur_id, montant) values ($1, $2, 600) returning id`, [ev, l1.id]);
const opEv = (await attendOk('CO saisit une opération sur la caisse de l\'événement', 'co',
  `insert into public.caisse_operations (event_id, type, montant, motif) values ($1, 'decaissement', 200, 'Transport') returning id`, [ev])).rows[0].id;
await attendRefus('caissier ne saisit pas d\'opération de caisse', 'caissier',
  `insert into public.caisse_operations (type, montant, motif) values ('encaissement', 100, 'Don') returning id`);
await attendOk('CO saisit une opération de caisse générale', 'co',
  `insert into public.caisse_operations (type, montant, motif) values ('encaissement', 100, 'Don') returning id`);

await attendRefus('responsable ne clôture pas', 'responsable', `update public.evenements set statut = 'termine' where id = $1 returning id`, [ev]);
await attendLignes('CO clôture l\'événement', 'co', `update public.evenements set statut = 'termine' where id = $1 returning id`, [ev]);
{
  const r = await enAdminSql(`select action from public.logs where objet_type = 'evenements' and objet_ref = $1 order by id desc limit 1`, [ev]);
  if (r[0]?.action === 'evenement.cloture') ok('clôture journalisée par le trigger (evenement.cloture)');
  else ko('journal clôture', JSON.stringify(r[0]));
}
await attendRefus('événement terminé : inscription refusée', 'responsable',
  `insert into public.evenement_participants (event_id, lecteur_id) values ($1, $2) returning id`, [ev, l2.id]);
await attendRefus('événement terminé : tranche refusée', 'co',
  `insert into public.evenement_paiements (event_id, lecteur_id, montant) values ($1, $2, 1) returning id`, [ev, l2.id]);
await attendRefus('événement terminé : CO ne modifie plus l\'événement', 'co', `update public.evenements set lieu = 'X' where id = $1 returning id`, [ev]);
await attendRefus('événement terminé : CO ne réouvre pas', 'co', `update public.evenements set statut = 'en_cours' where id = $1 returning id`, [ev]);
await attendRefus('événement terminé : CO ne modifie plus une opération de caisse liée (WITH CHECK)', 'co',
  `update public.caisse_operations set montant = 1 where id = $1 returning id`, [opEv]);
await attendRefus('événement terminé : CO ne supprime plus une opération de caisse liée', 'co',
  `delete from public.caisse_operations where id = $1 returning id`, [opEv]);
await attendRefus('CO ne rattache pas une opération générale à un événement clôturé (WITH CHECK)', 'co',
  `update public.caisse_operations set event_id = $1 where event_id is null returning id`, [ev]);
await attendLignes('admin réouvre l\'événement', 'admin', `update public.evenements set statut = 'en_cours' where id = $1 returning id`, [ev]);
{
  const r = await enAdminSql(`select action from public.logs where objet_type = 'evenements' and objet_ref = $1 order by id desc limit 1`, [ev]);
  if (r[0]?.action === 'evenement.reouverture') ok('réouverture journalisée par le trigger (evenement.reouverture)');
  else ko('journal réouverture', JSON.stringify(r[0]));
}
await attendRefus('responsable ne supprime pas un événement', 'responsable', `delete from public.evenements where id = $1 returning id`, [ev]);
await attendLignes('CO supprime l\'événement (cascade)', 'co', `delete from public.evenements where id = $1 returning id`, [ev]);
{
  const r = await enAdminSql(`select action from public.logs where objet_type = 'evenements' and objet_ref = $1 order by id desc limit 1`, [ev]);
  if (r[0]?.action === 'evenement.suppression') ok('suppression journalisée par le trigger (evenement.suppression)');
  else ko('journal suppression', JSON.stringify(r[0]));
  const c = await enAdminSql(`select count(*)::int n from public.evenement_paiements where event_id = $1`, [ev]);
  if (c[0].n === 0) ok('paiements supprimés en cascade');
  else ko('cascade paiements');
}

// ---------------------------------------------------------------------------
// 7. Journal — infalsifiable
// ---------------------------------------------------------------------------
section('7. Journal');
await attendRefus('log_action n\'est plus appelable par un compte applicatif', 'responsable',
  `select public.log_action('compte.connexion', 'profiles', $1, null)`, [U.admin]);
await attendRefus('journal_client refuse une action métier (evenement.cloture)', 'responsable',
  `select public.journal_client('evenement.cloture', 'evenements', 'x', null)`);
await attendOk('journal_client accepte compte.connexion', 'responsable',
  `select public.journal_client('compte.connexion', 'profiles', $1, '{"identifiant":"resp1"}'::jsonb)`, [U.admin]);
{
  const r = await enAdminSql(`select user_id, objet_ref from public.logs where action = 'compte.connexion' order by id desc limit 1`);
  if (r[0].user_id === U.responsable && r[0].objet_ref === U.responsable) ok('l\'auteur et la référence sont forcés à auth.uid() (usurpation impossible)');
  else ko('usurpation', JSON.stringify(r[0]));
}
await attendOk('journal_client accepte export.pdf', 'caissier', `select public.journal_client('export.pdf', 'caisse', '2026-09', '{"document":"etat_caisse"}'::jsonb)`);
{
  const r = await en('responsable', `select count(*)::int n from public.logs`);
  if (r.rows?.[0]?.n === 0) ok('responsable : logs invisibles (0 ligne)');
  else ko('responsable voit les logs', JSON.stringify(r.rows?.[0]));
}
await attendOk('admin lit les logs', 'admin', `select count(*) from public.logs`);
await attendRefus('personne n\'écrit directement dans logs', 'admin', `insert into public.logs (action) values ('x') returning id`);

// ---------------------------------------------------------------------------
// 8. Vues d'agrégats & volumétrie (200 lecteurs)
// ---------------------------------------------------------------------------
section('8. Agrégats & volumétrie (200 lecteurs × 52 samedis)');
{
  // 200 lecteurs, 52 samedis de cotisations et de présences.
  // created_at reculé de 2 ans : sinon le trigger « premier samedi actif »
  // (entrée en vigueur au samedi suivant l'inscription) refuserait — à juste
  // titre — l'insertion d'un historique d'un an pour des lecteurs créés
  // aujourd'hui. La volumétrie teste la perf, pas cette règle (voir 8b).
  await db.exec(`
    insert into public.lecteurs (nom, prenom, matricule, created_at)
    select 'NOM' || g, 'Prenom' || g, '', now() - interval '2 years' from generate_series(1, 200) g;
  `);
  const n = (await enAdminSql(`select count(*)::int n, max(matricule) m from public.lecteurs`))[0];
  if (n.n === 203 && n.m === 'LEC302') ok(`203 lecteurs, dernier matricule ${n.m}`);
  else ko('volumétrie lecteurs', JSON.stringify(n));

  const t0 = Date.now();
  await db.exec(`
    insert into public.cotisations (lecteur_id, date_samedi, paye, montant, paid_at)
    select l.id, d::date, true, 50, d
      from public.lecteurs l,
           generate_series(public.dernier_samedi() - 7 * 51, public.dernier_samedi(), interval '7 days') d
     where l.matricule > 'LEC102'
    on conflict do nothing;
    insert into public.presences (lecteur_id, date_samedi, statut)
    select l.id, d::date, case when random() < 0.8 then 'present' else 'absent' end
      from public.lecteurs l,
           generate_series(public.dernier_samedi() - 7 * 51, public.dernier_samedi(), interval '7 days') d
     where l.matricule > 'LEC102'
    on conflict do nothing;
  `);
  const c = (await enAdminSql(`select (select count(*)::int from public.cotisations) c, (select count(*)::int from public.presences) p, (select count(*)::int from public.logs) l`))[0];
  ok(`${c.c} cotisations, ${c.p} présences, ${c.l} lignes de journal insérées en ${Date.now() - t0} ms (triggers d'audit inclus)`);

  const v = await en('responsable', `select * from public.v_caisse_totaux`);
  // Référence calculée en SQL propriétaire (hors RLS) : la vue doit dire pareil.
  const attendu = Number((await enAdminSql(`select coalesce(sum(montant),0)::bigint t from public.cotisations where paye`))[0].t);
  if (attendu === 200 * 52 * 50 + 50 + 50 + 75) ok(`référence : 200 × 52 × 50 + 3 cotisations de test = ${attendu} F`); else ko('référence cotisations', String(attendu));
  if (v.rows && Number(v.rows[0].total_cotisations) === attendu && Number(v.rows[0].total_encaissements) === 100)
    ok(`v_caisse_totaux : ${v.rows[0].total_cotisations} F de cotisations, ${v.rows[0].total_encaissements} F d'encaissements`);
  else ko('v_caisse_totaux', JSON.stringify(v.rows?.[0] ?? v.error?.message));

  // Vues mensuelles : cohérentes avec les lignes brutes (que le navigateur ne charge plus).
  const brut = (await enAdminSql(`
    select to_char(date_samedi,'YYYY-MM') mois, count(*) filter (where statut='present')::int presents, count(*) filter (where statut='absent')::int absents
      from public.presences p join public.lecteurs l on l.id = p.lecteur_id and not l.archived
     where date_samedi <= public.aujourdhui_benin() group by 1 order by 1`));
  const vue = (await en('responsable', `select * from public.v_presences_par_mois order by mois`)).rows ?? [];
  const identique = brut.length === vue.length && brut.every((b, i) => b.mois === vue[i].mois && b.presents === vue[i].presents && b.absents === vue[i].absents);
  if (identique && vue.length >= 12) ok(`v_presences_par_mois : ${vue.length} mois, identiques au calcul brut (${brut.reduce((s, b) => s + b.presents + b.absents, 0)} présences agrégées)`);
  else ko('v_presences_par_mois', JSON.stringify({ brut: brut.slice(0, 2), vue: vue.slice(0, 2) }));
  const cm = (await en('caissier', `select * from public.v_cotisations_par_mois order by mois`)).rows ?? [];
  const sommeCm = cm.reduce((s, r) => s + Number(r.total), 0);
  if (sommeCm === attendu) ok(`v_cotisations_par_mois : ${cm.length} mois, total ${sommeCm} F`); else ko('v_cotisations_par_mois', `${sommeCm} ≠ ${attendu}`);
  const eff = (await en('responsable', `select * from public.v_effectif_par_mois order by mois`)).rows ?? [];
  if (eff.length === 12 && Number(eff.at(-1).effectif) === 202) ok(`v_effectif_par_mois : 12 mois, effectif courant ${eff.at(-1).effectif}`); else ko('v_effectif_par_mois', JSON.stringify(eff.slice(-1)));
  const cpt = (await en('responsable', `select * from public.v_lecteurs_compteurs`)).rows?.[0];
  if (cpt && Number(cpt.actifs) === 202 && Number(cpt.archives) === 1) ok(`v_lecteurs_compteurs : ${cpt.actifs} actifs, ${cpt.archives} archivé`); else ko('v_lecteurs_compteurs', JSON.stringify(cpt));

  // Preuve du problème « 1 000 lignes » : un mois à 5 samedis pour 200 lecteurs.
  const nbMois5 = (await enAdminSql(`
    select count(*)::int n from public.presences p
     where to_char(date_samedi,'YYYY-MM') = (select to_char(date_samedi,'YYYY-MM') from public.presences group by 1 having count(distinct date_samedi) = 5 order by 1 desc limit 1)`))[0].n;
  if (nbMois5 >= 1000) ok(`un mois à 5 samedis = ${nbMois5} présences (≥ 1 000 : la page Présences DOIT paginer — cf. verif.ts « Pagination »)`);
  else ok(`(aucun mois à 5 samedis complet dans la fenêtre : ${nbMois5} lignes)`);

  const a = await en('caissier', `select * from public.v_cotisations_par_annee order by annee`);
  const somme = a.rows?.reduce((s, r) => s + Number(r.total), 0);
  if (somme === attendu) ok(`v_cotisations_par_annee : ${a.rows.map((r) => `${r.annee}=${r.total}`).join(', ')}`);
  else ko('v_cotisations_par_annee', JSON.stringify(a.rows ?? a.error?.message));
}

// ---------------------------------------------------------------------------
// 8b. Premier samedi actif : protections base (migration 20260919120000)
// ---------------------------------------------------------------------------
section('8b. Premier samedi actif (triggers presences/cotisations)');
{
  // Fonction pure (fuseau Bénin) : samedi d'inscription → ce samedi ;
  // autre jour → samedi suivant ; null → 1970 (pas de blocage).
  const ps = (await enAdminSql(`
    select public.premier_samedi_actif('2026-09-16 10:00:00+00')::text as mercredi,
           public.premier_samedi_actif('2026-09-19 10:00:00+00')::text as samedi,
           public.premier_samedi_actif('2026-09-20 10:00:00+00')::text as dimanche,
           public.premier_samedi_actif(null)::text as vide`))[0];
  if (ps.mercredi === '2026-09-19' && ps.samedi === '2026-09-19' && ps.dimanche === '2026-09-26' && ps.vide === '1970-01-01')
    ok(`premier_samedi_actif : mer ${ps.mercredi}, sam ${ps.samedi}, dim ${ps.dimanche}, null ${ps.vide}`);
  else ko('premier_samedi_actif', JSON.stringify(ps));

  // LEC103 : lecteur sectaire créé il y a 2 ans (volumétrie). Toute ligne à
  // PSA − 7 jours doit être rejetée par le trigger (INSERT), même en admin.
  await attendRefus(
    'présence avant le premier samedi actif',
    'admin',
    `insert into public.presences (lecteur_id, date_samedi, statut)
     select id, public.premier_samedi_actif(created_at) - 7, 'present'
       from public.lecteurs where matricule = 'LEC103'`
  );
  await attendRefus(
    'cotisation avant le premier samedi actif',
    'admin',
    `insert into public.cotisations (lecteur_id, date_samedi, paye, montant)
     select id, public.premier_samedi_actif(created_at) - 7, true, 50
       from public.lecteurs where matricule = 'LEC103'`
  );
  // Le trigger ne bloque pas une mise à jour légitime (date ≥ PSA).
  await attendOk(
    'mise à jour d\'une présence autorisée (date ≥ premier samedi actif)',
    'admin',
    `update public.presences set statut = 'present'
      where lecteur_id = (select id from public.lecteurs where matricule = 'LEC103')
        and date_samedi = public.dernier_samedi()`
  );

  // Le trigger couvre aussi l'UPDATE : même l'admin ne peut pas DÉPLACER une
  // ligne vers un samedi antérieur au premier samedi actif du lecteur.
  const psaMoins7 = (await enAdminSql(
    `select (public.premier_samedi_actif(created_at) - 7)::text d from public.lecteurs where matricule = 'LEC103'`
  ))[0].d;
  await attendRefus(
    'UPDATE qui déplace une présence avant le premier samedi actif refusé (même admin)',
    'admin',
    `update public.presences set date_samedi = $2
      where lecteur_id = (select id from public.lecteurs where matricule = 'LEC103')
        and date_samedi = public.dernier_samedi()`,
    [psaMoins7]
  );
  await attendRefus(
    'UPDATE qui déplace une cotisation avant le premier samedi actif refusé (même admin)',
    'admin',
    `update public.cotisations set date_samedi = $2
      where lecteur_id = (select id from public.lecteurs where matricule = 'LEC103')
        and date_samedi = public.dernier_samedi()`,
    [psaMoins7]
  );

  // Dénominateurs du tableau de bord (migration 20260919180000) : les vues
  // comptent seulement les samedis ARRIVÉS à partir du premier samedi actif de
  // chaque lecteur — vérifiées contre un calcul brut en SQL propriétaire.
  const moisRef = (await enAdminSql(`select to_char(public.dernier_samedi(), 'YYYY-MM')::text m`))[0].m;
  const refElig = (await enAdminSql(`
    select
      (select count(*)::int
         from public.lecteurs l,
              generate_series(
                to_date($1 || '-01', 'YYYY-MM-DD')::date,
                (to_date($1 || '-01', 'YYYY-MM-DD')::date + interval '1 month' - interval '1 day')::date,
                interval '1 day') g(d)
        where not l.archived
          and extract(isodow from g.d::date) = 6
          and g.d::date <= public.aujourdhui_benin()
          and g.d::date >= public.premier_samedi_actif(l.created_at)) as paires,
      (select count(distinct l.id)::int
         from public.lecteurs l,
              generate_series(
                to_date($1 || '-01', 'YYYY-MM-DD')::date,
                (to_date($1 || '-01', 'YYYY-MM-DD')::date + interval '1 month' - interval '1 day')::date,
                interval '1 day') g(d)
        where not l.archived
          and extract(isodow from g.d::date) = 6
          and g.d::date <= public.aujourdhui_benin()
          and g.d::date >= public.premier_samedi_actif(l.created_at)) as lecteurs
  `, [moisRef]))[0];
  const vueEligP = (await en('responsable', `select samedis_eligibles from public.v_presences_par_mois where mois = $1`, [moisRef])).rows?.[0];
  if (vueEligP && Number(vueEligP.samedis_eligibles) === Number(refElig.paires))
    ok(`v_presences_par_mois.samedis_eligibles = ${refElig.paires} paires (référence brute, ${moisRef})`);
  else ko('v_presences_par_mois.samedis_eligibles', JSON.stringify({ vue: vueEligP, attendu: refElig.paires }));
  const vueEligC = (await en('caissier', `select lecteurs_eligibles from public.v_cotisations_par_mois where mois = $1`, [moisRef])).rows?.[0];
  if (vueEligC && Number(vueEligC.lecteurs_eligibles) === Number(refElig.lecteurs))
    ok(`v_cotisations_par_mois.lecteurs_eligibles = ${refElig.lecteurs} lecteurs (référence brute, ${moisRef})`);
  else ko('v_cotisations_par_mois.lecteurs_eligibles', JSON.stringify({ vue: vueEligC, attendu: refElig.lecteurs }));

  // Robustesse « ne doit JAMAIS être comptabilisé » : même si des lignes
  // antérieures au premier samedi actif existaient en base (données legacy
  // créées avant la règle), les vues d'agrégats les excluent. Simulation en
  // désactivant temporairement les triggers (ce que le SQL Editor pourrait
  // faire) — les vues sont la 2e ligne de défense.
  const leg = (await enAdminSql(`insert into public.lecteurs (nom, prenom, matricule) values ('LEGACY', 'Test', '') returning id`))[0].id;
  const legAvant = (await enAdminSql(`select (public.premier_samedi_actif(created_at) - 7)::text d from public.lecteurs where id = $1`, [leg]))[0].d;
  await enAdminSql(`alter table public.presences disable trigger check_presence_premier_samedi`);
  await enAdminSql(`alter table public.cotisations disable trigger check_cotisation_premier_samedi`);
  try {
    await enAdminSql(`insert into public.presences (lecteur_id, date_samedi, statut) values ($1, $2, 'present')`, [leg, legAvant]);
    await enAdminSql(`insert into public.cotisations (lecteur_id, date_samedi, paye) values ($1, $2, true)`, [leg, legAvant]);
  } finally {
    await enAdminSql(`alter table public.presences enable trigger check_presence_premier_samedi`);
    await enAdminSql(`alter table public.cotisations enable trigger check_cotisation_premier_samedi`);
  }
  const refExclu = (await enAdminSql(`
    select
      (select coalesce(count(*) filter (where p.statut = 'present'), 0)::int
         from public.presences p
         join public.lecteurs l on l.id = p.lecteur_id and not l.archived
        where p.date_samedi <= public.aujourdhui_benin()
          and p.date_samedi >= public.premier_samedi_actif(l.created_at)) as presents_ok,
      (select coalesce(sum(c.montant), 0)::bigint
         from public.cotisations c
         join public.lecteurs l on l.id = c.lecteur_id
        where c.paye
          and c.date_samedi >= public.premier_samedi_actif(l.created_at)) as montant_ok
  `))[0];
  const legPres = (await en('responsable', `select coalesce(sum(presents), 0)::int s from public.v_presences_par_mois`)).rows?.[0];
  if (legPres && Number(legPres.s) === Number(refExclu.presents_ok))
    ok(`v_presences_par_mois exclut la ligne legacy antérieure au premier samedi actif (${refExclu.presents_ok} présents comptés)`);
  else ko('v_presences_par_mois exclut la ligne legacy', JSON.stringify({ vue: legPres, attendu: refExclu.presents_ok }));
  const legAnnee = (await en('caissier', `select coalesce(sum(total), 0)::int s from public.v_cotisations_par_annee`)).rows?.[0];
  const legEnc = (await en('caissier', `select coalesce(sum(total), 0)::int s from public.v_encaissements_par_mois`)).rows?.[0];
  const legCaisse = (await en('caissier', `select * from public.v_caisse_totaux`)).rows?.[0];
  if (
    legAnnee && Number(legAnnee.s) === Number(refExclu.montant_ok) &&
    legEnc && Number(legEnc.s) === Number(refExclu.montant_ok) &&
    legCaisse && Number(legCaisse.total_cotisations) === Number(refExclu.montant_ok)
  )
    ok(`vues cotisations excluent la ligne legacy (${Number(refExclu.montant_ok)} F comptés partout, caisse incluse)`);
  else ko('vues cotisations excluent la ligne legacy', JSON.stringify({ annee: legAnnee, enc: legEnc, caisse: legCaisse, attendu: refExclu.montant_ok }));
  // Nettoyage : la suppression du lecteur cascade sur ses lignes legacy.
  await enAdminSql(`delete from public.lecteurs where id = $1`, [leg]);
}

// ---------------------------------------------------------------------------
// 9. Publication temps réel
// ---------------------------------------------------------------------------
section('9. Temps réel (publication supabase_realtime)');
{
  const pub = await enAdminSql(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`);
  const tables = pub.map((r) => r.tablename);
  for (const t of ['presences', 'cotisations', 'lecteurs', 'fraternites', 'caisse_operations', 'evenements', 'evenement_participants', 'evenement_paiements']) {
    if (tables.includes(t)) ok(`${t} publiée`);
    else ko(`${t} NON publiée`);
  }
  const ri = await enAdminSql(`select relname, relreplident from pg_class where relname in ('presences','cotisations','evenements','caisse_operations')`);
  for (const r of ri) {
    if (r.relreplident === 'f') ok(`${r.relname} : replica identity full`);
    else ko(`${r.relname} : replica identity ${r.relreplident}`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n──────────────────────────────────────────────────────────────────');
if (echecs.length === 0) {
  console.log(`✅ ${reussites} vérifications base réussies, 0 échec.`);
  process.exit(0);
} else {
  console.log(`❌ ${echecs.length} échec(s) sur ${reussites + echecs.length} :`);
  for (const e of echecs) console.log(`   • ${e}`);
  process.exit(1);
}
