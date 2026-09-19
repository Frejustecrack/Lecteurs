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
let tablesCotisations = [];
let suffixeNom = '';
mod.definirIntercepteurPdf((doc, nom) => {
  if (nom.startsWith('lecteur_akogbato_presences')) tablesPresences = [doc.lastAutoTable];
  if (nom.startsWith('lecteur_akogbato_cotisations')) tablesCotisations = [doc.lastAutoTable];
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  const pages = doc.getNumberOfPages();
  const buffer = Buffer.from(doc.output('arraybuffer'));
  writeFileSync(join(sortie, nom.replace(/\.pdf$/, `${suffixeNom}.pdf`)), buffer);
  produits.push({ nom, w, h, pages, doc, taille: buffer.length, suffixe: suffixeNom });
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
  const p = produits.find((x) => x.nom.startsWith('lecteur_akogbato_presences'));
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

console.log('\n5. Règle « premier samedi actif » dans les PDF (cellules « Néant »)');
{
  // Lecteur inscrit le mardi 2026-09-15 → premier samedi actif = 2026-09-19.
  // Les samedis 05/09 et 12/09 sont ANTÉRIEURS : aucune ligne possible,
  // cellules « Néant » grises, ni absence ni cotisation due.
  const nouveau = {
    ...lecteurs[0], id: 'l400', matricule: 'LEC400', nom: 'RECENT', prenom: 'Ismaël',
    created_at: '2026-09-15T10:00:00Z', updated_at: '2026-09-15T10:00:00Z',
  };
  const presN = [
    { id: 1, lecteur_id: 'l400', date_samedi: '2026-09-19', statut: 'present', recorded_by: null, created_at: '', updated_at: '' },
    { id: 2, lecteur_id: 'l400', date_samedi: '2026-09-26', statut: 'present', recorded_by: null, created_at: '', updated_at: '' },
  ];
  const cotN = presN.map((p, k) => ({
    id: k, lecteur_id: 'l400', date_samedi: p.date_samedi, paye: true, montant: 50,
    paid_at: '2026-09-19T10:00:00Z', recorded_by: null, created_at: '', updated_at: '',
  }));

  // Fichiers de test écrits à part (suffixe) : ne pas écraser les 200 lecteurs.
  suffixeNom = '_test_neant';
  mod.exportPresences({ ...commun, lecteurs: [nouveau], presences: presN });
  mod.exportCotisations({ ...commun, lecteurs: [nouveau], cotisations: cotN, montantCot: 50 });
  suffixeNom = '';

  const ligneDe = (tab, matricule) => {
    for (const t of tab) for (const row of t.body) {
      const v = Object.values(row.cells);
      if (String(v[0]?.text?.join?.(' ') ?? v[0]?.raw ?? '') === matricule) {
        return v.map((c) => String(c.text?.join?.(' ') ?? c.raw ?? ''));
      }
    }
    return null;
  };
  const lignePres = ligneDe(tablesPresences, 'LEC400');
  const ligneCot = ligneDe(tablesCotisations, 'LEC400');
  if (lignePres && lignePres[3] === 'Néant' && lignePres[4] === 'Néant' && lignePres[5] === 'Pres' && lignePres[6] === 'Pres')
    ok('PDF présences : LEC400 (inscrit le 15/09) → « Néant » les 05/09 et 12/09, « Pres » dès le 19/09');
  else ko('PDF présences : ligne LEC400', JSON.stringify(lignePres));
  if (lignePres && lignePres[7] === '2' && lignePres[8] === '0')
    ok('PDF présences : les 2 samedis avant l’inscription ne comptent AUCUNE absence (2 présents, 0 absent)');
  else ko('PDF présences : compteurs LEC400', JSON.stringify(lignePres?.slice(7)));
  if (ligneCot && ligneCot[3] === 'Néant' && ligneCot[4] === 'Néant' && ligneCot[5] === '50 F' && ligneCot[6] === '50 F')
    ok('PDF cotisations : LEC400 → « Néant » les 05/09 et 12/09, « 50 F » dès le 19/09');
  else ko('PDF cotisations : ligne LEC400', JSON.stringify(ligneCot));
  if (ligneCot && ligneCot[7] === '100 F' && ligneCot[8] === '0 F')
    ok('PDF cotisations : total payé 100 F, total dû 0 F — aucun dû sur les samedis avant l’inscription');
  else ko('PDF cotisations : totaux LEC400', JSON.stringify(ligneCot?.slice(7)));
}

console.log('\n6. Noms de fichiers : préfixe « lecteur_akogbato », descriptifs, uniques');
{
  // Les 2 documents de la section 5 sont des fixtures de test : on contrôle
  // l'unicité sur les 7 documents « réels » (mêmes noms → mêmes fichiers).
  const noms = produits.filter((p) => !p.suffixe).map((p) => p.nom);
  if (noms.every((n) => n.startsWith('lecteur_akogbato_') && n.endsWith('.pdf')))
    ok('tous les noms commencent par « lecteur_akogbato_ »');
  else ko('préfixe des noms', noms.filter((n) => !n.startsWith('lecteur_akogbato_')).join(', '));
  if (noms.every((n) => !/cdlj/i.test(n)))
    ok('aucun nom ne contient « cdlj »');
  else ko('« cdlj » encore présent dans un nom');
  if (new Set(noms).size === noms.length)
    ok(`les ${noms.length} noms des 7 documents sont tous uniques (horodatage à la seconde)`);
  else ko('noms en double', noms.join(', '));
  if (noms.every((n) => /^[a-z0-9_]+\.pdf$/.test(n)))
    ok('noms minuscules, sans espaces ni accents (sécurisés partout)');
  else ko('caractères indésirables', noms.filter((n) => !/^[a-z0-9_]+\.pdf$/.test(n)).join(', '));
  const attenduNature = ['_presences_', '_cotisations_', '_liste_lecteurs_', '_bilan_evenement_', '_caisse_', '_fiche_lecteur_', '_suivis_'];
  const manquants = attenduNature.filter((nat) => !noms.some((n) => n.includes(nat)));
  if (manquants.length === 0)
    ok('la nature de chaque document est lisible dans son nom (presences, cotisations, liste_lecteurs, bilan_evenement, caisse, fiche_lecteur, suivis)');
  else ko('nature lisible manquante', manquants.join(', '));
  for (const n of [...noms, ...produits.filter((p) => p.suffixe).map((p) => p.nom)]) console.log(`      • ${n}`);
}

console.log('\n7. Ordre alphabétique imposé par les cinq exports de listes');
{
  suffixeNom = '_tri';
  // Matricules volontairement en ordre inverse des noms : tester le nom réel.
  const jeu = [
    { ...lecteurs[0], id: 'z', matricule: 'LEC100', nom: 'Zinsou', prenom: 'Alice' },
    { ...lecteurs[0], id: 'e', matricule: 'LEC101', nom: 'Éhouman', prenom: 'Zoé' },
    { ...lecteurs[0], id: 'd', matricule: 'LEC200', nom: 'Dossou', prenom: 'Marc' },
    { ...lecteurs[0], id: 'a', matricule: 'LEC300', nom: 'Dossou', prenom: 'Alice' },
  ];
  const avant = JSON.stringify(jeu);
  const verifierTri = (nom, action, colonne = 0) => {
    action();
    const lignes = produits.at(-1).doc.lastAutoTable.body;
    const ordre = lignes.map(r => r.cells[colonne].text.join(' ')).join(',');
    if (ordre === 'LEC300,LEC200,LEC101,LEC100') ok(`${nom} : noms puis prénoms, indépendamment des matricules`);
    else ko(`${nom} : tri PDF`, ordre);
  };
  verifierTri('Présences', () => mod.exportPresences({ ...commun, lecteurs: jeu, presences: [] }));
  verifierTri('Cotisations', () => mod.exportCotisations({ ...commun, lecteurs: jeu, cotisations: [], montantCot: 50 }));
  verifierTri('Liste des lecteurs', () => mod.exportListeLecteurs({ lecteurs: jeu, grades: [], fraternites: [], fraternite: null, grade: null, recherche: '', statut: 'actifs', auteur: 'Test' }), 1);
  verifierTri('Bilan événement', () => mod.exportEvenementBilan({
    evenement: { id: 'tri', nom: 'Tri', date_evenement: '2026-10-01', lieu: '', montant_participation: 50, statut: 'en_cours' },
    participants: jeu.map(lecteur => ({ lecteur, paye: 0, tranches: [] })), totalCollecte: 0, totalAttendu: 200, auteur: 'Test',
  }));
  verifierTri('Suivis', () => mod.exportSuivis({ periode: 'Test', samedis: [], recaps: jeu.map(lecteur => ({ lecteur, total: 0, present: 0, absent: 0, nonSaisi: 0, taux: 0 })), fraterniteNom: () => null, auteur: 'Test' }));
  if (JSON.stringify(jeu) === avant) ok('exports : aucun tableau source modifié'); else ko('exports : mutation des lecteurs');
}

console.log(`\nFichiers écrits dans ${sortie}`);
console.log('\n' + '─'.repeat(66));
if (echecs.length === 0) { console.log(`✅ ${reussites} vérifications PDF réussies, 0 échec.`); }
else { console.log(`❌ ${echecs.length} échec(s) :`); echecs.forEach((e) => console.log(`   • ${e}`)); process.exit(1); }
