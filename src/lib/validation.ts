/**
 * Validations de saisie partagées par les fiches lecteurs.
 *
 * Règle métier (demande CDLJ) : ni l'année de naissance ni l'année d'adhésion
 * ne peuvent dépasser l'année en cours — et l'adhésion ne peut pas précéder
 * la naissance.
 */
import { aujourdhuiBenin } from './dates.ts';

/**
 * Année civile en cours **au Bénin** (Africa/Lagos) — et non dans le fuseau
 * du navigateur : `new Date().getFullYear()` décalait d'un an le 31 décembre
 * au soir pour tout utilisateur à l'ouest de UTC.
 */
export function anneeCourante(): number {
  return aujourdhuiBenin().getFullYear();
}

/** Année minimale acceptée (garde-fou contre les saisies aberrantes). */
export const ANNEE_MIN = 1900;

export interface ResultatValidation {
  ok: boolean;
  message: string | null;
}

/**
 * Contrôle la date de naissance et l'année d'adhésion.
 * Les deux paramètres sont facultatifs : une valeur vide est simplement ignorée.
 */
export function validerAnneesLecteur(
  dateNaissance: string,
  anneeAdhesion: string
): ResultatValidation {
  const anneeEnCours = anneeCourante();

  if (dateNaissance.trim()) {
    const d = new Date(dateNaissance);
    if (isNaN(d.getTime())) {
      return { ok: false, message: "La date de naissance n'est pas valide." };
    }
    if (d.getFullYear() > anneeEnCours) {
      return {
        ok: false,
        message: `L'année de naissance ne peut pas dépasser l'année en cours (${anneeEnCours}).`,
      };
    }
    if (d.getTime() > Date.now()) {
      return {
        ok: false,
        message: 'La date de naissance ne peut pas être une date future.',
      };
    }
    if (d.getFullYear() < ANNEE_MIN) {
      return {
        ok: false,
        message: `L'année de naissance doit être postérieure à ${ANNEE_MIN}.`,
      };
    }
  }

  if (anneeAdhesion.trim()) {
    const a = Number(anneeAdhesion);
    if (!Number.isFinite(a) || !Number.isInteger(a)) {
      return { ok: false, message: "L'année d'adhésion doit être un nombre entier." };
    }
    if (a > anneeEnCours) {
      return {
        ok: false,
        message: `L'année d'adhésion ne peut pas dépasser l'année en cours (${anneeEnCours}).`,
      };
    }
    if (a < ANNEE_MIN) {
      return {
        ok: false,
        message: `L'année d'adhésion doit être postérieure à ${ANNEE_MIN}.`,
      };
    }
    if (dateNaissance.trim()) {
      const d = new Date(dateNaissance);
      if (!isNaN(d.getTime()) && a < d.getFullYear()) {
        return {
          ok: false,
          message: `L'année d'adhésion (${a}) ne peut pas précéder l'année de naissance (${d.getFullYear()}).`,
        };
      }
    }
  }

  return { ok: true, message: null };
}

/**
 * Attributs `min` / `max` à poser sur les champs, pour que le navigateur
 * bloque la saisie avant même la validation applicative.
 */
export function bornesAnneeNaissance() {
  return {
    min: `${ANNEE_MIN}-01-01`,
    max: `${anneeCourante()}-12-31`,
  };
}

export function bornesAnneeAdhesion() {
  return { min: ANNEE_MIN, max: anneeCourante() };
}

/**
 * Lecture d'un paramètre numérique d'`app_settings`.
 *
 * `Number(value) || defaut` était faux sur DEUX cas réels :
 *  - un tarif volontairement fixé à **0** (samedi offert) retombait sur le
 *    tarif par défaut à l'écran alors que la base enregistrait bien 0 ;
 *  - une valeur non numérique donnait `NaN`, affiché tel quel.
 *
 * Le repli ne doit s'appliquer qu'à une valeur absente ou non numérique.
 */
export function montantParametre(
  valeur: number | undefined | null,
  defaut: number
): number {
  return typeof valeur === 'number' && Number.isFinite(valeur) ? valeur : defaut;
}
