import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { supabase } from '../lib/supabase';
import { useRealtime } from '../lib/useRealtime';
import {
  dateISO,
  fmtMoney,
  moisLabel,
  pct,
  samedisArrives,
  samedisDuMois,
} from '../lib/dates';
import { useAuth } from '../context/AuthContext';
import { EmptyState, PageHeader, Spinner, StatCard } from '../components/ui';
import type { Evenement, Lecteur } from '../lib/types';

interface SeriesPoint {
  label: string;
  presences: number;
  absences: number;
  effectif: number;
  cotisations: number;
}

export default function Dashboard() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [kpi, setKpi] = useState({
    actifs: 0,
    tauxPresence: 0,
    presenceMoyenne: 0,
    tauxCotisation: 0,
    caisseSolde: 0,
    evenementsEnCours: 0,
    samedisMois: 0,
  });
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [evenements, setEvenements] = useState<
    (Evenement & { participants: number; paye: number; attendu: number })[]
  >([]);
  const [lecteurs, setLecteurs] = useState<Lecteur[]>([]);

  useEffect(() => {
    load();
  }, []);

  // Synchronisation temps réel : toute modif de présence/cotisation/lecteur recharge le tableau de bord
  useRealtime('realtime-dashboard', ['presences', 'cotisations', 'lecteurs', 'caisse_operations', 'evenements', 'evenement_paiements'], load);

  async function load() {
    const now = new Date();
    const am = now.getFullYear();
    const m = now.getMonth();
    const cle = (y: number, mo: number) => `${y}-${String(mo + 1).padStart(2, '0')}`;
    const moisCourant = cle(am, m);
    const mois6 = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(am, m - (5 - i), 1);
      return { annee: d.getFullYear(), mois: d.getMonth(), cle: cle(d.getFullYear(), d.getMonth()), date: d };
    });

    // Dimensionné pour 200+ lecteurs : PostgREST tronque toute réponse à
    // 1 000 lignes (6 mois de présences = 5 200 lignes). Plus AUCUNE ligne
    // brute ici : tout vient de vues d'agrégats calculées par PostgreSQL
    // (migration 20260916150000), quelques dizaines de lignes au total.
    const [rCompteurs, rPresMois, rCotMois, rEncMois, rEffectif, rEven, rAvancement, rTotaux, rDerniers] =
      await Promise.all([
        supabase.from('v_lecteurs_compteurs').select('*').maybeSingle(),
        supabase.from('v_presences_par_mois').select('*').gte('mois', mois6[0].cle),
        supabase.from('v_cotisations_par_mois').select('*').gte('mois', mois6[0].cle),
        supabase.from('v_encaissements_par_mois').select('*').gte('mois', mois6[0].cle),
        supabase.from('v_effectif_par_mois').select('*').gte('mois', mois6[0].cle),
        supabase.from('evenements').select('id, nom, montant_participation').eq('statut', 'en_cours'),
        supabase.from('v_evenements_avancement').select('*'),
        supabase.from('v_caisse_totaux').select('*').maybeSingle(),
        supabase
          .from('lecteurs')
          .select('id, matricule, nom, prenom, archived')
          .eq('archived', false)
          .order('matricule', { ascending: false })
          .limit(6),
      ]);

    const compteurs = (rCompteurs.data ?? { actifs: 0 }) as { actifs: number };
    const actifs = Number(compteurs.actifs);
    const presParMois = new Map(
      ((rPresMois.data ?? []) as { mois: string; presents: number; absents: number; samedis_eligibles?: number }[]).map((r) => [r.mois, r])
    );
    const cotParMois = new Map(
      ((rCotMois.data ?? []) as { mois: string; total: number; lecteurs_payes: number; lecteurs_eligibles?: number }[]).map((r) => [r.mois, r])
    );
    const encParMois = new Map(
      ((rEncMois.data ?? []) as { mois: string; total: number }[]).map((r) => [r.mois, Number(r.total)])
    );
    const effectifParMois = new Map(
      ((rEffectif.data ?? []) as { mois: string; effectif: number }[]).map((r) => [r.mois, Number(r.effectif)])
    );
    const even = (rEven.data ?? []) as Evenement[];
    const avancement = new Map(
      ((rAvancement.data ?? []) as { id: string; participants: number; paye: number }[]).map((r) => [r.id, r])
    );
    const totaux = (rTotaux.data ?? null) as {
      total_cotisations: number;
      total_encaissements: number;
      total_decaissements: number;
    } | null;

    // ---- KPIs mois courant
    // Seuls les samedis déjà arrivés sont comptabilisés : un samedi à venir
    // ne peut ni gonfler le taux d'absence ni le nombre de cotisations dues.
    const samedis = samedisArrives(samedisDuMois(am, m).map(dateISO));
    const nbPresent = Number(presParMois.get(moisCourant)?.presents ?? 0);
    const lecteursPayes = Number(cotParMois.get(moisCourant)?.lecteurs_payes ?? 0);
    // Dénominateurs « premier samedi actif » (migration 20260919180000) : un
    // lecteur inscrit en cours de mois ne compte que pour les samedis à partir
    // de son premier samedi actif — les samedis antérieurs ne sont ni des
    // absences potentielles ni des cotisations attendues. Repli sur l'ancien
    // dénominateur si la vue date d'avant la migration.
    const samedisEligibles = Number(
      presParMois.get(moisCourant)?.samedis_eligibles ?? actifs * Math.max(samedis.length, 1)
    );
    const lecteursEligibles = Number(cotParMois.get(moisCourant)?.lecteurs_eligibles ?? actifs);
    const caisseSolde = totaux
      ? Number(totaux.total_cotisations) +
        Number(totaux.total_encaissements) -
        Number(totaux.total_decaissements)
      : 0;

    setKpi({
      actifs,
      tauxPresence: pct(nbPresent, samedisEligibles),
      presenceMoyenne:
        samedis.length > 0 ? Math.round((nbPresent / samedis.length) * 10) / 10 : 0,
      tauxCotisation: pct(lecteursPayes, lecteursEligibles),
      caisseSolde,
      evenementsEnCours: even.length,
      samedisMois: samedis.length,
    });

    // ---- Événements en cours : avancement des paiements
    setEvenements(
      even.map((e) => {
        const av = avancement.get(e.id);
        const nb = Number(av?.participants ?? 0);
        return { ...e, participants: nb, paye: Number(av?.paye ?? 0), attendu: nb * e.montant_participation };
      })
    );

    // ---- Courbes 6 derniers mois
    setSeries(
      mois6.map((mo) => ({
        label: mo.date.toLocaleDateString('fr-FR', { month: 'short' }),
        presences: Number(presParMois.get(mo.cle)?.presents ?? 0),
        absences: Number(presParMois.get(mo.cle)?.absents ?? 0),
        effectif: effectifParMois.get(mo.cle) ?? 0,
        cotisations: encParMois.get(mo.cle) ?? 0,
      }))
    );

    setLecteurs((rDerniers.data ?? []) as Lecteur[]);
    setLoading(false);
  }

  if (loading) return <Spinner label="Chargement du tableau de bord…" />;

  return (
    <div>
      <PageHeader
        title="Tableau de bord"
        sub={`${moisLabel(new Date().getFullYear(), new Date().getMonth())} — ${kpi.actifs} lecteur(s) actif(s)`}
        actions={
          profile ? (
            <Link
              to="/lecteurs"
              className="rounded-lg bg-cdlj px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-cdlj-dark"
            >
              + Nouveau lecteur
            </Link>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Lecteurs actifs" value={kpi.actifs} />
        <StatCard
          label="Taux de présence"
          value={kpi.tauxPresence + ' %'}
          sub={`${kpi.samedisMois} samedi(s) ce mois`}
          tone="green"
        />
        <StatCard
          label="Présents / samedi"
          value={kpi.presenceMoyenne}
          sub="moyenne du mois"
          tone="green"
        />
        <StatCard
          label="Taux de cotisation"
          value={kpi.tauxCotisation + ' %'}
          sub="lecteurs ayant payé"
          tone="amber"
        />
        <StatCard label="Caisse générale" value={fmtMoney(kpi.caisseSolde)} tone="blue" />
        <StatCard
          label="Événements en cours"
          value={kpi.evenementsEnCours}
          tone="red"
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-slate-700">
            Présences / absences — 6 derniers mois
          </h3>
          {series.some((s) => s.presences || s.absences) ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="presences"
                  name="Présents"
                  stroke="#059669"
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="absences"
                  name="Absents"
                  stroke="#c0392b"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState msg="Aucune présence enregistrée sur les 6 derniers mois." />
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-slate-700">
            Effectifs du groupe — 6 derniers mois
          </h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="label" fontSize={12} />
              <YAxis fontSize={12} allowDecimals={false} domain={['auto', 'auto']} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="effectif"
                name="Effectif"
                stroke="#1a56db"
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-slate-700">
            Cotisations collectées (F CFA) — 6 derniers mois
          </h3>
          {series.some((s) => s.cotisations > 0) ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Bar dataKey="cotisations" name="Collecté" fill="#1a56db" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState msg="Aucune cotisation collectée sur la période." />
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-slate-700">
            Avancement des paiements — événements en cours
          </h3>
          {evenements.length === 0 ? (
            <EmptyState msg="Aucun événement en cours." />
          ) : (
            <div className="space-y-3">
              {evenements.map((e) => {
                const p = pct(e.paye, e.attendu);
                return (
                  <Link
                    key={e.id}
                    to={`/evenements/${e.id}`}
                    className="block rounded-lg border border-slate-100 p-3 hover:bg-slate-50"
                  >
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold text-slate-700">{e.nom}</span>
                      <span className="text-xs text-slate-500">
                        {fmtMoney(e.paye)} / {fmtMoney(e.attendu)}
                      </span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${p}%` }}
                      />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Derniers lecteurs */}
      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-700">Derniers lecteurs enregistrés</h3>
          <Link to="/lecteurs" className="text-xs font-semibold text-cdlj hover:underline">
            Tout voir →
          </Link>
        </div>
        {lecteurs.length === 0 ? (
          <EmptyState msg="Aucun lecteur pour l'instant. Créez le premier lecteur !" />
        ) : (
          <div className="divide-y divide-slate-100">
            {lecteurs.map((l) => (
                <Link
                  key={l.id}
                  to={`/lecteurs/${l.id}`}
                  className="flex items-center justify-between py-2 text-sm hover:bg-slate-50"
                >
                  <span className="font-mono font-semibold text-cdlj">{l.matricule}</span>
                  <span className="font-medium text-slate-700">
                    {l.prenom} {l.nom.toUpperCase()}
                  </span>
                </Link>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
