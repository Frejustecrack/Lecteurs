import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { traduireErreur } from '../lib/errors';
import { journaliser } from '../lib/journal';
import { BtnPrimary, EyeToggle, Field, inputCls, pwInputCls } from '../components/ui';

// Domaines internes réservés aux identifiants CDLJ (jamais utilisé pour l'envoi
// d'emails : les comptes sont créés directement par l'administrateur).
const USERNAME_DOMAIN = '@lecteurs.cdlj';

/**
 * Image de fond de la page de connexion — UNIQUEMENT cette page.
 *
 * Déposez le visuel dans `src/assets/` sous le nom `fond-connexion`
 * (.jpg, .jpeg, .png ou .webp) : il est détecté automatiquement au build,
 * sans aucune modification de code. En son absence, le dégradé CDLJ
 * s'affiche à la place (aucune erreur, aucune requête inutile).
 */
const fondsConnexion = import.meta.glob('../assets/fond-connexion.*', {
  eager: true,
  import: 'default',
}) as Record<string, string>;
const fondConnexion = Object.values(fondsConnexion)[0];

export default function Login() {
  const { user, profile, loading } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  /** Œil : révèle temporairement le mot de passe saisi. */
  const [showPassword, setShowPassword] = useState(false);
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
        await journaliser('compte.connexion', undefined, undefined, { identifiant });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="relative flex min-h-full items-center justify-center overflow-hidden bg-cdlj bg-cover bg-center p-4"
      style={
        fondConnexion
          ? { backgroundImage: `url(${fondConnexion})` }
          : {
              backgroundImage:
                'linear-gradient(150deg, #1a56db 0%, #1544ad 45%, #0f2f7a 100%)',
            }
      }
    >
      {/* Voile sombre : garantit la lisibilité quel que soit le visuel de fond. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-slate-900/45"
      />

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-6 text-center text-white drop-shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-white/95 text-3xl font-extrabold text-cdlj shadow-lg">
            C
          </div>
          <h1 className="mt-4 text-2xl font-extrabold">
            Lecteurs Juniors <span className="font-semibold text-white/85">à Akogbato</span>
          </h1>
          <p className="mt-1 text-sm italic text-white/85">
            « Lecteurs, sel et lumière nous sommes »
          </p>
          <p className="mt-1 text-xs text-white/70">
            Paroisse Sainte Famille d'Akogbato — Archidiocèse de Cotonou
          </p>
        </div>

        <form
          onSubmit={submit}
          className="rounded-2xl border border-white/40 bg-white/95 p-6 shadow-xl backdrop-blur"
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
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={pwInputCls}
                  placeholder="••••••••"
                />
                <EyeToggle shown={showPassword} onToggle={() => setShowPassword((v) => !v)} />
              </div>
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
