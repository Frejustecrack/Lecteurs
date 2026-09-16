/**
 * Planificateur de rechargement — logique pure du temps réel (testée dans
 * `scripts/verif.ts`, sans React ni Supabase).
 *
 * Trois garanties, indispensables dès que plusieurs personnes saisissent en
 * même temps sur 200 lecteurs :
 *
 *  1. **Regroupement** : une rafale de N événements en moins de `delai` ms ne
 *     déclenche qu'UN rechargement, `delai` ms après le dernier événement.
 *  2. **Jamais deux rechargements simultanés** : si un événement arrive
 *     pendant un rechargement, un seul rechargement supplémentaire est
 *     programmé à la fin du premier (les données finales sont donc toujours
 *     à jour, sans course entre deux réponses réseau).
 *  3. **Arrêt propre** : après `arreter()`, plus rien n'est exécuté.
 */
export interface Planificateur {
  /** Un événement temps réel est arrivé : rechargement regroupé. */
  signaler(): void;
  /** Rechargement immédiat (retour sur l'onglet), même garantie n° 2. */
  immediat(): void;
  /** Démontage : annule le minuteur et ignore tout ce qui suit. */
  arreter(): void;
}

export interface OptionsPlanificateur {
  delai: number;
  /** Injectables pour les tests (par défaut : setTimeout/clearTimeout). */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  onErreur?: (err: unknown) => void;
}

export function creerPlanificateur(
  recharger: () => Promise<unknown> | unknown,
  opts: OptionsPlanificateur
): Planificateur {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let actif = true;
  let timer: unknown = null;
  let enCours = false;
  let relance = false;

  const executer = async () => {
    if (!actif) return;
    if (enCours) {
      relance = true;
      return;
    }
    enCours = true;
    try {
      await recharger();
    } catch (err) {
      opts.onErreur?.(err);
    } finally {
      enCours = false;
      if (relance && actif) {
        relance = false;
        void executer();
      }
    }
  };

  return {
    signaler() {
      if (!actif) return;
      if (timer !== null) clearTimer(timer);
      timer = setTimer(() => {
        timer = null;
        void executer();
      }, opts.delai);
    },
    immediat() {
      void executer();
    },
    arreter() {
      actif = false;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}
