import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { traduireErreur } from '../lib/errors';
import { BtnPrimary, Field, inputCls } from '../components/ui';

// Domaines internes réservés aux identifiants CDLJ (jamais utilisé pour l'envoi
// d'emails : les comptes sont créés directement par l'administrateur).
const USERNAME_DOMAIN = '@lecteurs.cdlj';

export default function Login() {
  const { user, profile, loading } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // L'utilisateur ne saisit que son identifiant ; l'application le mappe
      // vers l'identifiant interne de l'authentification.
      const identifiant = username.trim().toLowerCase();
      const { data, error: err } = await supabase.auth.signInWithPassword({
        email: identifiant + USERNAME_DOMAIN,
        password,
      });
      if (err) {
        setError(traduireErreur(err, 'vous connecter'));
      } else if (data.session) {
        // Cahier des charges §18 : chaque connexion est tracée dans les logs.
        await supabase.rpc('log_action', {
          p_action: 'compte.connexion',
          p_objet_type: 'profiles',
          p_objet_ref: data.session.user.id,
          p_detail: JSON.stringify({ identifiant }),
        });
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
            <Field label="Identifiant">
              <input
                required
                autoComplete="username"
                autoCapitalize="none"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={inputCls}
                placeholder="votre identifiant"
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
            <BtnPrimary type="submit" busy={busy} busyLabel="Connexion…" className="w-full">
              Se connecter
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
