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
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {items.map((t) => (
          <div
            key={t.id}
            className={`rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg ${
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
      className={`rounded-xl border border-slate-200 border-l-4 bg-white p-4 shadow-sm ${border[tone]}`}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold text-slate-800">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
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
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
        aria-hidden
      />
      <div
        className={`relative z-10 max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl ${
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

export const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-cdlj focus:outline-none focus:ring-2 focus:ring-cdlj/20';

export function BtnPrimary({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded-lg bg-cdlj px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-cdlj-dark disabled:cursor-not-allowed disabled:opacity-50 ${props.className ?? ''}`}
    >
      {children}
    </button>
  );
}

export function BtnGhost({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 ${props.className ?? ''}`}
    >
      {children}
    </button>
  );
}

export function BtnDanger({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded-lg bg-alerte px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${props.className ?? ''}`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- Divers
export function EmptyState({ msg }: { msg: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-10 text-center text-sm text-slate-500">
      {msg}
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
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-slate-500">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
