export type Role = 'admin' | 'co' | 'caissier' | 'responsable';

export interface Profile {
  id: string;
  full_name: string | null;
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
  caissier: 'Caissier',
  responsable: 'Responsable',
};
