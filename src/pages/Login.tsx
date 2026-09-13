import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { BtnPrimary, Field, inputCls } from '../components/ui';

export default function Login() {
  const { user, profile, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (err) {
        setError(
          err.message === 'Invalid login credentials'
            ? 'Email ou mot de passe incorrect.'
            : err.message
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-cdlj text-3xl font-extrabold text-white shadow-lg">
            C
          </div>
          <h1 className="mt-4 text-2xl font-extrabold text-slate-800">
            CDLJ <span className="text-cdlj">Akogbato</span>
          </h1>
          <p className="mt-1 text-sm italic text-slate-500">
            « Lecteurs, sel et lumière nous sommes »
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Paroisse Sainte Famille d'Akogbato — Archidiocèse de Cotonou
          </p>
        </div>

        <form
          onSubmit={submit}
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <div className="space-y-4">
            <Field label="Adresse email">
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
                placeholder="nom@exemple.com"
              />
            </Field>
            <Field label="Mot de passe">
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
                placeholder="••••••••"
              />
            </Field>
            {error && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-alerte">
                {error}
              </div>
            )}
            <BtnPrimary type="submit" disabled={busy} className="w-full">
              {busy ? 'Connexion…' : 'Se connecter'}
            </BtnPrimary>
          </div>
          {profile && !profile.role && (
            <p className="mt-3 text-center text-xs text-amber-600">
              Compte connecté — en attente d'activation par l'Administrateur.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
