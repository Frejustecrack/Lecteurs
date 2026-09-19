import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { toutesLesLignes } from '../lib/pagination';
import { useRealtime } from '../lib/useRealtime';
import { useAuth } from '../context/AuthContext';
import { useDebounce } from '../lib/useDebounce';
import {
  dateISO,
  deplaceMois,
  deplaceSemaine,
  dernierSamedi,
  dimancheDeSemaine,
  estAvantPremierSamediActif,
  estGelee,
  fmtDate,
  lundiDeSemaine,
  moisLabel,
  premierSamediActif,
  samediEstArrive,
  samedisDuMois,
  samedisSemaine,
  semaineLabel,
} from '../lib/dates';
import { traduireErreur } from '../lib/errors';
import { journaliserExport } from '../lib/journal';
import {
  peutExporter as rolePeutExporter,
  type Fraternite,
  type Lecteur,
  type Presence,
} from '../lib/types';
import {
  BtnGhost,
  EmptyState,
  iconPressCls,
  inputCls,
  PageHeader,
  Segmented,
  Spinner,
  StepNav,
  useToast,
} from '../components/ui';
import { exportPresences } from '../pdf/export';

/** Vue mensuelle (tous les samedis du mois) ou hebdomadaire (un seul samedi). */
type ModeVue = 'mois' | 'semaine';

export default function Presences() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
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
  const [presences, setPresences] = useState<Presence[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyPdf, setBusyPdf] = useState(false);
  const [celluleActive, setCelluleActive] = useState<string | null>(null);

  /**
   * Les samedis affichés : 3 à 5 colonnes en vue mensuelle,
   * UNE SEULE colonne en vue hebdomadaire — plus besoin de faire défiler
   * le tableau pour pointer le samedi en cours.
   */
  const samedis = useMemo<string[]>(
    () =>
      mode === 'semaine'
        ? samedisSemaine(semaine).map(dateISO)
        : samedisDuMois(annee, mois).map(dateISO),
    [mode, semaine, annee, mois]
  );

  const dernierSam = useMemo(() => dateISO(dernierSamedi()), []);
  const aujourdhui = useMemo(() => dateISO(new Date()), []);

  const periodeLabel =
    mode === 'semaine' ? semaineLabel(semaine) : moisLabel(annee, mois);

  const [busyBulk, setBusyBulk] = useState(false);

  const load = useCallback(async () => {
    if (samedis.length === 0) {
      setPresences([]);
      return;
    }
    const [rL, rF, rP] = await Promise.all([
      // Optimisé 200 max : colonnes minimales avec created_at pour premier samedi actif
      toutesLesLignes<Lecteur>((de, a) =>
        supabase
          .from('lecteurs')
          .select('id, matricule, nom, prenom, fraternite_id, archived, created_at')
          .eq('archived', false)
          .order('matricule')
          .range(de, a)
      ),
      supabase.from('fraternites').select('id, nom').order('nom'),
      // 200 lecteurs × 5 samedis = 1 000 lignes : la limite PostgREST. Paginé.
      toutesLesLignes<Presence>((de, a) =>
        supabase
          .from('presences')
          .select('id, lecteur_id, date_samedi, statut')
          .gte('date_samedi', samedis[0])
          .lte('date_samedi', samedis[samedis.length - 1])
          .order('id')
          .range(de, a)
      ),
    ]);
    setLecteurs((rL.data ?? []) as Lecteur[]);
    setFraternites((rF.data ?? []) as Fraternite[]);
    setPresences((rP.data ?? []) as Presence[]);
    setLoading(false);
  }, [samedis]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  // Synchronisation temps réel : toute modification de présence est reflétée immédiatement
  useRealtime('realtime-presences', ['presences'], load);

  const map = useMemo(() => {
    const m = new Map<string, Presence>();
    presences.forEach((p) => m.set(`${p.lecteur_id}|${p.date_samedi}`, p));
    return m;
  }, [presences]);

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

  /** Samedis déjà arrivés : seuls ceux-là sont comptabilisés. */
  const samedisArrivesListe = useMemo(
    () => samedis.filter(samediEstArrive),
    [samedis]
  );

  async function toggle(l: Lecteur, sam: string) {
    if (estAvantPremierSamediActif(sam, l.created_at)) {
      toast(
        `Ce samedi est antérieur au premier samedi actif de ${l.prenom} (${fmtDate(premierSamediActif(l.created_at))}).`,
        'err'
      );
      return;
    }
    const current = map.get(`${l.id}|${sam}`);
    const gelee = sam < dernierSam;
    if (gelee && !isAdmin) {
      toast(
        "Ce samedi est gelé (passé). Seule l'Administrateur peut effectuer une correction exceptionnelle, tracée dans les logs.",
        'err'
      );
      return;
    }
    const next = current?.statut === 'present' ? 'absent' : 'present';
    setCelluleActive(`${l.id}|${sam}`);
    const { error } = await supabase
      .from('presences')
      .upsert(
        {
          lecteur_id: l.id,
          date_samedi: sam,
          statut: next,
        },
        { onConflict: 'lecteur_id,date_samedi' }
      );
    setCelluleActive(null);
    if (error) {
      toast(
        gelee
          ? "Vous n'êtes pas autorisé à modifier un samedi déjà passé. Cette correction est réservée à l'Administrateur."
          : traduireErreur(error, 'enregistrer cette présence'),
        'err'
      );
      return;
    }
    if (gelee && isAdmin) {
      // Journalisé en base par le trigger d'audit (action « presence.correction_gelee »).
      toast(`Présence corrigée (${l.matricule}, ${fmtDate(sam)}) — tracée dans les logs.`);
    }
    load();
  }

  // Actions de masse pour 200 lecteurs : évite 200 clics le samedi matin
  async function marquerTous(statut: 'present' | 'absent') {
    if (samedisArrivesListe.length === 0) {
      toast('Aucun samedi arrivé à marquer.', 'err');
      return;
    }
    if (!confirm(`Marquer ${filtered.length} lecteur(s) comme ${statut === 'present' ? 'présents' : 'absents'} sur ${samedisArrivesListe.length} samedi(s) ?`)) return;
    setBusyBulk(true);
    try {
      const payload = filtered.flatMap((l) =>
        samedisArrivesListe
          .filter((sam) => !estAvantPremierSamediActif(sam, l.created_at))
          .map((sam) => ({
            lecteur_id: l.id,
            date_samedi: sam,
            statut,
          }))
      );
      // Upsert par paquets de 200 pour éviter de surcharger PostgREST (200*5=1000)
      for (let i = 0; i < payload.length; i += 200) {
        const chunk = payload.slice(i, i + 200);
        const { error } = await supabase.from('presences').upsert(chunk, { onConflict: 'lecteur_id,date_samedi' });
        if (error) throw error;
      }
      toast(`${filtered.length} lecteur(s) marqués ${statut} sur leurs samedis actifs.`);
      load();
    } catch (e) {
      toast(traduireErreur(e, 'marquer les présences en masse'), 'err');
    } finally {
      setBusyBulk(false);
    }
  }

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

  if (loading) return <Spinner label="Chargement des présences…" />;

  const peutExporter = rolePeutExporter(profile?.role);

  return (
    <div>
      <PageHeader
        title="Présences"
        sub="Pointage des samedis — un samedi non pointé est considéré comme absent"
        actions={
          peutExporter ? (
            <BtnGhost
              busy={busyPdf}
              busyLabel="PDF…"
              onClick={async () => {
                setBusyPdf(true);
                try {
                  exportPresences({
                    annee,
                    mois,
                    fraternite: fraternites.find((f) => f.id === fId)?.nom ?? null,
                    lecteurs: filtered,
                    presences,
                    auteur: profile?.full_name ?? '—',
                    samedis,
                    periode: periodeLabel,
                  });
                  await journaliserExport(
                    'presences',
                    `${annee}-${String(mois + 1).padStart(2, '0')}`,
                    { document: 'fiche_presences', vue: mode, fraternite: fId || 'globale' }
                  );
                  toast('PDF généré.');
                } catch (err) {
                  toast(traduireErreur(err, 'générer le PDF des présences'), 'err');
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

      {/* ---------------------------------------------------------- filtres + bulk 200 */}
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
        {filtered.length > 0 && samedisArrivesListe.length > 0 && (
          <div className="flex w-full gap-2 sm:w-auto">
            <button
              onClick={() => marquerTous('present')}
              disabled={busyBulk}
              className={`flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 sm:flex-none ${busyBulk ? 'opacity-50' : ''}`}
            >
              {busyBulk ? '...' : `✓ Tous présents (${filtered.length})`}
            </button>
            <button
              onClick={() => marquerTous('absent')}
              disabled={busyBulk}
              className="flex-1 rounded-lg bg-white border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 sm:flex-none"
            >
              {busyBulk ? '...' : `✗ Tous absents`}
            </button>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState msg="Aucun lecteur actif. Créez des lecteurs pour enregistrer les présences." />
      ) : mode === 'semaine' ? (
        <>
          {/* Mobile : cartes empilées — pas de scroll horizontal, une seule case visible d'emblée */}
          <ul className="space-y-2 sm:hidden">
            {filtered.map((l) => {
              const sam = samedis[0];
              const neant = sam ? estAvantPremierSamediActif(sam, l.created_at) : false;
              const p = sam && !neant ? map.get(`${l.id}|${sam}`) : undefined;
              const arrive = sam ? samediEstArrive(sam) : false;
              const gelee = sam ? estGelee(new Date(sam + 'T12:00:00')) : false;
              const clickable = !neant && (!gelee || isAdmin);
              const vert = !neant && p?.statut === 'present';
              const rouge = !neant && (p?.statut === 'absent' || (!p && arrive));
              
              const samedisVisiblesLecteur = samedis.filter((s) => !estAvantPremierSamediActif(s, l.created_at));
              const samedisArrivesLecteur = samedisArrivesListe.filter((s) => !estAvantPremierSamediActif(s, l.created_at));
              const pres = samedisVisiblesLecteur.filter((s) => map.get(`${l.id}|${s}`)?.statut === 'present').length;
              const abs = samedisArrivesLecteur.filter((s) => map.get(`${l.id}|${s}`)?.statut !== 'present').length;
              return (
                <li
                  key={l.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs font-semibold text-cdlj">{l.matricule}</div>
                    <Link
                      to={`/lecteurs/${l.id}`}
                      className="block truncate text-sm font-medium text-slate-800 hover:text-cdlj"
                    >
                      {l.prenom} {l.nom.toUpperCase()}
                    </Link>
                    <div className="mt-0.5 text-xs font-semibold text-slate-500">{pres}P · {abs}A</div>
                  </div>
                  <button
                    onClick={() => sam && clickable && toggle(l, sam)}
                    disabled={!clickable || !sam}
                    aria-busy={celluleActive === `${l.id}|${sam}` || undefined}
                    title={
                      neant
                        ? `Néant — Inscription ultérieure (1er samedi actif : ${fmtDate(premierSamediActif(l.created_at))})`
                        : !clickable
                          ? 'Samedi gelé — correction Admin uniquement'
                          : !arrive
                            ? 'Samedi à venir — pas encore comptabilisé'
                            : vert
                              ? 'Présent — cliquez pour basculer en absent'
                              : 'Absent — cliquez pour basculer en présent'
                    }
                    className={`h-12 w-20 shrink-0 rounded-xl text-base font-bold transition-all duration-150 active:scale-90 ${
                      neant
                        ? 'border border-slate-200 bg-slate-100 text-slate-400 font-normal italic text-xs'
                        : vert
                          ? 'bg-emerald-500 text-white'
                          : rouge
                            ? 'bg-alerte text-white'
                            : 'border border-dashed border-slate-300 text-slate-300'
                    } ${clickable ? 'cursor-pointer hover:opacity-80' : 'cursor-not-allowed opacity-70'}`}
                  >
                    {neant ? 'Néant' : vert ? '✓' : rouge ? '✗' : '—'}
                  </button>
                </li>
              );
            })}
          </ul>
          {/* Desktop : tableau hebdomadaire sans scroll horizontal */}
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
                    {s === dernierSam && (
                      <span className="mt-1 inline-block rounded bg-blue-50 px-1 text-[10px] font-bold text-cdlj">
                        DERNIER SAM.
                      </span>
                    )}
                    {s === aujourdhui && (
                      <span className="mt-1 inline-block rounded bg-amber-50 px-1 text-[10px] font-bold text-amber-700">
                        AUJOURD'HUI
                      </span>
                    )}
                    {!samediEstArrive(s) && (
                      <span className="mt-1 inline-block rounded bg-slate-100 px-1 text-[10px] font-bold text-slate-400">
                        À VENIR
                      </span>
                    )}
                  </th>
                ))}
                <th className="px-2 py-3 text-center">Récap</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((l) => {
                const samedisVisiblesLecteur = samedis.filter((s) => !estAvantPremierSamediActif(s, l.created_at));
                const samedisArrivesLecteur = samedisArrivesListe.filter((s) => !estAvantPremierSamediActif(s, l.created_at));
                const pres = samedisVisiblesLecteur.filter(
                  (s) => map.get(`${l.id}|${s}`)?.statut === 'present'
                ).length;
                const abs = samedisArrivesLecteur.filter(
                  (s) => map.get(`${l.id}|${s}`)?.statut !== 'present'
                ).length;
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
                    {samedis.map((s) => {
                      const neant = estAvantPremierSamediActif(s, l.created_at);
                      const p = !neant ? map.get(`${l.id}|${s}`) : undefined;
                      const arrive = samediEstArrive(s);
                      const gelee = estGelee(new Date(s + 'T12:00:00'));
                      const clickable = !neant && (!gelee || isAdmin);
                      const vert = !neant && p?.statut === 'present';
                      const rouge = !neant && (p?.statut === 'absent' || (!p && arrive));
                      return (
                        <td key={s} className="px-2 py-2 text-center">
                          <button
                            onClick={() => clickable && toggle(l, s)}
                            disabled={!clickable}
                            aria-busy={celluleActive === `${l.id}|${s}` || undefined}
                            title={
                              neant
                                ? `Néant — Inscription ultérieure (1er samedi actif : ${fmtDate(premierSamediActif(l.created_at))})`
                                : !clickable
                                  ? 'Samedi gelé — correction Admin uniquement'
                                  : !arrive
                                    ? 'Samedi à venir — pas encore comptabilisé'
                                    : vert
                                      ? 'Présent — cliquez pour basculer en absent'
                                      : 'Absent — cliquez pour basculer en présent'
                            }
                            className={`h-8 min-w-[44px] rounded-md px-1 text-xs font-bold transition-all duration-150 active:scale-90 ${
                              neant
                                ? 'border border-slate-200 bg-slate-100 text-slate-400 font-normal italic text-[11px]'
                                : vert
                                  ? 'bg-emerald-500 text-white'
                                  : rouge
                                    ? 'bg-alerte text-white'
                                    : 'border border-dashed border-slate-300 text-slate-300'
                            } ${
                              clickable
                                ? 'cursor-pointer hover:opacity-80'
                                : 'cursor-not-allowed opacity-70'
                            }`}
                          >
                            {neant ? 'Néant' : vert ? '✓' : rouge ? '✗' : '—'}
                          </button>
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap px-2 py-2 text-center text-xs font-semibold text-slate-500">
                      {pres}P · {abs}A
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
                    {s === dernierSam && (
                      <span className="mt-1 inline-block rounded bg-blue-50 px-1 text-[10px] font-bold text-cdlj">
                        DERNIER SAM.
                      </span>
                    )}
                    {s === aujourdhui && (
                      <span className="mt-1 inline-block rounded bg-amber-50 px-1 text-[10px] font-bold text-amber-700">
                        AUJOURD'HUI
                      </span>
                    )}
                    {!samediEstArrive(s) && (
                      <span className="mt-1 inline-block rounded bg-slate-100 px-1 text-[10px] font-bold text-slate-400">
                        À VENIR
                      </span>
                    )}
                  </th>
                ))}
                <th className="px-2 py-3 text-center">Récap</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((l) => {
                const samedisVisiblesLecteur = samedis.filter((s) => !estAvantPremierSamediActif(s, l.created_at));
                const samedisArrivesLecteur = samedisArrivesListe.filter((s) => !estAvantPremierSamediActif(s, l.created_at));
                const pres = samedisVisiblesLecteur.filter((s) => map.get(`${l.id}|${s}`)?.statut === 'present').length;
                const abs = samedisArrivesLecteur.filter((s) => map.get(`${l.id}|${s}`)?.statut !== 'present').length;
                return (
                  <tr key={l.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-cdlj">{l.matricule}</td>
                    <td className="max-w-[220px] truncate px-3 py-2">
                      <Link to={`/lecteurs/${l.id}`} className="font-medium text-slate-700 hover:text-cdlj">
                        {l.prenom} {l.nom.toUpperCase()}
                      </Link>
                    </td>
                    {samedis.map((s) => {
                      const neant = estAvantPremierSamediActif(s, l.created_at);
                      const p = !neant ? map.get(`${l.id}|${s}`) : undefined;
                      const arrive = samediEstArrive(s);
                      const gelee = estGelee(new Date(s + 'T12:00:00'));
                      const clickable = !neant && (!gelee || isAdmin);
                      const vert = !neant && p?.statut === 'present';
                      const rouge = !neant && (p?.statut === 'absent' || (!p && arrive));
                      return (
                        <td key={s} className="px-2 py-2 text-center">
                          <button
                            onClick={() => clickable && toggle(l, s)}
                            disabled={!clickable}
                            aria-busy={celluleActive === `${l.id}|${s}` || undefined}
                            title={
                              neant
                                ? `Néant — Inscription ultérieure (1er samedi actif : ${fmtDate(premierSamediActif(l.created_at))})`
                                : !clickable
                                  ? 'Samedi gelé — correction Admin uniquement'
                                  : !arrive
                                    ? 'Samedi à venir — pas encore comptabilisé'
                                    : vert
                                      ? 'Présent — cliquez pour basculer en absent'
                                      : 'Absent — cliquez pour basculer en présent'
                            }
                            className={`h-8 min-w-[44px] rounded-md px-1 text-xs font-bold transition-all duration-150 active:scale-90 ${
                              neant
                                ? 'border border-slate-200 bg-slate-100 text-slate-400 font-normal italic text-[11px]'
                                : vert ? 'bg-emerald-500 text-white' : rouge ? 'bg-alerte text-white' : 'border border-dashed border-slate-300 text-slate-300'
                            } ${clickable ? 'cursor-pointer hover:opacity-80' : 'cursor-not-allowed opacity-70'}`}
                          >
                            {neant ? 'Néant' : vert ? '✓' : rouge ? '✗' : '—'}
                          </button>
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap px-2 py-2 text-center text-xs font-semibold text-slate-500">{pres}P · {abs}A</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ------------------------------------------------------------------
          Légende — puces reprenant exactement les couleurs des cellules du
          tableau (vert = présent, rouge = absent, gris pointillé = à venir). */}
      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-7 items-center gap-1.5 rounded-md bg-emerald-500 px-2.5 text-sm font-bold text-white">
            <span aria-hidden>✓</span>
            <span className="text-xs font-semibold">Présent (vert)</span>
          </span>
          <span aria-hidden className="text-slate-300">·</span>
          <span className="inline-flex h-7 items-center gap-1.5 rounded-md bg-alerte px-2.5 text-sm font-bold text-white">
            <span aria-hidden>✗</span>
            <span className="text-xs font-semibold">Absent (rouge)</span>
          </span>
          <span aria-hidden className="text-slate-300">·</span>
          <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-100 px-2.5 text-xs font-semibold text-slate-400">
            <span>Néant (non inscrit)</span>
          </span>
          <span aria-hidden className="text-slate-300">·</span>
          <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-dashed border-slate-300 px-2.5 text-sm font-bold text-slate-400">
            <span aria-hidden>—</span>
            <span className="text-xs font-semibold">à venir (gris)</span>
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          Les samedis antérieurs à l'inscription d'un lecteur affichent <strong className="text-slate-500">Néant</strong> et ne génèrent aucune absence.
          Par défaut un samedi arrivé est <strong className="text-alerte">rouge</strong> :
          tant que la présence n'a pas été basculée au vert, le lecteur est
          considéré comme absent. Un samedi passé est gelé — correction
          exceptionnelle de l'Administrateur uniquement, tracée dans les logs. Le
          récapitulatif par lecteur et les listes de présents/absents se
          consultent dans l'onglet{' '}
          <Link to="/suivis" className="font-semibold text-cdlj hover:underline">
            Suivis
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

