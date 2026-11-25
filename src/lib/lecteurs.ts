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

/**
 * Forme comparable d'un texte saisi : sans accents, sans casse, sans espaces
 * superflus. Utilisée par TOUTES les recherches de l'application (lecteurs,
 * journaux, cotisations, permissions) pour qu'un « Ehouman » saisi sans accent
 * retrouve bien « Éhouman » — comportement identique partout.
 */
export function normaliserTexte(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('fr')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Vrai si **tous les mots** de `recherche` apparaissent dans l'un des champs
 * fournis, sans distinction d'accents ni de casse. Une recherche vide
 * correspond à tout.
 *
 *   correspondRecherche(['Éhouman', 'Zoé', 'LEC101'], 'ehouman zoe') // true
 */
export function correspondRecherche(
  champs: readonly (string | null | undefined)[],
  recherche: string
): boolean {
  const mots = normaliserTexte(recherche).split(' ').filter(Boolean);
  if (mots.length === 0) return true;
  const contenu = normaliserTexte(
    champs.filter(Boolean).join(' ')
  );
  return mots.every((mot) => contenu.includes(mot));
}

/** Recherche sans distinction d'accents/casse, par nom, prénom ou matricule. */
export function rechercherLecteurs<T extends IdentiteLecteur>(lecteurs: readonly T[], recherche: string): T[] {
  const mots = normaliserTexte(recherche).split(' ').filter(Boolean);
  if (mots.length === 0) return trierLecteurs(lecteurs);
  return trierLecteurs(lecteurs.filter((l) => {
    const identite = normaliserTexte(`${l.nom} ${l.prenom} ${l.matricule}`);
    return mots.every((mot) => identite.includes(mot));
  }));
}
