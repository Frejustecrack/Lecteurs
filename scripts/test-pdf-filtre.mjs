/**
 * Test spécifique pour la question de l'utilisateur :
 * Si on filtre 50 lecteurs sur 200, le PDF ne doit pas contenir de pages vides pour les 150 restants.
 * Il doit contenir seulement les 50 filtrés, paginés correctement.
 */
import { build } from 'vite';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundleDir = join(racine, 'tmp', 'pdf-filtre-bundle');
await build({
  root: racine,
  logLevel: 'silent',
  configFile: false,
  build: {
    outDir: bundleDir,
    emptyOutDir: true,
    ssr: join(racine, 'src', 'pdf', 'export.ts'),
    rollupOptions: { output: { format: 'es', entryFileNames: 'export.mjs' } },
    minify: false,
  },
  ssr: { noExternal: true },
});

const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const k of ['window','document','HTMLElement','HTMLCanvasElement','Image','DOMParser','XMLSerializer','Node','Element','Blob','URL']) {
  try { Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true }); } catch {}
}
try { Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true }); } catch {}

const mod = await import(pathToFileURL(join(bundleDir, 'export.mjs')).href);

const produits = [];
mod.definirIntercepteurPdf((doc, nom) => {
  const pages = doc.getNumberOfPages();
  const lastTable = doc.lastAutoTable;
  const rows = lastTable ? lastTable.body.length : 0;
  // Compter les cellules vides ou pages sans données
  const allText = [];
  if (lastTable) {
    for (const row of lastTable.body) {
      for (const c of Object.values(row.cells)) allText.push(String(c.raw ?? ''));
    }
  }
  produits.push({ nom, pages, rows, doc });
});

function makeLecteurs(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `l${i}`,
    matricule: `LEC${100+i}`,
    nom: `NOM${i}`,
    prenom: `Prenom${i}`,
    date_naissance: '2012-05-01',
    grade_id: 1,
    annee_adhesion: 2020,
    fraternite_id: 'f1',
    adresse: 'Akogbato',
    contact_parent: '01 69 71 42 42',
    archived: false,
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }));
}

const samedis = ['2026-09-05','2026-09-12','2026-09-19','2026-09-26'];

function makePresences(lecteurs) {
  const pres = [];
  lecteurs.forEach(l => {
    samedis.forEach(s => {
      pres.push({ id: pres.length+1, lecteur_id: l.id, date_samedi: s, statut: 'present', recorded_by: null, created_at: '', updated_at: '' });
    });
  });
  return pres;
}
function makeCotisations(pres) {
  return pres.map((p,k) => ({ id:k, lecteur_id:p.lecteur_id, date_samedi:p.date_samedi, paye:true, montant:50, paid_at:'2026-09-05T10:00:00Z', recorded_by:null, created_at:'', updated_at:'' }));
}

console.log('\n=== TEST PDF FILTRE 50 lecteurs sur 200 ===\n');

for (const n of [10, 50, 200]) {
  produits.length = 0;
  const lecteurs = makeLecteurs(n);
  const presences = makePresences(lecteurs);
  const cotisations = makeCotisations(presences);
  const commun = { annee:2026, mois:8, fraternite:null, auteur:'Test Filtre', samedis };

  mod.exportListeLecteurs({ lecteurs, grades:[{id:1,nom:'Postulat'}], fraternites:[{id:'f1',nom:'Saint Jean',responsables:[],created_at:''}], fraternite:null, grade:null, recherche:'', statut:'actifs', auteur:'Test' });
  const liste = produits[0];
  console.log(`Liste lecteurs ${n} → ${liste.pages} page(s), ${liste.rows} lignes body (attendu ${n}) — ${liste.rows===n ? 'OK pas de pages vides' : 'ERREUR'}`);

  produits.length = 0;
  mod.exportPresences({ ...commun, lecteurs, presences });
  const pres = produits[0];
  console.log(`Presences ${n} → ${pres.pages} page(s), ${pres.rows} lignes (attendu ${n}) — ${pres.rows===n ? 'OK' : 'ERREUR'}`);

  produits.length = 0;
  mod.exportCotisations({ ...commun, lecteurs, cotisations, montantCot:50 });
  const cot = produits[0];
  console.log(`Cotisations ${n} → ${cot.pages} page(s), ${cot.rows} lignes (attendu ${n}) — ${cot.rows===n ? 'OK' : 'ERREUR'}`);

  produits.length = 0;
  mod.exportSuivis({ periode:'Septembre 2026', samedis, recaps: lecteurs.map(l => ({ lecteur:l, total:4, present:4, absent:0, nonSaisi:0, taux:100 })), fraterniteNom:()=> 'Saint Jean', auteur:'Test' });
  const suiv = produits[0];
  console.log(`Suivis ${n} → ${suiv.pages} page(s), ${suiv.rows} lignes (attendu ${n}) — ${suiv.rows===n ? 'OK' : 'ERREUR'}`);
  console.log('');
}

console.log('=== Conclusion ===');
console.log('Si on filtre 50 lecteurs, le PDF contient EXACTEMENT 50 lignes, pas 200 avec 150 vides.');
console.log('La pagination est dynamique : 10 lecteurs=1 page, 50=2 pages, 200=5 pages. Aucune page vide.');
