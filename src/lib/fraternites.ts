/**
 * Règle d'affichage des animateurs dans les vues de suivi hebdomadaire
 * (Présences et Cotisations).
 *
 * Les animateurs ne sont pas des lecteurs comme les autres : ils encadrent,
 * cotisent à un tarif distinct, et les mélanger aux lecteurs fausse la lecture
 * des totaux (effectif, dû, taux de présence). La **vue globale les exclut
 * donc**, et ils n'apparaissent que lorsque leur fraternité est explicitement
 * sélectionnée dans le filtre.
 *
 * Conséquence volontaire : en vue globale, les cartes de statistiques ne
 * comptent pas les animateurs. C'est le but — ces vues décrivent les lecteurs.
 */

/** Tout ce dont le filtre a besoin d'une fraternité. */
export interface FraterniteFiltrable {
  id: string;
  system_key?: 'animateur' | null;
}

/** Tout ce dont le filtre a besoin d'un lecteur. */
export interface LecteurFiltrable {
  fraternite_id: string | null;
}

/**
 * Identifiant de la fraternité portant le tarif Animateur, ou `null` si
 * aucune n'est désignée (voir Admin → Paramètres).
 *
 * Le marqueur est technique : il ne dépend NI du nom de la fraternité, ni de
 * sa position dans la liste.
 */
export function idFraterniteAnimateur(
  fraternites: readonly FraterniteFiltrable[]
): string | null {
  return fraternites.find((f) => f.system_key === 'animateur')?.id ?? null;
}

/**
 * Applique le filtre de fraternité d'une vue de suivi.
 *
 * @param fraterniteId `''` = vue globale ; sinon l'identifiant sélectionné.
 * @param animateurId  résultat de `idFraterniteAnimateur`, ou `null`.
 *
 * - **Vue globale** : tous les lecteurs SAUF les animateurs.
 * - **Fraternité sélectionnée** : exactement ses membres — y compris lorsque
 *   c'est la fraternité des animateurs, qui devient alors seule visible.
 */
export function filtrerParFraternite<T extends LecteurFiltrable>(
  lecteurs: readonly T[],
  fraterniteId: string,
  animateurId: string | null
): T[] {
  if (fraterniteId) {
    return lecteurs.filter((l) => l.fraternite_id === fraterniteId);
  }
  if (!animateurId) return [...lecteurs];
  return lecteurs.filter((l) => l.fraternite_id !== animateurId);
}

/** Vrai lorsque la vue affichée est celle des animateurs. */
export function vueAnimateurs(
  fraterniteId: string,
  animateurId: string | null
): boolean {
  return Boolean(animateurId) && fraterniteId === animateurId;
}

/**
 * Libellé de l'option « vue globale » du filtre.
 *
 * Il doit dire la vérité : tant qu'une fraternité porte le tarif Animateur,
 * la vue globale n'est pas exhaustive. Une statistique dont le périmètre est
 * tu est une statistique fausse.
 */
export function libelleVueGlobale(animateurId: string | null): string {
  return animateurId
    ? 'Vue globale — toutes les fraternités sauf les animateurs'
    : 'Vue globale — toutes les fraternités';
}
