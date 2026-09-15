import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import {
  dateISO,
  deplaceMois,
  deplaceSemaine,
  dimancheDeSemaine,
  fmtDate,
  fmtMoney,
  lundiDeSemaine,
  moisLabel,
  samediEstArrive,
  samedisDuMois,
  samedisSemaine,
  semaineLabel,
} from '../lib/dates';
import { traduireErreur } from '../lib/errors';
import {
  estCaissier,
  peutExporter as rolePeutExporter,
  type Cotisation,
  type Fraternite,
  type Lecteur,
} from '../lib/types';
import {
  BtnGhost,
  EmptyState,
  iconPressCls,
  inputCls,
  PageHeader,
  Segmented,
  Spinner,
  StatCard,
  StepNav,
  useToast,
} from '../components/ui';
import { exportCotisations } from '../pdf/export';

/** Vue mensuelle (tous les samedis du mois) ou hebdomadaire (un seul samedi). */
type ModeVue = 'mois' | 'semaine';

export default function Cotisations() {
  const { profile } = useAuth();
  const isCaissier = estCaissier(profile?.role);
  const { toast } = useToast();

  const now = new Date();
  const [mode, setMode] = useState<ModeVue>('mois');
  const [annee, setAnnee] = useState(now.getFullYear());
  const [mois, setMois] = useState(now.getMonth());
  const [semaine, setSemaine] = useState<Date>(lundiDeSemaine(now));
  const [fId, setFId] = useState('');
  const [search, setSearch] = useState('');

  const [lecteurs, setLecteurs] = useState<Lecteur[]>([]);
  const [fraternites, setFraternites] = useState<Fraternite[]>([]);
  const [cotisations, setCotisations] = useState<Cotisation[]>([]);
  const [montantCot, setMontantCot] = useState(50);
  const [loading, setLoading] = useState(true);
  const [busyPdf, setBusyPdf] = useState(false);
  const [celluleActive, setCelluleActive] = useState<string | null>(null);

  /**
   * Samedis affichés : une seule colonne en vue hebdomadaire, pour que le
   * Caissier pointe tout le monde d'un coup sans faire défiler le tableau.
   */
  const samedis = useMemo<string[]>(
    () =>
      mode === 'semaine'
        ? samedisSemaine(semaine).map(dateISO)
        : samedisDuMois(annee, mois).map(dateISO),
    [mode, semaine, annee, mois]
  );

  const periodeLabel =
    mode === 'semaine' ? semaineLabel(semaine) : moisLabel(annee, mois);

  /** Seuls les samedis déjà arrivés génèrent une cotisation due. */
  const samedisArrivesListe = useMemo(
    () => samedis.filter(samediEstArrive),
    [samedis]
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

  // Synchronisation temps réel : toute modif de cotisation est reflétée immédiatement
  useEffect(() => {
    const channel = supabase
      .channel('realtime-cotisations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cotisations' }, () => {
        load();
      })
      .subscribe();
    const onFocus = () => load();
    const onVis = () => {
      if (document.visibilityState === 'visible') load();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
      supabase.removeChannel(channel);
    };
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
      toast(
        "Vous n'êtes pas autorisé à saisir les cotisations : cette opération est réservée aux Caissiers.",
        'err'
      );
      return;
    }
    const current = map.get(`${l.id}|${sam}`);
    let error: { message: string } | null = null;
    setCelluleActive(`${l.id}|${sam}`);
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
    setCelluleActive(null);
    if (error) {
      toast(traduireErreur(error, 'enregistrer cette cotisation'), 'err');
      return;
    }
    load();
  }

  // --------------------------------------------------------------- totaux
  const totalPaye = filtered.reduce(
    (s, l) =>
      s +
      samedis.reduce(
        (ss, sam) =>
          ss + (map.get(`${l.id}|${sam}`)?.paye ? map.get(`${l.id}|${sam}`)!.montant : 0),
        0
      ),
    0
  );
  /** Samedis arrivés et non réglés — les samedis à venir ne comptent pas. */
  const nbDu = filtered.reduce(
    (s, l) =>
      s + samedisArrivesListe.filter((sam) => !map.get(`${l.id}|${sam}`)?.paye).length,
    0
  );

  function allerPrecedent() {
    if (mode === 'semaine') setSemaine(deplaceSemaine(semaine, -1));
    else {
      const d = deplaceMois(annee, mois, -1);
      setAnnee(d.annee);
      setMois(d.mois);
    }
  }

  function allerSuivant() {
    if (mode === 'semaine') setSemaine(deplaceSemaine(semaine, 1));
    else {
      const d = deplaceMois(annee, mois, 1);
      setAnnee(d.annee);
      setMois(d.mois);
    }
  }

  function revenirAujourdhui() {
    const t = new Date();
    setAnnee(t.getFullYear());
    setMois(t.getMonth());
    setSemaine(lundiDeSemaine(t));
  }

  if (loading) return <Spinner label="Chargement des cotisations…" />;

  const peutExporter = rolePeutExporter(profile?.role);

  return (
    <div>
      <PageHeader
        title="Cotisations"
        sub={`${fmtMoney(montantCot)} par lecteur et par samedi — saisie réservée aux Caissiers`}
        actions={
          peutExporter ? (
            <BtnGhost
              busy={busyPdf}
              busyLabel="PDF…"
              onClick={async () => {
                setBusyPdf(true);
                try {
                  exportCotisations({
                    annee,
                    mois,
                    fraternite: fraternites.find((f) => f.id === fId)?.nom ?? null,
                    lecteurs: filtered,
                    cotisations,
                    montantCot,
                    auteur: profile?.full_name ?? '—',
                    samedis,
                    periode: periodeLabel,
                  });
                  await supabase.rpc('log_action', {
                    p_action: 'export.pdf',
                    p_objet_type: 'cotisations',
                    p_objet_ref: `${annee}-${String(mois + 1).padStart(2, '0')}`,
                    p_detail: JSON.stringify({
                      document: 'fiche_cotisations',
                      vue: mode,
                      fraternite: fId || 'globale',
                    }),
                  });
                  toast('PDF généré.');
                } catch (err) {
                  toast(traduireErreur(err, 'générer le PDF des cotisations'), 'err');
                } finally {
                  setBusyPdf(false);
                }
              }}
            >
              ⬇ PDF
            </BtnGhost>
          ) : undefined
        }
      />

      {/* ------------------------------------------------- vue + navigation */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'mois', label: 'Vue mensuelle', icon: '🗓️' },
            { value: 'semaine', label: 'Vue hebdomadaire', icon: '📆' },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          <StepNav
            label={periodeLabel}
            width="min-w-[190px]"
            onPrev={allerPrecedent}
            onNext={allerSuivant}
          />
          <button
            onClick={revenirAujourdhui}
            className={`${iconPressCls} px-3 py-2 text-xs font-semibold text-cdlj`}
          >
            Aujourd'hui
          </button>
        </div>
      </div>

      {mode === 'semaine' && (
        <p className="mb-4 text-xs text-slate-400">
          Vue hebdomadaire : une seule case devant chaque lecteur — le samedi{' '}
          <strong className="text-slate-500">
            {samedis[0] ? fmtDate(samedis[0]) : '—'}
          </strong>{' '}
          (semaine du {fmtDate(lundiDeSemaine(semaine))} au{' '}
          {fmtDate(dimancheDeSemaine(semaine))}).
        </p>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Total payé (vue)"
          value={fmtMoney(totalPaye)}
          tone="green"
          sub={periodeLabel}
        />
        <StatCard
          label="Cotisations dues (vue)"
          value={fmtMoney(nbDu * montantCot)}
          tone="red"
          sub={`${nbDu} samedi(s) arrivé(s) non réglé(s)`}
        />
        <StatCard
          label="Samedis comptés"
          value={samedisArrivesListe.length}
          sub={`${samedis.length} affiché(s) — à venir exclus`}
        />
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
          aria-label="Filtrer par fraternité"
          className={`${inputCls} w-full sm:w-auto`}
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
          aria-label="Rechercher un lecteur"
          className={`${inputCls} min-w-0 flex-1 sm:max-w-xs`}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState msg="Aucun lecteur actif pour cette vue." />
      ) : mode === 'semaine' ? (
        <>
          {/* Mobile : cartes sans scroll horizontal */}
          <ul className="space-y-2 sm:hidden">
            {filtered.map((l) => {
              const sam = samedis[0];
              const c = sam ? map.get(`${l.id}|${sam}`) : undefined;
              const arrive = sam ? samediEstArrive(sam) : false;
              const duCeSamedi = sam ? !c?.paye && arrive : false;
              let paye = 0;
              let du = 0;
              samedis.forEach((s) => {
                const cc = map.get(`${l.id}|${s}`);
                if (cc?.paye) paye += cc.montant;
                else if (samediEstArrive(s)) du += 1;
              });
              return (
                <li key={l.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs font-semibold text-cdlj">{l.matricule}</div>
                    <Link to={`/lecteurs/${l.id}`} className="block truncate text-sm font-medium text-slate-800 hover:text-cdlj">
                      {l.prenom} {l.nom.toUpperCase()}
                    </Link>
                    <div className="mt-0.5 text-xs font-semibold text-slate-500">
                      {paye > 0 ? fmtMoney(paye) + ' payé' : '—'} · {du > 0 ? fmtMoney(du * montantCot) + ' dû' : 'à jour'}
                    </div>
                  </div>
                  <button
                    onClick={() => sam && toggle(l, sam)}
                    disabled={!isCaissier || !sam}
                    aria-busy={celluleActive === `${l.id}|${sam}` || undefined}
                    title={!isCaissier ? 'Lecture seule — saisie réservée aux Caissiers' : c?.paye ? 'Payé — cliquez pour repasser en dû' : duCeSamedi ? 'Dû — cliquez pour déclarer' : 'Samedi à venir'}
                    className={`min-w-[72px] shrink-0 rounded-xl px-3 py-3 text-xs font-bold transition-all duration-150 active:scale-90 ${
                      c?.paye ? 'bg-emerald-500 text-white' : duCeSamedi ? 'bg-alerte text-white' : 'border border-dashed border-slate-300 text-slate-400'
                    } ${isCaissier ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                  >
                    {c?.paye ? `${c.montant} F ✓` : duCeSamedi ? 'dû' : '—'}
                  </button>
                </li>
              );
            })}
          </ul>
          {/* Desktop : tableau hebdomadaire sans scroll */}
          <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm sm:block">
            <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3">Matricule</th>
                <th className="px-3 py-3">Lecteur</th>
                {samedis.map((s) => (
                  <th key={s} className="px-2 py-3 text-center">
                    <span className="block whitespace-nowrap">
                      {fmtDate(s).slice(0, 5)}
                    </span>
                    {!samediEstArrive(s) && (
                      <span className="mt-1 inline-block rounded bg-slate-100 px-1 text-[10px] font-bold text-slate-400">
                        À VENIR
                      </span>
                    )}
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
                  else if (samediEstArrive(sam)) du += 1;
                });
                return (
                  <tr key={l.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-cdlj">
                      {l.matricule}
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-2">
                      <Link
                        to={`/lecteurs/${l.id}`}
                        className="font-medium text-slate-700 hover:text-cdlj"
                      >
                        {l.prenom} {l.nom.toUpperCase()}
                      </Link>
                    </td>
                    {samedis.map((sam) => {
                      const c = map.get(`${l.id}|${sam}`);
                      const arrive = samediEstArrive(sam);
                      // Rouge par défaut dès que le samedi est arrivé :
                      // tant que le paiement n'est pas déclaré, il est dû.
                      const duCeSamedi = !c?.paye && arrive;
                      return (
                        <td key={sam} className="px-2 py-2 text-center">
                          <button
                            onClick={() => toggle(l, sam)}
                            disabled={!isCaissier}
                            aria-busy={celluleActive === `${l.id}|${sam}` || undefined}
                            title={
                              !isCaissier
                                ? "Lecture seule — saisie réservée aux Caissiers"
                                : c?.paye
                                  ? 'Payé — cliquez pour repasser en dû'
                                  : duCeSamedi
                                    ? 'Dû — cliquez pour déclarer le paiement'
                                    : 'Samedi à venir — pas encore comptabilisé'
                            }
                            className={`min-w-[52px] rounded-md px-2 py-1.5 text-xs font-bold transition-all duration-150 active:scale-90 ${
                              c?.paye
                                ? 'bg-emerald-500 text-white'
                                : duCeSamedi
                                  ? 'bg-alerte text-white'
                                  : 'border border-dashed border-slate-300 text-slate-400'
                            } ${
                              isCaissier
                                ? 'cursor-pointer hover:opacity-80'
                                : 'cursor-default'
                            }`}
                          >
                            {c?.paye ? `${c.montant} F ✓` : duCeSamedi ? 'dû' : '—'}
                          </button>
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap px-2 py-2 text-right text-xs font-bold text-emerald-600">
                      {fmtMoney(paye)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right text-xs font-bold text-alerte">
                      {fmtMoney(du * montantCot)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3">Matricule</th>
                <th className="px-3 py-3">Lecteur</th>
                {samedis.map((s) => (
                  <th key={s} className="px-2 py-3 text-center">
                    <span className="block whitespace-nowrap">{fmtDate(s).slice(0, 5)}</span>
                    {!samediEstArrive(s) && (
                      <span className="mt-1 inline-block rounded bg-slate-100 px-1 text-[10px] font-bold text-slate-400">À VENIR</span>
                    )}
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
                  else if (samediEstArrive(sam)) du += 1;
                });
                return (
                  <tr key={l.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-cdlj">{l.matricule}</td>
                    <td className="max-w-[220px] truncate px-3 py-2">
                      <Link to={`/lecteurs/${l.id}`} className="font-medium text-slate-700 hover:text-cdlj">
                        {l.prenom} {l.nom.toUpperCase()}
                      </Link>
                    </td>
                    {samedis.map((sam) => {
                      const c = map.get(`${l.id}|${sam}`);
                      const arrive = samediEstArrive(sam);
                      const duCeSamedi = !c?.paye && arrive;
                      return (
                        <td key={sam} className="px-2 py-2 text-center">
                          <button
                            onClick={() => toggle(l, sam)}
                            disabled={!isCaissier}
                            aria-busy={celluleActive === `${l.id}|${sam}` || undefined}
                            title={!isCaissier ? 'Lecture seule — saisie réservée aux Caissiers' : c?.paye ? 'Payé — cliquez pour repasser en dû' : duCeSamedi ? 'Dû — cliquez pour déclarer le paiement' : 'Samedi à venir — pas encore comptabilisé'}
                            className={`min-w-[52px] rounded-md px-2 py-1.5 text-xs font-bold transition-all duration-150 active:scale-90 ${
                              c?.paye ? 'bg-emerald-500 text-white' : duCeSamedi ? 'bg-alerte text-white' : 'border border-dashed border-slate-300 text-slate-400'
                            } ${isCaissier ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                          >
                            {c?.paye ? `${c.montant} F ✓` : duCeSamedi ? 'dû' : '—'}
                          </button>
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap px-2 py-2 text-right text-xs font-bold text-emerald-600">{fmtMoney(paye)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right text-xs font-bold text-alerte">{fmtMoney(du * montantCot)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-slate-400">
        Par défaut, un samedi arrivé est <strong className="text-alerte">dû</strong> :
        tant que le Caissier n'a pas basculé la case au vert, le lecteur est
        considéré comme n'ayant pas payé. L'absence ne dispense pas du paiement.
        Les samedis à venir ne sont pas comptabilisés. Les mois passés restent
        conservés et consultables.
      </p>
    </div>
  );
}
