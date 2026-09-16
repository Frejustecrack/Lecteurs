import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { toutesLesLignes } from '../lib/pagination';
import { useRealtime } from '../lib/useRealtime';
import { useAuth } from '../context/AuthContext';
import { traduireErreur } from '../lib/errors';
import { journaliserExport } from '../lib/journal';
import {
  dateISO,
  deplaceMois,
  deplaceSemaine,
  dernierSamedi,
  dimancheDeSemaine,
  estSemaineCourante,
  fmtDate,
  lundiDeSemaine,
  moisLabel,
  samediEstArrive,
  samedisDuMois,
  samedisSemaine,
  semaineLabel,
} from '../lib/dates';
import { peutExporter as rolePeutExporter, type Fraternite, type Lecteur, type Presence } from '../lib/types';
import {
  absencesEffectives,
  appliquerFiltreRecap,
  calculerRecaps,
  filtrerRecaps,
  trierRecaps,
  type FiltreRecap,
  type TriRecap,
} from '../lib/recap';
import {
  Badge,
  BtnGhost,
  EmptyState,
  iconPressCls,
  inputCls,
  PageHeader,
  pressCls,
  Segmented,
  Spinner,
  StatCard,
  StepNav,
  useToast,
} from '../components/ui';
import { exportSuivis } from '../pdf/export';

/** Vue hebdomadaire (le samedi de la semaine) ou mensuelle (tous les samedis). */
type ModeVue = 'semaine' | 'mois';

const FILTRES: { value: FiltreRecap; label: string; aide: string }[] = [
  {
    value: 'tous',
    label: 'Tous les lecteurs',
    aide: 'Récapitulatif complet : matricule, nom, prénom, présences et absences.',
  },
  {
    value: 'absents',
    label: 'Ayant été absents',
    aide: 'Lecteurs comptant au moins une absence sur la période affichée.',
  },
  {
    value: 'parfaits',
    label: 'Présents tout le long',
    aide: 'Lecteurs présents à toutes les séances de la période (aucune absence, aucune séance manquante).',
  },
  {
    value: 'incomplets',
    label: 'Saisie incomplète',
    aide: "Lecteurs dont au moins une séance n'a pas encore été pointée.",
  },
];

export default function Suivis() {
  const now = new Date();
  const { profile } = useAuth();
  const { toast } = useToast();
  // Cahier des charges §17 : Admin, Chargé des Opérations et Caissiers.
  const peutExporter = rolePeutExporter(profile?.role);
  const [busyPdf, setBusyPdf] = useState(false);

  // ---------------------------------------------------------------- état
  const [mode, setMode] = useState<ModeVue>('mois');
  const [annee, setAnnee] = useState(now.getFullYear());
  const [mois, setMois] = useState(now.getMonth());
  const [semaine, setSemaine] = useState<Date>(lundiDeSemaine(now));
  const [samediChoisi, setSamediChoisi] = useState('');
  const [filtre, setFiltre] = useState<FiltreRecap>('tous');
  const [fId, setFId] = useState('');
  const [search, setSearch] = useState('');
  const [tri, setTri] = useState<TriRecap>('nom');
  const [triAsc, setTriAsc] = useState(true);

  const [lecteurs, setLecteurs] = useState<Lecteur[]>([]);
  const [fraternites, setFraternites] = useState<Fraternite[]>([]);
  const [presences, setPresences] = useState<Presence[]>([]);
  const [loading, setLoading] = useState(true);

  // ------------------------------------------------------- période affichée
  /** Les samedis de la période (1 en vue hebdomadaire, 3 à 5 en vue mensuelle). */
  const samedisPeriode = useMemo<string[]>(() => {
    if (mode === 'semaine') return samedisSemaine(semaine).map(dateISO);
    return samedisDuMois(annee, mois).map(dateISO);
  }, [mode, semaine, annee, mois]);

  /**
   * Les samedis réellement pris en compte dans le récapitulatif.
   * Un samedi qui n'est pas encore arrivé n'est jamais compté : ni présence,
   * ni absence (règle CDLJ — on ne raisonne que sur les samedis passés et
   * le samedi du jour).
   */
  const samedisComptes = useMemo(() => {
    const base =
      samediChoisi && samedisPeriode.includes(samediChoisi)
        ? [samediChoisi]
        : samedisPeriode;
    return base.filter(samediEstArrive);
  }, [samediChoisi, samedisPeriode]);

  const periodeLabel =
    mode === 'semaine' ? semaineLabel(semaine) : moisLabel(annee, mois);

  // ------------------------------------------------------------ chargement - optimisé 200 max
  const load = useCallback(async () => {
    const [rL, rF] = await Promise.all([
      toutesLesLignes<Lecteur>((de, a) =>
        supabase
          .from('lecteurs')
          .select('id, matricule, nom, prenom, fraternite_id, archived')
          .eq('archived', false)
          .order('matricule')
          .range(de, a)
      ),
      supabase.from('fraternites').select('id, nom').order('nom'),
    ]);
    setLecteurs((rL.data ?? []) as Lecteur[]);
    setFraternites((rF.data ?? []) as Fraternite[]);

    if (samedisPeriode.length === 0) {
      setPresences([]);
      setLoading(false);
      return;
    }
    // 200 lecteurs × 5 samedis = 1 000 lignes : la limite PostgREST. Paginé.
    const rP = await toutesLesLignes<Pick<Presence, 'lecteur_id' | 'date_samedi' | 'statut'>>((de, a) =>
      supabase
        .from('presences')
        .select('lecteur_id, date_samedi, statut')
        .gte('date_samedi', samedisPeriode[0])
        .lte('date_samedi', samedisPeriode[samedisPeriode.length - 1])
        .order('id')
        .range(de, a)
    );
    setPresences((rP.data ?? []) as Presence[]);
    setLoading(false);
  }, [samedisPeriode]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  // Synchronisation temps réel : toute modification de présence est reflétée dans le récap
  useRealtime('realtime-suivis', ['presences', 'lecteurs'], load);

  // Le samedi sélectionné doit rester dans la période courante.
  useEffect(() => {
    if (samediChoisi && !samedisPeriode.includes(samediChoisi)) setSamediChoisi('');
  }, [samedisPeriode, samediChoisi]);

  // ------------------------------------------------------------- récapitulatif
  // Le calcul lui-même vit dans `src/lib/recap.ts` (logique pure, vérifiable).
  const recaps = useMemo(
    () => calculerRecaps(lecteurs, presences, samedisComptes),
    [lecteurs, presences, samedisComptes]
  );

  const filtres = useMemo(
    () => filtrerRecaps(recaps, { fraterniteId: fId, recherche: search, filtre }),
    [recaps, fId, search, filtre]
  );

  const tries = useMemo(() => trierRecaps(filtres, tri, triAsc), [filtres, tri, triAsc]);

  // ---------------------------------------------------------------- indicateurs
  const nbSeances = samedisComptes.length;
  const nbAssidus = filtres.filter((r) => r.total > 0 && r.present === r.total).length;
  const nbAbsents = filtres.filter((r) => absencesEffectives(r) > 0).length;
  const moyennePresents =
    nbSeances > 0
      ? Math.round(
          (filtres.reduce((s, r) => s + r.present, 0) / nbSeances) * 10
        ) / 10
      : 0;
  const tauxGlobal =
    filtres.length > 0
      ? Math.round(filtres.reduce((s, r) => s + r.taux, 0) / filtres.length)
      : 0;

  // ---------------------------------------------------------------- navigation
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
    if (mode === 'semaine') setSemaine(lundiDeSemaine(t));
    else {
      setAnnee(t.getFullYear());
      setMois(t.getMonth());
    }
    setSamediChoisi('');
  }

  function basculeTri(colonne: TriRecap) {
    if (tri === colonne) setTriAsc(!triAsc);
    else {
      setTri(colonne);
      setTriAsc(true);
    }
  }

  const flecheTri = (c: TriRecap) => (tri === c ? (triAsc ? ' ↑' : ' ↓') : '');
  const fraterniteNom = (id: string | null) =>
    fraternites.find((f) => f.id === id)?.nom ?? null;

  const samedisArrivesMois = useMemo(
    () => samedisPeriode.filter(samediEstArrive),
    [samedisPeriode]
  );

  const aideFiltre = FILTRES.find((f) => f.value === filtre)?.aide;
  const dernierSam = dateISO(dernierSamedi());

  /**
   * Export PDF du récapitulatif **tel qu'il est affiché** : mêmes samedis
   * comptés, mêmes filtres, même tri. Chaque export est tracé.
   */
  async function exporterPdf() {
    if (!peutExporter) {
      toast("Vous n'êtes pas autorisé à exporter ce récapitulatif.", 'err');
      return;
    }
    if (tries.length === 0) {
      toast('Aucun lecteur à exporter avec les filtres actuels.', 'err');
      return;
    }
    setBusyPdf(true);
    try {
      const morceaux = [
        filtre !== 'tous' ? FILTRES.find((f) => f.value === filtre)?.label : null,
        fId ? `Fraternité : ${fraterniteNom(fId) ?? '—'}` : null,
        search.trim() ? `Recherche : « ${search.trim()} »` : null,
        samediChoisi ? `Samedi ${fmtDate(samediChoisi)}` : null,
      ].filter(Boolean);
      await exportSuivis({
        periode: periodeLabel,
        samedis: samedisComptes,
        recaps: tries,
        fraterniteNom,
        contexte: morceaux.length > 0 ? morceaux.join('   •   ') : undefined,
        auteur: profile?.full_name ?? '—',
      });
      await journaliserExport('suivis', periodeLabel, { document: 'suivis', periode: periodeLabel });
      toast('Le récapitulatif PDF a été généré.');
    } catch (err) {
      toast(traduireErreur(err, 'générer le récapitulatif PDF'), 'err');
    } finally {
      setBusyPdf(false);
    }
  }

  if (loading) return <Spinner label="Chargement du suivi…" />;

  return (
    <div>
      <PageHeader
        title="Suivis"
        sub="Récapitulatif des présences et des absences — vue hebdomadaire ou mensuelle"
        actions={
          peutExporter ? (
            <BtnGhost
              onClick={exporterPdf}
              busy={busyPdf}
              busyLabel="PDF…"
              disabled={tries.length === 0}
              title={
                tries.length === 0
                  ? 'Aucun lecteur à exporter avec les filtres actuels'
                  : `Exporter les ${tries.length} lecteur(s) affichés en PDF`
              }
            >
              Bilan PDF
            </BtnGhost>
          ) : undefined
        }
      />

      {/* ---------------------------------------------------- vue & période */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Segmented
          value={mode}
          onChange={(v) => {
            setMode(v);
            setSamediChoisi('');
          }}
          options={[
            { value: 'semaine', label: 'Vue hebdomadaire', icon: '📆' },
            { value: 'mois', label: 'Vue mensuelle', icon: '🗓️' },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2">
          <StepNav label={periodeLabel} width="min-w-[190px]" onPrev={allerPrecedent} onNext={allerSuivant} />
          <button onClick={revenirAujourdhui} className={`${iconPressCls} px-3 py-2 text-xs font-semibold text-cdlj`}>
            Aujourd'hui
          </button>
        </div>
      </div>

      {/* Samedi précis (vue mensuelle uniquement) */}
      {mode === 'mois' && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label htmlFor="samedi-suivi" className="text-sm font-medium text-slate-700">
            Samedi précis :
          </label>
          <select
            id="samedi-suivi"
            value={samediChoisi}
            onChange={(e) => setSamediChoisi(e.target.value)}
            className={`${inputCls} w-full sm:w-auto`}
          >
            <option value="">
              Tous les samedis arrivés du mois ({samedisArrivesMois.length} sur{' '}
              {samedisPeriode.length})
            </option>
            {samedisArrivesMois.map((s) => (
              <option key={s} value={s}>
                Samedi {fmtDate(s)}
                {s === dernierSam ? ' (dernier samedi)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* ------------------------------------------------------- indicateurs */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Lecteurs affichés"
          value={tries.length}
          sub={`sur ${lecteurs.length} lecteur(s) actif(s)`}
        />
        <StatCard
          label="Séances comptées"
          value={nbSeances}
          tone="blue"
          sub={samediChoisi ? 'samedi sélectionné' : periodeLabel}
        />
        <StatCard
          label="Présents en moyenne"
          value={moyennePresents}
          tone="green"
          sub={`taux moyen ${tauxGlobal} %`}
        />
        <StatCard
          label="Assidus / absents"
          value={`${nbAssidus} / ${nbAbsents}`}
          tone={nbAbsents > 0 ? 'red' : 'green'}
          sub="100 % de présence / ≥ 1 absence"
        />
      </div>

      {/* ----------------------------------------------------------- filtres */}
      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {FILTRES.map((f) => {
            const actif = filtre === f.value;
            const compte = appliquerFiltreRecap(recaps, f.value).length;
            return (
              <button
                key={f.value}
                onClick={() => setFiltre(f.value)}
                aria-pressed={actif}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${pressCls} ${
                  actif
                    ? 'bg-cdlj text-white shadow-sm'
                    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {f.label}
                <span className={`ml-1 ${actif ? 'text-white/80' : 'text-slate-400'}`}>
                  {compte}
                </span>
              </button>
            );
          })}
        </div>

        {aideFiltre && (
          <p className="mt-2 text-xs text-slate-400">{aideFiltre}</p>
        )}

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select
            value={fId}
            onChange={(e) => setFId(e.target.value)}
            aria-label="Filtrer par fraternité"
            className={`${inputCls} w-full sm:w-auto`}
          >
            <option value="">Toutes les fraternités</option>
            {fraternites.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nom}
              </option>
            ))}
          </select>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher (matricule, nom, prénom…)"
            aria-label="Rechercher un lecteur"
            className={`${inputCls} min-w-0 flex-1`}
          />
        </div>
      </div>

      {/* ---------------------------------------------------------- résultats */}
      {tries.length === 0 ? (
        <EmptyState msg="Aucun lecteur ne correspond à ce filtre pour la période affichée." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Récapitulatif — {periodeLabel}
            {samediChoisi ? ` · samedi ${fmtDate(samediChoisi)}` : ''}
          </div>

          {/* ---- Mobile : cartes empilées ---- */}
          <ul className="divide-y divide-slate-100 sm:hidden">
            {tries.map((r) => (
              <li key={r.lecteur.id} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-xs font-semibold text-cdlj">
                      {r.lecteur.matricule}
                    </div>
                    <Link
                      to={`/lecteurs/${r.lecteur.id}`}
                      className="block truncate text-sm font-medium text-slate-800 hover:text-cdlj"
                    >
                      {r.lecteur.prenom} {r.lecteur.nom.toUpperCase()}
                    </Link>
                    {fraterniteNom(r.lecteur.fraternite_id) && (
                      <div className="mt-0.5 truncate text-xs text-slate-400">
                        {fraterniteNom(r.lecteur.fraternite_id)}
                      </div>
                    )}
                  </div>
                  <Badge
                    tone={
                      r.total > 0 && r.present === r.total
                        ? 'green'
                        : absencesEffectives(r) > 0
                          ? 'red'
                          : 'amber'
                    }
                  >
                    {r.total > 0 && r.present === r.total
                      ? 'Assidu'
                      : absencesEffectives(r) > 0
                        ? `${absencesEffectives(r)} absence(s)`
                        : '—'}
                  </Badge>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-emerald-50 py-1.5 font-bold text-emerald-700">
                    {r.present} <span className="font-medium">présent(s)</span>
                  </div>
                  <div className="rounded-lg bg-red-50 py-1.5 font-bold text-alerte">
                    {absencesEffectives(r)} <span className="font-medium">absence(s)</span>
                  </div>
                  <div className="rounded-lg bg-slate-50 py-1.5 font-bold text-slate-500">
                    {r.taux} <span className="font-medium">%</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {/* ---- Tablette / desktop : tableau ---- */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5">
                    <button onClick={() => basculeTri('matricule')} className={`hover:text-cdlj ${pressCls}`}>
                      Matricule{flecheTri('matricule')}
                    </button>
                  </th>
                  <th className="px-3 py-2.5">
                    <button onClick={() => basculeTri('nom')} className={`hover:text-cdlj ${pressCls}`}>
                      Nom{flecheTri('nom')}
                    </button>
                  </th>
                  <th className="px-3 py-2.5">Prénom</th>
                  <th className="px-3 py-2.5">Fraternité</th>
                  <th className="px-3 py-2.5 text-center">
                    <button onClick={() => basculeTri('presences')} className={`hover:text-cdlj ${pressCls}`}>
                      Présences{flecheTri('presences')}
                    </button>
                  </th>
                  <th className="px-3 py-2.5 text-center">
                    <button onClick={() => basculeTri('absences')} className={`hover:text-cdlj ${pressCls}`}>
                      Absences{flecheTri('absences')}
                    </button>
                  </th>
                  <th className="px-3 py-2.5 text-center">Non pointé</th>
                  <th className="px-3 py-2.5 text-right">Taux</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tries.map((r) => (
                  <tr key={r.lecteur.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-cdlj">
                      {r.lecteur.matricule}
                    </td>
                    <td className="max-w-[200px] truncate px-3 py-2 font-medium text-slate-800">
                      <Link to={`/lecteurs/${r.lecteur.id}`} className="hover:text-cdlj">
                        {r.lecteur.nom.toUpperCase()}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{r.lecteur.prenom}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {fraterniteNom(r.lecteur.fraternite_id) ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-center font-semibold text-emerald-600">
                      {r.present}
                    </td>
                    <td className="px-3 py-2 text-center font-semibold text-alerte">
                      {absencesEffectives(r)}
                    </td>
                    <td className="px-3 py-2 text-center text-slate-400">
                      {r.nonSaisi > 0 ? r.nonSaisi : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="inline-flex items-center gap-2">
                        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                          <span
                            className="block h-full rounded-full bg-emerald-500"
                            style={{ width: `${r.taux}%` }}
                          />
                        </span>
                        <span className="w-9 text-right text-xs font-semibold text-slate-600">
                          {r.taux} %
                        </span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-slate-400">
        Le récapitulatif est calculé sur {nbSeances} séance(s)
        {samediChoisi ? ` (samedi ${fmtDate(samediChoisi)})` : ` — ${periodeLabel}`}.
        {mode === 'semaine'
          ? ` Semaine du ${fmtDate(lundiDeSemaine(semaine))} au ${fmtDate(dimancheDeSemaine(semaine))}${
              estSemaineCourante(semaine) ? ' (semaine en cours)' : ''
            }.`
          : ''}{' '}
        Un samedi arrivé mais non pointé compte comme une absence (« à preuve du
        contraire ») ; les samedis à venir ne sont jamais comptabilisés.
      </p>
    </div>
  );
}
