import { useEffect, useRef } from 'react';
import type {
  RealtimePostgresChangesFilter,
  REALTIME_POSTGRES_CHANGES_LISTEN_EVENT,
} from '@supabase/supabase-js';
import { supabase } from './supabase';
import { creerPlanificateur } from './planificateur';

type Evenement = `${REALTIME_POSTGRES_CHANGES_LISTEN_EVENT}`;

/** Une table à écouter : `'presences'` ou `{ table, event?, filter? }`. */
export type Ecoute = string | { table: string; event?: Evenement; filter?: string };

/** Délai de regroupement des rafales d'événements (ms). */
const DEBOUNCE_MS = 400;

/**
 * Synchronisation temps réel d'une page.
 *
 * - Abonne un canal aux tables indiquées et appelle `recharger` quand elles
 *   changent, ainsi qu'au retour sur l'onglet (focus / visibilité).
 * - **Regroupe** les rafales : avec 200 lecteurs, un Caissier qui pointe
 *   dix cotisations d'affilée provoque dix événements — un seul rechargement
 *   est déclenché, ~400 ms après le dernier.
 * - **Ne superpose jamais** deux rechargements : si un `recharger()` est en
 *   cours quand un nouvel événement arrive, un unique rechargement
 *   supplémentaire est programmé à la fin du premier.
 * - Ignore les événements survenus après le démontage de la page.
 *
 * La logique (regroupement, non-superposition, arrêt) vit dans
 * `lib/planificateur.ts` et est couverte par `npm run verif`.
 *
 * La liste des tables est stabilisée par sa clé JSON : les pages peuvent la
 * passer en littéral sans provoquer de réabonnement à chaque rendu.
 */
export function useRealtime(
  nomCanal: string,
  ecoutes: Ecoute[],
  recharger: () => Promise<unknown> | unknown
) {
  const rechargerRef = useRef(recharger);
  rechargerRef.current = recharger;
  const cle = JSON.stringify(ecoutes);

  useEffect(() => {
    const plan = creerPlanificateur(() => rechargerRef.current(), {
      delai: DEBOUNCE_MS,
      onErreur: (err) => console.warn(`Rechargement (${nomCanal}) :`, err),
    });

    let canal = supabase.channel(nomCanal);
    for (const e of JSON.parse(cle) as Ecoute[]) {
      const spec = typeof e === 'string' ? { table: e } : e;
      const filtre: RealtimePostgresChangesFilter<'*'> = {
        event: (spec.event ?? '*') as '*',
        schema: 'public',
        table: spec.table,
        ...(spec.filter ? { filter: spec.filter } : {}),
      };
      canal = canal.on('postgres_changes', filtre, () => plan.signaler());
    }
    canal.subscribe();

    const onFocus = () => plan.immediat();
    const onVis = () => {
      if (document.visibilityState === 'visible') plan.immediat();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);

    return () => {
      plan.arreter();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
      supabase.removeChannel(canal);
    };
  }, [nomCanal, cle]);
}
