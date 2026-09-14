/**
 * Traduction des erreurs techniques (PostgreSQL / Supabase / réseau) en
 * messages compréhensibles par des utilisateurs qui ne sont pas développeurs.
 *
 * Principe :
 *  - on n'affiche JAMAIS un code ou un message PostgreSQL brut à l'écran ;
 *  - l'erreur technique complète reste visible dans la console du navigateur
 *    (F12 → Console) pour le diagnostic ;
 *  - un refus de sécurité (Row Level Security) est toujours reformulé en
 *    « vous n'êtes pas autorisé à … ».
 */

type ErrShape = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

function asErr(err: unknown): ErrShape {
  if (!err) return {};
  if (typeof err === 'string') return { message: err };
  if (err instanceof Error) {
    return {
      message: err.message,
      code: (err as Error & { code?: string }).code,
    };
  }
  return err as ErrShape;
}

/** L'action en cours, pour formuler « Vous n'êtes pas autorisé à … ». */
function refus(action?: string): string {
  return action
    ? `Vous n'êtes pas autorisé à ${action}.`
    : "Vous n'êtes pas autorisé à effectuer cette action.";
}

const REFUS_GEN = refus();

/**
 * Transforme n'importe quelle erreur en message français lisible.
 *
 * @param err    l'erreur renvoyée par Supabase (`error`), une `Error`, ou une chaîne
 * @param action description courte de l'action en cours
 *               (ex. « enregistrer cette présence »)
 */
export function traduireErreur(err: unknown, action?: string): string {
  const e = asErr(err);
  // Trace technique conservée pour le développeur uniquement.
  console.error('[CDLJ] erreur technique :', err);

  const msg = e.message ?? '';
  const code = String(e.code ?? '');
  const details = e.details ?? '';

  // ---------------------------------------------------------------- droits
  // 42501 = insufficient_privilege (rejet RLS ou droit d'exécution manquant)
  if (
    code === '42501' ||
    /row-level security/i.test(msg) ||
    /permission denied/i.test(msg) ||
    /droits insuffisants/i.test(msg)
  ) {
    return refus(action);
  }

  // ------------------------------------------------- exceptions métier SQL
  // (levées par raise exception dans les fonctions de la base)
  if (/total pay[ée]/i.test(msg)) {
    return 'Le total payé dépasse le montant de participation fixé pour cet événement.';
  }
  if (/lecteur introuvable/i.test(msg)) {
    return 'Ce lecteur est introuvable.';
  }
  if (/grade invalide/i.test(msg)) return 'Le grade sélectionné est invalide.';
  if (/r[oô]le invalide/i.test(msg)) return 'Le rôle sélectionné est invalide.';

  // -------------------------------------------------- codes PostgreSQL/REST
  switch (code) {
    case '23505': // violation de contrainte d'unicité
      if (/matricule/i.test(details)) return 'Ce matricule est déjà attribué.';
      if (/nom/i.test(details)) return 'Ce nom est déjà utilisé.';
      if (/date_samedi/i.test(details))
        return 'Cette saisie a déjà été enregistrée pour ce samedi.';
      if (/event_id/i.test(details))
        return 'Ce lecteur est déjà inscrit à cet événement.';
      return 'Cette information a déjà été enregistrée.';
    case '23503': // clé étrangère
      return "Opération impossible : l'élément concerné n'existe plus. Rechargez la page.";
    case '23514': // contrainte de vérification
      if (/montant/i.test(details))
        return 'Le montant doit être un nombre supérieur à zéro.';
      return 'La valeur saisie est invalide.';
    case '23502':
      return 'Un champ obligatoire est manquant.';
    case '22P02':
    case '22007':
      return 'Le format saisi est invalide (nombre ou date attendu).';
    case '40001':
      return 'Un autre utilisateur a modifié ces données au même moment. Rechargez la page.';
    case '57014':
      return "La demande a pris trop de temps. Réduisez la période affichée et réessayez.";
    case 'PGRST116':
      return "Aucun élément ne correspond à cette demande.";
    case 'P0001':
      return "L'opération a été refusée par le serveur.";
  }

  // ------------------------------------------------------------ authentification
  if (/invalid login credentials/i.test(msg)) {
    return 'Identifiant ou mot de passe incorrect.';
  }
  if (/email not confirmed/i.test(msg)) {
    return "Ce compte n'a pas encore été activé. Contactez l'Administrateur.";
  }
  if (
    /auth session missing/i.test(msg) ||
    /session expired/i.test(msg) ||
    /jwt expired/i.test(msg) ||
    /refresh_token_not_found/i.test(msg)
  ) {
    return 'Votre session a expiré. Merci de vous reconnecter.';
  }
  if (/password should be at least/i.test(msg)) {
    return 'Le mot de passe doit contenir au moins 8 caractères.';
  }
  if (/new password should be different/i.test(msg)) {
    return "Le nouveau mot de passe doit être différent de l'ancien.";
  }
  if (/rate limit/i.test(msg)) {
    return 'Trop de tentatives successives. Réessayez dans quelques minutes.';
  }

  // ------------------------------------------------------------------ réseau
  if (
    /failed to fetch/i.test(msg) ||
    /networkerror/i.test(msg) ||
    /load failed/i.test(msg) ||
    /network request failed/i.test(msg)
  ) {
    return 'Impossible de joindre le serveur. Vérifiez votre connexion Internet puis réessayez.';
  }
  if (/missing supabase url|missing supabase.*key/i.test(msg)) {
    return "L'application n'est pas encore configurée (accès à la base manquant). Contactez l'Administrateur.";
  }

  // ------------------------------------------------------------------ repli
  return action
    ? `Impossible de ${action}. Réessayez, et si le problème persiste contactez l'Administrateur.`
    : "L'opération n'a pas abouti. Réessayez, et si le problème persiste contactez l'Administrateur.";
}

/** Vrai si l'erreur est un refus de droits (utile pour adapter l'affichage). */
export function estErreurDroits(err: unknown): boolean {
  const e = asErr(err);
  return (
    String(e.code ?? '') === '42501' ||
    /row-level security|permission denied|droits insuffisants/i.test(e.message ?? '')
  );
}

/** Message générique de refus, réutilisable par les gardes côté interface. */
export const MESSAGE_REFUS = REFUS_GEN;
