import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { toutesLesLignes } from '../lib/pagination';
import { useRealtime } from '../lib/useRealtime';
import { useAuth } from '../context/AuthContext';
import {
  dateISO,
  deplaceMois,
  estAvantPremierSamediActif,
  fmtDate,
  fmtDateHeure,
  fmtMoney,
  moisLabel,
} from '../lib/dates';
import { traduireErreur } from '../lib/errors';
import { journaliserExport } from '../lib/journal';
import {
  estCO,
  peutExporter as rolePeutExporter,
  type CaisseOperation,
  type Cotisation,
  type Lecteur,
  type Profile,
} from '../lib/types';
import {
  Badge,
  BtnGhost,
  BtnPrimary,
  EmptyState,
  inputCls,
  PageHeader,
  Spinner,
  StatCard,
  StepNav,
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

/** Colonnes réellement utilisées — évite de charger des données inutiles. */
const COLONNES_COT = 'lecteur_id, date_samedi, montant, paid_at, recorded_by';

export default function Caisse() {
  const { profile } = useAuth();
  // `estCO` couvre `co` ET `co_paroissial`, comme `public.is_co()` en base.
  const isCO = estCO(profile?.role);
  // Cahier des charges §17 : l'état de caisse est exportable par
  // Admin, CO et Caissiers uniquement (les Responsables consultent sans exporter).
  const canExport = rolePeutExporter(profile?.role);
  const { toast } = useToast();

  const now = new Date();
  const [annee, setAnnee] = useState(now.getFullYear());
  const [mois, setMois] = useState(now.getMonth());

  /** Cotisations payées du mois affiché (mouvements + total mensuel). */
  const [cotsMois, setCotsMois] = useState<Cotisation[]>([]);
  /** Cotisations payées depuis l'origine (solde général + cumul annuel). */
  /** Somme de toutes les cotisations encaissées (vue v_caisse_totaux). */
  const [totalCotTout, setTotalCotTout] = useState(0);
  /** Cotisations de l'année affichée (vue v_cotisations_par_annee). */
  const [cotAnnee, setCotAnnee] = useState(0);
  const [ops, setOps] = useState<CaisseOperation[]>([]);
  const [lecteurs, setLecteurs] = useState<Lecteur[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyExport, setBusyExport] = useState(false);
  const [busyOp, setBusyOp] = useState(false);
  const [opForm, setOpForm] = useState({
    type: 'encaissement' as 'encaissement' | 'decaissement',
    montant: '',
    motif: '',
  });

  const load = useCallback(async () => {
    const d1 = dateISO(new Date(annee, mois, 1));
    const d2 = dateISO(new Date(annee, mois + 1, 0));
    const [rCM, rTot, rAn, rO, rL, rP] = await Promise.all([
      // mois affiché : 200 lecteurs × 5 samedis = 1000 pile la limite PostgREST → paginé
      toutesLesLignes<Cotisation>((de, a) =>
        supabase
          .from('cotisations')
          .select(COLONNES_COT)
          .eq('paye', true)
          .gte('date_samedi', d1)
          .lte('date_samedi', d2)
          .order('id')
          .range(de, a)
      ),
      // Solde général et cumul annuel : agrégats calculés par la base
      // (vues v_caisse_totaux / v_cotisations_par_annee) — jamais l'historique
      // complet des cotisations dans le navigateur (200 lecteurs × 52 samedis).
      supabase.from('v_caisse_totaux').select('*').maybeSingle(),
      supabase.from('v_cotisations_par_annee').select('*').eq('annee', annee).maybeSingle(),
      // 200 lecteurs × 12 mois = potentiel >1000 opérations sur 2 ans → paginé
      toutesLesLignes<CaisseOperation>((de, a) =>
        supabase
          .from('caisse_operations')
          .select('id, type, montant, motif, created_at, recorded_by')
          .is('event_id', null)
          .order('created_at')
          .range(de, a)
      ),
      // 200 lecteurs max : colonnes minimales, paginé pour éviter troncature PostgREST
      // created_at : règle « premier samedi actif » — la liste des mouvements
      // doit afficher exactement ce que comptent les vues d'agrégats.
      toutesLesLignes<Lecteur>((de, a) =>
        supabase
          .from('lecteurs')
          .select('id, matricule, created_at')
          .order('matricule')
          .range(de, a)
      ),
      supabase.from('profiles').select('id, full_name'),
    ]);
    const mapCree = new Map(((rL.data ?? []) as Lecteur[]).map((l) => [l.id, l.created_at]));
    setCotsMois(
      ((rCM.data ?? []) as Cotisation[]).filter(
        (c) => !mapCree.has(c.lecteur_id) || !estAvantPremierSamediActif(c.date_samedi, mapCree.get(c.lecteur_id))
      )
    );
    const t = (rTot.data ?? null) as { total_cotisations: number } | null;
    setTotalCotTout(t ? Number(t.total_cotisations) : 0);
    const a = (rAn.data ?? null) as { total: number } | null;
    setCotAnnee(a ? Number(a.total) : 0);
    setOps((rO.data ?? []) as CaisseOperation[]);
    setLecteurs((rL.data ?? []) as Lecteur[]);
    setProfiles((rP.data ?? []) as Profile[]);
    setLoading(false);
  }, [annee, mois]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  /**
   * Temps réel : une cotisation encaissée par le Caissier ou une opération
   * saisie par le Chargé des Opérations met à jour le solde général ici même,
   * sans rechargement.
   * (`caisse_operations` est publiée par la migration 20260915180000.)
   */
  useRealtime('realtime-caisse', ['cotisations', 'caisse_operations'], load);

  // --------------------------------------------------------------- totaux
  // Solde général : toutes les cotisations jamais encaissées + encaissements
  // − décaissements. Le mois affiché n'entre pas dans ce calcul.
  const totalCotMois = cotsMois.reduce((s, c) => s + c.montant, 0);
  const enc = ops
    .filter((o) => o.type === 'encaissement')
    .reduce((s, o) => s + o.montant, 0);
  const dec = ops
    .filter((o) => o.type === 'decaissement')
    .reduce((s, o) => s + o.montant, 0);
  const soldeGeneral = totalCotTout + enc - dec;

  const prefixeMois = `${annee}-${String(mois + 1).padStart(2, '0')}`;
  const prefixeAnnee = String(annee);

  // Récolté ce mois : cotisations du mois + opérations de caisse du mois.
  const opsMois = ops
    .filter((o) => o.created_at.slice(0, 7) === prefixeMois)
    .reduce((s, o) => s + (o.type === 'encaissement' ? o.montant : -o.montant), 0);
  const recolteMois = totalCotMois + opsMois;

  // Cumul annuel : cotisations dont le samedi tombe dans l'année affichée
  // (même base que la vue mensuelle) + opérations de caisse de cette année.
  const opsAnnee = ops
    .filter((o) => o.created_at.slice(0, 4) === prefixeAnnee)
    .reduce((s, o) => s + (o.type === 'encaissement' ? o.montant : -o.montant), 0);
  const cumulAnnee = cotAnnee + opsAnnee;

  const lignes: Ligne[] = useMemo(() => {
    const moisDebut = dateISO(new Date(annee, mois, 1));
    const moisFin = dateISO(new Date(annee, mois + 1, 0, 23, 59));
    const mapLect = new Map(lecteurs.map((l) => [l.id, l.matricule]));
    const mapProf = new Map(profiles.map((p) => [p.id, p.full_name ?? '—']));
    const cots: Ligne[] = cotsMois
      .filter((c) => c.date_samedi >= moisDebut && c.date_samedi <= moisFin)
      .map((c) => ({
        date: c.date_samedi,
        type: 'cotisation' as const,
        libelle: `Cotisation — ${mapLect.get(c.lecteur_id) ?? '—'}`,
        montant: c.montant,
        auteur: mapProf.get(c.recorded_by ?? '') ?? '—',
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
        auteur: mapProf.get(o.recorded_by ?? '') ?? '—',
      }));
    return [...cots, ...opsLignes].sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [cotsMois, ops, lecteurs, profiles, annee, mois]);

  async function ajouterOp() {
    if (!isCO) {
      toast("Seul le Chargé des Opérations peut enregistrer une opération de caisse.", 'err');
      return;
    }
    const montant = Number(opForm.montant);
    if (!montant || montant <= 0 || !opForm.motif.trim()) {
      toast('Montant et motif obligatoires.', 'err');
      return;
    }
    setBusyOp(true);
    const { error } = await supabase.from('caisse_operations').insert({
      event_id: null,
      type: opForm.type,
      montant,
      motif: opForm.motif.trim(),
    });
    setBusyOp(false);
    if (error) {
      toast(traduireErreur(error, "enregistrer cette opération de caisse"), 'err');
    } else {
      setOpForm({ type: 'encaissement', montant: '', motif: '' });
      toast('Opération enregistrée dans la caisse générale.');
      load();
    }
  }

  async function exportPdf() {
    setBusyExport(true);
    try {
      await exportCaisse({
        periode: moisLabel(annee, mois),
        lignes,
        totalPaye: totalCotMois,
        totalEnc: lignes
          .filter((l) => l.type === 'encaissement')
          .reduce((s, l) => s + l.montant, 0),
        totalDec: lignes
          .filter((l) => l.type === 'decaissement')
          .reduce((s, l) => s + l.montant, 0),
        soldeGeneral,
        auteur: profile?.full_name ?? '—',
      });
      await journaliserExport('caisse', prefixeMois, { document: 'etat_caisse' });
      toast('PDF généré.');
    } catch (err) {
      toast(traduireErreur(err, 'générer le PDF de la caisse'), 'err');
    } finally {
      setBusyExport(false);
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
            <BtnGhost onClick={exportPdf} busy={busyExport} busyLabel="PDF…">
              ⬇ Export PDF
            </BtnGhost>
          ) : undefined
        }
      />

      <div className="mb-4 flex justify-start">
        <StepNav
          label={moisLabel(annee, mois)}
          width="min-w-[170px]"
          onPrev={() => {
            const d = deplaceMois(annee, mois, -1);
            setAnnee(d.annee);
            setMois(d.mois);
          }}
          onNext={() => {
            const d = deplaceMois(annee, mois, 1);
            setAnnee(d.annee);
            setMois(d.mois);
          }}
        />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Solde général de la caisse"
          value={fmtMoney(soldeGeneral)}
          tone="blue"
          sub="depuis l'origine"
        />
        <StatCard
          label="Récolté ce mois"
          value={fmtMoney(recolteMois)}
          tone="green"
          sub={moisLabel(annee, mois)}
        />
        <StatCard
          label={`Cumul ${prefixeAnnee}`}
          value={fmtMoney(cumulAnnee)}
          tone="amber"
          sub={`dont ${fmtMoney(cotAnnee)} de cotisations`}
        />
        <StatCard
          label="Décaissés (total)"
          value={fmtMoney(dec)}
          tone="red"
          sub={`${ops.filter((o) => o.type === 'decaissement').length} opération(s)`}
        />
      </div>

      {isCO && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={opForm.type}
              aria-label="Type d'opération"
              onChange={(ev) =>
                setOpForm({
                  ...opForm,
                  type: ev.target.value as 'encaissement' | 'decaissement',
                })
              }
              className={`${inputCls} w-full sm:w-auto`}
            >
              <option value="encaissement">Encaissement</option>
              <option value="decaissement">Décaissement</option>
            </select>
            <input
              type="number"
              min={1}
              inputMode="numeric"
              placeholder="Montant (F)"
              value={opForm.montant}
              onChange={(ev) => setOpForm({ ...opForm, montant: ev.target.value })}
              className={`${inputCls} w-full sm:w-32`}
            />
            <input
              placeholder="Motif"
              value={opForm.motif}
              onChange={(ev) => setOpForm({ ...opForm, motif: ev.target.value })}
              className={`${inputCls} min-w-0 flex-1`}
            />
            <BtnPrimary
              onClick={ajouterOp}
              busy={busyOp}
              busyLabel="Enregistrement…"
              className="w-full sm:w-auto"
            >
              Enregistrer
            </BtnPrimary>
          </div>
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
                    <td className="whitespace-nowrap px-4 py-2 text-slate-500">
                      {fmtDate(l.date)}
                    </td>
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
                    <td className="px-4 py-2 break-words">{l.libelle}</td>
                    <td className="px-4 py-2 text-slate-500">{l.auteur}</td>
                    <td
                      className={`whitespace-nowrap px-4 py-2 text-right font-semibold ${
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
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-2 text-xs text-slate-400">
          <span>
            Dernière opération :{' '}
            {ops.length > 0 ? fmtDateHeure(ops[ops.length - 1].created_at) : '—'}
          </span>
          <span>
            Solde général :{' '}
            <strong className="text-slate-600">{fmtMoney(soldeGeneral)}</strong>
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
