import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import {
  dateISO,
  deplaceMois,
  fmtDate,
  fmtMoney,
  moisLabel,
  samedisDuMois,
} from '../lib/dates';
import type { Cotisation, Fraternite, Lecteur } from '../lib/types';
import {
  EmptyState,
  inputCls,
  PageHeader,
  Spinner,
  StatCard,
  useToast,
} from '../components/ui';
import { exportCotisations } from '../pdf/export';

export default function Cotisations() {
  const { profile } = useAuth();
  const isCaissier = profile?.role === 'caissier';
  const { toast } = useToast();

  const now = new Date();
  const [annee, setAnnee] = useState(now.getFullYear());
  const [mois, setMois] = useState(now.getMonth());
  const [fId, setFId] = useState('');
  const [search, setSearch] = useState('');

  const [lecteurs, setLecteurs] = useState<Lecteur[]>([]);
  const [fraternites, setFraternites] = useState<Fraternite[]>([]);
  const [cotisations, setCotisations] = useState<Cotisation[]>([]);
  const [montantCot, setMontantCot] = useState(50);
  const [loading, setLoading] = useState(true);

  const samedis = useMemo(
    () => samedisDuMois(annee, mois).map(dateISO),
    [annee, mois]
  );

  const load = useCallback(async () => {
    const [rL, rF, rSet] = await Promise.all([
      supabase.from('lecteurs').select('*').eq('archived', false).order('matricule'),
      supabase.from('fraternites').select('*').order('nom'),
      supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'montant_cotisation')
        .maybeSingle(),
    ]);
    setLecteurs((rL.data ?? []) as Lecteur[]);
    setFraternites((rF.data ?? []) as Fraternite[]);
    if (rSet.data) setMontantCot(Number(rSet.data.value) || 50);

    if (samedis.length > 0) {
      const rC = await supabase
        .from('cotisations')
        .select('*')
        .gte('date_samedi', samedis[0])
        .lte('date_samedi', samedis[samedis.length - 1]);
      setCotisations((rC.data ?? []) as Cotisation[]);
    } else {
      setCotisations([]);
    }
    setLoading(false);
  }, [samedis]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const map = useMemo(() => {
    const m = new Map<string, Cotisation>();
    cotisations.forEach((c) => m.set(`${c.lecteur_id}|${c.date_samedi}`, c));
    return m;
  }, [cotisations]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lecteurs.filter((l) => {
      if (fId && l.fraternite_id !== fId) return false;
      if (!q) return true;
      return (
        l.matricule.toLowerCase().includes(q) ||
        l.nom.toLowerCase().includes(q) ||
        l.prenom.toLowerCase().includes(q)
      );
    });
  }, [lecteurs, fId, search]);

  async function toggle(l: Lecteur, sam: string) {
    if (!isCaissier) {
      toast('Seul un Caissier peut saisir les cotisations.', 'err');
      return;
    }
    const current = map.get(`${l.id}|${sam}`);
    let error: { message: string } | null = null;
    if (current?.paye) {
      ({ error } = await supabase
        .from('cotisations')
        .update({ paye: false, paid_at: null, recorded_by: profile?.id ?? null })
        .eq('id', current.id));
    } else {
      ({ error } = await supabase
        .from('cotisations')
        .upsert(
          {
            lecteur_id: l.id,
            date_samedi: sam,
            paye: true,
            montant: montantCot,
            paid_at: new Date().toISOString(),
            recorded_by: profile?.id ?? null,
          },
          { onConflict: 'lecteur_id,date_samedi' }
        ));
    }
    if (error) {
      toast(error.message, 'err');
      return;
    }
    load();
  }

  // Totaux sur la vue filtrée
  const totalPaye = filtered.reduce((s, l) => {
    return (
      s + samedis.reduce((ss, sam) => ss + (map.get(`${l.id}|${sam}`)?.paye ? map.get(`${l.id}|${sam}`)!.montant : 0), 0)
    );
  }, 0);
  const nbDu = filtered.reduce(
    (s, l) => s + samedis.filter((sam) => !map.get(`${l.id}|${sam}`)?.paye).length,
    0
  );

  if (loading) return <Spinner label="Chargement des cotisations…" />;

  const estMoisCourant =
    annee === now.getFullYear() && mois === now.getMonth();

  return (
    <div>
      <PageHeader
        title="Cotisations"
        sub={`${fmtMoney(montantCot)} par lecteur et par samedi — saisie réservée aux Caissiers (pas de gel : mois passés modifiables)`}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
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
              <span className="min-w-[150px] px-1 text-center text-sm font-bold text-slate-700">
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
            {(profile?.role === 'admin' ||
              profile?.role === 'co' ||
              profile?.role === 'caissier') && (
              <button
                onClick={async () => {
                  try {
                    exportCotisations({
                      annee,
                      mois,
                      fraternite: fraternites.find((f) => f.id === fId)?.nom ?? null,
                      lecteurs: filtered,
                      cotisations,
                      montantCot,
                      auteur: profile?.full_name ?? '—',
                    });
                    await supabase.rpc('log_action', {
                      p_action: 'export.pdf',
                      p_objet_type: 'cotisations',
                      p_objet_ref: `${annee}-${String(mois + 1).padStart(2, '0')}`,
                      p_detail: JSON.stringify({
                        document: 'fiche_cotisations',
                        fraternite: fId || 'globale',
                      }),
                    });
                    toast('PDF généré.');
                  } catch (err) {
                    toast(err instanceof Error ? err.message : 'Erreur PDF.', 'err');
                  }
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                ⬇ PDF
              </button>
            )}
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Total payé (vue)"
          value={fmtMoney(totalPaye)}
          tone="green"
          sub={moisLabel(annee, mois)}
        />
        <StatCard
          label="Cotisations dues (vue)"
          value={fmtMoney(nbDu * montantCot)}
          tone="red"
          sub={`${nbDu} samedi(s) non payé(s)`}
        />
        <StatCard label="Samedis du mois" value={samedis.length} />
        <StatCard
          label="Lecteurs (vue)"
          value={filtered.length}
          tone="amber"
          sub={isCaissier ? 'clic sur une case = payé/dû' : 'lecture seule'}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={fId}
          onChange={(e) => setFId(e.target.value)}
          className={`${inputCls} w-auto`}
        >
          <option value="">Vue globale — toutes les fraternités</option>
          {fraternites.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nom}
            </option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un lecteur (matricule…)"
          className={`${inputCls} max-w-xs flex-1`}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState msg="Aucun lecteur actif pour cette vue." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3">Matricule</th>
                <th className="px-3 py-3">Lecteur</th>
                {samedis.map((s) => (
                  <th key={s} className="px-2 py-3 text-center">
                    {fmtDate(s).slice(0, 5)}
                  </th>
                ))}
                <th className="px-2 py-3 text-right">Payé</th>
                <th className="px-2 py-3 text-right">Dû</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((l) => {
                let paye = 0;
                let du = 0;
                samedis.forEach((sam) => {
                  const c = map.get(`${l.id}|${sam}`);
                  if (c?.paye) paye += c.montant;
                  else du += 1;
                });
                return (
                  <tr key={l.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-cdlj">
                      {l.matricule}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        to={`/lecteurs/${l.id}`}
                        className="font-medium text-slate-700 hover:text-cdlj"
                      >
                        {l.prenom} {l.nom.toUpperCase()}
                      </Link>
                    </td>
                    {samedis.map((sam) => {
                      const c = map.get(`${l.id}|${sam}`);
                      return (
                        <td key={sam} className="px-2 py-2 text-center">
                          <button
                            onClick={() => toggle(l, sam)}
                            disabled={!isCaissier}
                            title={
                              isCaissier
                                ? 'Cliquez pour basculer payé/dû'
                                : 'Lecture seule'
                            }
                            className={`min-w-[52px] rounded-md px-2 py-1.5 text-xs font-bold ${
                              c?.paye
                                ? 'bg-emerald-500 text-white'
                                : 'bg-red-50 text-alerte ring-1 ring-inset ring-red-200'
                            } ${isCaissier ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                          >
                            {c?.paye ? `${c.montant} F ✓` : 'dû'}
                          </button>
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 text-right text-xs font-bold text-emerald-600">
                      {fmtMoney(paye)}
                    </td>
                    <td className="px-2 py-2 text-right text-xs font-bold text-alerte">
                      {fmtMoney(du * montantCot)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-slate-400">
        Un lecteur absent un samedi voit sa cotisation « due » — l'absence ne
        dispense pas du paiement. Suivi des dettes sur le mois courant ; les mois
        passés restent conservés et consultables.
      </p>
    </div>
  );
}
