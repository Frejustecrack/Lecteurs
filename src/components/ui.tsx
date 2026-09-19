import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';

// ---------------------------------------------------------------- Toast
interface ToastItem {
  id: number;
  msg: string;
  type: 'ok' | 'err';
}

const ToastContext = createContext<{
  toast: (msg: string, type?: 'ok' | 'err') => void;
}>({ toast: () => {} });

let toastId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    const id = ++toastId;
    setItems((l) => [...l, { id, msg, type }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), 4500);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 left-4 right-4 z-50 flex flex-col gap-2 pb-[env(safe-area-inset-bottom)] sm:left-auto sm:max-w-sm sm:pb-0">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.type === 'ok' ? 'status' : 'alert'}
            className={`cdlj-toast rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg ${
              t.type === 'ok' ? 'bg-emerald-600' : 'bg-alerte'
            }`}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// ---------------------------------------------------------------- Spinner
export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-slate-500">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-cdlj border-t-transparent" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- Badge
export function Badge({
  children,
  tone = 'gray',
}: {
  children: ReactNode;
  tone?: 'gray' | 'blue' | 'green' | 'red' | 'amber';
}) {
  const tones: Record<string, string> = {
    gray: 'bg-slate-100 text-slate-700',
    blue: 'bg-blue-50 text-cdlj',
    green: 'bg-emerald-50 text-emerald-700',
    red: 'bg-red-50 text-alerte',
    amber: 'bg-amber-50 text-amber-700',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- StatCard
export function StatCard({
  label,
  value,
  sub,
  tone = 'blue',
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: 'blue' | 'green' | 'red' | 'amber';
}) {
  const border: Record<string, string> = {
    blue: 'border-l-cdlj',
    green: 'border-l-emerald-500',
    red: 'border-l-alerte',
    amber: 'border-l-amber-500',
  };
  return (
    <div
      className={`group h-full min-w-0 rounded-2xl border border-slate-200/70 border-l-4 bg-white p-4 shadow-sm backdrop-blur-sm transition-all duration-200 hover:shadow-md hover:-translate-y-[1px] hover:border-slate-300 ${border[tone]}`}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 break-words text-xl font-bold tracking-tight text-slate-800 sm:text-2xl">
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs leading-relaxed text-slate-500">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Modal
export function Modal({
  open,
  title,
  onClose,
  children,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div
        className="cdlj-backdrop absolute inset-0 bg-slate-900/30 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`cdlj-modal relative z-10 max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl ring-1 ring-slate-200 sm:rounded-2xl sm:pb-5 ${
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Fermer"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Champs de formulaire
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

/**
 * Classe de base des champs de saisie.
 * `text-base sm:text-sm` : 16 px sur téléphone, car iOS zoome automatiquement
 * dans la page dès qu'un champ fait moins de 16 px au moment de la prise de
 * focus — ce qui décale toute l'interface sous le clavier.
 */
export const inputCls =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base sm:text-sm shadow-sm placeholder:text-slate-400 focus:border-cdlj focus:outline-none focus:ring-2 focus:ring-cdlj/20 focus:shadow-md transition-all';

/**
 * Classes de « retour au clic » partagées par tous les boutons de l'application :
 *  - `active:scale-…`  → le bouton s'enfonce visiblement sous le doigt / la souris ;
 *  - `touch-manipulation` → supprime le délai de double-tap sur mobile ;
 *  - `focus-visible:ring` → repère clavier visible sans polluer le clic souris.
 */
export const pressCls =
  'select-none touch-manipulation will-change-transform transition-[transform,box-shadow,background-color,color,border-color] duration-150 ease-out active:scale-[0.96] active:duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cdlj/45 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50';

/** Petit bouton « icône » (flèches de mois, fermeture…) avec le même ressenti. */
export const iconPressCls =
  'select-none touch-manipulation rounded-xl border border-slate-200 bg-white shadow-sm transition-all duration-150 ease-out hover:bg-slate-50 hover:shadow hover:border-slate-300 active:scale-[0.92] active:duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cdlj/45 disabled:pointer-events-none disabled:opacity-40';

/** Petit spinner blanc/bleu affiché dans un bouton occupé. */
export function BtnSpinner({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 ${
        tone === 'light'
          ? 'border-white/70 border-t-transparent'
          : 'border-cdlj border-t-transparent'
      }`}
    />
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Affiche un spinner et bloque le bouton pendant l'opération. */
  busy?: boolean;
  /** Texte affiché à la place du libellé pendant l'opération. */
  busyLabel?: string;
};

function Contenu({
  busy,
  busyLabel,
  children,
  tone,
}: Pick<BtnProps, 'busy' | 'busyLabel' | 'children'> & { tone: 'light' | 'dark' }) {
  return (
    <span className="flex items-center justify-center gap-2">
      {busy && <BtnSpinner tone={tone} />}
      {busy ? (busyLabel ?? 'En cours…') : children}
    </span>
  );
}

export function BtnPrimary({
  children,
  busy,
  busyLabel,
  disabled,
  ...props
}: BtnProps) {
  return (
    <button
      {...props}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`rounded-xl bg-gradient-to-br from-cdlj to-cdlj-dark px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-cdlj/20 ring-1 ring-cdlj/10 hover:shadow-md hover:from-cdlj-dark hover:to-cdlj active:shadow-none ${pressCls} ${props.className ?? ''}`}
    >
      <Contenu busy={busy} busyLabel={busyLabel} tone="light">
        {children}
      </Contenu>
    </button>
  );
}

export function BtnGhost({
  children,
  busy,
  busyLabel,
  disabled,
  ...props
}: BtnProps) {
  return (
    <button
      {...props}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 hover:border-slate-300 hover:shadow active:bg-slate-100 ${pressCls} ${props.className ?? ''}`}
    >
      <Contenu busy={busy} busyLabel={busyLabel} tone="dark">
        {children}
      </Contenu>
    </button>
  );
}

export function BtnDanger({
  children,
  busy,
  busyLabel,
  disabled,
  ...props
}: BtnProps) {
  return (
    <button
      {...props}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`rounded-xl bg-alerte px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-alerte/20 ring-1 ring-alerte/10 hover:opacity-95 hover:shadow active:shadow-none ${pressCls} ${props.className ?? ''}`}
    >
      <Contenu busy={busy} busyLabel={busyLabel} tone="light">
        {children}
      </Contenu>
    </button>
  );
}

/**
 * Action destructive secondaire (suppression) : même gravité que `BtnDanger`
 * mais en contour, pour que l'action définitive ressorte et qu'un clic par
 * inadvertance soit moins probable.
 */
export function BtnDangerGhost({
  children,
  busy,
  busyLabel,
  disabled,
  ...props
}: BtnProps) {
  return (
    <button
      {...props}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`rounded-xl border border-alerte/40 bg-white px-4 py-2 text-sm font-semibold text-alerte shadow-sm hover:border-alerte hover:bg-red-50 active:bg-red-100 ${pressCls} ${props.className ?? ''}`}
    >
      <Contenu busy={busy} busyLabel={busyLabel} tone="dark">
        {children}
      </Contenu>
    </button>
  );
}

// ---------------------------------------------------------------- Divers
export function EmptyState({ msg }: { msg: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-10 text-center backdrop-blur-sm">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400">∅</div>
      <div className="mt-3 text-sm font-medium text-slate-600">{msg}</div>
      <div className="mt-1 text-xs text-slate-400">Aucune donnée à afficher pour cette vue.</div>
    </div>
  );
}

export function PageHeader({
  title,
  sub,
  actions,
}: {
  title: string;
  sub?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-extrabold tracking-tight text-slate-800 sm:text-2xl">{title}</h1>
        {sub && <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">{sub}</p>}
      </div>
      {/* `cdlj-actions` : grille 2 colonnes pleine largeur sur téléphone,
          ligne alignée à droite dès la tablette (voir index.css). */}
      {actions && <div className="cdlj-actions">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Segmented
/**
 * Groupe de boutons à choix unique (onglets / filtres).
 * Utilisé partout où l'on bascule entre deux ou plusieurs vues.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T;
  options: { value: T; label: string; icon?: string }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm';
  return (
    <div
      role="tablist"
      className="inline-flex w-full rounded-xl border border-slate-200 bg-slate-50 p-1 shadow-inner sm:w-auto"
    >
      {options.map((o) => {
        const actif = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={actif}
            onClick={() => onChange(o.value)}
            className={`${pressCls} ${pad} min-w-0 flex-1 whitespace-normal break-words rounded-lg font-semibold sm:flex-none sm:whitespace-nowrap transition-all ${
              actif ? 'bg-cdlj text-white shadow-sm shadow-cdlj/20' : 'text-slate-600 hover:text-slate-800 hover:bg-white/60'
            }`}
          >
            {o.icon ? <span className="mr-1">{o.icon}</span> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- MonthNav
/** Navigation précédent / suivant réutilisable (mois, semaine…). */
export function StepNav({
  onPrev,
  onNext,
  label,
  width = 'min-w-[150px]',
}: {
  onPrev: () => void;
  onNext: () => void;
  label: string;
  width?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={onPrev}
        aria-label="Précédent"
        className={`${iconPressCls} px-3 py-2 text-sm font-semibold`}
      >
        ←
      </button>
      <span className={`${width} px-1 text-center text-sm font-bold text-slate-700`}>
        {label}
      </span>
      <button
        onClick={onNext}
        aria-label="Suivant"
        className={`${iconPressCls} px-3 py-2 text-sm font-semibold`}
      >
        →
      </button>
    </div>
  );
}

// ------------------------------------------------- Champ mot de passe (œil)
/**
 * Classes d'un `input` mot de passe : `inputCls` + la réserve à droite pour le
 * bouton œil, qui est positionné en absolu par-dessus le champ.
 */
export const pwInputCls = `${inputCls} pr-11`;

/**
 * Bouton « œil » qui révèle / masque un mot de passe.
 *
 * À placer en `absolute` à droite d'un champ `relative` portant `pwInputCls`.
 * `type="button"` : il ne doit jamais soumettre le formulaire qui l'entoure.
 * Icônes en SVG inline (l'application n'embarque aucune librairie d'icônes).
 */
export function EyeToggle({
  shown,
  onToggle,
  label,
}: {
  /** true = le mot de passe est actuellement visible */
  shown: boolean;
  onToggle: () => void;
  /** Libellé accessible, personnalisé si plusieurs champs sur la même page */
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label ?? (shown ? 'Masquer le mot de passe' : 'Afficher le mot de passe')}
      aria-pressed={shown}
      title={shown ? 'Masquer' : 'Afficher'}
      className={`absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cdlj/45 ${pressCls}`}
    >
      {shown ? (
        /* Œil barré */
        <svg
          aria-hidden
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.8}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88"
          />
        </svg>
      ) : (
        /* Œil ouvert */
        <svg
          aria-hidden
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.8}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
          />
        </svg>
      )}
    </button>
  );
}
