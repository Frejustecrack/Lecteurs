import { supabase } from './supabase';

/**
 * Journalisation côté client — UNIQUEMENT pour les faits que la base ne peut
 * pas observer elle-même : connexion, déconnexion, export PDF.
 *
 * Tout le reste (création/modification/suppression, clôture d'un événement,
 * correction d'une présence gelée…) est journalisé par les triggers d'audit
 * à partir des données réelles : rien à déclarer ici, donc rien à falsifier.
 *
 * La fonction SQL `journal_client` (migration 20260916120000) n'accepte que
 * ces trois actions et force l'auteur à `auth.uid()`.
 */
export type ActionClient = 'compte.connexion' | 'compte.deconnexion' | 'export.pdf';

export async function journaliser(
  action: ActionClient,
  objetType?: string,
  objetRef?: string,
  detail?: Record<string, unknown>
): Promise<void> {
  // Un échec de journalisation ne doit jamais bloquer l'utilisateur :
  // l'action principale (export, déconnexion) a déjà eu lieu.
  const { error } = await supabase.rpc('journal_client', {
    p_action: action,
    p_objet_type: objetType ?? null,
    p_objet_ref: objetRef ?? null,
    p_detail: detail ?? null,
  });
  if (error) console.warn('Journalisation impossible :', error.message);
}

/** Raccourci pour les exports PDF. */
export function journaliserExport(
  objetType: string,
  objetRef: string,
  detail: Record<string, unknown>
): Promise<void> {
  return journaliser('export.pdf', objetType, objetRef, detail);
}
