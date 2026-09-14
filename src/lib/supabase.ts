import { createClient } from '@supabase/supabase-js';

/**
 * Configuration de l'accès à Supabase.
 *
 * Les variables proviennent du fichier `.env` (voir `.env.example`).
 * Si elles sont absentes, on ne fait PAS planter l'application au démarrage :
 * un écran explicatif est affiché à la place (`supabaseConfiguré === false`),
 * car un écran blanc ne dit rien à un utilisateur non développeur.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** Vrai lorsque les deux variables d'environnement sont renseignées. */
export const supabaseConfiguré = Boolean(url && key);

export const supabase = createClient(
  supabaseConfiguré ? (url as string) : 'https://cdlj-placeholder.invalid',
  supabaseConfiguré ? (key as string) : 'cle-manquante',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  }
);
