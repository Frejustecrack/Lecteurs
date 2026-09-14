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
  dateISO,
  dernierSamedi,
  estGelee,
  lundiDeSemaine,
  numeroSemaine,
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
  appliquerFiltreRecap,
  calculerRecaps,
  filtrerRecaps,
  trierRecaps,
} from '../src/lib/recap.ts';
import type { Lecteur } from '../src/lib/types.ts';

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

eq('filtre « absents » → 1 lecteur (Paul)', appliquerFiltreRecap(recaps, 'absents').length, 1);
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
  'cumul fraternité + filtre « absents » sur fr2 → 0',
  filtrerRecaps(recaps, { fraterniteId: 'fr2', filtre: 'absents' }).length,
  0
);

eq(
  'tri par absences croissantes',
  trierRecaps(recaps, 'absences', true).map((r) => r.lecteur.matricule).join(','),
  'LEC100,LEC102,LEC101'
);
eq(
  'tri par absences décroissantes',
  trierRecaps(recaps, 'absences', false).map((r) => r.lecteur.matricule)[0],
  'LEC101'
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
eq('samedi unique : 1 seul absent', appliquerFiltreRecap(recapUn, 'absents').length, 1);

// Période vide (aucun samedi) : aucun plantage, taux à 0
const recapVide = calculerRecaps(lect, pres, []);
eq('période vide : taux 0', recapVide[0].taux, 0);
eq('période vide : aucun assidu', appliquerFiltreRecap(recapVide, 'parfaits').length, 0);

// ============================================================================
console.log(`\n${'─'.repeat(66)}`);
if (echecs.length === 0) {
  console.log(`✅ ${reussites} vérifications réussies, 0 échec.`);
} else {
  console.log(`❌ ${echecs.length} échec(s) sur ${reussites + echecs.length} vérifications :`);
  echecs.forEach((e) => console.log(`   • ${e}`));
  process.exit(1);
}
