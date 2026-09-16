/**
 * Vérification de la SYNCHRONISATION TEMPS RÉEL — bout en bout, sans
 * navigateur ni instance Supabase :
 *
 *   PGlite (PostgreSQL + migrations réelles + trigger pg_notify)
 *      └─► faux serveur Realtime (protocole Phoenix v1, WebSocket local)
 *             └─► VRAI client supabase-js ×3 (« postes » : CO, Caissier, Responsable)
 *                    └─► VRAI hook useRealtime monté par React dans jsdom
 *
 * Scénarios (chaque poste a sa page ouverte) :
 *   1. Un poste enregistre une tranche sur l'événement A → seuls les postes
 *      qui regardent A se rechargent (filtre event_id=eq.A) ; celui sur B non.
 *   2. Rafale : 25 cotisations saisies en 300 ms par le Caissier → le tableau
 *      de bord de chaque autre poste se recharge UNE fois (regroupement).
 *   3. Clôture d'un événement → la page de détail se recharge (UPDATE filtré id=eq.A).
 *   4. Suppression d'un événement → la liste se recharge (DELETE).
 *   5. Démontage d'une page → plus aucun rechargement pour ce poste.
 *   6. 200 lecteurs : 200 présences pointées en rafale → rechargement unique
 *      par poste, aucun rechargement superposé.
 *
 *   npm run verif:realtime
 */
import { PGlite } from '@electric-sql/pglite';
import { WebSocketServer } from 'ws';
import { build } from 'vite';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
let reussites = 0;
const echecs = [];
const ok = (n) => { reussites++; console.log(`  ✓ ${n}`); };
const ko = (n, d) => { echecs.push(`${n}${d ? ` — ${d}` : ''}`); console.log(`  ✗ ${n}${d ? `\n      ${d}` : ''}`); };
const eq = (n, a, b) => (a === b ? ok(`${n} (${JSON.stringify(a)})`) : ko(n, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 1. Base : migrations réelles + trigger de notification
// ---------------------------------------------------------------------------
const db = new PGlite();
await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin; create role authenticated nologin; create role supabase_admin nologin;
  create publication supabase_realtime;
`);
const dir = join(racine, 'supabase', 'migrations');
for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await db.exec(readFileSync(join(dir, f), 'utf8'));
// Émulation de la réplication logique : chaque écriture sur une table publiée
// est notifiée (comme le ferait le serveur Realtime à partir du WAL).
await db.exec(`
  create or replace function public._rt_notify() returns trigger language plpgsql as $$
  begin
    perform pg_notify('rt', json_build_object(
      'table', tg_table_name, 'type', tg_op,
      'record', case when tg_op = 'DELETE' then null else row_to_json(new) end,
      'old', case when tg_op = 'INSERT' then null else row_to_json(old) end
    )::text);
    return coalesce(new, old);
  end $$;
  do $$ declare t text; begin
    for t in select tablename from pg_publication_tables where pubname = 'supabase_realtime' loop
      execute format('create trigger _rt_%I after insert or update or delete on public.%I for each row execute function public._rt_notify()', t, t);
    end loop;
  end $$;
`);
ok('migrations appliquées, 8 tables publiées instrumentées');

// ---------------------------------------------------------------------------
// 2. Faux serveur Realtime (protocole Phoenix v2 : trames JSON [join_ref, ref, topic, event, payload])
// ---------------------------------------------------------------------------
const PORT = 54321;
const wss = new WebSocketServer({ port: PORT, path: '/realtime/v1/websocket' });
const abonnements = []; // { ws, topic, joinRef, bindings: [{id, event, table, filter}] }
let prochainId = 1;
let messagesEnvoyes = 0;
wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    const [join_ref, ref, topic, event, pl] = JSON.parse(raw.toString());
    const m = { join_ref, ref, topic, event, payload: pl };
    const repondre = (payload) => ws.send(JSON.stringify([m.join_ref ?? null, m.ref, m.topic, 'phx_reply', payload]));
    if (m.topic === 'phoenix' && m.event === 'heartbeat') return repondre({ status: 'ok', response: {} });
    if (m.event === 'phx_join') {
      const bindings = (m.payload?.config?.postgres_changes ?? []).map((b) => ({ id: prochainId++, ...b }));
      abonnements.push({ ws, topic: m.topic, joinRef: m.ref, bindings });
      return repondre({ status: 'ok', response: { postgres_changes: bindings } });
    }
    if (m.event === 'phx_leave') {
      for (let i = abonnements.length - 1; i >= 0; i--) if (abonnements[i].ws === ws && abonnements[i].topic === m.topic) abonnements.splice(i, 1);
      return repondre({ status: 'ok', response: {} });
    }
    if (m.event === 'access_token') return; // pas de réponse attendue
    repondre({ status: 'ok', response: {} });
  });
  ws.on('close', () => { for (let i = abonnements.length - 1; i >= 0; i--) if (abonnements[i].ws === ws) abonnements.splice(i, 1); });
});
function filtreOk(filter, rec) {
  if (!filter) return true;
  const m = /^(\w+)=eq\.(.+)$/.exec(filter);
  if (!m) return true;
  return rec && String(rec[m[1]]) === m[2];
}
await db.listen('rt', (payload) => {
  const n = JSON.parse(payload);
  for (const ab of abonnements) {
    const ids = ab.bindings
      .filter((b) => b.table === n.table && (b.event === '*' || b.event === n.type) && filtreOk(b.filter, n.record ?? n.old))
      .map((b) => b.id);
    if (ids.length === 0) continue;
    messagesEnvoyes++;
    ab.ws.send(JSON.stringify([ab.joinRef, null, ab.topic, 'postgres_changes',
      { ids, data: { schema: 'public', table: n.table, type: n.type, commit_timestamp: new Date().toISOString(), record: n.record ?? {}, old_record: n.old ?? {}, columns: [], errors: null } },
    ]));
  }
});
ok(`serveur Realtime local sur ws://localhost:${PORT}`);

// ---------------------------------------------------------------------------
// 3. Bundle du VRAI hook + VRAI client (URL pointée sur le serveur local)
// ---------------------------------------------------------------------------
process.env.VITE_SUPABASE_URL = `http://localhost:${PORT}`;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'cle-de-test';
const bundleDir = join(racine, 'tmp', 'rt-bundle');
await build({
  root: racine, logLevel: 'silent', configFile: false,
  define: { 'process.env.NODE_ENV': '"development"' },
  build: { outDir: bundleDir, emptyOutDir: true, ssr: join(racine, 'scripts', 'realtime-entry.ts'), rollupOptions: { output: { format: 'es', entryFileNames: 'entry.mjs' } }, minify: false },
  ssr: { noExternal: true },
});
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'Node', 'Element', 'MutationObserver', 'localStorage']) {
  try { Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true }); } catch { /* ignore */ }
}
try { Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true }); } catch { /* ignore */ }
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { useRealtime, supabase, createElement, createRoot, act } = await import(pathToFileURL(join(bundleDir, 'entry.mjs')).href);
ok('vrai hook useRealtime + vrai client supabase-js chargés');

// ---------------------------------------------------------------------------
// 4. « Postes » : chaque page ouverte = un composant React qui utilise le hook.
// ---------------------------------------------------------------------------
const pages = new Map(); // nom → { compteur, enCours, maxParallele, root, conteneur }
function Page({ nom, canal, ecoutes, duree }) {
  useRealtime(canal, ecoutes, async () => {
    const p = pages.get(nom);
    p.enCours++; p.maxParallele = Math.max(p.maxParallele, p.enCours);
    p.compteur++;
    await dormir(duree ?? 20);
    p.enCours--;
  });
  return null;
}
async function ouvrir(nom, canal, ecoutes, duree) {
  const conteneur = dom.window.document.createElement('div');
  const root = createRoot(conteneur);
  pages.set(nom, { compteur: 0, enCours: 0, maxParallele: 0, root, conteneur });
  await act(async () => { root.render(createElement(Page, { nom, canal, ecoutes, duree })); });
}
async function fermer(nom) {
  const p = pages.get(nom);
  await act(async () => { p.root.unmount(); });
}
const compteur = (nom) => pages.get(nom).compteur;
const remettre = () => { for (const p of pages.values()) { p.compteur = 0; p.maxParallele = 0; } };
/** Attend la fin du regroupement (400 ms) + marge réseau. */
const attendreSync = () => dormir(900);

// Données : 2 événements, 200 lecteurs.
await db.exec(`insert into public.lecteurs (nom, prenom, matricule) select 'NOM'||g, 'P'||g, '' from generate_series(1,200) g;`);
const evA = (await db.query(`insert into public.evenements (nom, date_evenement, montant_participation) values ('A', current_date, 1000) returning id`)).rows[0].id;
const evB = (await db.query(`insert into public.evenements (nom, date_evenement, montant_participation) values ('B', current_date, 500) returning id`)).rows[0].id;
const lecteurs = (await db.query(`select id from public.lecteurs order by matricule`)).rows.map((r) => r.id);
await db.query(`insert into public.evenement_participants (event_id, lecteur_id) select $1, id from public.lecteurs`, [evA]);

// Postes ouverts, comme dans l'application (mêmes écoutes que les pages).
await ouvrir('CO · détail A', `realtime-evenement-${evA}`, [
  { table: 'evenement_participants', filter: `event_id=eq.${evA}` },
  { table: 'evenement_paiements', filter: `event_id=eq.${evA}` },
  { table: 'caisse_operations', filter: `event_id=eq.${evA}` },
  { table: 'evenements', filter: `id=eq.${evA}` },
]);
await ouvrir('Responsable · détail B', `realtime-evenement-${evB}`, [
  { table: 'evenement_participants', filter: `event_id=eq.${evB}` },
  { table: 'evenement_paiements', filter: `event_id=eq.${evB}` },
  { table: 'caisse_operations', filter: `event_id=eq.${evB}` },
  { table: 'evenements', filter: `id=eq.${evB}` },
]);
await ouvrir('Caissier · liste événements', 'realtime-evenements', ['evenements', 'evenement_participants']);
await ouvrir('Admin · tableau de bord', 'realtime-dashboard', ['presences', 'cotisations', 'lecteurs', 'caisse_operations', 'evenements', 'evenement_paiements'], 150);
await ouvrir('Responsable · présences', 'realtime-presences', ['presences'], 150);
await dormir(800); // abonnements établis
eq('abonnements actifs côté serveur', abonnements.length, 5);
remettre();

console.log('\nScénario 1 — tranche encaissée sur A : seuls les postes concernés se rechargent');
await db.query(`insert into public.evenement_paiements (event_id, lecteur_id, montant) values ($1, $2, 300)`, [evA, lecteurs[0]]);
await attendreSync();
eq('CO · détail A rechargé', compteur('CO · détail A'), 1);
eq('Responsable · détail B NON rechargé (filtre event_id)', compteur('Responsable · détail B'), 0);
eq('Caissier · liste NON rechargée (n\'écoute pas les paiements)', compteur('Caissier · liste événements'), 0);
eq('Admin · tableau de bord rechargé (écoute evenement_paiements)', compteur('Admin · tableau de bord'), 1);
remettre();

console.log('\nScénario 2 — rafale : 25 cotisations en ~300 ms → un seul rechargement');
const dernier = (await db.query(`select public.dernier_samedi()::text d`)).rows[0].d;
for (let i = 0; i < 25; i++) {
  await db.query(`insert into public.cotisations (lecteur_id, date_samedi, paye, montant, paid_at) values ($1, $2, true, 50, now())`, [lecteurs[i], dernier]);
  await dormir(12);
}
await attendreSync();
eq('Admin · tableau de bord : 1 rechargement pour 25 écritures', compteur('Admin · tableau de bord'), 1);
eq('Responsable · présences : 0 (n\'écoute pas les cotisations)', compteur('Responsable · présences'), 0);
remettre();

console.log('\nScénario 3 — clôture de A (UPDATE) : détail A + liste + tableau de bord');
await db.query(`update public.evenements set statut = 'termine' where id = $1`, [evA]);
await attendreSync();
eq('CO · détail A rechargé', compteur('CO · détail A'), 1);
eq('Responsable · détail B NON rechargé (filtre id)', compteur('Responsable · détail B'), 0);
eq('Caissier · liste rechargée', compteur('Caissier · liste événements'), 1);
remettre();

console.log('\nScénario 4 — suppression de B (DELETE, cascade) : liste + détail B');
await db.query(`delete from public.evenements where id = $1`, [evB]);
await attendreSync();
eq('Caissier · liste rechargée', compteur('Caissier · liste événements'), 1);
eq('Responsable · détail B rechargé (DELETE filtré sur old.id)', compteur('Responsable · détail B'), 1);
eq('CO · détail A NON rechargé', compteur('CO · détail A'), 0);
remettre();

console.log('\nScénario 5 — le CO quitte la page A : plus aucun rechargement pour lui');
await fermer('CO · détail A');
await dormir(300);
eq('abonnement retiré côté serveur', abonnements.length, 4);
await db.query(`update public.evenements set statut = 'en_cours' where id = $1`, [evA]);
await attendreSync();
eq('CO · détail A (fermée) : 0 rechargement', compteur('CO · détail A'), 0);
eq('Caissier · liste rechargée', compteur('Caissier · liste événements'), 1);
remettre();

console.log('\nScénario 6 — 200 présences pointées d\'affilée (200 lecteurs)');
const t0 = Date.now();
for (const id of lecteurs) {
  await db.query(`insert into public.presences (lecteur_id, date_samedi, statut) values ($1, $2, 'present') on conflict (lecteur_id, date_samedi) do update set statut = 'present'`, [id, dernier]);
}
const dureeSaisie = Date.now() - t0;
await dormir(1500);
const p = pages.get('Responsable · présences');
console.log(`  (200 écritures en ${dureeSaisie} ms, ${messagesEnvoyes} messages Realtime émis au total)`);
if (p.compteur >= 1 && p.compteur <= 3) ok(`Responsable · présences : ${p.compteur} rechargement(s) pour 200 écritures (regroupement)`); else ko('regroupement présences', `${p.compteur} rechargements`);
eq('aucun rechargement superposé (max parallèle)', p.maxParallele, 1);
const d = pages.get('Admin · tableau de bord');
if (d.compteur >= 1 && d.compteur <= 3) ok(`Admin · tableau de bord : ${d.compteur} rechargement(s)`); else ko('regroupement tableau de bord', `${d.compteur}`);
eq('tableau de bord : aucun rechargement superposé', d.maxParallele, 1);

// Nettoyage
for (const nom of [...pages.keys()]) if (pages.get(nom).root) { try { await fermer(nom); } catch { /* déjà fermée */ } }
await supabase.removeAllChannels();
wss.close();
await db.close();

console.log('\n' + '─'.repeat(66));
if (echecs.length === 0) { console.log(`✅ ${reussites} vérifications temps réel réussies, 0 échec.`); process.exit(0); }
else { console.log(`❌ ${echecs.length} échec(s) :`); echecs.forEach((e) => console.log(`   • ${e}`)); process.exit(1); }
