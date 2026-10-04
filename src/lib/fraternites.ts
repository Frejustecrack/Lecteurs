/**
 * Règle d'affichage des animateurs dans les vues de suivi hebdomadaire
 * (Présences et Cotisations).
 *
 * Les animateurs ne sont pas des lecteurs comme les autres : ils encadrent et
 * cotisent à un tarif distinct. Pour alléger la LISTE à pointer, la vue
 * globale les exclut visuellement, et ils ne réapparaissent qu'en
 * sélectionnant explicitement leur fraternité dans le filtre.
 *
 * Règle structurante, sans exception : **ce qu'on AFFICHE se filtre, ce qu'on
 * COMPTE ne se filtre JAMAIS.** L'exclusion ci-dessus est un confort de
 * lecture, rien de plus — les totaux financiers (dû, payé, caisse) et tout
 * effectif comptable DOIVENT toujours inclure les animateurs, sans quoi
 * l'écran ne correspond plus à l'argent réellement encaissé. Voir
 * `filtrerParFraternite` (affichage, filtre) vs `filtrerPourTotaux` (calcul,
 * ne filtre jamais) ci-dessous.
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

/**
 * Périmètre **comptable** d'une vue — les animateurs y sont TOUJOURS inclus.
 *
 * L'exclusion opérée par `filtrerParFraternite` est purement **visuelle** :
 * elle allège la liste des lecteurs à pointer. Les totaux affichés, eux,
 * doivent décrire la communauté entière, sinon le total payé d'un écran ne
 * correspond plus à l'argent réellement encaissé et la caisse ne tombe plus
 * juste.
 *
 * Règle : **ce qu'on affiche** se filtre, **ce qu'on compte** ne se filtre pas.
 *
 * @param fraterniteId `''` = vue globale (toute la communauté) ; sinon les
 *                     membres de la fraternité choisie.
 */
export function filtrerPourTotaux<T extends LecteurFiltrable>(
  lecteurs: readonly T[],
  fraterniteId: string
): T[] {
  if (!fraterniteId) return [...lecteurs];
  return lecteurs.filter((l) => l.fraternite_id === fraterniteId);
}

/** Nombre d'animateurs dans un ensemble — sert à expliciter un total. */
export function compterAnimateurs<T extends LecteurFiltrable>(
  lecteurs: readonly T[],
  animateurId: string | null
): number {
  if (!animateurId) return 0;
  return lecteurs.filter((l) => l.fraternite_id === animateurId).length;
}

/** Tout ce dont la détection de candidat a besoin d'une fraternité. */
export interface FraterniteCandidate extends FraterniteFiltrable {
  nom: string;
}

/**
 * Suggère une fraternité à désigner pour le tarif Animateur quand aucune
 * fraternité AVEC MEMBRES ne porte actuellement le marqueur `system_key`.
 *
 * Reproduit côté interface exactement la même règle que la fonction SQL
 * `reparer_designation_fraternite_animateur` (migration 20261004120000) :
 * une communauté qui crée elle-même sa fraternité d'animateurs (« Fraternité
 * animateur », « Animateurs », …) sans jamais utiliser l'écran de désignation
 * se retrouve avec ses membres facturés au tarif normal, sans que rien ne
 * l'explique. On repère ce cas pour l'afficher clairement.
 *
 * Ne devine jamais à l'aveugle : renvoie `null`
 *  - si une fraternité marquée a déjà des membres (configuration saine) ;
 *  - si aucun nom ne ressemble à « animateur » ;
 *  - si plusieurs fraternités pourraient convenir (ambiguïté : à l'Admin de
 *    trancher explicitement, voir l'écran Fraternités).
 */
export function candidatFraterniteAnimateur<
  F extends FraterniteCandidate,
  L extends LecteurFiltrable
>(fraternites: readonly F[], lecteurs: readonly L[]): F | null {
  const marquee = fraternites.find((f) => f.system_key === 'animateur');
  const aDesMembres = (id: string) => lecteurs.some((l) => l.fraternite_id === id);
  if (marquee && aDesMembres(marquee.id)) return null;

  const candidats = fraternites.filter(
    (f) => f.id !== marquee?.id && /animateur/i.test(f.nom) && aDesMembres(f.id)
  );
  return candidats.length === 1 ? candidats[0] : null;
}

/**
 * Mention à accoler à un total pour que son périmètre soit lisible.
 * Renvoie `undefined` quand il n'y a rien à signaler.
 */
export function mentionAnimateurs(nb: number): string | undefined {
  if (nb <= 0) return undefined;
  return `animateurs inclus (${nb})`;
}
