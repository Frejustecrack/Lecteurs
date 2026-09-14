import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import {
  dateISO,
  deplaceMois,
  deplaceSemaine,
  dernierSamedi,
  dimancheDeSemaine,
  estGelee,
  fmtDate,
  lundiDeSemaine,
  moisLabel,
  samediEstArrive,
  samedisDuMois,
  samedisSemaine,
  semaineLabel,
} from '../lib/dates';
import { traduireErreur } from '../lib/errors';
import type { Fraternite, Lecteur, Presence } from '../lib/types';
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

  const load = useCallback(async () => {
    if (samedis.length === 0) {
      setPresences([]);
      return;
    }
    const [rL, rF, rP] = await Promise.all([
      supabase.from('lecteurs').select('*').eq('archived', false).order('matricule'),
      supabase.from('fraternites').select('*').order('nom'),
      supabase
        .from('presences')
        .select('*')
        .gte('date_samedi', samedis[0])
        .lte('date_samedi', samedis[samedis.length - 1]),
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

  const map = useMemo(() => {
    const m = new Map<string, Presence>();
    presences.forEach((p) => m.set(`${p.lecteur_id}|${p.date_samedi}`, p));
    return m;
  }, [presences]);

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

  /** Samedis déjà arrivés : seuls ceux-là sont comptabilisés. */
  const samedisArrivesListe = useMemo(
    () => samedis.filter(samediEstArrive),
    [samedis]
  );

  async function toggle(l: Lecteur, sam: string) {
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
          recorded_by: profile?.id ?? null,
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
      await supabase.rpc('log_action', {
        p_action: 'presence.correction_gelee',
        p_objet_type: 'presences',
        p_objet_ref: l.matricule,
        p_detail: JSON.stringify({ date_samedi: sam, nouveau_statut: next }),
      });
      toast(`Présence corrigée (${l.matricule}, ${fmtDate(sam)}) — tracée dans les logs.`);
    }
    load();
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

  const peutExporter =
    profile?.role === 'admin' ||
    profile?.role === 'co' ||
    profile?.role === 'caissier';

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
                  await supabase.rpc('log_action', {
                    p_action: 'export.pdf',
                    p_objet_type: 'presences',
                    p_objet_ref: `${annee}-${String(mois + 1).padStart(2, '0')}`,
                    p_detail: JSON.stringify({
                      document: 'fiche_presences',
                      vue: mode,
                      fraternite: fId || 'globale',
                    }),
                  });
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

      {/* ---------------------------------------------------------- filtres */}
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
        <EmptyState msg="Aucun lecteur actif. Créez des lecteurs pour enregistrer les présences." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table
            className={`w-full text-left text-sm ${
              mode === 'semaine' ? 'min-w-[420px]' : 'min-w-[560px]'
            }`}
          >
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
                // À preuve du contraire : un samedi arrivé non pointé = absent.
                const pres = samedis.filter(
                  (s) => map.get(`${l.id}|${s}`)?.statut === 'present'
                ).length;
                const abs = samedisArrivesListe.filter(
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
                      const p = map.get(`${l.id}|${s}`);
                      const arrive = samediEstArrive(s);
                      const gelee = estGelee(new Date(s + 'T12:00:00'));
                      const clickable = !gelee || isAdmin;
                      // Rouge par défaut dès que le samedi est arrivé.
                      const vert = p?.statut === 'present';
                      const rouge = p?.statut === 'absent' || (!p && arrive);
                      return (
                        <td key={s} className="px-2 py-2 text-center">
                          <button
                            onClick={() => clickable && toggle(l, s)}
                            disabled={!clickable}
                            aria-busy={celluleActive === `${l.id}|${s}` || undefined}
                            title={
                              !clickable
                                ? 'Samedi gelé — correction Admin uniquement'
                                : !arrive
                                  ? 'Samedi à venir — pas encore comptabilisé'
                                  : vert
                                    ? 'Présent — cliquez pour basculer en absent'
                                    : 'Absent — cliquez pour basculer en présent'
                            }
                            className={`h-8 w-10 rounded-md text-sm font-bold transition-all duration-150 active:scale-90 ${
                              vert
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
                            {vert ? '✓' : rouge ? '✗' : '—'}
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
      )}

      <p className="mt-3 text-xs text-slate-400">
        ✓ Présent · ✗ Absent · — Samedi à venir (non comptabilisé). Par défaut un
        samedi arrivé est <strong className="text-alerte">rouge</strong> : tant que
        la présence n'a pas été basculée au vert, le lecteur est considéré comme
        absent. Un samedi passé est gelé — correction exceptionnelle de
        l'Administrateur uniquement, tracée dans les logs. Le récapitulatif par
        lecteur et les listes de présents/absents se consultent dans l'onglet{' '}
        <Link to="/suivis" className="font-semibold text-cdlj hover:underline">
          Suivis
        </Link>
        .
      </p>
    </div>
  );
}
