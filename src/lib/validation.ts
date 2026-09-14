/**
 * Validations de saisie partagées par les fiches lecteurs.
 *
 * Règle métier (demande CDLJ) : ni l'année de naissance ni l'année d'adhésion
 * ne peuvent dépasser l'année en cours — et l'adhésion ne peut pas précéder
 * la naissance.
 */

/** Année civile en cours (fuseau de l'utilisateur). */
export function anneeCourante(): number {
  return new Date().getFullYear();
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
