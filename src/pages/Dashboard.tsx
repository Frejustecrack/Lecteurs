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
import type { Evenement, Lecteur, Presence } from '../lib/types';

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
  useEffect(() => {
    const ch = supabase
      .channel('realtime-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'presences' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cotisations' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lecteurs' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'caisse_operations' }, () => load())
      .subscribe();
    const onFocus = () => load();
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
      supabase.removeChannel(ch);
    };
  }, []);

  async function load() {
    const now = new Date();
    const am = now.getFullYear();
    const m = now.getMonth();
    const debut6 = dateISO(new Date(am, m - 5, 1));

    const [rLecteurs, rPres, rCot, rEven, rOps, rPaiements] = await Promise.all([
      supabase.from('lecteurs').select('*'),
      supabase
        .from('presences')
        .select('lecteur_id, date_samedi, statut')
        .gte('date_samedi', debut6),
      supabase.from('cotisations').select('lecteur_id, date_samedi, paye, montant, paid_at'),
      supabase.from('evenements').select('*').eq('statut', 'en_cours'),
      supabase
        .from('caisse_operations')
        .select('montant, type')
        .is('event_id', null),
      supabase.from('evenement_paiements').select('event_id, montant'),
    ]);

    const lecteurs = (rLecteurs.data ?? []) as Lecteur[];
    setLecteurs(lecteurs);
    const actifs = lecteurs.filter((l) => !l.archived);
    const activesIds = new Set(actifs.map((l) => l.id));
    const pres = (rPres.data ?? []) as Presence[];
    const cots = (rCot.data ?? []) as {
      lecteur_id: string;
      date_samedi: string;
      paye: boolean;
      montant: number;
      paid_at: string | null;
    }[];
    const even = (rEven.data ?? []) as Evenement[];
    const ops = (rOps.data ?? []) as { montant: number; type: string }[];
    const paiements = (rPaiements.data ?? []) as { event_id: string; montant: number }[];

    // ---- KPIs mois courant
    // Seuls les samedis déjà arrivés sont comptabilisés : un samedi à venir
    // ne peut ni gonfler le taux d'absence ni le nombre de cotisations dues.
    const samedis = samedisArrives(samedisDuMois(am, m).map(dateISO));
    const presMois = pres.filter(
      (p) => activesIds.has(p.lecteur_id) && samedis.includes(p.date_samedi)
    );
    const nbPresent = presMois.filter((p) => p.statut === 'present').length;
    const cotMois = cots.filter(
      (c) => c.paye && samedis.includes(c.date_samedi) && activesIds.has(c.lecteur_id)
    );
    const lecteursPayes = new Set(cotMois.map((c) => c.lecteur_id)).size;

    const soldeCot = cots.filter((c) => c.paye).reduce((s, c) => s + c.montant, 0);
    const soldeOps = ops.reduce(
      (s, o) => s + (o.type === 'encaissement' ? o.montant : -o.montant),
      0
    );

    setKpi({
      actifs: actifs.length,
      tauxPresence: pct(nbPresent, actifs.length * Math.max(samedis.length, 1)),
      presenceMoyenne:
        samedis.length > 0 ? Math.round((nbPresent / samedis.length) * 10) / 10 : 0,
      tauxCotisation: pct(lecteursPayes, actifs.length),
      caisseSolde: soldeCot + soldeOps,
      evenementsEnCours: even.length,
      samedisMois: samedis.length,
    });

    // ---- Événements en cours : avancement des paiements
    const rParts = await supabase
      .from('evenement_participants')
      .select('event_id')
      .in(
        'event_id',
        even.map((e) => e.id)
      );
    const parts = (rParts.data ?? []) as { event_id: string }[];
    setEvenements(
      even.map((e) => {
        const nb = parts.filter((p) => p.event_id === e.id).length;
        const paye = paiements
          .filter((p) => p.event_id === e.id)
          .reduce((s, p) => s + p.montant, 0);
        return { ...e, participants: nb, paye, attendu: nb * e.montant_participation };
      })
    );

    // ---- Courbes 6 derniers mois
    const pts: SeriesPoint[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(am, m - i, 1);
      const ya = d.getFullYear();
      const mo = d.getMonth();
      const sam = samedisArrives(samedisDuMois(ya, mo).map(dateISO));
      const finMois = dateISO(new Date(ya, mo + 1, 0, 23, 59));
      const presM = pres.filter(
        (p) => activesIds.has(p.lecteur_id) && sam.includes(p.date_samedi)
      );
      const effetif = lecteurs.filter(
        (l) =>
          l.created_at.slice(0, 10) <= finMois &&
          (l.archived_at ? l.archived_at.slice(0, 10) > finMois : true)
      ).length;
      const cotM = cots
        .filter(
          (c) =>
            c.paye && c.paid_at && c.paid_at.slice(0, 7) === `${ya}-${String(mo + 1).padStart(2, '0')}`
        )
        .reduce((s, c) => s + c.montant, 0);
      pts.push({
        label: d.toLocaleDateString('fr-FR', { month: 'short' }),
        presences: presM.filter((p) => p.statut === 'present').length,
        absences: presM.filter((p) => p.statut === 'absent').length,
        effectif: effetif,
        cotisations: cotM,
      });
    }
    setSeries(pts);
    setLoading(false);
  }

  if (loading) return <Spinner label="Chargement du tableau de bord…" />;

  return (
    <div>
      <PageHeader
        title="Tableau de bord"
        sub={moisLabel(new Date().getFullYear(), new Date().getMonth())}
        actions={
          profile && (
            <Link
              to="/lecteurs"
              className="rounded-lg bg-cdlj px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-cdlj-dark"
            >
              + Nouveau lecteur
            </Link>
          )
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
        {lecteurs.filter((l) => !l.archived).length === 0 ? (
          <EmptyState msg="Aucun lecteur pour l'instant. Créez le premier lecteur !" />
        ) : (
          <div className="divide-y divide-slate-100">
            {lecteurs
              .filter((l) => !l.archived)
              .sort((a, b) => (a.matricule < b.matricule ? 1 : -1))
              .slice(0, 6)
              .map((l) => (
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
