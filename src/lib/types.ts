export type Role = 'admin' | 'co' | 'co_paroissial' | 'caissier' | 'responsable';

export interface Profile {
  id: string;
  full_name: string | null;
  username: string | null;
  role: Role | null;
  created_at: string;
}

export interface Grade {
  id: number;
  nom: string;
}

export interface Fraternite {
  id: string;
  nom: string;
  responsables: string[];
  /** Identifiant réservé aux fraternités créées par le système. */
  system_key?: 'animateur' | null;
  created_at: string;
}

export interface Lecteur {
  id: string;
  matricule: string;
  nom: string;
  prenom: string;
  date_naissance: string | null;
  grade_id: number;
  annee_adhesion: number | null;
  fraternite_id: string | null;
  adresse: string | null;
  contact_parent: string | null;
  archived: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LecteurGrade {
  id: number;
  lecteur_id: string;
  grade_id: number;
  changed_at: string;
}

export interface Presence {
  id: number;
  lecteur_id: string;
  date_samedi: string;
  statut: 'present' | 'absent';
  recorded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Cotisation {
  id: number;
  lecteur_id: string;
  date_samedi: string;
  paye: boolean;
  montant: number;
  paid_at: string | null;
  recorded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Evenement {
  id: string;
  nom: string;
  date_evenement: string;
  lieu: string | null;
  montant_participation: number;
  statut: 'en_cours' | 'termine';
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EvenementParticipant {
  id: number;
  event_id: string;
  lecteur_id: string;
  registered_by: string | null;
  created_at: string;
}

export interface EvenementPaiement {
  id: number;
  event_id: string;
  lecteur_id: string;
  montant: number;
  paye_at: string;
  recorded_by: string | null;
  created_at: string;
}

export interface CaisseOperation {
  id: number;
  event_id: string | null;
  type: 'encaissement' | 'decaissement';
  montant: number;
  motif: string;
  recorded_by: string | null;
  created_at: string;
}

export type TypePermission = 'un_samedi' | 'plusieurs_samedis';

export interface Permission {
  id: string;
  lecteur_id: string;
  type_permission: TypePermission;
  samedis: string[];
  motif: string;
  created_by: string | null;
  created_at: string;
}

export type NatureAppreciation = 'positive' | 'avertissement' | 'blame';

export interface Appreciation {
  id: number;
  lecteur_id: string;
  nature: NatureAppreciation;
  motif: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
  deleted_at: string | null;
}

export interface LogEntry {
  id: number;
  user_id: string | null;
  user_name: string | null;
  user_role: string | null;
  action: string;
  objet_type: string | null;
  objet_ref: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrateur',
  co: 'Chargé des Opérations',
  co_paroissial: 'Chargé des Opérations',
  caissier: 'Caissier',
  responsable: 'Responsable',
};

/**
 * Libellés DÉSAMBIGUÏSÉS, réservés à l'écran d'administration des comptes.
 *
 * `ROLE_LABELS` affiche volontairement le même intitulé pour `co` et
 * `co_paroissial` : vis-à-vis de la communauté, c'est la même fonction.
 *
 * Mais au moment d'ATTRIBUER un rôle, cette égalité devient un piège : la
 * liste déroulante proposait deux entrées « Chargé des Opérations » rigoureusement
 * identiques, et la colonne « Rôle » affichait la même chose pour les deux.
 * L'Administrateur ne pouvait donc ni choisir en connaissance de cause, ni
 * vérifier ce qu'il avait choisi — alors que la différence est réelle : seul
 * `co_paroissial` gère les membres de la fraternité au tarif Animateur.
 */
export const ROLE_LABELS_ADMIN: Record<Role, string> = {
  admin: 'Administrateur',
  co: 'Chargé des Opérations (diocésain)',
  co_paroissial: 'Chargé des Opérations (paroissial) — gère la fraternité Animateur',
  caissier: 'Caissier',
  responsable: 'Responsable',
};

// ---------------------------------------------------------------------------
// Helpers de rôle — à utiliser PARTOUT à la place des comparaisons littérales.
//
// `co_paroissial` est un alias strict de `co` : la base les traite de la même
// façon (`public.is_co()` renvoie vrai pour les deux, migration 20260914150500).
// L'interface doit faire exactement pareil, sinon un CO paroissial a le droit
// en base mais ne voit pas les boutons correspondants.
// ---------------------------------------------------------------------------

/** Administrateur. */
export function estAdmin(role: Role | null | undefined): boolean {
  return role === 'admin';
}

/** Chargé des Opérations — `co` ou son alias `co_paroissial`. */
export function estCO(role: Role | null | undefined): boolean {
  return role === 'co' || role === 'co_paroissial';
}

/** Caissier (saisie des cotisations). */
export function estCaissier(role: Role | null | undefined): boolean {
  return role === 'caissier';
}

/**
 * Chargé des Opérations **paroissial** — le seul libellé habilité sur la
 * fraternité système « Animateur ».
 *
 * Contrairement à `estCO`, ce test n'est PAS un alias : la base distingue
 * strictement les deux libellés sur ce point précis
 * (`changer_fraternite` et `proteger_affectation_animateur`,
 * migration 20261003220000 → `current_role() is distinct from 'co_paroissial'`).
 */
export function estCOParoissial(role: Role | null | undefined): boolean {
  return role === 'co_paroissial';
}

/**
 * Export PDF — cahier des charges §17 : Admin, Chargé des Opérations et
 * Caissiers (les Responsables consultent sans exporter).
 */
export function peutExporter(role: Role | null | undefined): boolean {
  return estAdmin(role) || estCO(role) || estCaissier(role);
}

/** Modification des fiches lecteurs : Admin et Chargé des Opérations. */
export function peutGererLecteurs(role: Role | null | undefined): boolean {
  return estAdmin(role) || estCO(role);
}

/**
 * Ajout / retrait de membres dans une fraternité.
 *
 * Reflète exactement ce que la base autorise, afin qu'aucun bouton visible ne
 * débouche sur un refus RLS (et réciproquement qu'aucun droit réel ne reste
 * invisible dans l'interface) :
 *
 *  - fraternité **ordinaire** : tout compte authentifié — l'appartenance est
 *    une information de vie de groupe, corrigée sur le terrain
 *    (`changer_fraternite`, migration 20260914150600) ;
 *  - fraternité **système « Animateur »** : le **CO paroissial uniquement**,
 *    car entrer ou sortir de cette fraternité recalcule tout l'historique des
 *    cotisations payées (migration 20261003220000).
 *
 * @param systemKey `fraternite.system_key` de la fraternité ciblée.
 */
export function peutGererMembresFraternite(
  role: Role | null | undefined,
  systemKey: Fraternite['system_key']
): boolean {
  if (!role) return false;
  if (systemKey === 'animateur') return estCOParoissial(role);
  return true;
}

/**
 * Déplacer un lecteur de `depuis` vers `vers` : les DEUX extrémités comptent.
 * Sortir quelqu'un d'« Animateur » est aussi réservé au CO paroissial que l'y
 * faire entrer — c'est la règle que `changer_fraternite` applique en base.
 */
export function peutDeplacerEntreFraternites(
  role: Role | null | undefined,
  depuis: Fraternite['system_key'],
  vers: Fraternite['system_key']
): boolean {
  return (
    peutGererMembresFraternite(role, depuis) &&
    peutGererMembresFraternite(role, vers)
  );
}
