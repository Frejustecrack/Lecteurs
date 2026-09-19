import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { toutesLesLignes } from '../lib/pagination';
import { useRealtime } from '../lib/useRealtime';
import { useAuth } from '../context/AuthContext';
import {
  dateISO,
  deplaceMois,
  deplaceSemaine,
  dimancheDeSemaine,
  estAvantPremierSamediActif,
  fmtDate,
  fmtMoney,
  lundiDeSemaine,
  moisLabel,
  premierSamediActif,
  samediEstArrive,
  samedisDuMois,
  samedisSemaine,
  semaineLabel,
} from '../lib/dates';
import { useDebounce } from '../lib/useDebounce';
import { traduireErreur } from '../lib/errors';
import { journaliserExport } from '../lib/journal';
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
  const debouncedSearch = useDebounce(search, 300);

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

  const [busyBulk, setBusyBulk] = useState(false);

  const load = useCallback(async () => {
    const [rL, rF, rSet] = await Promise.all([
      toutesLesLignes<Lecteur>((de, a) =>
        supabase
          .from('lecteurs')
          .select('id, matricule, nom, prenom, fraternite_id, archived, created_at')
          .eq('archived', false)
          .order('matricule')
          .range(de, a)
      ),
      supabase.from('fraternites').select('id, nom').order('nom'),
      supabase.from('app_settings').select('value').eq('key', 'montant_cotisation').maybeSingle(),
    ]);
    setLecteurs((rL.data ?? []) as Lecteur[]);
    setFraternites((rF.data ?? []) as Fraternite[]);
    if (rSet.data) setMontantCot(Number(rSet.data.value) || 50);

    if (samedis.length > 0) {
      // 200 lecteurs × 5 samedis = 1 000 lignes : la limite PostgREST. Paginé.
      const rC = await toutesLesLignes<Cotisation>((de, a) =>
        supabase
          .from('cotisations')
          .select('id, lecteur_id, date_samedi, paye, montant')
          .gte('date_samedi', samedis[0])
          .lte('date_samedi', samedis[samedis.length - 1])
          .order('id')
          .range(de, a)
      );
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
  useRealtime('realtime-cotisations', ['cotisations'], load);

  const map = useMemo(() => {
    const m = new Map<string, Cotisation>();
    cotisations.forEach((c) => m.set(`${c.lecteur_id}|${c.date_samedi}`, c));
    return m;
  }, [cotisations]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
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
    if (estAvantPremierSamediActif(sam, l.created_at)) {
      toast(
        `Ce samedi est antérieur au premier samedi actif de ${l.prenom} (${fmtDate(premierSamediActif(l.created_at))}).`,
        'err'
      );
      return;
    }
    if (!isCaissier) {
      toast(
        "Vous n'êtes pas autorisé à saisir les cotisations : cette opération est réservée aux Caissiers.",
        'err'
      );
      return;
    }
    const current = map.get(`${l.id}|${sam}`);
    const nextPaye = !current?.paye;
    setCelluleActive(`${l.id}|${sam}`);
    const { error } = await supabase.from('cotisations').upsert(
      {
        lecteur_id: l.id,
        date_samedi: sam,
        paye: nextPaye,
        montant: nextPaye ? montantCot : 0,
      },
      { onConflict: 'lecteur_id,date_samedi' }
    );
    setCelluleActive(null);
    if (error) {
      toast(traduireErreur(error, 'enregistrer cette cotisation'), 'err');
      return;
    }
    toast(nextPaye ? `Cotisation enregistrée (${fmtMoney(montantCot)}).` : 'Cotisation marquée comme due.');
    load();
  }

  async function marquerTous(paye: boolean) {
    if (!isCaissier) {
      toast('Réservé aux Caissiers.', 'err');
      return;
    }
    if (samedisArrivesListe.length === 0) {
      toast('Aucun samedi arrivé à marquer.', 'err');
      return;
    }
    if (!confirm(`Marquer les cotisations de ${filtered.length} lecteur(s) comme ${paye ? 'payées' : 'dues'} ?`)) return;
    setBusyBulk(true);
    try {
      const payload = filtered.flatMap((l) =>
        samedisArrivesListe
          .filter((sam) => !estAvantPremierSamediActif(sam, l.created_at))
          .map((sam) => ({
            lecteur_id: l.id,
            date_samedi: sam,
            paye,
            montant: paye ? montantCot : 0,
          }))
      );
      for (let i = 0; i < payload.length; i += 200) {
        const chunk = payload.slice(i, i + 200);
        const { error } = await supabase.from('cotisations').upsert(chunk, { onConflict: 'lecteur_id,date_samedi' });
        if (error) throw error;
      }
      toast(`${filtered.length} lecteur(s) marqués ${paye ? 'payés' : 'dus'} sur leurs samedis actifs.`);
      load();
    } catch (e) {
      toast(traduireErreur(e, 'marquer les cotisations en masse'), 'err');
    } finally {
      setBusyBulk(false);
    }
  }

  // --------------------------------------------------------------- totaux
  /** Total payé sur la vue — même filtre que les colonnes de chaque ligne : les samedis antérieurs au premier samedi actif ne comptent jamais. */
  const totalPaye = filtered.reduce(
    (s, l) =>
      s +
      samedis
        .filter((sam) => !estAvantPremierSamediActif(sam, l.created_at))
        .reduce(
          (ss, sam) =>
            ss + (map.get(`${l.id}|${sam}`)?.paye ? map.get(`${l.id}|${sam}`)!.montant : 0),
          0
        ),
    0
  );
  /** Samedis arrivés et non réglés à partir du premier samedi actif — les samedis antérieurs ou à venir ne comptent pas. */
  const nbDu = filtered.reduce(
    (s, l) =>
      s +
      samedisArrivesListe.filter(
        (sam) => !estAvantPremierSamediActif(sam, l.created_at) && !map.get(`${l.id}|${sam}`)?.paye
      ).length,
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
                  await journaliserExport(
                    'cotisations',
                    `${annee}-${String(mois + 1).padStart(2, '0')}`,
                    { document: 'fiche_cotisations', vue: mode, fraternite: fId || 'globale' }
                  );
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
          sub={`${nbDu} samedi(s) actif(s) non réglé(s)`}
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
        {isCaissier && filtered.length > 0 && samedisArrivesListe.length > 0 && (
          <div className="flex w-full gap-2 sm:w-auto">
            <button
              onClick={() => marquerTous(true)}
              disabled={busyBulk}
              className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 sm:flex-none"
            >
              {busyBulk ? '...' : `✓ Tous payés (${filtered.length})`}
            </button>
            <button
              onClick={() => marquerTous(false)}
              disabled={busyBulk}
              className="flex-1 rounded-lg bg-white border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 sm:flex-none"
            >
              Tous dus
            </button>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState msg="Aucun lecteur actif pour cette vue." />
      ) : mode === 'semaine' ? (
        <>
          {/* Mobile : cartes sans scroll horizontal */}
          <ul className="space-y-2 sm:hidden">
            {filtered.map((l) => {
              const sam = samedis[0];
              const neant = sam ? estAvantPremierSamediActif(sam, l.created_at) : false;
              const c = sam && !neant ? map.get(`${l.id}|${sam}`) : undefined;
              const arrive = sam ? samediEstArrive(sam) : false;
              const duCeSamedi = sam && !neant ? !c?.paye && arrive : false;
              let paye = 0;
              let du = 0;
              samedis.forEach((s) => {
                if (!estAvantPremierSamediActif(s, l.created_at)) {
                  const cc = map.get(`${l.id}|${s}`);
                  if (cc?.paye) paye += cc.montant;
                  else if (samediEstArrive(s)) du += 1;
                }
              });
              const clickable = !neant && isCaissier;
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
                    onClick={() => sam && clickable && toggle(l, sam)}
                    disabled={!clickable || !sam}
                    aria-busy={celluleActive === `${l.id}|${sam}` || undefined}
                    title={
                      neant
                        ? `Néant — Inscription ultérieure (1er samedi actif : ${fmtDate(premierSamediActif(l.created_at))})`
                        : !isCaissier
                          ? 'Lecture seule — saisie réservée aux Caissiers'
                          : c?.paye
                            ? 'Payé — cliquez pour repasser en dû'
                            : duCeSamedi
                              ? 'Dû — cliquez pour déclarer'
                              : 'Samedi à venir'
                    }
                    className={`min-w-[72px] shrink-0 rounded-xl px-3 py-3 text-xs font-bold transition-all duration-150 active:scale-90 ${
                      neant
                        ? 'border border-slate-200 bg-slate-100 text-slate-400 font-normal italic'
                        : c?.paye
                          ? 'bg-emerald-500 text-white'
                          : duCeSamedi
                            ? 'bg-alerte text-white'
                            : 'border border-dashed border-slate-300 text-slate-400'
                    } ${clickable ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                  >
                    {neant ? 'Néant' : c?.paye ? `${c.montant} F ✓` : duCeSamedi ? 'dû' : '—'}
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
                  if (!estAvantPremierSamediActif(sam, l.created_at)) {
                    const c = map.get(`${l.id}|${sam}`);
                    if (c?.paye) paye += c.montant;
                    else if (samediEstArrive(sam)) du += 1;
                  }
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
                      const neant = estAvantPremierSamediActif(sam, l.created_at);
                      const c = !neant ? map.get(`${l.id}|${sam}`) : undefined;
                      const arrive = samediEstArrive(sam);
                      const duCeSamedi = !neant && !c?.paye && arrive;
                      const clickable = !neant && isCaissier;
                      return (
                        <td key={sam} className="px-2 py-2 text-center">
                          <button
                            onClick={() => clickable && toggle(l, sam)}
                            disabled={!clickable}
                            aria-busy={celluleActive === `${l.id}|${sam}` || undefined}
                            title={
                              neant
                                ? `Néant — Inscription ultérieure (1er samedi actif : ${fmtDate(premierSamediActif(l.created_at))})`
                                : !isCaissier
                                  ? "Lecture seule — saisie réservée aux Caissiers"
                                  : c?.paye
                                    ? 'Payé — cliquez pour repasser en dû'
                                    : duCeSamedi
                                      ? 'Dû — cliquez pour déclarer le paiement'
                                      : 'Samedi à venir — pas encore comptabilisé'
                            }
                            className={`min-w-[52px] rounded-md px-2 py-1.5 text-xs font-bold transition-all duration-150 active:scale-90 ${
                              neant
                                ? 'border border-slate-200 bg-slate-100 text-slate-400 font-normal italic text-[11px]'
                                : c?.paye
                                  ? 'bg-emerald-500 text-white'
                                  : duCeSamedi
                                    ? 'bg-alerte text-white'
                                    : 'border border-dashed border-slate-300 text-slate-400'
                            } ${
                              clickable
                                ? 'cursor-pointer hover:opacity-80'
                                : 'cursor-default'
                            }`}
                          >
                            {neant ? 'Néant' : c?.paye ? `${c.montant} F ✓` : duCeSamedi ? 'dû' : '—'}
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
                  if (!estAvantPremierSamediActif(sam, l.created_at)) {
                    const c = map.get(`${l.id}|${sam}`);
                    if (c?.paye) paye += c.montant;
                    else if (samediEstArrive(sam)) du += 1;
                  }
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
                      const neant = estAvantPremierSamediActif(sam, l.created_at);
                      const c = !neant ? map.get(`${l.id}|${sam}`) : undefined;
                      const arrive = samediEstArrive(sam);
                      const duCeSamedi = !neant && !c?.paye && arrive;
                      const clickable = !neant && isCaissier;
                      return (
                        <td key={sam} className="px-2 py-2 text-center">
                          <button
                            onClick={() => clickable && toggle(l, sam)}
                            disabled={!clickable}
                            aria-busy={celluleActive === `${l.id}|${sam}` || undefined}
                            title={
                              neant
                                ? `Néant — Inscription ultérieure (1er samedi actif : ${fmtDate(premierSamediActif(l.created_at))})`
                                : !isCaissier
                                  ? 'Lecture seule — saisie réservée aux Caissiers'
                                  : c?.paye
                                    ? 'Payé — cliquez pour repasser en dû'
                                    : duCeSamedi
                                      ? 'Dû — cliquez pour déclarer le paiement'
                                      : 'Samedi à venir — pas encore comptabilisé'
                            }
                            className={`min-w-[52px] rounded-md px-2 py-1.5 text-xs font-bold transition-all duration-150 active:scale-90 ${
                              neant
                                ? 'border border-slate-200 bg-slate-100 text-slate-400 font-normal italic text-[11px]'
                                : c?.paye
                                  ? 'bg-emerald-500 text-white'
                                  : duCeSamedi
                                    ? 'bg-alerte text-white'
                                    : 'border border-dashed border-slate-300 text-slate-400'
                            } ${clickable ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                          >
                            {neant ? 'Néant' : c?.paye ? `${c.montant} F ✓` : duCeSamedi ? 'dû' : '—'}
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
        Les samedis antérieurs à l'inscription d'un lecteur affichent <strong className="text-slate-500">Néant</strong> et ne génèrent aucun dû.
        Par défaut, un samedi arrivé actif est <strong className="text-alerte">dû</strong> :
        tant que le Caissier n'a pas basculé la case au vert, le lecteur est
        considéré comme n'ayant pas payé. L'absence ne dispense pas du paiement.
        Les samedis à venir ne sont pas comptabilisés. Les mois passés restent
        conservés et consultables.
      </p>
    </div>
  );
}
