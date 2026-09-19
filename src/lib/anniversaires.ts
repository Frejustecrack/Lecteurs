import { aujourdhuiBenin } from './dates.ts';

/** Projection minimale de v_anniversaires_mois ; aucune date de naissance complète. */
export interface Anniversaire {
  id: string;
  matricule: string;
  nom: string;
  prenom: string;
  jour: number;
  mois: number;
  annee: number;
  age_atteint: number;
}

export function periodeAnniversaires(maintenant = new Date()) {
  const date = aujourdhuiBenin(maintenant);
  return { annee: date.getFullYear(), mois: date.getMonth() + 1 };
}

/** Âge atteint à l'anniversaire, pas l'âge actuel avant ce jour. */
export function ageAnniversaire(naissance: string | null, annee: number): number | null {
  if (!naissance || !/^\d{4}-\d{2}-\d{2}$/.test(naissance) || !Number.isInteger(annee)) return null;
  const [a, m, j] = naissance.split('-').map(Number);
  const date = new Date(`${naissance}T12:00:00Z`);
  if (a < 1 || !Number.isFinite(date.getTime()) || date.getUTCFullYear() !== a || date.getUTCMonth() + 1 !== m || date.getUTCDate() !== j || a > annee) return null;
  return annee - a;
}

/** Année bissextile de référence : conserve « 29 février » même en année commune. */
export function dateAnniversaire(jour: number, mois: number): string {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(2000, mois - 1, jour)));
}

/** Défense contre des réponses API invalides, sans normaliser un 31 février en mars. */
export function anniversaireValide(l: Anniversaire): boolean {
  if (!l || typeof l !== 'object') return false;
  const date = `2000-${String(l.mois).padStart(2, '0')}-${String(l.jour).padStart(2, '0')}`;
  return typeof l.id === 'string' && typeof l.matricule === 'string'
    && typeof l.nom === 'string' && typeof l.prenom === 'string'
    && !!`${l.nom} ${l.prenom}`.trim()
    && Number.isInteger(l.annee) && l.annee > 0
    && Number.isInteger(l.age_atteint) && l.age_atteint >= 0
    && Number.isInteger(l.jour) && Number.isInteger(l.mois)
    && ageAnniversaire(date, 2000) !== null;
}

/** Le schéma actuel ne contient pas de sexe : le défaut est volontairement neutre. */
export function messagesAnniversaire(sexe?: 'fille' | 'garcon' | null): string[] {
  const engagement = sexe === 'fille' ? 'de lectrice junior' : sexe === 'garcon' ? 'de lecteur junior' : 'au sein des Lecteurs Juniors';
  return [
    'Au nom de toute la communauté paroissiale des Lecteurs Juniors de la Paroisse Sainte-Famille d’Akogbato, nous te souhaitons un très joyeux anniversaire !',
    'Que le Seigneur t’accorde joie, santé et paix. Qu’il guide tes pas, te fasse grandir dans la confiance et bénisse tes projets de réussite.',
    `Nous t’encourageons à rester fidèle à ton engagement ${engagement} et à continuer à servir avec joie, sérieux et dévouement.`,
  ];
}

export function nomFichierAnniversaire(l: Anniversaire): string {
  const nom = `${l.prenom}-${l.nom}`.normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 110) || 'Lecteur';
  const ref = l.matricule.replace(/[^a-zA-Z0-9]/g, '');
  return `Carte-anniversaire-${nom}-${ref}-${l.annee}.pdf`;
}
