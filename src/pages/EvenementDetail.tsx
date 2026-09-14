import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { fmtDate, fmtDateHeure, fmtMoney, pct } from '../lib/dates';
import { traduireErreur } from '../lib/errors';
import type {
  CaisseOperation,
  Evenement,
  EvenementPaiement,
  Lecteur,
} from '../lib/types';
import {
  Badge,
  BtnDanger,
  BtnGhost,
  BtnPrimary,
  EmptyState,
  Field,
  inputCls,
  Modal,
  PageHeader,
  pressCls,
  Spinner,
  StatCard,
  useToast,
} from '../components/ui';
import { exportEvenementBilan } from '../pdf/export';

type StatutPaiement = 'solde_regle' | 'partiel' | 'non_paye';

function statutDe(paye: number, participation: number): StatutPaiement {
  if (participation > 0 && paye >= participation) return 'solde_regle';
  if (paye > 0) return 'partiel';
  return 'non_paye';
}

export default function EvenementDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isCO = profile?.role === 'co';
  const isAdmin = profile?.role === 'admin';
  const { toast } = useToast();

  const [e, setE] = useState<Evenement | null>(null);
  const [lecteurs, setLecteurs] = useState<Lecteur[]>([]);
  const [paiements, setPaiements] = useState<EvenementPaiement[]>([]);
  const [ops, setOps] = useState<CaisseOperation[]>([]);
  const [loading, setLoading] = useState(true);

  const [matricule, setMatricule] = useState('');
  const [filtre, setFiltre] = useState<'' | StatutPaiement>('');
  const [trancheOuverte, setTrancheOuverte] = useState<string | null>(null);
  const [montantTranche, setMontantTranche] = useState('');
  const [opForm, setOpForm] = useState({
    type: 'encaissement' as 'encaissement' | 'decaissement',
    montant: '',
    motif: '',
  });
  const [showEdit, setShowEdit] = useState(false);
  const [busyInscription, setBusyInscription] = useState(false);
  const [busyTranche, setBusyTranche] = useState(false);
  const [busyOp, setBusyOp] = useState(false);
  const [busyEdit, setBusyEdit] = useState(false);
  const [busyStatut, setBusyStatut] = useState(false);
  const [busyPdf, setBusyPdf] = useState(false);
  const [formEdit, setFormEdit] = useState({
    nom: '',
    date_evenement: '',
    lieu: '',
    montant_participation: '',
  });

  const enCours = e?.statut === 'en_cours';

  const load = useCallback(async () => {
    if (!id) return;
    const rE = await supabase.from('evenements').select('*').eq('id', id).maybeSingle();
    const ev = (rE.data as Evenement | null) ?? null;
    if (!ev) {
      navigate('/evenements');
      return;
    }
    setE(ev);
    const [rL, rP, rO] = await Promise.all([
      supabase
        .from('lecteurs')
        .select('*')
        .in('id', (await supabase.from('evenement_participants').select('lecteur_id').eq('event_id', id)).data?.map((x: { lecteur_id: string }) => x.lecteur_id) ?? []),
      supabase.from('evenement_paiements').select('*').eq('event_id', id).order('paye_at'),
      supabase
        .from('caisse_operations')
        .select('*')
        .eq('event_id', id)
        .order('created_at'),
    ]);
    setLecteurs((rL.data ?? []) as Lecteur[]);
    setPaiements((rP.data ?? []) as EvenementPaiement[]);
    setOps((rO.data ?? []) as CaisseOperation[]);
    setLoading(false);
  }, [id, navigate]);

  useEffect(() => {
    load();
  }, [load]);

  /** Paiements et opérations triés du plus récent au plus ancien. */
  const paiementsTri = useMemo(
    () => [...paiements].sort((a, b) => (a.paye_at < b.paye_at ? 1 : -1)),
    [paiements]
  );
  const opsTri = useMemo(
    () => [...ops].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    [ops]
  );

  // ---- paiements par lecteur
  const parLecteur = useMemo(() => {
    const m = new Map<string, { paye: number; tranches: EvenementPaiement[] }>();
    paiements.forEach((p) => {
      const cur = m.get(p.lecteur_id) ?? { paye: 0, tranches: [] };
      cur.paye += p.montant;
      cur.tranches.push(p);
      m.set(p.lecteur_id, cur);
    });
    return m;
  }, [paiements]);

  const rows = useMemo(() => {
    return lecteurs
      .map((l) => {
        const paye = parLecteur.get(l.id)?.paye ?? 0;
        const restant = Math.max((e?.montant_participation ?? 0) - paye, 0);
        return { lecteur: l, paye, restant, statut: statutDe(paye, e?.montant_participation ?? 0) };
      })
      .filter((r) => (filtre ? r.statut === filtre : true));
  }, [lecteurs, parLecteur, e, filtre]);

  const totalCollecte = paiements.reduce((s, p) => s + p.montant, 0);
  const totalAttendu = lecteurs.length * (e?.montant_participation ?? 0);
  const restantGlobal = Math.max(totalAttendu - totalCollecte, 0);
  const soldeCaisse = ops.reduce(
    (s, o) => s + (o.type === 'encaissement' ? o.montant : -o.montant),
    0
  );

  if (loading || !e) return <Spinner label="Chargement de l'événement…" />;

  const lecteurById = (lid: string) => lecteurs.find((l) => l.id === lid);

  async function inscrire() {
    const q = matricule.trim().toUpperCase();
    if (!q || !enCours) return;
    setBusyInscription(true);
    const { data: l } = await supabase
      .from('lecteurs')
      .select('*')
      .eq('matricule', q)
      .maybeSingle();
    if (!l) {
      setBusyInscription(false);
      toast(`Matricule ${q} introuvable dans la base.`, 'err');
      return;
    }
    if ((l as Lecteur).archived) {
      setBusyInscription(false);
      toast('Ce lecteur est archivé.', 'err');
      return;
    }
    const { data: deja } = await supabase
      .from('evenement_participants')
      .select('id')
      .eq('event_id', e!.id)
      .eq('lecteur_id', (l as Lecteur).id)
      .maybeSingle();
    if (deja) {
      setBusyInscription(false);
      toast(`${q} est déjà inscrit à cet événement.`, 'err');
      return;
    }
    const { error } = await supabase.from('evenement_participants').insert({
      event_id: e!.id,
      lecteur_id: (l as Lecteur).id,
      registered_by: profile?.id ?? null,
    });
    setBusyInscription(false);
    if (error) toast(traduireErreur(error, 'inscrire ce lecteur à l\'événement'), 'err');
    else {
      setMatricule('');
      toast(`${(l as Lecteur).matricule} — ${(l as Lecteur).prenom} ${(l as Lecteur).nom} inscrit.`);
      load();
    }
  }

  async function retirer(l: Lecteur) {
    if (!isCO && !isAdmin) {
      toast("Vous n'êtes pas autorisé à retirer un participant d'un événement.", 'err');
      return;
    }
    if (!confirm(`Retirer ${l.matricule} — ${l.prenom} ${l.nom} de cet événement ?`)) return;
    const { error } = await supabase
      .from('evenement_participants')
      .delete()
      .eq('event_id', e!.id)
      .eq('lecteur_id', l.id);
    if (error) toast(traduireErreur(error, 'retirer ce participant'), 'err');
    else {
      toast('Participant retiré.');
      load();
    }
  }

  async function ajouterTranche() {
    if (!trancheOuverte) return;
    if (!isCO && !isAdmin) {
      toast(
        "Vous n'êtes pas autorisé à enregistrer un paiement d'événement : cette opération est réservée au Chargé des Opérations.",
        'err'
      );
      return;
    }
    const montant = Number(montantTranche);
    if (!montant || montant <= 0) {
      toast('Montant invalide.', 'err');
      return;
    }
    const paye = parLecteur.get(trancheOuverte)?.paye ?? 0;
    const restant = (e?.montant_participation ?? 0) - paye;
    if (montant > restant) {
      toast(`Montant supérieur au restant (${fmtMoney(restant)}).`, 'err');
      return;
    }
    setBusyTranche(true);
    const { error } = await supabase.from('evenement_paiements').insert({
      event_id: e!.id,
      lecteur_id: trancheOuverte,
      montant,
      recorded_by: profile?.id ?? null,
    });
    setBusyTranche(false);
    if (error) toast(traduireErreur(error, 'enregistrer cette tranche de paiement'), 'err');
    else {
      setTrancheOuverte(null);
      setMontantTranche('');
      toast(`Tranche de ${fmtMoney(montant)} enregistrée.`);
      load();
    }
  }

  async function terminer() {
    if (!e || !isCO) return;
    if (
      !confirm(
        `Clôturer « ${e.nom} » ?\n\nL'événement passera en lecture seule : plus aucune modification ne sera possible (inscriptions, paiements, caisse).\nCette action est irréversible sauf intervention de l'Administrateur.`
      )
    )
      return;
    if (!confirm('Confirmation finale : terminer l’événement définitivement ?')) return;
    setBusyStatut(true);
    const { error } = await supabase
      .from('evenements')
      .update({ statut: 'termine' })
      .eq('id', e.id);
    setBusyStatut(false);
    if (error) toast(traduireErreur(error, 'clôturer cet événement'), 'err');
    else {
      toast('Événement terminé — en lecture seule.');
      load();
    }
  }

  async function reouvrir() {
    if (!e || !isAdmin) return;
    if (!confirm("Réouvrir cet événement ? (intervention Admin, tracée dans les logs)")) return;
    setBusyStatut(true);
    const { error } = await supabase
      .from('evenements')
      .update({ statut: 'en_cours' })
      .eq('id', e.id);
    setBusyStatut(false);
    if (error) toast(traduireErreur(error, 'réouvrir cet événement'), 'err');
    else {
      await supabase.rpc('log_action', {
        p_action: 'evenement.reouverture',
        p_objet_type: 'evenements',
        p_objet_ref: e.id,
        p_detail: JSON.stringify({ nom: e.nom }),
      });
      toast('Événement réouvert.');
      load();
    }
  }

  async function ajouterOp() {
    if (!isCO) {
      toast(
        "Vous n'êtes pas autorisé à enregistrer une opération sur la caisse d'un événement : c'est réservé au Chargé des Opérations.",
        'err'
      );
      return;
    }
    if (!enCours) return;
    const montant = Number(opForm.montant);
    if (!montant || montant <= 0 || !opForm.motif.trim()) {
      toast('Montant et motif obligatoires.', 'err');
      return;
    }
    setBusyOp(true);
    const { error } = await supabase.from('caisse_operations').insert({
      event_id: e.id,
      type: opForm.type,
      montant,
      motif: opForm.motif.trim(),
      recorded_by: profile?.id ?? null,
    });
    setBusyOp(false);
    if (error) toast(traduireErreur(error, 'enregistrer cette opération de caisse'), 'err');
    else {
      setOpForm({ type: 'encaissement', montant: '', motif: '' });
      toast('Opération enregistrée.');
      load();
    }
  }

  function openEdit() {
    setFormEdit({
      nom: e!.nom,
      date_evenement: e!.date_evenement,
      lieu: e!.lieu ?? '',
      montant_participation: String(e!.montant_participation),
    });
    setShowEdit(true);
  }

  async function saveEdit() {
    if (!formEdit.nom.trim() || !formEdit.date_evenement) {
      toast('Nom et date sont obligatoires.', 'err');
      return;
    }
    setBusyEdit(true);
    const { error } = await supabase.from('evenements').update({
      nom: formEdit.nom.trim(),
      date_evenement: formEdit.date_evenement,
      lieu: formEdit.lieu.trim() || null,
      montant_participation: Number(formEdit.montant_participation) || 0,
    });
    setBusyEdit(false);
    if (error) toast(traduireErreur(error, 'modifier cet événement'), 'err');
    else {
      setShowEdit(false);
      toast('Événement mis à jour.');
      load();
    }
  }

  async function exportPdf() {
    if (!e) return;
    setBusyPdf(true);
    try {
      await exportEvenementBilan({
        evenement: e,
        participants: lecteurs.map((l) => ({
          lecteur: l,
          paye: parLecteur.get(l.id)?.paye ?? 0,
          tranches: parLecteur.get(l.id)?.tranches ?? [],
        })),
        totalCollecte,
        totalAttendu,
        auteur: profile?.full_name ?? '—',
      });
      await supabase.rpc('log_action', {
        p_action: 'export.pdf',
        p_objet_type: 'evenements',
        p_objet_ref: e.id,
        p_detail: JSON.stringify({ document: 'bilan_evenement', nom: e.nom }),
      });
      toast('PDF généré.');
    } catch (err) {
      toast(traduireErreur(err, 'générer le bilan PDF de cet événement'), 'err');
    } finally {
      setBusyPdf(false);
    }
  }

  const statutBadge = (s: StatutPaiement) =>
    s === 'solde_regle' ? (
      <Badge tone="green">Solde réglé</Badge>
    ) : s === 'partiel' ? (
      <Badge tone="amber">Paiement partiel</Badge>
    ) : (
      <Badge tone="red">Non payé</Badge>
    );

  return (
    <div>
      <PageHeader
        title={e.nom}
        sub={`📅 ${fmtDate(e.date_evenement)}${e.lieu ? ` · 📍 ${e.lieu}` : ''} · Participation ${fmtMoney(e.montant_participation)}`}
        actions={
          <>
            {enCours && (isCO || isAdmin) && (
              <BtnGhost onClick={openEdit}>Modifier</BtnGhost>
            )}
            {/* Cahier des charges §17 : le bilan d'événement est exportable
                par l'Admin et le CO uniquement. */}
            {(isAdmin || isCO) && (
              <BtnGhost onClick={exportPdf} busy={busyPdf} busyLabel="PDF…">
                ⬇ PDF bilan
              </BtnGhost>
            )}
            {enCours ? (
              isCO && (
                <BtnDanger onClick={terminer} busy={busyStatut} busyLabel="Clôture…">
                  Terminer l'événement
                </BtnDanger>
              )
            ) : (
              isAdmin && (
                <BtnGhost onClick={reouvrir} busy={busyStatut} busyLabel="Réouverture…">
                  Réouvrir (Admin)
                </BtnGhost>
              )
            )}
          </>
        }
      />

      {!enCours && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-100 px-4 py-2 text-sm text-slate-600">
          🔒 Événement <strong>terminé</strong> — consultation en lecture seule.
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Collecté" value={fmtMoney(totalCollecte)} tone="green" sub="sur l'événement" />
        <StatCard
          label="Restant à percevoir"
          value={fmtMoney(restantGlobal)}
          tone={restantGlobal > 0 ? 'red' : 'green'}
        />
        <StatCard
          label="Avancement"
          value={pct(totalCollecte, totalAttendu) + ' %'}
          tone="blue"
          sub={`${lecteurs.length} participant(s)`}
        />
        <StatCard
          label="Caisse de l'événement"
          value={fmtMoney(soldeCaisse)}
          tone="amber"
          sub="encaissements − décaissements"
        />
      </div>

      {/* Barre de progression */}
      <div className="mb-4 h-3 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${pct(totalCollecte, totalAttendu)}%` }}
        />
      </div>

      {/* Inscription */}
      {enCours && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-bold text-slate-700">
            Inscrire un lecteur (par matricule)
          </h3>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={matricule}
              onChange={(ev) => setMatricule(ev.target.value.toUpperCase())}
              placeholder="Ex. LEC101"
              aria-label="Matricule du lecteur à inscrire"
              className={`${inputCls} w-full font-mono sm:max-w-[180px]`}
              onKeyDown={(ev) => ev.key === 'Enter' && inscrire()}
            />
            <BtnPrimary
              onClick={inscrire}
              busy={busyInscription}
              busyLabel="Inscription…"
              className="w-full sm:w-auto"
            >
              Inscrire
            </BtnPrimary>
          </div>
        </div>
      )}

      {/* Participants */}
      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-700">
            Participants ({rows.length}
            {filtre ? ` filtrés` : ''})
          </h3>
          <select
            value={filtre}
            onChange={(ev) => setFiltre(ev.target.value as '' | StatutPaiement)}
            className={`${inputCls} w-auto`}
          >
            <option value="">Tous</option>
            <option value="solde_regle">Solde réglé</option>
            <option value="partiel">Paiement partiel</option>
            <option value="non_paye">Non payé</option>
          </select>
        </div>
        {rows.length === 0 ? (
          <EmptyState msg="Aucun participant (pour ce filtre)." />
        ) : (
          <>
            {/* ---- Mobile : cartes empilées (aucun débordement horizontal) ---- */}
            <ul className="divide-y divide-slate-100 sm:hidden">
              {rows.map((r) => (
                <li key={r.lecteur.id} className="py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-semibold text-cdlj">
                        {r.lecteur.matricule}
                      </div>
                      <a
                        href={`/lecteurs/${r.lecteur.id}`}
                        className="block truncate font-medium text-slate-700 hover:text-cdlj"
                      >
                        {r.lecteur.prenom} {r.lecteur.nom.toUpperCase()}
                      </a>
                    </div>
                    <span className="shrink-0">{statutBadge(r.statut)}</span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-sm">
                    <span className="font-semibold text-emerald-600">
                      Payé {fmtMoney(r.paye)}
                    </span>
                    <span className="font-semibold text-alerte">
                      Restant {fmtMoney(r.restant)}
                    </span>
                  </div>
                  {(isCO || isAdmin) && (
                    <div className="mt-2 flex gap-2">
                      {enCours && r.restant > 0 && (
                        <button
                          onClick={() => {
                            setTrancheOuverte(r.lecteur.id);
                            setMontantTranche('');
                          }}
                          className={`flex-1 rounded-lg border border-cdlj/40 bg-blue-50 px-2 py-1.5 text-xs font-semibold text-cdlj ${pressCls}`}
                        >
                          + Tranche
                        </button>
                      )}
                      <button
                        onClick={() => retirer(r.lecteur)}
                        className={`flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold text-alerte ${pressCls}`}
                      >
                        Retirer
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>

            {/* ---- Tablette / desktop : tableau ---- */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-2 py-2">Matricule</th>
                    <th className="px-2 py-2">Lecteur</th>
                    <th className="px-2 py-2 text-right">Payé</th>
                    <th className="px-2 py-2 text-right">Restant</th>
                    <th className="px-2 py-2">Statut</th>
                    {(isCO || isAdmin) && <th className="px-2 py-2 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.lecteur.id} className="hover:bg-slate-50/60">
                      <td className="px-2 py-2 font-mono text-xs font-semibold text-cdlj">
                        {r.lecteur.matricule}
                      </td>
                      <td className="max-w-[220px] truncate px-2 py-2">
                        <a
                          href={`/lecteurs/${r.lecteur.id}`}
                          className="font-medium text-slate-700 hover:text-cdlj"
                        >
                          {r.lecteur.prenom} {r.lecteur.nom.toUpperCase()}
                        </a>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right font-semibold text-emerald-600">
                        {fmtMoney(r.paye)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right font-semibold text-alerte">
                        {fmtMoney(r.restant)}
                      </td>
                      <td className="px-2 py-2">{statutBadge(r.statut)}</td>
                      {(isCO || isAdmin) && (
                        <td className="whitespace-nowrap px-2 py-2 text-right text-xs font-semibold">
                          {enCours && r.restant > 0 && (
                            <button
                              className={`mr-2 text-cdlj hover:underline ${pressCls}`}
                              onClick={() => {
                                setTrancheOuverte(r.lecteur.id);
                                setMontantTranche('');
                              }}
                            >
                              + Tranche
                            </button>
                          )}
                          <button
                            className={`text-alerte hover:underline ${pressCls}`}
                            onClick={() => retirer(r.lecteur)}
                          >
                            Retirer
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Historique des tranches */}
      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-bold text-slate-700">
          Historique des paiements (tranches)
        </h3>
        {paiements.length === 0 ? (
          <p className="text-sm text-slate-400">Aucun paiement enregistré.</p>
        ) : (
          <>
            {/* ---- Mobile : liste compacte ---- */}
            <ul className="divide-y divide-slate-100 sm:hidden">
              {paiementsTri.map((p) => {
                const l = lecteurById(p.lecteur_id);
                return (
                  <li key={p.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-slate-700">
                        {l ? `${l.prenom} ${l.nom.toUpperCase()}` : '—'}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-slate-400">
                        <span className="font-mono text-cdlj">{l?.matricule ?? '—'}</span>
                        {' · '}
                        {fmtDateHeure(p.paye_at)}
                      </div>
                    </div>
                    <div className="shrink-0 whitespace-nowrap text-sm font-semibold text-emerald-600">
                      {fmtMoney(p.montant)}
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* ---- Tablette / desktop : tableau ---- */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2">Matricule</th>
                    <th className="px-2 py-2">Lecteur</th>
                    <th className="px-2 py-2 text-right">Montant</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paiementsTri.map((p) => {
                    const l = lecteurById(p.lecteur_id);
                    return (
                      <tr key={p.id}>
                        <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">
                          {fmtDateHeure(p.paye_at)}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-xs text-cdlj">
                          {l?.matricule ?? '—'}
                        </td>
                        <td className="max-w-[220px] truncate px-2 py-1.5">
                          {l ? `${l.prenom} ${l.nom.toUpperCase()}` : '—'}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold">
                          {fmtMoney(p.montant)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Caisse de l'événement */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-bold text-slate-700">
          Caisse de l'événement (séparée de la caisse générale)
        </h3>
        {isCO && enCours && (
          <div className="mb-4 flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row">
            <select
              value={opForm.type}
              aria-label="Type d'opération"
              onChange={(ev) =>
                setOpForm({ ...opForm, type: ev.target.value as 'encaissement' | 'decaissement' })
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
        )}
        {ops.length === 0 ? (
          <p className="text-sm text-slate-400">
            Aucune opération d'encaissement/décaissement sur cet événement.
          </p>
        ) : (
          <>
            {/* ---- Mobile : liste compacte ---- */}
            <ul className="divide-y divide-slate-100 sm:hidden">
              {opsTri.map((o) => (
                <li key={o.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-slate-700">{o.motif}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
                      <Badge tone={o.type === 'encaissement' ? 'green' : 'red'}>
                        {o.type === 'encaissement' ? 'Encaissement' : 'Décaissement'}
                      </Badge>
                      <span>{fmtDateHeure(o.created_at)}</span>
                    </div>
                  </div>
                  <div
                    className={`shrink-0 whitespace-nowrap text-sm font-semibold ${
                      o.type === 'encaissement' ? 'text-emerald-600' : 'text-alerte'
                    }`}
                  >
                    {o.type === 'encaissement' ? '+' : '−'} {fmtMoney(o.montant)}
                  </div>
                </li>
              ))}
            </ul>

            {/* ---- Tablette / desktop : tableau ---- */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2">Type</th>
                    <th className="px-2 py-2">Motif</th>
                    <th className="px-2 py-2 text-right">Montant</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {opsTri.map((o) => (
                    <tr key={o.id}>
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">
                        {fmtDateHeure(o.created_at)}
                      </td>
                      <td className="px-2 py-1.5">
                        <Badge tone={o.type === 'encaissement' ? 'green' : 'red'}>
                          {o.type === 'encaissement' ? 'Encaissement' : 'Décaissement'}
                        </Badge>
                      </td>
                      <td className="max-w-[260px] break-words px-2 py-1.5">{o.motif}</td>
                      <td
                        className={`whitespace-nowrap px-2 py-1.5 text-right font-semibold ${
                          o.type === 'encaissement' ? 'text-emerald-600' : 'text-alerte'
                        }`}
                      >
                        {o.type === 'encaissement' ? '+' : '−'} {fmtMoney(o.montant)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Modale tranche */}
      <Modal
        open={trancheOuverte !== null}
        onClose={() => setTrancheOuverte(null)}
        title="Ajouter une tranche de paiement"
      >
        <div className="space-y-4">
          {trancheOuverte && (
            <p className="text-sm text-slate-600">
              Participant :{' '}
              <strong>
                {lecteurById(trancheOuverte)
                  ? `${lecteurById(trancheOuverte)!.prenom} ${lecteurById(trancheOuverte)!.nom.toUpperCase()}`
                  : '—'}
              </strong>{' '}
              · Restant :{' '}
              <strong>
                {fmtMoney(
                  (e.montant_participation ?? 0) -
                    (parLecteur.get(trancheOuverte)?.paye ?? 0)
                )}
              </strong>
            </p>
          )}
          <Field label="Montant de la tranche (F CFA)">
            <input
              type="number"
              className={inputCls}
              value={montantTranche}
              onChange={(ev) => setMontantTranche(ev.target.value)}
              placeholder="Ex. 5000"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <BtnGhost onClick={() => setTrancheOuverte(null)}>Annuler</BtnGhost>
            <BtnPrimary onClick={ajouterTranche} busy={busyTranche} busyLabel="Enregistrement…">
              Enregistrer la tranche
            </BtnPrimary>
          </div>
        </div>
      </Modal>

      {/* Modale édition */}
      <Modal
        open={showEdit}
        onClose={() => setShowEdit(false)}
        title="Modifier l'événement"
      >
        <div className="space-y-4">
          <Field label="Nom">
            <input
              className={inputCls}
              value={formEdit.nom}
              onChange={(ev) => setFormEdit({ ...formEdit, nom: ev.target.value })}
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Date">
              <input
                type="date"
                className={inputCls}
                value={formEdit.date_evenement}
                onChange={(ev) =>
                  setFormEdit({ ...formEdit, date_evenement: ev.target.value })
                }
              />
            </Field>
            <Field label="Lieu">
              <input
                className={inputCls}
                value={formEdit.lieu}
                onChange={(ev) => setFormEdit({ ...formEdit, lieu: ev.target.value })}
              />
            </Field>
          </div>
          <Field label="Montant de participation">
            <input
              type="number"
              className={inputCls}
              value={formEdit.montant_participation}
              onChange={(ev) =>
                setFormEdit({ ...formEdit, montant_participation: ev.target.value })
              }
            />
          </Field>
          <div className="flex justify-end gap-2">
            <BtnGhost onClick={() => setShowEdit(false)}>Annuler</BtnGhost>
            <BtnPrimary onClick={saveEdit} busy={busyEdit} busyLabel="Enregistrement…">
              Enregistrer
            </BtnPrimary>
          </div>
        </div>
      </Modal>
    </div>
  );
}
