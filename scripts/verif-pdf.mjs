/**
 * Vérification des exports PDF — exécutée dans Node avec le VRAI code de
 * `src/pdf/export.ts` (compilé à la volée par esbuild via Vite).
 *
 *   npm run verif:pdf
 *
 * Contrôles :
 *   - les 7 documents sont au format A4 PORTRAIT (210 × 297 mm) ;
 *   - la fiche des présences affiche « Pres » / « Abs » (plus de ✓/✗) ;
 *   - une fiche mensuelle de 200 lecteurs tient dans la largeur portrait
 *     (aucune colonne coupée) et se pagine correctement ;
 *   - les fichiers sont écrits dans `tmp/pdf/` pour contrôle visuel.
 */
import { build } from 'vite';
import { samediEstArrive } from '../src/lib/dates.ts';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const sortie = join(racine, 'tmp', 'pdf');
rmSync(sortie, { recursive: true, force: true });
mkdirSync(sortie, { recursive: true });

// 1. Bundle Node du module d'export (jspdf a besoin d'un DOM minimal).
const bundleDir = join(racine, 'tmp', 'pdf-bundle');
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
    sourcemap: false,
  },
  ssr: { noExternal: true },
});

// DOM (jsdom) : jspdf et canvg attendent window/document.
const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'Image', 'DOMParser', 'XMLSerializer', 'Node', 'Element', 'Blob', 'URL']) {
  try { Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true }); } catch { /* ignore */ }
}
try { Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true }); } catch { /* ignore */ }

const mod = await import(pathToFileURL(join(bundleDir, 'export.mjs')).href);

let reussites = 0;
const echecs = [];
const ok = (n) => { reussites++; console.log(`  ✓ ${n}`); };
const ko = (n, d) => { echecs.push(`${n}${d ? ` — ${d}` : ''}`); console.log(`  ✗ ${n}${d ? `\n      ${d}` : ''}`); };

// Capture des documents.
const produits = [];
let tablesPresences = [];
mod.definirIntercepteurPdf((doc, nom) => {
  if (nom.startsWith('cdlj_presences')) tablesPresences = [doc.lastAutoTable];
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  const pages = doc.getNumberOfPages();
  const buffer = Buffer.from(doc.output('arraybuffer'));
  writeFileSync(join(sortie, nom), buffer);
  produits.push({ nom, w, h, pages, doc, taille: buffer.length });
});

// 2. Jeu de données : 200 lecteurs, septembre 2026.
const lecteurs = Array.from({ length: 200 }, (_, i) => ({
  id: `l${i}`,
  matricule: `LEC${100 + i}`,
  nom: `NOMFAMILLE${i}`,
  prenom: `Prénom${i}`,
  date_naissance: '2012-05-01',
  grade_id: (i % 7) + 1,
  annee_adhesion: 2020 + (i % 6),
  fraternite_id: i % 2 ? 'f1' : 'f2',
  adresse: 'Akogbato',
  contact_parent: '01 69 71 42 42',
  archived: false,
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}));
const samedis = ['2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26'];
// Lecteur 0 : présent partout ; lecteur 1 : absent partout ; lecteur 2 : non pointé.
const presences = [];
lecteurs.forEach((l, i) => {
  if (i === 2) return;
  samedis.forEach((s, j) => {
    presences.push({
      id: presences.length + 1, lecteur_id: l.id, date_samedi: s,
      statut: i === 0 ? 'present' : i === 1 ? 'absent' : (i + j) % 4 === 0 ? 'absent' : 'present',
      recorded_by: null, created_at: '', updated_at: '',
    });
  });
});
const cotisations = presences.map((p, k) => ({
  id: k, lecteur_id: p.lecteur_id, date_samedi: p.date_samedi, paye: p.statut === 'present',
  montant: 50, paid_at: p.statut === 'present' ? '2026-09-05T10:00:00Z' : null, recorded_by: null, created_at: '', updated_at: '',
}));

const commun = { annee: 2026, mois: 8, fraternite: null, auteur: 'Test', samedis };

const avertissements = [];
const consoleErrorOrig = console.error;
console.error = (...a) => { avertissements.push(a.join(' ')); };
console.log('\n1. Génération des 7 documents');
mod.exportPresences({ ...commun, lecteurs, presences });
mod.exportCotisations({ ...commun, lecteurs, cotisations, montantCot: 50 });
mod.exportListeLecteurs({ lecteurs, grades: [{ id: 1, nom: 'Postulat' }], fraternites: [{ id: 'f1', nom: 'Saint Jean', responsables: [], created_at: '' }], fraternite: null, grade: null, recherche: '', statut: 'actifs', auteur: 'Test' });
mod.exportEvenementBilan({
  evenement: { id: 'e1', nom: 'Pèlerinage', date_evenement: '2026-10-01', lieu: 'Dassa', montant_participation: 1000, statut: 'en_cours', created_by: null, created_at: '', updated_at: '' },
  participants: lecteurs.slice(0, 60).map((l, i) => ({ lecteur: l, paye: (i % 3) * 500, tranches: i % 3 ? [{ id: i, event_id: 'e1', lecteur_id: l.id, montant: (i % 3) * 500, paye_at: '2026-09-10T00:00:00Z', recorded_by: null, created_at: '' }] : [] })),
  totalCollecte: 30000, totalAttendu: 60000, auteur: 'Test',
});
mod.exportCaisse({ periode: 'Septembre 2026', lignes: Array.from({ length: 80 }, (_, i) => ({ date: '2026-09-05', type: i % 5 ? 'Cotisation' : 'Décaissement', libelle: `Ligne ${i}`, montant: 50, auteur: 'Caissier' })), totalPaye: 4000, totalEnc: 0, totalDec: 800, soldeGeneral: 3200, auteur: 'Test' });
mod.exportFicheLecteur({ lecteur: lecteurs[0], grades: [{ id: 1, nom: 'Postulat' }], history: [{ id: 1, lecteur_id: 'l0', grade_id: 1, changed_at: '2026-01-01' }], presences: presences.filter((p) => p.lecteur_id === 'l0'), cotisations: cotisations.filter((c) => c.lecteur_id === 'l0'), evenements: [], appreciations: [], auteur: 'Test', montantCot: 50 });
mod.exportSuivis({ periode: 'Septembre 2026', samedis, recaps: lecteurs.map((l, i) => ({ lecteur: l, total: 4, present: 4 - (i % 3), absent: i % 3, nonSaisi: 0, taux: Math.round(((4 - (i % 3)) / 4) * 100) })), fraterniteNom: () => 'Saint Jean', auteur: 'Test' });

console.error = consoleErrorOrig;
if (produits.length === 7) ok('7 documents générés'); else ko('documents générés', String(produits.length));
const deborde = avertissements.filter((a) => /could not fit page/.test(a));
if (deborde.length === 0) ok('aucun avertissement autoTable « could not fit page »'); else ko('tableaux qui débordent', deborde.join(' ; '));

console.log('\n2. Orientation A4 portrait');
for (const p of produits) {
  const portrait = Math.abs(p.w - 210) < 0.5 && Math.abs(p.h - 297) < 0.5;
  if (portrait) ok(`${p.nom} : ${p.w.toFixed(0)}×${p.h.toFixed(0)} mm, ${p.pages} page(s), ${(p.taille / 1024).toFixed(0)} Ko`);
  else ko(`${p.nom} n'est pas en portrait`, `${p.w}×${p.h}`);
}

console.log('\n3. Contenu de la fiche des présences');
{
  const p = produits.find((x) => x.nom.startsWith('cdlj_presences'));
  // Texte brut de toutes les pages (les chaînes sont encodées entre parenthèses dans le flux PDF).
  // Les cellules autoTable restent accessibles : on lit le texte de chaque cellule du corps.
  const cellules = [];
  for (let i = 1; i <= p.pages; i++) {
    p.doc.setPage(i);
  }
  for (const t of tablesPresences) {
    for (const row of t.body) for (const c of Object.values(row.cells)) cellules.push(String(c.text?.join?.(' ') ?? c.raw ?? ''));
  }
  const compte = (mot) => cellules.filter((x) => x === mot).length;
  const flux = cellules.join('|');
  const nbPres = compte('Pres');
  const nbAbs = compte('Abs');
  const attenduPres = presences.filter((x) => x.statut === 'present').length;
  // Absents = statut absent + lecteur 2 non pointé sur les samedis arrivés.
  // Même règle que l'app (samediEstArrive : arrivé dès minuit, heure du Bénin) —
  // l'ancienne heuristique « midi local » faisait échouer le test tout samedi
  // avant midi si la liste contient le samedi du jour.
  const arrives = samedis.filter(samediEstArrive).length;
  const attenduAbs = presences.filter((x) => x.statut === 'absent').length + arrives; // lecteur 2 non pointé
  if (nbPres === attenduPres) ok(`« Pres » apparaît ${nbPres} fois (= présences)`); else ko('« Pres »', `${nbPres} ≠ ${attenduPres}`);
  if (nbAbs === attenduAbs) ok(`« Abs » apparaît ${nbAbs} fois (= absents + non pointés sur samedis arrivés)`); else ko('« Abs »', `${nbAbs} ≠ ${attenduAbs}`);
  if (!flux.includes('✓') && !flux.includes('✗')) ok('plus aucun symbole ✓ / ✗'); else ko('symboles ✓ / ✗ encore présents');
  if (p.pages >= 5) ok(`200 lecteurs paginés sur ${p.pages} pages`); else ko('pagination', `${p.pages} pages`);
}

console.log('\n4. Largeur des tableaux (aucune colonne hors page)');
for (const p of produits) {
  const t = p.doc.lastAutoTable;
  if (!t) { ok(`${p.nom} : pas de tableau autoTable final`); continue; }
  const largeur = t.columns.reduce((s, c) => s + (c.width ?? 0), 0);
  const marge = t.settings.margin.left + t.settings.margin.right;
  if (largeur + marge <= p.w + 0.5) ok(`${p.nom} : tableau ${largeur.toFixed(0)} mm + marges ${marge} mm ≤ ${p.w} mm`);
  else ko(`${p.nom} : tableau déborde`, `${largeur.toFixed(1)} + ${marge} > ${p.w}`);
}

console.log(`\nFichiers écrits dans ${sortie}`);
console.log('\n' + '─'.repeat(66));
if (echecs.length === 0) { console.log(`✅ ${reussites} vérifications PDF réussies, 0 échec.`); }
else { console.log(`❌ ${echecs.length} échec(s) :`); echecs.forEach((e) => console.log(`   • ${e}`)); process.exit(1); }
