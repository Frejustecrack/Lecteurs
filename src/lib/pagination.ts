/**
 * Chargement complet d'une requête Supabase, par pages.
 *
 * PostgREST tronque **silencieusement** toute réponse à `max_rows` lignes
 * (1 000 par défaut sur Supabase). Avec 200 lecteurs, un mois à 5 samedis
 * fait exactement 1 000 présences : au 201ᵉ lecteur, une case disparaît
 * sans aucune erreur. Cette fonction enchaîne les `range()` jusqu'à la fin.
 *
 * Usage :
 *   const presences = await toutesLesLignes<Presence>((de, a) =>
 *     supabase.from('presences').select('*').gte(...).order('id').range(de, a)
 *   );
 *
 * La requête DOIT être triée (`order`) pour que les pages soient stables.
 */
export const TAILLE_PAGE = 1000;

export interface ReponsePage<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * Chargement complet — tolère les `select` partiels (perf 200 lecteurs) :
 * la requête peut renvoyer un sous-ensemble de colonnes, on caste en T
 * côté appelant via `as Lecteur[]`. Le builder Supabase garde son type
 * PostgrestFilterBuilder, d'où `any` ici pour éviter TS2322 sur les selects
 * minimaux.
 */
export async function toutesLesLignes<T>(
  page: (de: number, a: number) => PromiseLike<ReponsePage<any>>,
  taille = TAILLE_PAGE
): Promise<{ data: T[]; error: { message: string } | null }> {
  const tout: T[] = [];
  let de = 0;
  for (;;) {
    const { data, error } = await page(de, de + taille - 1);
    if (error) return { data: tout, error };
    const lot = (data ?? []) as T[];
    tout.push(...lot);
    if (lot.length < taille) break;
    de += taille;
  }
  return { data: tout, error: null };
}
