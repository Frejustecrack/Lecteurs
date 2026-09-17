import { useEffect, useState } from 'react';

/**
 * Hook de debounce pour la recherche.
 * Retarde la mise à jour de la valeur jusqu'à ce que l'utilisateur arrête de taper.
 * 
 * @param value - La valeur à debouncer
 * @param delay - Délai en millisecondes (défaut: 300ms)
 * @returns La valeur debouncée
 * 
 * @example
 * const [search, setSearch] = useState('');
 * const debouncedSearch = useDebounce(search, 300);
 * // debouncedSearch ne se met à jour que 300ms après le dernier changement de search
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}
