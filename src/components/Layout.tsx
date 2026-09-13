import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { ROLE_LABELS, type Role } from '../lib/types';
import {
  BtnPrimary,
  Field,
  inputCls,
  Modal,
  useToast,
} from './ui';

const NAV: { to: string; label: string; icon: string; roles?: Role[] }[] = [
  { to: '/', label: 'Accueil', icon: '🏠' },
  { to: '/lecteurs', label: 'Lecteurs', icon: '👥' },
  { to: '/fraternites', label: 'Fraternités', icon: '️' },
  { to: '/presences', label: 'Présences', icon: '📅' },
  { to: '/cotisations', label: 'Cotisations', icon: '💰' },
  { to: '/evenements', label: 'Événements', icon: '🎉' },
  { to: '/caisse', label: 'Caisse', icon: '🏦' },
  { to: '/admin', label: 'Administration', icon: '🛠️', roles: ['admin'] },
];

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cdlj text-lg font-extrabold text-white shadow-sm">
        C
      </div>
      <div className="leading-tight">
        <div className="text-base font-extrabold tracking-tight text-cdlj">
          CDLJ <span className="font-semibold text-slate-700">Akogbato</span>
        </div>
        <div className="max-w-[220px] text-[11px] font-medium italic text-slate-500">
          « Lecteurs, sel et lumière nous sommes »
        </div>
      </div>
    </div>
  );
}

export default function Layout() {
  const { profile, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwForm, setPwForm] = useState({ p1: '', p2: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const displayUser =
    profile?.username ?? user?.phone ?? user?.email ?? 'Utilisateur';

  const items = NAV.filter(
    (n) => !n.roles || (profile?.role && n.roles.includes(profile.role))
  );

  async function logout() {
    await supabase.auth.signOut();
    navigate('/login');
  }

  async function changePassword() {
    if (pwForm.p1.length < 8) {
      toast('Le nouveau mot de passe doit faire au moins 8 caractères.', 'err');
      return;
    }
    if (pwForm.p1 !== pwForm.p2) {
      toast('Les deux mots de passe ne correspondent pas.', 'err');
      return;
    }
    setPwBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pwForm.p1 });
    setPwBusy(false);
    if (error) {
      toast(error.message, 'err');
    } else {
      setPwOpen(false);
      setPwForm({ p1: '', p2: '' });
      toast('Mot de passe modifié.');
    }
  }

  const userFooter = (
    <div className="border-t border-slate-200 pt-3">
      <div className="truncate text-sm font-semibold text-slate-700" title={profile?.full_name ?? undefined}>
        {displayUser}
      </div>
      <div className="mb-2 text-xs text-slate-500">
        {profile?.role ? ROLE_LABELS[profile.role] : '—'}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => setPwOpen(true)}
          className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          Mot de passe
        </button>
        <button
          onClick={logout}
          className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          Déconnexion
        </button>
      </div>
    </div>
  );

  const navContent = (
    <>
      {items.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.to === '/'}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
              isActive
                ? 'bg-cdlj text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`
          }
        >
          <span className="text-base">{n.icon}</span>
          {n.label}
        </NavLink>
      ))}
    </>
  );

  return (
    <div className="flex min-h-full">
      {/* Sidebar desktop */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white p-4 lg:flex">
        <Logo />
        <nav className="mt-6 flex flex-1 flex-col gap-1 overflow-y-auto">{navContent}</nav>
        {userFooter}
      </aside>

      {/* Header mobile */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
          <button
            onClick={() => setOpen(true)}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
            aria-label="Ouvrir le menu"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="text-sm font-extrabold text-cdlj">CDLJ Akogbato</div>
          <button
            onClick={logout}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
            aria-label="Se déconnecter"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
            </svg>
          </button>
        </header>

        {/* Drawer mobile */}
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} aria-hidden />
            <div className="absolute left-0 top-0 flex h-full w-72 flex-col bg-white p-4 shadow-xl">
              <Logo />
              <nav className="mt-6 flex flex-1 flex-col gap-1 overflow-y-auto">{navContent}</nav>
              {userFooter}
            </div>
          </div>
        )}

        <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>

      <Modal
        open={pwOpen}
        onClose={() => setPwOpen(false)}
        title="Changer mon mot de passe"
      >
        <div className="space-y-4">
          <Field label="Nouveau mot de passe">
            <input
              type="password"
              className={inputCls}
              value={pwForm.p1}
              onChange={(e) => setPwForm({ ...pwForm, p1: e.target.value })}
              placeholder="8 caractères minimum"
            />
          </Field>
          <Field label="Confirmer le nouveau mot de passe">
            <input
              type="password"
              className={inputCls}
              value={pwForm.p2}
              onChange={(e) => setPwForm({ ...pwForm, p2: e.target.value })}
            />
          </Field>
          <p className="text-xs text-slate-400">
            Votre identifiant ({displayUser}) reste fixe et ne change pas.
          </p>
          <div className="flex justify-end gap-2">
            <BtnPrimary onClick={changePassword} disabled={pwBusy}>
              {pwBusy ? 'Enregistrement…' : 'Enregistrer'}
            </BtnPrimary>
          </div>
        </div>
      </Modal>
    </div>
  );
}
