import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { supabaseConfiguré } from './lib/supabase';
import { ToastProvider } from './components/ui';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Lecteurs from './pages/Lecteurs';
import LecteurProfil from './pages/LecteurProfil';
import Fraternites from './pages/Fraternites';
import Presences from './pages/Presences';
import Suivis from './pages/Suivis';
import Cotisations from './pages/Cotisations';
import Evenements from './pages/Evenements';
import EvenementDetail from './pages/EvenementDetail';
import Caisse from './pages/Caisse';
import Admin from './pages/Admin';
import { Spinner } from './components/ui';

function RequireAuth() {
  const { user, profile, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner label="Chargement…" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!profile || !profile.role) {
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
          <div className="text-3xl">⏳</div>
          <h1 className="mt-2 text-lg font-bold text-slate-800">
            Compte en attente d'activation
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Votre compte existe mais aucun rôle ne lui a encore été attribué.
            L'Administrateur doit vous assigner un rôle (Admin → Administration →
            Comptes) avant que vous puissiez accéder à l'application.
          </p>
        </div>
      </div>
    );
  }
  return <Layout />;
}

function RequireAdmin() {
  const { profile } = useAuth();
  if (profile?.role !== 'admin') return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Écran affiché tant que les variables d'accès à la base ne sont pas renseignées. */
function ConfigManquante() {
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
        <div className="text-3xl">⚙️</div>
        <h1 className="mt-2 text-lg font-bold text-slate-800">
          Connexion à la base non configurée
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Copiez <code className="rounded bg-white px-1">.env.example</code> en{' '}
          <code className="rounded bg-white px-1">.env</code>, renseignez{' '}
          <code className="rounded bg-white px-1">VITE_SUPABASE_URL</code> et{' '}
          <code className="rounded bg-white px-1">
            VITE_SUPABASE_PUBLISHABLE_KEY
          </code>
          , puis relancez l'application.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  if (!supabaseConfiguré) return <ConfigManquante />;
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<RequireAuth />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/lecteurs" element={<Lecteurs />} />
              <Route path="/lecteurs/:id" element={<LecteurProfil />} />
              <Route path="/fraternites" element={<Fraternites />} />
              <Route path="/presences" element={<Presences />} />
              <Route path="/suivis" element={<Suivis />} />
              <Route path="/cotisations" element={<Cotisations />} />
              <Route path="/evenements" element={<Evenements />} />
              <Route path="/evenements/:id" element={<EvenementDetail />} />
              <Route path="/caisse" element={<Caisse />} />
              <Route element={<RequireAdmin />}>
                <Route path="/admin" element={<Admin />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
