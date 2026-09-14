import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Filet de sécurité : évite l'écran blanc en cas d'erreur au démarrage
 * (configuration manquante, base injoignable…). Le message affiché reste
 * compréhensible par un utilisateur non développeur ; le détail technique
 * part dans la console du navigateur.
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[CDLJ] erreur applicative :', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const nonConfigure =
      /supabase.*(url|key)|Missing Supabase|import\.meta\.env/i.test(error.message);

    return (
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
          <div className="text-3xl">{nonConfigure ? '⚙️' : '⚠️'}</div>
          <h1 className="mt-2 text-lg font-bold text-slate-800">
            {nonConfigure
              ? "L'application n'est pas encore connectée à la base"
              : "L'application a rencontré un problème"}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            {nonConfigure ? (
              <>
                Les variables d'accès à Supabase sont absentes. Copiez{' '}
                <code className="rounded bg-white px-1">.env.example</code> en{' '}
                <code className="rounded bg-white px-1">.env</code> puis renseignez{' '}
                <code className="rounded bg-white px-1">VITE_SUPABASE_URL</code> et{' '}
                <code className="rounded bg-white px-1">
                  VITE_SUPABASE_PUBLISHABLE_KEY
                </code>
                , et relancez l'application.
              </>
            ) : (
              <>
                Rechargez la page. Si le problème persiste, notez l'heure et
                prévenez l'Administrateur système.
              </>
            )}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-cdlj px-4 py-2 text-sm font-semibold text-white shadow-sm transition-transform duration-150 hover:bg-cdlj-dark active:scale-[0.96]"
          >
            Recharger la page
          </button>
        </div>
      </div>
    );
  }
}
