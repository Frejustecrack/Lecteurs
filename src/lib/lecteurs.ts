/** Ordre partagé par toutes les listes de lecteurs et leurs exports PDF. */
export interface IdentiteLecteur {
  nom: string;
  prenom: string;
  matricule: string;
}

const alphabetFrancais = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

/** Nom de famille, puis prénom, puis matricule pour départager les homonymes. */
export function comparerLecteurs(a: IdentiteLecteur, b: IdentiteLecteur): number {
  return alphabetFrancais.compare(a.nom.trim(), b.nom.trim())
    || alphabetFrancais.compare(a.prenom.trim(), b.prenom.trim())
    || alphabetFrancais.compare(a.matricule, b.matricule);
}

/** Ne modifie jamais le tableau fourni (notamment les états React). */
export function trierLecteurs<T extends IdentiteLecteur>(lecteurs: readonly T[]): T[] {
  return [...lecteurs].sort(comparerLecteurs);
}

function normaliserRecherche(texte: string): string {
  return texte.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr').trim();
}

/** Recherche sans distinction d'accents/casse, par nom, prénom ou matricule. */
export function rechercherLecteurs<T extends IdentiteLecteur>(lecteurs: readonly T[], recherche: string): T[] {
  const mots = normaliserRecherche(recherche).split(/\s+/).filter(Boolean);
  return trierLecteurs(lecteurs.filter((l) => {
    const identite = normaliserRecherche(`${l.nom} ${l.prenom} ${l.matricule}`);
    return mots.every((mot) => identite.includes(mot));
  }));
}
