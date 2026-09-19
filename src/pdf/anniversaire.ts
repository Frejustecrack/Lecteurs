import jsPDF from 'jspdf';
import fondUrl from '../assets/anniversaires/fond.jpg?url';
import { anniversaireValide, messagesAnniversaire, nomFichierAnniversaire, type Anniversaire } from '../lib/anniversaires';

// Rapport exact du JPEG officiel, pas de déformation ni de recadrage.
// 240 × 135,529 mm : environ 288 ppp pour l'image d'origine 2720 × 1536.
export const LARGEUR_CARTE = 240;
export const HAUTEUR_CARTE = LARGEUR_CARTE * 1536 / 2720;
const facteur = LARGEUR_CARTE / 1568;

type Zone = { x: number; y: number; largeur: number; hauteur: number };
export interface TextePlace extends Zone {
  texte: string;
  lignes: string[];
  taille: number;
  largeurTexte: number;
  hauteurTexte: number;
}

/** Ajustement mesuré, sans ellipse : centré, retours à la ligne, taille bornée. */
function texteDansZone(doc: jsPDF, texte: string, pixels: Zone, tailleMax: number, tailleMin: number): TextePlace {
  const zone = Object.fromEntries(Object.entries(pixels).map(([k, v]) => [k, v * facteur])) as Zone;
  const propre = texte.replace(/\s+/g, ' ').trim();
  for (let taille = tailleMax; taille >= tailleMin; taille -= 0.25) {
    doc.setFontSize(taille);
    const lignes = doc.splitTextToSize(propre, zone.largeur - 1) as string[];
    const interligne = taille / doc.internal.scaleFactor * 1.15;
    const hauteurTexte = lignes.length * interligne;
    const largeurTexte = Math.max(...lignes.map((ligne) => doc.getTextWidth(ligne)));
    if (hauteurTexte <= zone.hauteur && largeurTexte <= zone.largeur + 0.01) {
      const debut = zone.y + (zone.hauteur - hauteurTexte) / 2 + taille / doc.internal.scaleFactor * 0.85;
      lignes.forEach((ligne, i) => doc.text(ligne, zone.x + zone.largeur / 2, debut + i * interligne, { align: 'center' }));
      return { ...zone, texte: propre, lignes, taille, largeurTexte, hauteurTexte };
    }
  }
  // Une donnée démesurée ne doit jamais produire une carte tronquée/illisible.
  throw new Error('Ce nom est trop long pour la zone de la carte. Vérifiez la fiche du lecteur.');
}

/** Fonction testable sans DOM : le fond fourni est le JPEG officiel préparé. */
export function creerCarteAnniversaire(lecteur: Anniversaire, fond: Uint8Array) {
  if (!anniversaireValide(lecteur)) throw new Error('Informations d’anniversaire invalides.');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [LARGEUR_CARTE, HAUTEUR_CARTE], compress: true });
  doc.setProperties({ title: `Anniversaire — ${lecteur.prenom} ${lecteur.nom} — ${lecteur.annee}`, author: 'Lecteurs Juniors — Paroisse Sainte-Famille d’Akogbato' });
  doc.addImage(fond, 'JPEG', 0, 0, LARGEUR_CARTE, HAUTEUR_CARTE, 'template-officiel');
  const textes: TextePlace[] = [];
  // Le JPEG ne fournit aucune police éditable. Times conserve le style à
  // empattements du modèle ; le titre et l'en-tête originaux restent intacts.
  doc.setFont('times', 'italic');
  doc.setTextColor(163, 128, 53);
  textes.push(texteDansZone(doc, `${lecteur.age_atteint}${lecteur.age_atteint === 1 ? 'er' : 'e'}`,
    { x: 844, y: 321, largeur: 150, hauteur: 65 }, 38, 20));
  textes.push(texteDansZone(doc, `${lecteur.age_atteint} ${lecteur.age_atteint > 1 ? 'ans' : 'an'}`,
    { x: 854, y: 389, largeur: 130, hauteur: 25 }, 9.5, 8));
  doc.setFont('times', 'bold');
  doc.setTextColor(102, 65, 10);
  textes.push(texteDansZone(doc, `${lecteur.prenom} ${lecteur.nom}`.toLocaleUpperCase('fr'),
    { x: 455, y: 501, largeur: 665, hauteur: 77 }, 24, 7.25));
  doc.setFont('times', 'normal');
  doc.setTextColor(28, 23, 18);
  const zones: Zone[] = [
    { x: 470, y: 586, largeur: 720, hauteur: 89 },
    { x: 507, y: 689, largeur: 690, hauteur: 66 },
    { x: 443, y: 766, largeur: 774, hauteur: 63 },
  ];
  messagesAnniversaire().forEach((texte, i) => textes.push(texteDansZone(doc, texte, zones[i], 11.5, 8.5)));
  doc.setTextColor(83, 66, 34);
  textes.push(texteDansZone(doc, String(lecteur.annee), { x: 1468, y: 814, largeur: 53, hauteur: 23 }, 8, 7));
  return { doc, textes, nomFichier: nomFichierAnniversaire(lecteur) };
}

let fondCharge: Promise<Uint8Array> | undefined;

/** Chargement à la demande, mutualisé entre les téléchargements successifs. */
export async function telechargerCarteAnniversaire(lecteur: Anniversaire): Promise<void> {
  fondCharge ??= fetch(fondUrl).then(async (r) => {
    if (!r.ok) throw new Error('Le template de la carte n’a pas pu être chargé. Réessayez.');
    return new Uint8Array(await r.arrayBuffer());
  }).catch((error) => { fondCharge = undefined; throw error; });
  const { doc, nomFichier } = creerCarteAnniversaire(lecteur, await fondCharge);
  doc.save(nomFichier);
}
