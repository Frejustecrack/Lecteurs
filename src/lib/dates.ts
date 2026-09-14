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

// ---------------------------------------------------------------------------
// Semaines — utilisées par le module « Suivis » (vue hebdomadaire).
// Une semaine va du lundi au dimanche ; le groupe se réunissant le samedi,
// une semaine contient au plus un samedi de séance.
// ---------------------------------------------------------------------------

/** Lundi de la semaine contenant `d` (à minuit). */
export function lundiDeSemaine(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = r.getDay(); // 0 = dimanche … 6 = samedi
  const delta = dow === 0 ? -6 : 1 - dow;
  r.setDate(r.getDate() + delta);
  return r;
}

/** Dimanche de la semaine contenant `d` (à minuit). */
export function dimancheDeSemaine(d: Date): Date {
  const l = lundiDeSemaine(d);
  l.setDate(l.getDate() + 6);
  return l;
}

/** Les samedis contenus dans la semaine de `d` (0 ou 1 samedi). */
export function samedisSemaine(d: Date): Date[] {
  const res: Date[] = [];
  const cur = lundiDeSemaine(d);
  for (let i = 0; i < 7; i++) {
    if (cur.getDay() === 6) res.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return res;
}

/** Semaine précédente ou suivante (delta = -1 / +1). */
export function deplaceSemaine(d: Date, delta: number): Date {
  const r = lundiDeSemaine(d);
  r.setDate(r.getDate() + 7 * delta);
  return r;
}

/** Numéro ISO de la semaine. */
export function numeroSemaine(d: Date): number {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() + 4 - (t.getDay() || 7));
  const debutAn = new Date(t.getFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - debutAn.getTime()) / 86400000 + 1) / 7);
}

/** « Semaine 37 — 08/09 au 14/09/2026 ». */
export function semaineLabel(d: Date): string {
  const l = lundiDeSemaine(d);
  const dim = dimancheDeSemaine(d);
  const f = (x: Date) =>
    `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}`;
  return `Semaine ${numeroSemaine(d)} — ${f(l)} au ${f(dim)}/${dim.getFullYear()}`;
}

/** Vrai si la semaine contient aujourd'hui. */
export function estSemaineCourante(d: Date): boolean {
  return dateISO(lundiDeSemaine(d)) === dateISO(lundiDeSemaine(new Date()));
}

// ---------------------------------------------------------------------------
// Samedis « arrivés » — règle CDLJ :
//   un samedi qui n'est pas encore arrivé n'est pas pris en compte.
//   On ne raisonne que sur les samedis passés et le samedi du jour.
// ---------------------------------------------------------------------------

/** Vrai si le samedi est arrivé (aujourd'hui ou avant), faux s'il est à venir. */
export function samediEstArrive(dateSamedi: string | Date): boolean {
  const d =
    typeof dateSamedi === 'string'
      ? new Date(`${dateSamedi}T12:00:00`)
      : new Date(dateSamedi);
  if (isNaN(d.getTime())) return false;
  d.setHours(0, 0, 0, 0);
  const auj = new Date();
  auj.setHours(0, 0, 0, 0);
  return d.getTime() <= auj.getTime();
}

/** Ne conserve que les samedis déjà arrivés (passés ou en cours). */
export function samedisArrives(samedis: string[]): string[] {
  return samedis.filter(samediEstArrive);
}
