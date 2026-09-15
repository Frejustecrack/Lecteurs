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
import { LOGO_CDLJ_BASE64, SAINTE_FAMILLE_BASE64 } from './headerAssets';

const BLEU_CDLJ: [number, number, number] = [26, 86, 219];
const JAUNE_OFFICIEL: [number, number, number] = [255, 217, 102]; // #ffd966 tiré de Document 1.pdf

const LIGNES_OFFICIELLES = [
  'ARCHIDIOCESE DE COTONOU',
  '----------------',
  'ŒUVRE PONTIFICALE DE L’ENFANCE MISSIONNAIRE',
  '----------------',
  'COMMUNAUTE DIOCESAINE DES LECTEURS JUNIORS',
  '----------------',
  'VICARIAT FORAIN BON PASTEUR',
  '----------------',
  'PAROISSE SAINTE FAMILLE D’AKOGBATO',
  '----------------',
  'Tel : 01 69 71 42 42/  01 55 17 46 11/ 01 52 70 61 59',
];

/**
 * En-tête officiel CDLJ, commun à tous les documents de la plateforme
 * (reproduction fidèle du document officiel de référence : Document 1.pdf).
 *
 * S'adapte dynamiquement :
 * - À l'orientation de la page (portrait 210mm ou paysage 297mm)
 * - Aux terminaux (téléphone portable / iOS / Android / ordinateur)
 *   en embarquant les logos en base64 (aucun appel réseau nécessaire).
 */
function entete(
  doc: jsPDF,
  titre: string,
  sousTitre: string,
  utilisateur: string
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const isLandscape = pageWidth > 250;

  // Dimensions et positions adaptatives des deux logos officiels
  const logoW = isLandscape ? 28 : 25;
  const logoH = logoW * (260 / 260); // Ratio 1:1 pour le logo CDLJ
  const logoX = isLandscape ? 14 : 10;
  const logoY = isLandscape ? 6 : 7;

  const stfaW = isLandscape ? 20 : 18;
  const stfaH = stfaW * (350 / 257); // Ratio 1.36 pour l'image Sainte Famille
  const stfaX = pageWidth - (isLandscape ? 14 : 10) - stfaW;
  const stfaY = isLandscape ? 5 : 6;

  // 1. Logos officiels (gauche : CDLJ, droite : Sainte Famille)
  try {
    doc.addImage(LOGO_CDLJ_BASE64, 'JPEG', logoX, logoY, logoW, logoH);
    doc.addImage(SAINTE_FAMILLE_BASE64, 'JPEG', stfaX, stfaY, stfaW, stfaH);
  } catch (err) {
    console.warn('Affichage des logos dans le PDF :', err);
  }

  // 2. Textes officiels centrés (typographie Times Bold comme Document 1.pdf)
  const cx = pageWidth / 2;
  doc.setTextColor(0, 0, 0);
  doc.setFont('times', 'bold');
  const fontSize = isLandscape ? 7.8 : 7.2;
  doc.setFontSize(fontSize);

  const startY = isLandscape ? 8 : 8;
  const lineSpacing = isLandscape ? 3.0 : 2.9;

  for (let i = 0; i < LIGNES_OFFICIELLES.length; i++) {
    doc.text(LIGNES_OFFICIELLES[i], cx, startY + i * lineSpacing, {
      align: 'center',
    });
  }

  // 3. Bandeau doré officiel (#ffd966, épaisseur 1.3 mm)
  const goldY = startY + (LIGNES_OFFICIELLES.length - 1) * lineSpacing + 4;
  doc.setFillColor(JAUNE_OFFICIEL[0], JAUNE_OFFICIEL[1], JAUNE_OFFICIEL[2]);
  doc.rect(0, goldY, pageWidth, 1.3, 'F');

  // 4. Titre du document spécifique (en majuscules, gras, souligné)
  let cursorY = goldY + 6;
  doc.setFont('times', 'bold');
  doc.setFontSize(isLandscape ? 12 : 11.5);
  doc.setTextColor(15, 23, 42); // slate-900
  const titreUpper = titre.toUpperCase();
  doc.text(titreUpper, cx, cursorY, { align: 'center' });

  // Soulignement sous le titre
  const titleWidth = doc.getTextWidth(titreUpper);
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.4);
  doc.line(cx - titleWidth / 2, cursorY + 1.2, cx + titleWidth / 2, cursorY + 1.2);

  // 5. Métadonnées (période, filtres, exportateur, date)
  cursorY += 5;
  const metaParts: string[] = [];
  if (sousTitre) metaParts.push(sousTitre);
  if (utilisateur) metaParts.push(`Exporté par ${utilisateur}`);
  metaParts.push(`Le ${fmtDate(new Date())}`);
  const metaText = metaParts.join('   •   ');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105); // slate-600

  // Si le texte est trop large pour la zone imprimable, répartir sur deux lignes
  const maxW = pageWidth - 24;
  if (doc.getTextWidth(metaText) > maxW) {
    if (sousTitre) {
      doc.text(sousTitre, cx, cursorY, { align: 'center' });
      cursorY += 3.5;
    }
    const infoExport = `Exporté le ${fmtDate(new Date())}${utilisateur ? ` par ${utilisateur}` : ''}`;
    doc.text(infoExport, cx, cursorY, { align: 'center' });
  } else {
    doc.text(metaText, cx, cursorY, { align: 'center' });
  }

  // Retourne la position Y où le tableau ou corps du document commence
  return cursorY + 4;
}

/**
 * Pied de page officiel sur toutes les pages du document.
 * S'adapte dynamiquement à la largeur et hauteur de la page (portrait / paysage).
 */
function piedPage(doc: jsPDF) {
  const n = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184); // slate-400
    doc.text(
      `CDLJ Akogbato — Paroisse Sainte Famille — Document officiel — Page ${i}/${n}`,
      pageWidth / 2,
      pageHeight - 6,
      { align: 'center' }
    );
  }
}

/**
 * Sauvegarde le document PDF de manière fiable quel que soit le terminal
 * (ordinateur de bureau, téléphone mobile Android, iPhone/iPad iOS).
 */
function sauvegarderPdf(doc: jsPDF, nomFichier: string) {
  try {
    doc.save(nomFichier);
  } catch (err) {
    console.warn('doc.save() a échoué, utilisation du fallback Blob :', err);
    try {
      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nomFichier;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1000);
    } catch (e2) {
      console.error('Échec critique de la sauvegarde PDF :', e2);
    }
  }
}

function table(doc: jsPDF, opts: Parameters<typeof autoTable>[1]) {
  autoTable(doc, {
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: BLEU_CDLJ, fontSize: 8 },
    ...opts,
  });
}

// ------------------------------------------------------------------
// 1. Fiche mensuelle des cotisations
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
    `${args.periode ?? moisLabel(annee, mois)}${fraternite ? ` — ${fraternite}` : ' — Vue globale'}`,
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
  sauvegarderPdf(doc, `cdlj_cotisations_${annee}-${String(mois + 1).padStart(2, '0')}.pdf`);
}

// ------------------------------------------------------------------
// 2. Fiche mensuelle des présences
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
    `${args.periode ?? moisLabel(annee, mois)}${fraternite ? ` — ${fraternite}` : ' — Vue globale'}`,
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
  sauvegarderPdf(doc, `cdlj_presences_${annee}-${String(mois + 1).padStart(2, '0')}.pdf`);
}

// ------------------------------------------------------------------
// 3. Bilan d'un événement
// ------------------------------------------------------------------
export function exportEvenementBilan(args: {
  evenement: Evenement;
  participants: { lecteur: Lecteur; paye: number; tranches: EvenementPaiement[] }[];
  totalCollecte: number;
  totalAttendu: number;
  /** Reste à percevoir auprès des participants (facultatif : recalculé sinon). */
  restantAPercevoir?: number;
  /** Encaissements de la caisse de l'événement (hors participations). */
  encaissements?: number;
  /** Décaissements de la caisse de l'événement. */
  decaissements?: number;
  /** Caisse de l'événement : collecté + encaissements − décaissements. */
  soldeCaisse?: number;
  auteur: string;
}) {
  const { evenement: e, participants, totalCollecte, totalAttendu, auteur } = args;
  const restantAPercevoir =
    args.restantAPercevoir ?? Math.max(totalAttendu - totalCollecte, 0);
  const encaissements = args.encaissements ?? 0;
  const decaissements = args.decaissements ?? 0;
  const soldeCaisse =
    args.soldeCaisse ?? totalCollecte + encaissements - decaissements;
  const doc = new jsPDF();
  const y = entete(
    doc,
    'Bilan d\'événement',
    `${e.nom} — ${fmtDate(e.date_evenement)}`,
    auteur
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85);
  doc.text(
    `Lieu : ${e.lieu ?? '—'}   •   Participation : ${fmtMoney(e.montant_participation)}   •   Statut : ${e.statut === 'en_cours' ? 'En cours' : 'Terminé'}   •   Participants : ${participants.length}`,
    doc.internal.pageSize.getWidth() / 2,
    y,
    { align: 'center' }
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

  table(doc, { startY: y + 5, head, body });
  const finY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  const largeur = doc.internal.pageSize.getWidth();

  // Récapitulatif financier — mêmes intitulés que l'écran de l'événement.
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(`Total collecté : ${fmtMoney(totalCollecte)}`, 14, finY);
  doc.text(`Restant à percevoir : ${fmtMoney(restantAPercevoir)}`, 14, finY + 5);
  doc.text(`Total attendu : ${fmtMoney(totalAttendu)}`, 14, finY + 10);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 65, 85);
  doc.text(`Encaissements : ${fmtMoney(encaissements)}`, largeur - 14, finY, {
    align: 'right',
  });
  doc.text(`Décaissements : ${fmtMoney(decaissements)}`, largeur - 14, finY + 5, {
    align: 'right',
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(BLEU_CDLJ[0], BLEU_CDLJ[1], BLEU_CDLJ[2]);
  doc.text(`Caisse de l'événement : ${fmtMoney(soldeCaisse)}`, largeur - 14, finY + 12, {
    align: 'right',
  });

  piedPage(doc);
  sauvegarderPdf(doc, `cdlj_evenement_${e.date_evenement}.pdf`);
}

// ------------------------------------------------------------------
// 4. État de la caisse
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
  const y = entete(doc, 'État de la caisse (générale)', `Période : ${periode}`, auteur);

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
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(51, 65, 85);
  doc.text(`Cotisations du mois : ${fmtMoney(totalPaye)}`, 14, finY);
  doc.text(`Encaissements : ${fmtMoney(totalEnc)}`, 14, finY + 5);
  doc.text(`Décaissements : -${fmtMoney(totalDec)}`, 14, finY + 10);
  doc.setTextColor(BLEU_CDLJ[0], BLEU_CDLJ[1], BLEU_CDLJ[2]);
  doc.setFontSize(10.5);
  doc.text(`Solde général de la caisse : ${fmtMoney(soldeGeneral)}`, 14, finY + 18);
  piedPage(doc);
  sauvegarderPdf(doc, `cdlj_caisse_${periode.replace(/\s/g, '_')}.pdf`);
}

// ------------------------------------------------------------------
// 5. Fiche individuelle d'un lecteur
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
  const y = entete(
    doc,
    'Fiche individuelle du lecteur',
    `Matricule : ${l.matricule} — ${l.prenom} ${l.nom.toUpperCase()}`,
    auteur
  );

  const gradeNom = (id: number) => grades.find((g) => g.id === id)?.nom ?? '—';

  let cursor = y + 2;
  const infos: [string, string][] = [
    ['Matricule', l.matricule],
    ['Nom & Prénom', `${l.nom.toUpperCase()} ${l.prenom}`],
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
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('Historique des grades', 14, cursor);
  cursor += 3;
  table(doc, {
    startY: cursor,
    head: [['Date', 'Grade']],
    body: history.map((h) => [fmtDate(h.changed_at), gradeNom(h.grade_id)]),
  });
  cursor = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  // Présences (12 derniers mois)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('Présences — 12 derniers mois', 14, cursor);
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
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('Cotisations — 12 derniers mois', 14, cursor);
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
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('Événements', 14, cursor);
  cursor += 3;
  table(doc, {
    startY: cursor,
    head: [['Date', 'Événement', 'Lieu']],
    body: evenements.map((e) => [fmtDate(e.date_evenement), e.nom, e.lieu ?? '—']),
  });
  cursor = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  // Appréciations
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('Blâmes, avertissements & appréciations', 14, cursor);
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
  sauvegarderPdf(doc, `cdlj_fiche_${l.matricule}.pdf`);
}

// ------------------------------------------------------------------
// 6. Liste des lecteurs (onglet Lecteurs — reflète les filtres actifs)
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
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(51, 65, 85);
  doc.text(`Total : ${lecteurs.length} lecteur(s)   •   ${filtres}`, 14, finY);
  piedPage(doc);
  const horodatage = new Date().toISOString().slice(0, 10);
  sauvegarderPdf(doc, `cdlj_liste_lecteurs_${statut}_${horodatage}.pdf`);
}
