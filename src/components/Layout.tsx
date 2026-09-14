import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { ROLE_LABELS, type Role } from '../lib/types';
import { traduireErreur } from '../lib/errors';
import {
  BtnPrimary,
  Field,
  inputCls,
  Modal,
  pressCls,
  useToast,
} from './ui';

const NAV: { to: string; label: string; icon: string; roles?: Role[] }[] = [
  { to: '/', label: 'Accueil', icon: '🏠' },
  { to: '/lecteurs', label: 'Lecteurs', icon: '👥' },
  { to: '/fraternites', label: 'Fraternités', icon: '🤝' },
  { to: '/presences', label: 'Présences', icon: '📅' },
  { to: '/suivis', label: 'Suivis', icon: '📊' },
  { to: '/cotisations', label: 'Cotisations', icon: '💰' },
  { to: '/evenements', label: 'Événements', icon: '🎉' },
  { to: '/caisse', label: 'Caisse', icon: '🏦' },
  { to: '/admin', label: 'Administration', icon: '🛠️', roles: ['admin'] },
];

function Logo() {
  return (
    <div className="flex items-center gap-3 group">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cdlj to-cdlj-dark text-lg font-extrabold text-white shadow-sm ring-1 ring-cdlj/10 transition-all duration-200 group-hover:shadow-md group-hover:scale-[1.02]">
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
    // Le log doit être écrit AVANT la fermeture de session : après, le jeton
    // n'existe plus et l'auteur de la déconnexion serait perdu.
    if (user) {
      await supabase.rpc('log_action', {
        p_action: 'compte.deconnexion',
        p_objet_type: 'profiles',
        p_objet_ref: user.id,
        p_detail: JSON.stringify({
          identifiant: profile?.username ?? user.email ?? user.phone ?? null,
        }),
      });
    }
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
      toast(traduireErreur(error, 'modifier votre mot de passe'), 'err');
    } else {
      setPwOpen(false);
      setPwForm({ p1: '', p2: '' });
      toast('Mot de passe modifié.');
    }
  }

  const userFooter = (
    <div className="border-t border-slate-200/70 pt-3">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-cdlj ring-1 ring-slate-200">
          {(displayUser[0] ?? 'U').toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-700" title={profile?.full_name ?? undefined}>
            {displayUser}
          </div>
          <div className="truncate text-xs text-slate-500">
            {profile?.role ? ROLE_LABELS[profile.role] : '—'}
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex gap-2">
        <button
          onClick={() => setPwOpen(true)}
          className={`flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 hover:border-slate-300 ${pressCls}`}
        >
          Mot de passe
        </button>
        <button
          onClick={logout}
          className={`flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-700 ${pressCls}`}
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
            `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium ${pressCls} ${
              isActive
                ? 'bg-cdlj text-white shadow-sm shadow-cdlj/20'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
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
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200/70 bg-white/80 p-4 backdrop-blur-sm shadow-[1px_0_12px_rgba(15,23,42,0.04)] lg:flex">
        <Logo />
        <nav className="mt-6 flex flex-1 flex-col gap-1 overflow-y-auto">{navContent}</nav>
        {userFooter}
      </aside>

      {/* Header mobile */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200/70 bg-white/80 px-4 py-3 backdrop-blur-md shadow-sm lg:hidden">
          <button
            onClick={() => setOpen(true)}
            className={`rounded-lg p-2 text-slate-600 hover:bg-slate-100 ${pressCls}`}
            aria-label="Ouvrir le menu"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="text-sm font-extrabold text-cdlj">CDLJ Akogbato</div>
          <button
            onClick={logout}
            className={`rounded-lg p-2 text-slate-400 hover:bg-slate-100 ${pressCls}`}
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
            <div className="cdlj-backdrop absolute inset-0 bg-slate-900/30" onClick={() => setOpen(false)} aria-hidden />
            <div className="cdlj-drawer absolute left-0 top-0 flex h-full w-72 flex-col bg-white p-4 shadow-2xl ring-1 ring-slate-200">
              <Logo />
              <nav className="mt-6 flex flex-1 flex-col gap-1 overflow-y-auto">{navContent}</nav>
              {userFooter}
            </div>
          </div>
        )}

        <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">
          <div className="animate-[cdlj-modal-in_220ms_ease-out]">
            <Outlet />
          </div>
        </main>
      </div>

      <Modal
        open={pwOpen}
        onClose={() => setPwOpen(false)}
        title="Changer mon mot de passe"
      >
        <div className="space-y-4">
          <div className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-slate-600">
            Votre identifiant <span className="font-mono font-semibold text-cdlj">{displayUser}</span> est fixe — seul le mot de passe peut être modifié. 8 caractères minimum.
          </div>
          <Field label="Nouveau mot de passe">
            <input
              type="password"
              className={inputCls}
              value={pwForm.p1}
              onChange={(e) => setPwForm({ ...pwForm, p1: e.target.value })}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirmer le nouveau mot de passe">
            <input
              type="password"
              className={inputCls}
              value={pwForm.p2}
              onChange={(e) => setPwForm({ ...pwForm, p2: e.target.value })}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setPwOpen(false)} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Annuler</button>
            <BtnPrimary onClick={changePassword} busy={pwBusy} busyLabel="Enregistrement…">
              Enregistrer
            </BtnPrimary>
          </div>
        </div>
      </Modal>
    </div>
  );
}
