/**
 * Récapitulatif des présences / absences — logique pure utilisée par le module
 * « Suivis ». Isolée du composant React pour pouvoir être vérifiée directement.
 */
import type { Lecteur, Presence } from './types';

export interface Recap {
  lecteur: Lecteur;
  /** Séances pointées « présent » sur la période. */
  present: number;
  /** Séances pointées « absent » sur la période. */
  absent: number;
  /** Séances de la période qui n'ont pas encore été pointées. */
  nonSaisi: number;
  /** Nombre de séances prises en compte sur la période. */
  total: number;
  /** Taux de présence arrondi (0 à 100). */
  taux: number;
}

export type FiltreRecap = 'tous' | 'absents' | 'parfaits' | 'incomplets';

/** Présence d'un lecteur pour un samedi donné (ou `undefined` si non pointé). */
export function indexPresences(
  presences: Pick<Presence, 'lecteur_id' | 'date_samedi' | 'statut'>[]
): Map<string, 'present' | 'absent'> {
  const m = new Map<string, 'present' | 'absent'>();
  presences.forEach((p) => m.set(`${p.lecteur_id}|${p.date_samedi}`, p.statut));
  return m;
}

/**
 * Construit le récapitulatif de chaque lecteur sur une liste de samedis.
 *
 * @param lecteurs  lecteurs à récapituler (déjà filtrés sur les actifs)
 * @param presences présences chargées pour la période
 * @param samedis   samedis pris en compte (1 en vue hebdomadaire,
 *                  3 à 5 en vue mensuelle, ou un samedi précis)
 */
export function calculerRecaps(
  lecteurs: Lecteur[],
  presences: Pick<Presence, 'lecteur_id' | 'date_samedi' | 'statut'>[],
  samedis: string[]
): Recap[] {
  const index = indexPresences(presences);
  const total = samedis.length;
  return lecteurs.map((lecteur) => {
    let present = 0;
    let absent = 0;
    samedis.forEach((s) => {
      const st = index.get(`${lecteur.id}|${s}`);
      if (st === 'present') present++;
      else if (st === 'absent') absent++;
    });
    return {
      lecteur,
      present,
      absent,
      nonSaisi: total - present - absent,
      total,
      taux: total > 0 ? Math.round((present / total) * 100) : 0,
    };
  });
}

/** Applique le filtre de récapitulatif (« absents », « assidus »…). */
export function filtreRecap(r: Recap, filtre: FiltreRecap): boolean {
  switch (filtre) {
    case 'absents':
      return r.absent > 0;
    case 'parfaits':
      return r.total > 0 && r.present === r.total;
    case 'incomplets':
      return r.nonSaisi > 0;
    default:
      return true;
  }
}

/** Vrai si le récapitulatif correspond au filtre choisi. */
export function appliquerFiltreRecap(recaps: Recap[], filtre: FiltreRecap): Recap[] {
  return recaps.filter((r) => filtreRecap(r, filtre));
}

/** Filtre par fraternité et par recherche texte (matricule, nom, prénom). */
export function filtrerRecaps(
  recaps: Recap[],
  opts: { fraterniteId?: string; recherche?: string; filtre?: FiltreRecap }
): Recap[] {
  const q = (opts.recherche ?? '').trim().toLowerCase();
  const f = opts.filtre ?? 'tous';
  return recaps.filter((r) => {
    if (opts.fraterniteId && r.lecteur.fraternite_id !== opts.fraterniteId) return false;
    if (q) {
      const ok =
        r.lecteur.matricule.toLowerCase().includes(q) ||
        r.lecteur.nom.toLowerCase().includes(q) ||
        r.lecteur.prenom.toLowerCase().includes(q);
      if (!ok) return false;
    }
    return filtreRecap(r, f);
  });
}

export type TriRecap = 'matricule' | 'nom' | 'presences' | 'absences';

/** Trie les récapitulatifs selon la colonne choisie. */
export function trierRecaps(recaps: Recap[], tri: TriRecap, asc: boolean): Recap[] {
  const sens = asc ? 1 : -1;
  return [...recaps].sort((a, b) => {
    switch (tri) {
      case 'matricule':
        return a.lecteur.matricule.localeCompare(b.lecteur.matricule) * sens;
      case 'presences':
        return (
          (a.present - b.present) * sens || a.lecteur.nom.localeCompare(b.lecteur.nom)
        );
      case 'absences':
        return (
          (a.absent - b.absent) * sens || a.lecteur.nom.localeCompare(b.lecteur.nom)
        );
      default:
        return (
          a.lecteur.nom.localeCompare(b.lecteur.nom) * sens ||
          a.lecteur.prenom.localeCompare(b.lecteur.prenom)
        );
    }
  });
}
