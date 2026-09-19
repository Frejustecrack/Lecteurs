import { useEffect, useState } from 'react';
import { periodeAnniversaires } from './anniversaires';

/** Bascule automatique du mois au Bénin, même si la page reste ouverte. */
export function useMoisCourant() {
  const [periode, setPeriode] = useState(() => periodeAnniversaires());
  useEffect(() => {
    const verifier = () => {
      const suivante = periodeAnniversaires();
      setPeriode((p) => p.annee === suivante.annee && p.mois === suivante.mois ? p : suivante);
    };
    // 30 s maximum en onglet actif ; vérification immédiate au retour d'un
    // onglet suspendu (les navigateurs mobiles suspendent parfois les timers).
    const timer = window.setInterval(verifier, 30_000);
    window.addEventListener('focus', verifier);
    document.addEventListener('visibilitychange', verifier);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', verifier);
      document.removeEventListener('visibilitychange', verifier);
    };
  }, []);
  return periode;
}
