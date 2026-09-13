import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import {
  dateISO,
  deplaceMois,
  fmtDate,
  fmtDateHeure,
  fmtMoney,
  moisLabel,
} from '../lib/dates';
import type { CaisseOperation, Cotisation, Lecteur, Profile } from '../lib/types';
import {
  Badge,
  BtnPrimary,
  EmptyState,
  Field,
  inputCls,
  PageHeader,
  Spinner,
  StatCard,
  useToast,
} from '../components/ui';
import { exportCaisse } from '../pdf/export';

interface Ligne {
  date: string;
  type: 'cotisation' | 'encaissement' | 'decaissement';
  libelle: string;
  montant: number;
  auteur: string;
}

export default function Caisse() {
  const { profile } = useAuth();
  const isCO = profile?.role === 'co';
  const isAdmin = profile?.role === 'admin';
  const canExport =
    isAdmin || isCO || profile?.role === 'caissier' || profile?.role === 'responsable';
  const { toast } = useToast();

  const now = new Date();
  const [annee, setAnnee] = useState(now.getFullYear());
  const [mois, setMois] = useState(now.getMonth());

  const [cotisations, setCotisations] = useState<Cotisation[]>([]);
  const [ops, setOps] = useState<CaisseOperation[]>([]);
  const [lecteurs, setLecteurs] = useState<Lecteur[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [opForm, setOpForm] = useState({
    type: 'encaissement' as 'encaissement' | 'decaissement',
    montant: '',
    motif: '',
  });

  const load = useCallback(async () => {
    const r1 = new Date(annee, mois, 1);
    const r2 = new Date(annee, mois + 1, 0);
    const d1 = dateISO(r1);
    const d2 = dateISO(r2);
    const [rC, rO, rL, rP] = await Promise.all([
      supabase
        .from('cotisations')
        .select('*')
        .eq('paye', true)
        .gte('date_samedi', d1)
        .lte('date_samedi', d2),
      supabase.from('caisse_operations').select('*').is('event_id', null).order('created_at'),
      supabase.from('lecteurs').select('id, matricule'),
      supabase.from('profiles').select('id, full_name'),
    ]);
    setCotisations((rC.data ?? []) as Cotisation[]);
    setOps((rO.data ?? []) as CaisseOperation[]);
    setLecteurs((rL.data ?? []) as Lecteur[]);
    setProfiles((rP.data ?? []) as Profile[]);
    setLoading(false);
  }, [annee, mois]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const matriculeDe = (lid: string) =>
    lecteurs.find((l) => l.id === lid)?.matricule ?? '—';

  const auteurName = (uid: string | null) =>
    profiles.find((p) => p.id === uid)?.full_name ?? '—';

  // ---- totaux globaux (caisse générale)
  const totalCot = cotisations.reduce((s, c) => s + c.montant, 0);
  const enc = ops
    .filter((o) => o.type === 'encaissement')
    .reduce((s, o) => s + o.montant, 0);
  const dec = ops
    .filter((o) => o.type === 'decaissement')
    .reduce((s, o) => s + o.montant, 0);

  // totaux mensuels / annuels (cotisations + ops)
  const prefixeMois = `${annee}-${String(mois + 1).padStart(2, '0')}`;
  const opsMois = ops
    .filter((o) => o.created_at.slice(0, 7) === prefixeMois)
    .reduce((s, o) => s + (o.type === 'encaissement' ? o.montant : -o.montant), 0);
  const prefixeAnnee = String(annee);
  const opsAnnee = ops
    .filter((o) => o.created_at.slice(0, 4) === prefixeAnnee)
    .reduce((s, o) => s + (o.type === 'encaissement' ? o.montant : -o.montant), 0);
  const cotAnnee = cotisations
    .filter((c) => (c.paid_at ?? '').slice(0, 4) === prefixeAnnee)
    .reduce((s, c) => s + c.montant, 0);

  const lignes: Ligne[] = useMemo(() => {
    const moisDebut = dateISO(new Date(annee, mois, 1));
    const moisFin = dateISO(new Date(annee, mois + 1, 0, 23, 59));
    const cots: Ligne[] = cotisations
      .filter((c) => c.date_samedi >= moisDebut && c.date_samedi <= moisFin)
      .map((c) => ({
        date: c.date_samedi,
        type: 'cotisation' as const,
        libelle: `Cotisation — ${matriculeDe(c.lecteur_id)}`,
        montant: c.montant,
        auteur: auteurName(c.recorded_by),
      }));
    const opsLignes: Ligne[] = ops
      .filter((o) => {
        const d = o.created_at.slice(0, 10);
        return d >= moisDebut && d <= moisFin;
      })
      .map((o) => ({
        date: o.created_at.slice(0, 10),
        type: o.type,
        libelle: `${o.type === 'encaissement' ? 'Encaissement' : 'Décaissement'} — ${o.motif}`,
        montant: o.montant,
        auteur: auteurName(o.recorded_by),
      }));
    return [...cots, ...opsLignes].sort((a, b) => (a.date < b.date ? 1 : -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cotisations, ops, lecteurs, annee, mois]);

  async function ajouterOp() {
    if (!isCO) return;
    const montant = Number(opForm.montant);
    if (!montant || montant <= 0 || !opForm.motif.trim()) {
      toast('Montant et motif obligatoires.', 'err');
      return;
    }
    const { error } = await supabase.from('caisse_operations').insert({
      event_id: null,
      type: opForm.type,
      montant,
      motif: opForm.motif.trim(),
      recorded_by: profile?.id ?? null,
    });
    if (error) toast(error.message, 'err');
    else {
      setOpForm({ type: 'encaissement', montant: '', motif: '' });
      toast('Opération enregistrée dans la caisse générale.');
      load();
    }
  }

  async function exportPdf() {
    try {
      await exportCaisse({
        periode: moisLabel(annee, mois),
        lignes,
        totalPaye: lignes
          .filter((l) => l.type === 'cotisation')
          .reduce((s, l) => s + l.montant, 0),
        totalEnc: lignes
          .filter((l) => l.type === 'encaissement')
          .reduce((s, l) => s + l.montant, 0),
        totalDec: lignes
          .filter((l) => l.type === 'decaissement')
          .reduce((s, l) => s + l.montant, 0),
        soldeGeneral: totalCot + enc - dec,
        auteur: profile?.full_name ?? '—',
      });
      await supabase.rpc('log_action', {
        p_action: 'export.pdf',
        p_objet_type: 'caisse',
        p_objet_ref: prefixeMois,
        p_detail: JSON.stringify({ document: 'etat_caisse' }),
      });
      toast('PDF généré.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erreur PDF.', 'err');
    }
  }

  if (loading) return <Spinner label="Chargement de la caisse…" />;

  return (
    <div>
      <PageHeader
        title="Caisse & Décaissements"
        sub="Caisse générale (cotisations + encaissements − décaissements) — séparée des caisses d'événements"
        actions={
          canExport ? (
            <button
              onClick={exportPdf}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              ⬇ Export PDF
            </button>
          ) : undefined
        }
      />

      <div className="mb-4 flex items-center gap-1">
        <button
          onClick={() => {
            const d = deplaceMois(annee, mois, -1);
            setAnnee(d.annee);
            setMois(d.mois);
          }}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50"
        >
          ←
        </button>
        <span className="min-w-[170px] px-2 text-center text-sm font-bold text-slate-700">
          {moisLabel(annee, mois)}
        </span>
        <button
          onClick={() => {
            const d = deplaceMois(annee, mois, 1);
            setAnnee(d.annee);
            setMois(d.mois);
          }}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50"
        >
          →
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Solde général de la caisse"
          value={fmtMoney(totalCot + enc - dec)}
          tone="blue"
          sub="depuis l'origine"
        />
        <StatCard
          label="Récolté ce mois"
          value={fmtMoney(totalCot + opsMois)}
          tone="green"
          sub={moisLabel(annee, mois)}
        />
        <StatCard
          label="Annuel (année en cours)"
          value={fmtMoney(cotAnnee + opsAnnee)}
          tone="amber"
          sub={prefixeAnnee}
        />
        <StatCard
          label="Décaissés (total)"
          value={fmtMoney(dec)}
          tone="red"
          sub={`${ops.filter((o) => o.type === 'decaissement').length} opération(s)`}
        />
      </div>

      {isCO && (
        <div className="mb-4 flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <select
            value={opForm.type}
            onChange={(ev) =>
              setOpForm({
                ...opForm,
                type: ev.target.value as 'encaissement' | 'decaissement',
              })
            }
            className={`${inputCls} w-auto`}
          >
            <option value="encaissement">Encaissement</option>
            <option value="decaissement">Décaissement</option>
          </select>
          <input
            type="number"
            placeholder="Montant (F)"
            value={opForm.montant}
            onChange={(ev) => setOpForm({ ...opForm, montant: ev.target.value })}
            className={`${inputCls} w-32`}
          />
          <input
            placeholder="Motif"
            value={opForm.motif}
            onChange={(ev) => setOpForm({ ...opForm, motif: ev.target.value })}
            className={`${inputCls} min-w-[180px] flex-1`}
          />
          <BtnPrimary onClick={ajouterOp}>Enregistrer</BtnPrimary>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-bold text-slate-700">
            Mouvements — {moisLabel(annee, mois)}
          </h3>
        </div>
        {lignes.length === 0 ? (
          <div className="p-4">
            <EmptyState msg="Aucun mouvement sur ce mois." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Libellé</th>
                  <th className="px-4 py-2">Auteur</th>
                  <th className="px-4 py-2 text-right">Montant</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lignes.map((l, i) => (
                  <tr key={i} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2 text-slate-500">{fmtDate(l.date)}</td>
                    <td className="px-4 py-2">
                      <Badge
                        tone={
                          l.type === 'cotisation'
                            ? 'blue'
                            : l.type === 'encaissement'
                              ? 'green'
                              : 'red'
                        }
                      >
                        {l.type === 'cotisation'
                          ? 'Cotisation'
                          : l.type === 'encaissement'
                            ? 'Encaissement'
                            : 'Décaissement'}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">{l.libelle}</td>
                    <td className="px-4 py-2 text-slate-500">{l.auteur}</td>
                    <td
                      className={`px-4 py-2 text-right font-semibold ${
                        l.type === 'decaissement' ? 'text-alerte' : 'text-emerald-600'
                      }`}
                    >
                      {l.type === 'decaissement' ? '− ' : '+ '}
                      {fmtMoney(l.montant)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2 text-xs text-slate-400">
          <span>Dernière opération : {ops.length > 0 ? fmtDateHeure(ops[ops.length - 1].created_at) : '—'}</span>
          <span>
            Solde général : <strong className="text-slate-600">{fmtMoney(totalCot + enc - dec)}</strong>
          </span>
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Un décaissement déduit du solde général sans modifier le montant mensuel
        récolté. Les caisses des événements sont gérées dans la page de chaque
        événement.
      </p>
    </div>
  );
}
