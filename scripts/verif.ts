import { comparerLecteurs, rechercherLecteurs, trierLecteurs } from '../src/lib/lecteurs.ts';
/**
 * Vérification de la logique métier pure (aucune dépendance, aucun serveur).
 *
 * Exécution :  npm run verif
 * (Node exécute directement le TypeScript via le « type stripping » natif.)
 *
 * Ce script importe le VRAI code de l'application — pas une copie — afin que
 * toute régression dans src/lib/* fasse échouer la vérification.
 */
import {
  aujourdhuiBenin,
  dateISO,
  dernierSamedi,
  estAvantPremierSamediActif,
  estGelee,
  lundiDeSemaine,
  numeroSemaine,
  premierSamediActifISO,
  samediEstArrive,
  samedisArrives,
  samedisDuMois,
  samedisSemaine,
  semaineLabel,
} from '../src/lib/dates.ts';
import {
  anneeCourante,
  bornesAnneeAdhesion,
  bornesAnneeNaissance,
  validerAnneesLecteur,
} from '../src/lib/validation.ts';
import { estErreurDroits, traduireErreur } from '../src/lib/errors.ts';
import {
  absencesEffectives,
  appliquerFiltreRecap,
  calculerRecaps,
  filtrerRecaps,
  trierRecaps,
} from '../src/lib/recap.ts';
import type { Lecteur } from '../src/lib/types.ts';
import { creerPlanificateur } from '../src/lib/planificateur.ts';
import { toutesLesLignes } from '../src/lib/pagination.ts';

let reussites = 0;
const echecs: string[] = [];

function verif(nom: string, condition: boolean, detail = '') {
  if (condition) {
    reussites++;
    console.log(`  ✓ ${nom}`);
  } else {
    echecs.push(nom + (detail ? ` — ${detail}` : ''));
    console.log(`  ✗ ${nom}${detail ? ` — ${detail}` : ''}`);
  }
}

// Tri commun écrans/PDF et recherche d'inscription (accents, homonymes).
{
  const noms = [
    { nom: 'Zinsou', prenom: 'Anne', matricule: 'LEC100' },
    { nom: 'Éhouman', prenom: 'Zoé', matricule: 'LEC101' },
    { nom: 'dossou', prenom: 'Marc', matricule: 'LEC202' },
    { nom: 'DOSSOU', prenom: 'Alice', matricule: 'LEC201' },
    { nom: 'Dossou', prenom: 'Alice', matricule: 'LEC103' },
  ];
  const avant = JSON.stringify(noms);
  verif('tri alphabétique : nom, prénom, puis matricule',
    trierLecteurs(noms).map(l => l.matricule).join(',') === 'LEC103,LEC201,LEC202,LEC101,LEC100');
  verif('tri sans mutation du tableau source', JSON.stringify(noms) === avant);
  verif('tri français indépendant de la casse et des accents',
    comparerLecteurs({ nom: 'éhouman', prenom: 'zoe', matricule: 'LEC101' }, noms[1]) === 0);
  verif('recherche par nom sans casse', rechercherLecteurs(noms, 'DOSsou').length === 3);
  verif('recherche sans accent et par prénom', rechercherLecteurs(noms, 'ehouman zoe')[0]?.matricule === 'LEC101');
  verif('recherche par matricule partiel', rechercherLecteurs(noms, 'lec20').length === 2);
  verif('homonymes distingués par matricule', rechercherLecteurs(noms, 'alice').map(l => l.matricule).join(',') === 'LEC103,LEC201');
  verif('recherche vide : tous les lecteurs par nom', rechercherLecteurs(noms, '  ')[0]?.matricule === 'LEC103');
  verif('recherche sans résultat', rechercherLecteurs(noms, 'inexistant').length === 0);
}


function eq(nom: string, obtenu: unknown, attendu: unknown) {
  verif(nom, obtenu === attendu, `obtenu ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(attendu)}`);
}

// ============================================================================
console.log('\n── Dates : samedis réels et gel ─────────────────────────────────────');
// ============================================================================
const samSept2026 = samedisDuMois(2026, 8); // septembre 2026
eq('septembre 2026 compte 4 samedis', samSept2026.length, 4);
eq(
  'premier samedi de septembre 2026 = 05/09',
  samSept2026.map(dateISO).join(','),
  '2026-09-05,2026-09-12,2026-09-19,2026-09-26'
);
eq('août 2026 compte 5 samedis', samedisDuMois(2026, 7).length, 5);
eq('février 2026 compte 4 samedis', samedisDuMois(2026, 1).length, 4);

const lundi = lundiDeSemaine(new Date(2026, 8, 16)); // mercredi 16/09/2026
eq('lundi de la semaine du 16/09/2026 = 14/09', dateISO(lundi), '2026-09-14');
eq(
  'samedi de cette même semaine = 19/09',
  samedisSemaine(new Date(2026, 8, 16)).map(dateISO).join(','),
  '2026-09-19'
);
eq(
  'semaine du dimanche 20/09 contient encore le 19/09',
  samedisSemaine(new Date(2026, 8, 20)).map(dateISO).join(','),
  '2026-09-19'
);
eq(
  'libellé de semaine',
  semaineLabel(new Date(2026, 8, 16)),
  `Semaine ${numeroSemaine(new Date(2026, 8, 16))} — 14/09 au 20/09/2026`
);
eq(
  'numéros de semaines consécutifs',
  numeroSemaine(new Date(2026, 8, 21)) - numeroSemaine(new Date(2026, 8, 14)),
  1
);

const dernier = dernierSamedi();
eq('dernierSamedi() tombe bien un samedi', dernier.getDay(), 6);
verif('dernierSamedi() est aujourd’hui ou avant', dernier.getTime() <= Date.now());
verif(
  'le samedi précédent est gelé',
  estGelee(new Date(dernier.getTime() - 7 * 86400000))
);
verif('le dernier samedi lui-même n’est pas gelé', !estGelee(new Date(dernier.getTime() + 12 * 3600000)));
verif(
  'le samedi suivant n’est pas gelé',
  !estGelee(new Date(dernier.getTime() + 7 * 86400000))
);

verif('le dernier samedi est arrivé', samediEstArrive(dernierSamedi()));
verif(
  'le samedi précédent est arrivé',
  samediEstArrive(new Date(dernier.getTime() - 7 * 86400000))
);
verif(
  'le samedi suivant n’est pas arrivé',
  !samediEstArrive(new Date(dernier.getTime() + 7 * 86400000))
);
verif(
  'une date ISO passée est arrivée',
  samediEstArrive('2020-01-04')
);
verif(
  'une date ISO future n’est pas arrivée',
  !samediEstArrive('2099-01-03')
);
eq(
  'samedisArrives() ne garde que les samedis passés ou du jour',
  samedisArrives([
    dateISO(new Date(dernier.getTime() - 7 * 86400000)),
    dateISO(dernier),
    dateISO(new Date(dernier.getTime() + 7 * 86400000)),
  ]).length,
  2
);
eq('samedisArrives() sur une liste vide', samedisArrives([]).length, 0);

// Premier samedi actif (date d'entrée en vigueur)
eq('inscrit un samedi (05/09/2026) -> premier samedi = 05/09/2026', premierSamediActifISO('2026-09-05T10:00:00Z'), '2026-09-05');
eq('inscrit un dimanche (06/09/2026) -> premier samedi = 12/09/2026', premierSamediActifISO('2026-09-06T10:00:00Z'), '2026-09-12');
eq('inscrit un vendredi (11/09/2026) -> premier samedi = 12/09/2026', premierSamediActifISO('2026-09-11T23:00:00Z'), '2026-09-12');
verif('05/09/2026 est avant le premier samedi d un lecteur inscrit le 06/09/2026', estAvantPremierSamediActif('2026-09-05', '2026-09-06T10:00:00Z'));
verif('12/09/2026 n est pas avant le premier samedi d un lecteur inscrit le 06/09/2026', !estAvantPremierSamediActif('2026-09-12', '2026-09-06T10:00:00Z'));
// Cas « inscrit un samedi » : ce même samedi est le premier samedi actif —
// la cellule est interactive ce jour-là, les samedis précédents restent néant.
eq('inscrit un samedi (19/09/2026) -> premier samedi = 19/09/2026', premierSamediActifISO('2026-09-19T10:00:00Z'), '2026-09-19');
verif('12/09/2026 est avant le premier samedi d un lecteur inscrit le samedi 19/09/2026', estAvantPremierSamediActif('2026-09-12', '2026-09-19T10:00:00Z'));
verif('19/09/2026 (le jour de l inscription) n est PAS avant : cellule interactive', !estAvantPremierSamediActif('2026-09-19', '2026-09-19T10:00:00Z'));
verif('26/09/2026 (samedi suivant) n est pas avant le premier samedi actif', !estAvantPremierSamediActif('2026-09-26', '2026-09-19T10:00:00Z'));
// created_at absent (ligne historique sans date) : aucune date n est « avant ».
verif('created_at manquant -> aucun samedi n est exclu', !estAvantPremierSamediActif('2026-09-05', undefined) && !estAvantPremierSamediActif('2026-09-05', null));

// ============================================================================
console.log('\n── Validation : années de naissance et d’adhésion ───────────────────');
// ============================================================================
const annee = anneeCourante();
eq('année courante', annee, new Date().getFullYear());
eq('borne haute de l’année d’adhésion = année courante', bornesAnneeAdhesion().max, annee);
eq('borne haute de la date de naissance = 31/12 de l’année courante', bornesAnneeNaissance().max, `${annee}-12-31`);

let r = validerAnneesLecteur('', String(annee + 1));
verif('année d’adhésion future refusée', !r.ok);
verif('message explicite (sans jargon)', /année en cours \(\d{4}\)/.test(r.message ?? ''), r.message ?? '');

r = validerAnneesLecteur(`${annee + 1}-05-01`, '');
verif('date de naissance future refusée', !r.ok);

r = validerAnneesLecteur(`${annee + 1}-05-01`, '');
verif('message de naissance future explicite', /ne peut pas d\u00e9passer/.test(r.message ?? ''), r.message ?? '');

r = validerAnneesLecteur('2015-03-04', '2024');
verif('saisie cohérente acceptée', r.ok, r.message ?? '');

r = validerAnneesLecteur('2015-03-04', '2010');
verif('adhésion antérieure à la naissance refusée', !r.ok);
verif('message d’incohérence explicite', /précéder/.test(r.message ?? ''), r.message ?? '');

r = validerAnneesLecteur('date-invalide', '');
verif('date invalide refusée', !r.ok);

r = validerAnneesLecteur('', '');
verif('champs vides acceptés (facultatifs)', r.ok);

r = validerAnneesLecteur('', '1850');
verif('année trop ancienne refusée', !r.ok);

// ============================================================================
console.log('\n── Traduction des erreurs (aucun code technique affiché) ────────────');
// ============================================================================
// traduireErreur() journalise volontairement l'erreur technique dans la console
// (pour le développeur) : on la masque le temps de la vérification.
const consoleError = console.error;
console.error = () => {};

const casErreur: [string, unknown, string | undefined, RegExp][] = [
  [
    'RLS sur les cotisations',
    { code: '42501', message: 'new row violates row-level security policy for table "cotisations"' },
    'enregistrer cette cotisation',
    /^Vous n'êtes pas autorisé à enregistrer cette cotisation\.$/,
  ],
  [
    'RLS sans action précisée',
    { code: '42501', message: 'permission denied for table presences' },
    undefined,
    /^Vous n'êtes pas autorisé à effectuer cette action\.$/,
  ],
  [
    'fonction métier : droits insuffisants',
    { code: 'P0001', message: 'Droits insuffisants pour changer de grade' },
    'changer le grade',
    /^Vous n'êtes pas autorisé à changer le grade\.$/,
  ],
  [
    'doublon de matricule',
    { code: '23505', message: 'duplicate key value violates unique constraint', details: 'Key (matricule)=(LEC101) already exists.' },
    'créer ce lecteur',
    /matricule est déjà attribué/i,
  ],
  [
    'double saisie du même samedi',
    { code: '23505', message: 'duplicate key', details: 'Key (lecteur_id, date_samedi)=(...) already exists.' },
    undefined,
    /déjà été enregistrée pour ce samedi/i,
  ],
  [
    'montant invalide',
    { code: '23514', message: 'check constraint violated', details: 'Key (montant_check)' },
    undefined,
    /montant doit être un nombre supérieur à zéro/i,
  ],
  [
    'tranche supérieure au restant',
    { code: 'P0001', message: 'Total payé (7000) supérieur au montant de participation (5000)' },
    undefined,
    /dépasse le montant de participation/i,
  ],
  [
    'identifiants incorrects',
    new Error('Invalid login credentials'),
    'vous connecter',
    /^Identifiant ou mot de passe incorrect\.$/,
  ],
  [
    'coupure réseau',
    new TypeError('Failed to fetch'),
    undefined,
    /Impossible de joindre le serveur/i,
  ],
  [
    'erreur inconnue',
    { code: '99999', message: 'something weird happened' },
    'enregistrer',
    /Impossible de enregistrer|n'a pas abouti/,
  ],
  [
    'erreur vide',
    null,
    undefined,
    /n'a pas abouti/,
  ],
];

for (const [nom, err, action, attendu] of casErreur) {
  const msg = traduireErreur(err, action);
  verif(nom, attendu.test(msg), msg);
  verif(
    `… ${nom} : aucun code technique affiché`,
    !/42501|23505|23514|P0001|99999|violates|constraint|row-level|undefined|null/.test(msg),
    msg
  );
}

verif('estErreurDroits reconnaît un rejet RLS', estErreurDroits({ code: '42501' }));
verif('estErreurDroits ignore une erreur réseau', !estErreurDroits(new Error('Failed to fetch')));

console.error = consoleError;

// ============================================================================
console.log('\n── Suivis : récapitulatif des présences ─────────────────────────────');
// ============================================================================
function lecteur(id: string, matricule: string, nom: string, prenom: string, fr: string | null): Lecteur {
  return {
    id,
    matricule,
    nom,
    prenom,
    date_naissance: null,
    grade_id: 1,
    annee_adhesion: 2024,
    fraternite_id: fr,
    adresse: null,
    contact_parent: null,
    archived: false,
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

const samedis = ['2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26'];
const lect = [
  lecteur('a', 'LEC100', 'Adjovi', 'Marie', 'fr1'),
  lecteur('b', 'LEC101', 'Bossou', 'Paul', 'fr1'),
  lecteur('c', 'LEC102', 'Cossi', 'Jean', 'fr2'),
];
const pres = [
  // Marie : présente aux 4 séances
  ...samedis.map((d) => ({ lecteur_id: 'a', date_samedi: d, statut: 'present' as const })),
  // Paul : 3 présences, 1 absence
  { lecteur_id: 'b', date_samedi: samedis[0], statut: 'present' as const },
  { lecteur_id: 'b', date_samedi: samedis[1], statut: 'present' as const },
  { lecteur_id: 'b', date_samedi: samedis[2], statut: 'absent' as const },
  { lecteur_id: 'b', date_samedi: samedis[3], statut: 'present' as const },
  // Jean : 1 seule séance pointée
  { lecteur_id: 'c', date_samedi: samedis[0], statut: 'present' as const },
];

const recaps = calculerRecaps(lect, pres, samedis);
eq('3 récapitulatifs calculés', recaps.length, 3);
eq('Marie : 4 présences', recaps[0].present, 4);
eq('Marie : 0 absence', recaps[0].absent, 0);
eq('Marie : taux 100 %', recaps[0].taux, 100);
eq('Paul : 3 présences', recaps[1].present, 3);
eq('Paul : 1 absence', recaps[1].absent, 1);
eq('Paul : taux 75 %', recaps[1].taux, 75);
eq('Jean : 3 séances non pointées', recaps[2].nonSaisi, 3);
eq('Jean : taux 25 %', recaps[2].taux, 25);

// Règle « à preuve du contraire » : un samedi arrivé non pointé compte comme
// une absence. Jean (1 séance pointée sur 4) a donc 3 absences effectives.
eq('absences effectives de Marie', absencesEffectives(recaps[0]), 0);
eq('absences effectives de Paul', absencesEffectives(recaps[1]), 1);
eq('absences effectives de Jean (1 absent pointé + 3 non pointés = 0 + 3)', absencesEffectives(recaps[2]), 3);
eq('filtre « absents » → 2 lecteurs (Paul + Jean)', appliquerFiltreRecap(recaps, 'absents').length, 2);
eq('filtre « présents tout le long » → 1 lecteur (Marie)', appliquerFiltreRecap(recaps, 'parfaits').length, 1);
eq('filtre « saisie incomplète » → 1 lecteur (Jean)', appliquerFiltreRecap(recaps, 'incomplets').length, 1);
eq('filtre « tous » → 3 lecteurs', appliquerFiltreRecap(recaps, 'tous').length, 3);

eq(
  'recherche par matricule',
  filtrerRecaps(recaps, { recherche: 'lec102' }).map((r) => r.lecteur.nom).join(','),
  'Cossi'
);
eq(
  'recherche par prénom',
  filtrerRecaps(recaps, { recherche: 'PAUL' }).length,
  1
);
eq(
  'filtre par fraternité',
  filtrerRecaps(recaps, { fraterniteId: 'fr1' }).length,
  2
);
eq(
  'cumul fraternité + filtre « absents »',
  filtrerRecaps(recaps, { fraterniteId: 'fr1', filtre: 'absents' }).length,
  1
);
eq(
  'filtre « absents » sur fr2 → Jean (non pointé)',
  filtrerRecaps(recaps, { fraterniteId: 'fr2', filtre: 'absents' }).length,
  1
);
eq(
  'aucun lecteur sans absence effective n’apparaît dans « absents »',
  appliquerFiltreRecap(recaps, 'absents').some((r) => absencesEffectives(r) === 0),
  false
);

eq(
  'tri par absences effectives croissantes',
  trierRecaps(recaps, 'absences', true).map((r) => r.lecteur.matricule).join(','),
  'LEC100,LEC101,LEC102'
);
eq(
  'tri par absences effectives décroissantes',
  trierRecaps(recaps, 'absences', false).map((r) => r.lecteur.matricule)[0],
  'LEC102'
);
eq(
  'tri par matricule',
  trierRecaps(recaps, 'matricule', true).map((r) => r.lecteur.matricule).join(','),
  'LEC100,LEC101,LEC102'
);

// Samedi unique (vue hebdomadaire ou samedi précis)
const recapUn = calculerRecaps(lect, pres, ['2026-09-19']);
eq('samedi unique : 1 séance comptée', recapUn[0].total, 1);
eq('samedi unique : Marie présente', recapUn[0].present, 1);
eq('samedi unique : Paul absent', recapUn[1].absent, 1);
eq('samedi unique : Jean non pointé', recapUn[2].nonSaisi, 1);
eq('samedi unique : aucun assidu sauf Marie', appliquerFiltreRecap(recapUn, 'parfaits').length, 1);
eq('samedi unique : 2 absences effectives (Paul absent + Jean non pointé)', appliquerFiltreRecap(recapUn, 'absents').length, 2);

// Période vide (aucun samedi) : aucun plantage, taux à 0
const recapVide = calculerRecaps(lect, pres, []);
eq('période vide : taux 0', recapVide[0].taux, 0);
eq('période vide : aucun assidu', appliquerFiltreRecap(recapVide, 'parfaits').length, 0);

// Nouveau lecteur inscrit après le 1er samedi de la période (inscrit le 08/09/2026)
const lectNouveau = [
  { ...lecteur('d', 'LEC103', 'Dossou', 'Eric', 'fr1'), created_at: '2026-09-08T10:00:00Z' }
];
const recapNouveau = calculerRecaps(lectNouveau, [], samedis);
eq('nouveau lecteur inscrit le 08/09 : 3 samedis comptés au lieu de 4', recapNouveau[0].total, 3);
eq('nouveau lecteur inscrit le 08/09 : 3 non pointés (05/09 ignoré)', recapNouveau[0].nonSaisi, 3);


// ============================================================================
console.log('\n── Fuseau : « aujourd\'hui » est la date au Bénin (Africa/Lagos) ────');
// ============================================================================
// Samedi 12/09/2026 à 23 h 30 au Bénin = 22 h 30 UTC. Un navigateur réglé sur
// Los Angeles (UTC-7) afficherait encore le samedi 15 h 30 : même résultat
// attendu, car on ne dépend pas du fuseau du navigateur.
{
  const instant = new Date('2026-09-12T22:30:00Z'); // samedi 23:30 Bénin
  eq('12/09 23:30 Bénin → aujourd\'hui = 12/09', dateISO(aujourdhuiBenin(instant)), '2026-09-12');
  eq('12/09 23:30 Bénin → dernier samedi = 12/09 (encore ouvert)', dateISO(dernierSamedi(instant)), '2026-09-12');
  const minuit = new Date('2026-09-12T23:00:00Z'); // dimanche 00:00 Bénin
  eq('dimanche 00:00 Bénin → aujourd\'hui = 13/09', dateISO(aujourdhuiBenin(minuit)), '2026-09-13');
  eq('dimanche 00:00 Bénin → dernier samedi = 12/09 (gelé à partir de là)', dateISO(dernierSamedi(minuit)), '2026-09-12');
  const vendrediTard = new Date('2026-09-18T23:30:00Z'); // samedi 00:30 Bénin
  eq('samedi 00:30 Bénin (vendredi 23:30 UTC) → dernier samedi = 19/09', dateISO(dernierSamedi(vendrediTard)), '2026-09-19');
  const mercredi = new Date('2026-09-16T10:00:00Z');
  eq('mercredi 16/09 → dernier samedi = 12/09', dateISO(dernierSamedi(mercredi)), '2026-09-12');
}

// ============================================================================
console.log('\n── Pagination : PostgREST tronque à 1 000 lignes ────────────────────');
// ============================================================================
{
  // Source de 2 350 lignes servie par pages de 1 000 (comme PostgREST).
  const source = Array.from({ length: 2350 }, (_, i) => ({ id: i + 1 }));
  const appels: [number, number][] = [];
  const r = await toutesLesLignes<{ id: number }>(async (de, a) => {
    appels.push([de, a]);
    return { data: source.slice(de, a + 1), error: null };
  });
  eq('2 350 lignes récupérées intégralement', r.data.length, 2350);
  eq('3 appels (1000 + 1000 + 350)', appels.length, 3);
  eq('dernière ligne = 2350', r.data.at(-1)?.id, 2350);
  eq('pas d\'erreur', r.error, null);

  // Exactement 1 000 lignes : un appel supplémentaire vide confirme la fin.
  const mille = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
  const r2 = await toutesLesLignes<{ id: number }>(async (de, a) => ({ data: mille.slice(de, a + 1), error: null }));
  eq('exactement 1 000 lignes : toutes récupérées', r2.data.length, 1000);

  // Erreur à la 2ᵉ page : remontée, avec ce qui a été lu.
  const r3 = await toutesLesLignes<{ id: number }>(async (de) =>
    de === 0 ? { data: source.slice(0, 1000), error: null } : { data: null, error: { message: 'réseau' } }
  );
  eq('erreur en cours de route remontée', r3.error?.message, 'réseau');
  eq('les lignes déjà lues sont conservées', r3.data.length, 1000);

  // Source vide.
  const r4 = await toutesLesLignes<{ id: number }>(async () => ({ data: [], error: null }));
  eq('source vide → 0 ligne', r4.data.length, 0);
}

// ============================================================================
console.log('\n── Temps réel : regroupement et non-superposition des rechargements ──');
// ============================================================================
// Horloge factice : les minuteurs se déclenchent quand on avance le temps.
{
  type Minuteur = { id: number; a: number; fn: () => void };
  let horloge = 0;
  let prochainId = 1;
  let minuteurs: Minuteur[] = [];
  const setTimer = (fn: () => void, ms: number) => {
    const m = { id: prochainId++, a: horloge + ms, fn };
    minuteurs.push(m);
    return m.id;
  };
  const clearTimer = (id: unknown) => {
    minuteurs = minuteurs.filter((m) => m.id !== id);
  };
  const avancer = async (ms: number) => {
    const cible = horloge + ms;
    for (;;) {
      const prets = minuteurs.filter((m) => m.a <= cible).sort((x, y) => x.a - y.a);
      if (prets.length === 0) break;
      const m = prets[0];
      horloge = m.a;
      minuteurs = minuteurs.filter((x) => x.id !== m.id);
      m.fn();
      await Promise.resolve();
    }
    horloge = cible;
    await Promise.resolve();
  };
  const tick = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  // --- 1. Une rafale de 10 événements = 1 seul rechargement.
  let appels = 0;
  let plan = creerPlanificateur(async () => { appels++; }, { delai: 400, setTimer, clearTimer });
  for (let i = 0; i < 10; i++) {
    plan.signaler();
    await avancer(50); // 10 événements espacés de 50 ms (< 400 ms)
  }
  eq('rafale : aucun rechargement avant la fin du délai', appels, 0);
  await avancer(400);
  await tick();
  eq('rafale de 10 événements → 1 seul rechargement', appels, 1);

  // --- 2. Deux rafales séparées = 2 rechargements.
  plan.signaler();
  await avancer(450);
  await tick();
  eq('seconde rafale → second rechargement', appels, 2);

  // --- 3. Un événement pendant un rechargement lent : un seul rechargement
  //        supplémentaire, exécuté après la fin du premier (pas en parallèle).
  let enCours = 0;
  let maxParallele = 0;
  let termines = 0;
  let liberer: (() => void) | null = null;
  plan = creerPlanificateur(
    () =>
      new Promise<void>((resolve) => {
        enCours++;
        maxParallele = Math.max(maxParallele, enCours);
        liberer = () => {
          enCours--;
          termines++;
          resolve();
        };
      }),
    { delai: 400, setTimer, clearTimer }
  );
  plan.signaler();
  await avancer(400);
  await tick();
  eq('rechargement lent démarré', enCours, 1);
  // 3 nouveaux événements arrivent pendant qu'il tourne
  plan.signaler(); plan.signaler(); plan.signaler();
  await avancer(400);
  await tick();
  eq('pas de second rechargement en parallèle', maxParallele, 1);
  const lib1 = liberer as unknown as () => void; liberer = null;
  lib1();
  await tick();
  eq('à la fin du premier, exactement un rechargement de rattrapage démarre', enCours, 1);
  const lib2 = liberer as unknown as () => void; liberer = null;
  lib2();
  await tick();
  eq('deux rechargements au total, jamais simultanés', termines, 2);
  eq('aucun rechargement supplémentaire en attente', enCours, 0);

  // --- 4. immediat() pendant un rechargement : même garantie.
  plan.immediat();
  await tick();
  plan.immediat();
  await tick();
  eq('immediat() pendant un rechargement ne double pas', maxParallele, 1);
  (liberer as unknown as () => void)();
  await tick();
  (liberer as unknown as () => void)();
  await tick();
  eq('immediat() doublé → rattrapage unique', termines, 4);

  // --- 5. arreter() : plus rien après le démontage.
  appels = 0;
  plan = creerPlanificateur(async () => { appels++; }, { delai: 400, setTimer, clearTimer });
  plan.signaler();
  plan.arreter();
  await avancer(1000);
  await tick();
  plan.signaler();
  plan.immediat();
  await avancer(1000);
  await tick();
  eq('après arreter(), aucun rechargement', appels, 0);
  eq('après arreter(), aucun minuteur résiduel', minuteurs.length, 0);

  // --- 6. Une erreur de rechargement ne casse pas le planificateur.
  let n = 0;
  const erreurs: unknown[] = [];
  plan = creerPlanificateur(
    async () => { n++; if (n === 1) throw new Error('réseau'); },
    { delai: 100, setTimer, clearTimer, onErreur: (e) => erreurs.push(e) }
  );
  plan.signaler();
  await avancer(100); await tick();
  plan.signaler();
  await avancer(100); await tick();
  eq('une erreur est remontée à onErreur', erreurs.length, 1);
  eq('le rechargement suivant a bien lieu malgré l\'erreur précédente', n, 2);
}

// ============================================================================
console.log(`\n${'─'.repeat(66)}`);
if (echecs.length === 0) {
  console.log(`✅ ${reussites} vérifications réussies, 0 échec.`);
} else {
  console.log(`❌ ${echecs.length} échec(s) sur ${reussites + echecs.length} vérifications :`);
  echecs.forEach((e) => console.log(`   • ${e}`));
  process.exit(1);
}
