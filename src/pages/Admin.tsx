import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { fmtDateHeure } from '../lib/dates';
import { traduireErreur } from '../lib/errors';
import type { LogEntry, Profile, Role } from '../lib/types';
import { ROLE_LABELS } from '../lib/types';
import {
  Badge,
  BtnPrimary,
  EmptyState,
  Field,
  inputCls,
  PageHeader,
  pressCls,
  Spinner,
  useToast,
} from '../components/ui';

type Tab = 'logs' | 'comptes' | 'parametres';

export default function Admin() {
  const { profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('logs');

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [comptes, setComptes] = useState<Profile[]>([]);
  const [montantCot, setMontantCot] = useState('50');
  const [loading, setLoading] = useState(true);
  const [qLog, setQLog] = useState('');
  const [busyRole, setBusyRole] = useState<string | null>(null);
  const [busyMontant, setBusyMontant] = useState(false);

  const load = useCallback(async () => {
    const [rL, rP, rS] = await Promise.all([
      supabase.from('logs').select('*').order('id', { ascending: false }).limit(400),
      supabase.from('profiles').select('*').order('full_name'),
      supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'montant_cotisation')
        .maybeSingle(),
    ]);
    setLogs((rL.data ?? []) as LogEntry[]);
    setComptes((rP.data ?? []) as Profile[]);
    if (rS.data) setMontantCot(String(rS.data.value));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function changerRole(c: Profile, role: Role) {
    if (c.id === profile?.id) {
      toast("Vous ne pouvez pas modifier votre propre rôle ici.", 'err');
      return;
    }
    if (!confirm(`Changer le rôle de ${c.full_name ?? c.id} en ${ROLE_LABELS[role]} ?`))
      return;
    setBusyRole(c.id);
    const { error } = await supabase
      .from('profiles')
      .update({ role })
      .eq('id', c.id);
    setBusyRole(null);
    if (error) toast(traduireErreur(error, 'modifier le rôle de ce compte'), 'err');
    else {
      toast('Rôle mis à jour.');
      load();
    }
  }

  async function supprimerCompte(c: Profile) {
    if (c.id === profile?.id) {
      toast("Vous ne pouvez pas supprimer votre propre compte.", 'err');
      return;
    }
    if (
      !confirm(
        `Retirer le compte de ${c.full_name ?? c.id} ?\n\nLe compte perdra tout accès à l'application. Ses actions passées restent tracées dans les logs.`
      )
    )
      return;
    setBusyRole(c.id);
    const { error } = await supabase.from('profiles').delete().eq('id', c.id);
    setBusyRole(null);
    if (error) toast(traduireErreur(error, 'désactiver ce compte'), 'err');
    else {
      toast('Compte désactivé (accès retiré).');
      load();
    }
  }

  async function saveMontant() {
    const v = Number(montantCot);
    if (!v || v <= 0) {
      toast('Montant invalide.', 'err');
      return;
    }
    setBusyMontant(true);
    const { error } = await supabase
      .from('app_settings')
      .update({ value: String(v) })
      .eq('key', 'montant_cotisation');
    setBusyMontant(false);
    if (error) toast(traduireErreur(error, 'modifier le montant de la cotisation'), 'err');
    else {
      toast(`Montant de la cotisation : ${v} F (modifié — tracé dans les logs).`);
      load();
    }
  }

  if (loading) return <Spinner label="Chargement de l'administration…" />;

  const logsFiltres = qLog
    ? logs.filter(
        (l) =>
          l.action.toLowerCase().includes(qLog.toLowerCase()) ||
          (l.objet_ref ?? '').toLowerCase().includes(qLog.toLowerCase()) ||
          (l.user_name ?? '').toLowerCase().includes(qLog.toLowerCase())
      )
    : logs;

  return (
    <div>
      <PageHeader title="Administration" sub="Logs système, comptes utilisateurs et paramètres" />

      <div className="mb-4 flex w-fit rounded-lg border border-slate-200 bg-white p-0.5">
        {(
          [
            ['logs', '📜 Logs'],
            ['comptes', '👤 Comptes'],
            ['parametres', '⚙️ Paramètres'],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={`rounded-md px-4 py-1.5 text-sm font-semibold ${pressCls} ${
              tab === t ? 'bg-cdlj text-white' : 'text-slate-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'logs' && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-bold text-slate-700">
              Journal des actions ({logsFiltres.length} dernières)
            </h3>
            <input
              value={qLog}
              onChange={(e) => setQLog(e.target.value)}
              placeholder="Filtrer (action, matricule, utilisateur…)"
              className={`${inputCls} w-64 max-w-full`}
            />
          </div>
          {logsFiltres.length === 0 ? (
            <div className="p-4">
              <EmptyState msg="Aucun log (pour ce filtre). Les actions apparaîtront ici." />
            </div>
          ) : (
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full min-w-[680px] text-left text-xs">
                <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Utilisateur</th>
                    <th className="px-3 py-2">Action</th>
                    <th className="px-3 py-2">Objet</th>
                    <th className="px-3 py-2">Détail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {logsFiltres.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50/60">
                      <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                        {fmtDateHeure(l.created_at)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-700">
                          {l.user_name ?? '—'}
                        </div>
                        {l.user_role && (
                          <div className="text-[10px] uppercase text-slate-400">
                            {l.user_role}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          tone={
                            l.action.startsWith('delete')
                              ? 'red'
                              : l.action.startsWith('create')
                                ? 'green'
                                : l.action === 'export.pdf'
                                  ? 'amber'
                                  : 'blue'
                          }
                        >
                          {l.action}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {l.objet_type ? `${l.objet_type}` : '—'}
                        {l.objet_ref ? (
                          <span className="ml-1 font-mono text-[10px] text-slate-400">
                            {l.objet_ref}
                          </span>
                        ) : null}
                      </td>
                      <td className="max-w-[220px] truncate px-3 py-2 text-slate-500">
                        {l.detail ? JSON.stringify(l.detail) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'comptes' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-slate-700">
            <strong>Créer un nouveau compte :</strong> créez-le dans le dashboard
            Supabase (Authentication → Users → Add user, cocher « Auto confirm user »)
            puis exécutez ici dans le SQL Editor :
            <pre className="mt-2 overflow-x-auto rounded-lg bg-white p-3 font-mono text-xs">
{`select public.set_role('UUID_DU_COMPTE', 'caissier', 'Nom Prénom');
-- rôles possibles : admin | co | caissier | responsable`}
            </pre>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Nom</th>
                  <th className="px-4 py-3">Identifiant</th>
                  <th className="px-4 py-3">Rôle</th>
                  <th className="px-4 py-3">Créé le</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {comptes.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2 font-medium text-slate-700">
                      {c.full_name ?? '(sans nom)'}
                      {c.id === profile?.id && (
                        <span className="ml-1 text-xs text-cdlj">(vous)</span>
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-cdlj">
                      {c.username ?? '—'}
                    </td>
                    <td className="px-4 py-2">
                      {c.role ? (
                        <Badge tone="blue">{ROLE_LABELS[c.role]}</Badge>
                      ) : (
                        <Badge tone="gray">En attente</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-500">{fmtDateHeure(c.created_at)}</td>
                    <td className="px-4 py-2 text-right text-xs font-semibold">
                      {c.id !== profile?.id && (
                        <>
                          <select
                            disabled={busyRole === c.id}
                            aria-label={`Rôle de ${c.full_name ?? c.id}`}
                            className={`mr-2 rounded border border-slate-200 bg-white px-1 py-1 text-xs ${pressCls}`}
                            value={c.role ?? ''}
                            onChange={(e) =>
                              changerRole(c, e.target.value as Role)
                            }
                          >
                            <option value="">— sans rôle —</option>
                            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABELS[r]}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => supprimerCompte(c)}
                            disabled={busyRole === c.id}
                            className={`text-alerte hover:underline ${pressCls}`}
                          >
                            {busyRole === c.id ? 'En cours…' : 'Désactiver'}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            onClick={refreshProfile}
            className="text-xs font-semibold text-cdlj hover:underline"
          >
            ↻ Actualiser ma session
          </button>
        </div>
      )}

      {tab === 'parametres' && (
        <div className="max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-slate-700">
            Montant de la cotisation hebdomadaire
          </h3>
          <div className="flex items-center gap-2">
            <input
              type="number"
              className={`${inputCls} w-28`}
              value={montantCot}
              onChange={(e) => setMontantCot(e.target.value)}
            />
            <span className="text-sm text-slate-500">F CFA / lecteur / samedi</span>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            La modification ne touche que les futures saisies : les cotisations déjà
            enregistrées conservent leur montant. Action tracée dans les logs.
          </p>
          <div className="mt-4">
            <BtnPrimary
              onClick={saveMontant}
              busy={busyMontant}
              busyLabel="Enregistrement…"
            >
              Enregistrer
            </BtnPrimary>
          </div>
        </div>
      )}
    </div>
  );
}
