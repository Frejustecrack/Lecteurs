// Utilitaires de dates — le calcul se fait dans le fuseau de l'utilisateur
// (l'app est utilisée au Bénin, Africa/Lagos).

export function dateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const j = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${j}`;
}

/** Les samedis réels d'un mois (3, 4 ou 5). */
export function samedisDuMois(annee: number, mois: number): Date[] {
  const res: Date[] = [];
  const d = new Date(annee, mois, 1);
  while (d.getMonth() === mois) {
    if (d.getDay() === 6) res.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return res;
}

/** Dernier samedi (aujourd'hui si nous sommes samedi). */
export function dernierSamedi(): Date {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  const dow = t.getDay(); // 0 = dimanche … 6 = samedi
  const offset = dow === 6 ? 0 : dow === 0 ? 1 : dow + 1;
  t.setDate(t.getDate() - offset);
  return t;
}

/** Un samedi est "gelé" une fois qu'il est passé (verrou depuis dimanche 00:00). */
export function estGelee(date: Date): boolean {
  return date.getTime() < dernierSamedi().getTime();
}

export function moisLabel(annee: number, mois: number): string {
  const s = new Date(annee, mois, 1).toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function deplaceMois(
  annee: number,
  mois: number,
  delta: number
): { annee: number; mois: number } {
  const d = new Date(annee, mois + delta, 1);
  return { annee: d.getFullYear(), mois: d.getMonth() };
}

export function fmtDate(s: string | Date | null | undefined): string {
  if (!s) return '—';
  const d = typeof s === 'string' ? new Date(s) : s;
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function fmtDateHeure(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('fr-FR') + ' F';
}

export function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}
