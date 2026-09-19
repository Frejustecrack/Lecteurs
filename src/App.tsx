import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { supabaseConfiguré } from './lib/supabase';
import { Spinner, ToastProvider } from './components/ui';
import { estAdmin } from './lib/types';
import Layout from './components/Layout';
import Login from './pages/Login';
import ErrorBoundary from './components/ErrorBoundary';

// Lazy loading pour 200 lecteurs : bundle initial allégé (~60% de moins)
// recharts et jspdf ne sont chargés que quand la page en a besoin
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Lecteurs = lazy(() => import('./pages/Lecteurs'));
const LecteurProfil = lazy(() => import('./pages/LecteurProfil'));
const Fraternites = lazy(() => import('./pages/Fraternites'));
const Presences = lazy(() => import('./pages/Presences'));
const Suivis = lazy(() => import('./pages/Suivis'));
const Cotisations = lazy(() => import('./pages/Cotisations'));
const Evenements = lazy(() => import('./pages/Evenements'));
const EvenementDetail = lazy(() => import('./pages/EvenementDetail'));
const Caisse = lazy(() => import('./pages/Caisse'));
const Permissions = lazy(() => import('./pages/Permissions'));
const Anniversaires = lazy(() => import('./pages/Anniversaires'));
const Admin = lazy(() => import('./pages/Admin'));

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
  const { profile, loading } = useAuth();
  if (loading) return <Spinner label="Vérification des droits…" />;
  if (!estAdmin(profile?.role)) return <Navigate to="/" replace />;
  return <Outlet />;
}

function SuspenseFallback() {
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <Spinner label="Chargement de la page…" />
    </div>
  );
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
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <Suspense fallback={<SuspenseFallback />}>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route element={<RequireAuth />}>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/lecteurs" element={<Lecteurs />} />
                  <Route path="/anniversaires" element={<Anniversaires />} />
                  <Route path="/lecteurs/:id" element={<LecteurProfil />} />
                  <Route path="/fraternites" element={<Fraternites />} />
                  <Route path="/presences" element={<Presences />} />
                  <Route path="/suivis" element={<Suivis />} />
                  <Route path="/cotisations" element={<Cotisations />} />
                  <Route path="/evenements" element={<Evenements />} />
                  <Route path="/evenements/:id" element={<EvenementDetail />} />
                  <Route path="/caisse" element={<Caisse />} />
                <Route path="/permissions" element={<Permissions />} />
                  <Route element={<RequireAdmin />}>
                    <Route path="/admin" element={<Admin />} />
                  </Route>
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
