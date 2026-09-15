import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  dateISO,
  fmtDate,
  fmtMoney,
  moisLabel,
  samediEstArrive,
  samedisArrives,
  samedisDuMois,
} from '../lib/dates';
import type {
  Appreciation,
  Cotisation,
  Evenement,
  EvenementPaiement,
  Fraternite,
  Grade,
  Lecteur,
  LecteurGrade,
  Presence,
} from '../lib/types';

const BLEU: [number, number, number] = [26, 86, 219];

function entete(
  doc: jsPDF,
  titre: string,
  periode: string,
  utilisateur: string
): number {
  doc.setFillColor(BLEU[0], BLEU[1], BLEU[2]);
  doc.rect(0, 0, 210, 24, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text("CDLJ — Paroisse Sainte Famille d'Akogbato", 12, 10);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.text('« Lecteurs, sel et lumière nous sommes »', 12, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Archidiocèse de Cotonou — Bénin', 198, 10, { align: 'right' });
  doc.text(titre, 198, 16, { align: 'right' });
  doc.setTextColor(71, 85, 105);
  doc.setFontSize(8);
  doc.text(
    `Période : ${periode}   •   Exporté le ${fmtDate(new Date())} par ${utilisateur}`,
    12,
    30
  );
  return 34;
}

function piedPage(doc: jsPDF) {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `CDLJ Akogbato — document généré par l'application de gestion — page ${i}/${n}`,
      105,
      291,
      { align: 'center' }
    );
  }
}

function table(doc: jsPDF, opts: Parameters<typeof autoTable>[1]) {
  autoTable(doc, {
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: BLEU, fontSize: 8 },
    ...opts,
  });
}

// ------------------------------------------------------------------
// Fiche mensuelle des cotisations
// ------------------------------------------------------------------
export function exportCotisations(args: {
  annee: number;
  mois: number;
  fraternite: string | null;
  lecteurs: Lecteur[];
  cotisations: Cotisation[];
  montantCot: number;
  auteur: string;
  /** Samedis à exporter (ISO). Par défaut : tous les samedis du mois. */
  samedis?: string[];
  /** Libellé de période (vue hebdomadaire, samedi précis…). */
  periode?: string;
}) {
  const { annee, mois, fraternite, lecteurs, cotisations, montantCot, auteur } = args;
  const doc = new jsPDF({ orientation: 'landscape' });
  const samedisIso = args.samedis ?? samedisDuMois(annee, mois).map(dateISO);
  const map = new Map(cotisations.map((c) => [`${c.lecteur_id}|${c.date_samedi}`, c]));

  const y = entete(
    doc,
    'Fiche des cotisations',
    `${args.periode ?? moisLabel(annee, mois)}${fraternite ? ` — ${fraternite}` : ' — vue globale'}`,
    auteur
  );

  const head = [
    ['Matricule', 'Nom', 'Prénom', ...samedisIso.map((s) => s.slice(5).split('-').reverse().join('/')), 'Total payé', 'Total dû'],
  ];
  const body = lecteurs.map((l) => {
    let paye = 0;
    let du = 0;
    const cells = samedisIso.map((s) => {
      const c = map.get(`${l.id}|${s}`);
      if (c?.paye) {
        paye += c.montant;
        return `${c.montant} F`;
      }
      // Un samedi qui n'est pas encore arrivé ne génère pas de dette.
      if (!samediEstArrive(s)) return '—';
      du += 1;
      return 'Dû';
    });
    return [l.matricule, l.nom.toUpperCase(), l.prenom, ...cells, fmtMoney(paye), fmtMoney(du * montantCot)];
  });

  table(doc, { startY: y, head, body, foot: undefined });
  piedPage(doc);
  doc.save(`cdlj_cotisations_${annee}-${String(mois + 1).padStart(2, '0')}.pdf`);
}

// ------------------------------------------------------------------
// Fiche mensuelle des présences
// ------------------------------------------------------------------
export function exportPresences(args: {
  annee: number;
  mois: number;
  fraternite: string | null;
  lecteurs: Lecteur[];
  presences: Presence[];
  auteur: string;
  /** Samedis à exporter (ISO). Par défaut : tous les samedis du mois. */
  samedis?: string[];
  /** Libellé de période (vue hebdomadaire, samedi précis…). */
  periode?: string;
}) {
  const { annee, mois, fraternite, lecteurs, presences, auteur } = args;
  const doc = new jsPDF({ orientation: 'landscape' });
  const samedisIso = args.samedis ?? samedisDuMois(annee, mois).map(dateISO);
  const map = new Map(presences.map((p) => [`${p.lecteur_id}|${p.date_samedi}`, p]));

  const y = entete(
    doc,
    'Fiche des présences',
    `${args.periode ?? moisLabel(annee, mois)}${fraternite ? ` — ${fraternite}` : ' — vue globale'}`,
    auteur
  );

  const head = [
    ['Matricule', 'Nom', 'Prénom', ...samedisIso.map((s) => s.slice(5).split('-').reverse().join('/')), 'Présents', 'Absents'],
  ];
  const body = lecteurs.map((l) => {
    let pres = 0;
    let abs = 0;
    const cells = samedisIso.map((s) => {
      const p = map.get(`${l.id}|${s}`);
      // À preuve du contraire : un samedi arrivé non pointé compte comme absent.
      if (p?.statut === 'present') {
        pres++;
        return '✓';
      }
      if (p?.statut === 'absent' || samediEstArrive(s)) {
        abs++;
        return '✗';
      }
      return '—';
    });
    return [l.matricule, l.nom.toUpperCase(), l.prenom, ...cells, String(pres), String(abs)];
  });

  table(doc, { startY: y, head, body });
  piedPage(doc);
  doc.save(`cdlj_presences_${annee}-${String(mois + 1).padStart(2, '0')}.pdf`);
}

// ------------------------------------------------------------------
// Bilan d'un événement
// ------------------------------------------------------------------
export function exportEvenementBilan(args: {
  evenement: Evenement;
  participants: { lecteur: Lecteur; paye: number; tranches: EvenementPaiement[] }[];
  totalCollecte: number;
  totalAttendu: number;
  auteur: string;
}) {
  const { evenement: e, participants, totalCollecte, totalAttendu, auteur } = args;
  const doc = new jsPDF();
  const y = entete(
    doc,
    'Bilan d\'événement',
    `${e.nom} — ${fmtDate(e.date_evenement)}`,
    auteur
  );

  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  doc.text(
    `Lieu : ${e.lieu ?? '—'}   •   Participation : ${fmtMoney(e.montant_participation)}   •   Statut : ${e.statut === 'en_cours' ? 'En cours' : 'Terminé'}   •   Participants : ${participants.length}`,
    12,
    y + 2
  );

  const head = [
    ['Matricule', 'Nom', 'Prénom', 'Tranches payées', 'Total payé', 'Restant', 'Statut'],
  ];
  const body = participants.map(({ lecteur: l, paye, tranches }) => {
    const restant = Math.max(e.montant_participation - paye, 0);
    const statut =
      e.montant_participation > 0 && paye >= e.montant_participation
        ? 'Solde réglé'
        : paye > 0
          ? 'Paiement partiel'
          : 'Non payé';
    return [
      l.matricule,
      l.nom.toUpperCase(),
      l.prenom,
      tranches.map((t) => `${fmtDate(t.paye_at)} : ${fmtMoney(t.montant)}`).join('  •  ') || '—',
      fmtMoney(paye),
      fmtMoney(restant),
      statut,
    ];
  });

  table(doc, { startY: y + 6, head, body });
  const finY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(
    `Total collecté : ${fmtMoney(totalCollecte)}   •   Total restant : ${fmtMoney(Math.max(totalAttendu - totalCollecte, 0))}   •   Attendu : ${fmtMoney(totalAttendu)}`,
    12,
    finY
  );
  piedPage(doc);
  doc.save(`cdlj_evenement_${e.date_evenement}.pdf`);
}

// ------------------------------------------------------------------
// État de la caisse
// ------------------------------------------------------------------
export function exportCaisse(args: {
  periode: string;
  lignes: { date: string; type: string; libelle: string; montant: number; auteur: string }[];
  totalPaye: number;
  totalEnc: number;
  totalDec: number;
  soldeGeneral: number;
  auteur: string;
}) {
  const { periode, lignes, totalPaye, totalEnc, totalDec, soldeGeneral, auteur } = args;
  const doc = new jsPDF();
  const y = entete(doc, 'État de la caisse (générale)', periode, auteur);

  const head = [['Date', 'Type', 'Libellé', 'Auteur', 'Montant']];
  const body = lignes.map((l) => [
    fmtDate(l.date),
    l.type === 'cotisation' ? 'Cotisation' : l.type === 'encaissement' ? 'Encaissement' : 'Décaissement',
    l.libelle,
    l.auteur,
    `${l.type === 'decaissement' ? '-' : ''}${fmtMoney(l.montant)}`,
  ]);

  table(doc, { startY: y, head, body });
  const finY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(51, 65, 85);
  doc.text(`Cotisations du mois : ${fmtMoney(totalPaye)}`, 12, finY);
  doc.text(`Encaissements : ${fmtMoney(totalEnc)}`, 12, finY + 6);
  doc.text(`Décaissements : -${fmtMoney(totalDec)}`, 12, finY + 12);
  doc.setTextColor(26, 86, 219);
  doc.setFontSize(11);
  doc.text(`Solde général de la caisse : ${fmtMoney(soldeGeneral)}`, 12, finY + 20);
  piedPage(doc);
  doc.save(`cdlj_caisse_${periode.replace(/\s/g, '_')}.pdf`);
}

// ------------------------------------------------------------------
// Fiche individuelle d'un lecteur
// ------------------------------------------------------------------
export function exportFicheLecteur(args: {
  lecteur: Lecteur;
  grades: Grade[];
  history: LecteurGrade[];
  presences: Presence[];
  cotisations: Cotisation[];
  evenements: Evenement[];
  appreciations: Appreciation[];
  auteur: string;
  montantCot: number;
}) {
  const { lecteur: l, grades, history, presences, cotisations, evenements, appreciations, auteur, montantCot } =
    args;
  const doc = new jsPDF();
  const y = entete(doc, 'Fiche individuelle du lecteur', l.matricule, auteur);

  const gradeNom = (id: number) => grades.find((g) => g.id === id)?.nom ?? '—';

  let cursor = y + 2;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(`${l.prenom} ${l.nom.toUpperCase()}`, 12, cursor);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  cursor += 5;
  const infos: [string, string][] = [
    ['Date de naissance', fmtDate(l.date_naissance)],
    ['Grade actuel', gradeNom(l.grade_id)],
    ['Année d\'adhésion', String(l.annee_adhesion ?? '—')],
    ['Adresse', l.adresse ?? '—'],
    ['Contact parent / tuteur', l.contact_parent ?? '—'],
    ['Statut', l.archived ? 'Archivé' : 'Actif'],
  ];
  table(doc, { startY: cursor, body: infos, theme: 'plain' });
  cursor = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  // Historique des grades
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Historique des grades', 12, cursor);
  cursor += 3;
  table(doc, {
    startY: cursor,
    head: [['Date', 'Grade']],
    body: history.map((h) => [fmtDate(h.changed_at), gradeNom(h.grade_id)]),
  });
  cursor = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  // Présences (12 derniers mois)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Présences — 12 derniers mois', 12, cursor);
  cursor += 3;
  const now = new Date();
  const rows: string[][] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    // Seuls les samedis déjà arrivés sont comptabilisés.
    const sam = samedisArrives(
      samedisDuMois(d.getFullYear(), d.getMonth()).map(dateISO)
    );
    const p = presences.filter((x) => sam.includes(x.date_samedi));
    const pres = p.filter((x) => x.statut === 'present').length;
    // À preuve du contraire : un samedi arrivé non pointé compte comme absent.
    rows.push([
      d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
      String(pres),
      String(Math.max(sam.length - pres, 0)),
    ]);
  }
  table(doc, {
    startY: cursor,
    head: [['Mois', 'Présents', 'Absents']],
    body: rows,
  });
  cursor = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  // Cotisations (12 derniers mois)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Cotisations — 12 derniers mois', 12, cursor);
  cursor += 3;
  const rowsC: string[][] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const sam = samedisArrives(
      samedisDuMois(d.getFullYear(), d.getMonth()).map(dateISO)
    );
    const c = cotisations.filter((x) => sam.includes(x.date_samedi));
    const paye = c.filter((x) => x.paye).reduce((s, x) => s + x.montant, 0);
    // Les samedis à venir ne génèrent aucune dette.
    const du = Math.max(sam.length - c.filter((x) => x.paye).length, 0) * montantCot;
    rowsC.push([
      d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
      fmtMoney(paye),
      fmtMoney(du),
    ]);
  }
  table(doc, {
    startY: cursor,
    head: [['Mois', 'Payé', 'Dû']],
    body: rowsC,
  });
  cursor = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  // Événements
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Événements', 12, cursor);
  cursor += 3;
  table(doc, {
    startY: cursor,
    head: [['Date', 'Événement', 'Lieu']],
    body: evenements.map((e) => [fmtDate(e.date_evenement), e.nom, e.lieu ?? '—']),
  });
  cursor = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  // Appréciations
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Blâmes, avertissements & appréciations', 12, cursor);
  cursor += 3;
  table(doc, {
    startY: cursor,
    head: [['Date', 'Nature', 'Motif']],
    body: appreciations.map((a) => [
      fmtDate(a.created_at),
      a.nature === 'positive' ? 'Appréciation' : a.nature === 'blame' ? 'Blâme' : 'Avertissement',
      a.motif,
    ]),
  });

  piedPage(doc);
  doc.save(`cdlj_fiche_${l.matricule}.pdf`);
}

// ------------------------------------------------------------------
// Liste des lecteurs (onglet Lecteurs — reflète les filtres actifs)
// ------------------------------------------------------------------
export function exportListeLecteurs(args: {
  lecteurs: Lecteur[];
  grades: Grade[];
  fraternites: Fraternite[];
  /** Nom de la fraternité filtrée, ou null si « toutes ». */
  fraternite: string | null;
  /** Nom du grade filtré, ou null si « tous ». */
  grade: string | null;
  /** Texte de recherche saisi (matricule, nom…), '' si aucun. */
  recherche: string;
  statut: 'actifs' | 'archives';
  auteur: string;
}) {
  const { lecteurs, grades, fraternites, fraternite, grade, recherche, statut, auteur } =
    args;
  const doc = new jsPDF({ orientation: 'landscape' });
  const gradeNom = (id: number) =>
    grades.find((g) => g.id === id)?.nom ?? '—';
  const fraterniteNom = (id: string | null) =>
    fraternites.find((f) => f.id === id)?.nom ?? '—';

  const filtres = [
    statut === 'actifs' ? 'Actifs' : 'Archivés',
    fraternite ?? 'Toutes les fraternités',
    grade ?? 'Tous les grades',
    recherche ? `Recherche : « ${recherche} »` : null,
  ]
    .filter(Boolean)
    .join('  •  ');

  const y = entete(
    doc,
    'Liste des lecteurs',
    `${filtres} — ${lecteurs.length} lecteur(s)`,
    auteur
  );

  const tries = [...lecteurs].sort((a, b) =>
    a.matricule.localeCompare(b.matricule)
  );
  const head = [
    [
      'N°',
      'Matricule',
      'Nom',
      'Prénom',
      'Grade',
      'Fraternité',
      'Naissance',
      'Adhésion',
      'Contact parent / tuteur',
    ],
  ];
  const body = tries.map((l, i) => [
    String(i + 1),
    l.matricule,
    l.nom.toUpperCase(),
    l.prenom,
    gradeNom(l.grade_id),
    fraterniteNom(l.fraternite_id),
    fmtDate(l.date_naissance),
    l.annee_adhesion ? String(l.annee_adhesion) : '—',
    l.contact_parent ?? '—',
  ]);

  table(doc, {
    startY: y,
    head,
    body,
    columnStyles: {
      0: { halign: 'right', cellWidth: 12 },
      1: { cellWidth: 24 },
      6: { halign: 'center' },
      7: { halign: 'center' },
    },
  });
  const finY =
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
      .finalY + 6;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(51, 65, 85);
  doc.text(`Total : ${lecteurs.length} lecteur(s) — ${filtres}`, 12, finY);
  piedPage(doc);
  const horodatage = new Date().toISOString().slice(0, 10);
  doc.save(`cdlj_liste_lecteurs_${statut}_${horodatage}.pdf`);
}
