import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useRealtime } from '../lib/useRealtime';
import { useAuth } from '../context/AuthContext';
import {
  aujourdhuiBenin,
  dateISO,
  deplaceMois,
  fmtDate,
  fmtDateHeure,
  fmtMoney,
  moisLabel,
  samediEstArrive,
  samedisDuMois,
} from '../lib/dates';
import {
  estAdmin,
  peutGererLecteurs,
  type Appreciation,
  type Cotisation,
  type Evenement,
  type Grade,
  type Lecteur,
  type LecteurGrade,
  type NatureAppreciation,
  type Permission,
  type Presence,
  type Profile,
  type TypePermission,
} from '../lib/types';
import {
  Badge,
  BtnDanger,
  BtnGhost,
  BtnPrimary,
  EmptyState,
  Field,
  iconPressCls,
  inputCls,
  Modal,
  PageHeader,
  pressCls,
  Spinner,
  useToast,
} from '../components/ui';
import { traduireErreur } from '../lib/errors';
import { journaliserExport } from '../lib/journal';
import {
  anneeCourante,
  bornesAnneeAdhesion,
  bornesAnneeNaissance,
  validerAnneesLecteur,
} from '../lib/validation';
import { exportFicheLecteur } from '../pdf/export';

function MonthNav({
  annee,
  mois,
  onChange,
}: {
  annee: number;
  mois: number;
  onChange: (a: number, m: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => {
          const d = deplaceMois(annee, mois, -1);
          onChange(d.annee, d.mois);
        }}
        className={`border-slate-200 px-2.5 py-1 text-sm hover:bg-slate-50 ${iconPressCls}`}
        aria-label="Mois précédent"
      >
        ←
      </button>
      <span className="min-w-[150px] text-center text-sm font-semibold text-slate-700">
        {moisLabel(annee, mois)}
      </span>
      <button
        onClick={() => {
          const d = deplaceMois(annee, mois, 1);
          onChange(d.annee, d.mois);
        }}
        className={`border-slate-200 px-2.5 py-1 text-sm hover:bg-slate-50 ${iconPressCls}`}
        aria-label="Mois suivant"
      >
        →
      </button>
    </div>
  );
}

export default function LecteurProfil() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const canEdit = peutGererLecteurs(profile?.role);
  const isAdmin = estAdmin(profile?.role);
  const { toast } = useToast();

  const [l, setL] = useState<Lecteur | null>(null);
  const [loading, setLoading] = useState(true);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [history, setHistory] = useState<LecteurGrade[]>([]);
  const [presences, setPresences] = useState<Presence[]>([]);
  const [cotisations, setCotisations] = useState<Cotisation[]>([]);
  const [evenements, setEvenements] = useState<Evenement[]>([]);
  const [apprises, setAprises] = useState<Appreciation[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [montantCot, setMontantCot] = useState(50);

  const now = new Date();
  const [aP, setAP] = useState(now.getFullYear());
  const [mP, setMP] = useState(now.getMonth());
  const [aC, setAC] = useState(now.getFullYear());
  const [mC, setMC] = useState(now.getMonth());

  const [showEdit, setShowEdit] = useState(false);
  const [form, setForm] = useState({
    nom: '',
    prenom: '',
    date_naissance: '',
    annee_adhesion: '',
    fraternite_id: '',
    adresse: '',
    contact_parent: '',
  });
  const [fraternites, setFraternites] = useState<{ id: string; nom: string }[]>([]);

  /** Fraternité en cours de sélection (carte visible à tous les rôles). */
  const [fratSel, setFratSel] = useState('');
  const [busyFrat, setBusyFrat] = useState(false);

  const [nouveauxGrade, setNouveauxGrade] = useState(1);
  const [busyGrade, setBusyGrade] = useState(false);
  const [busyEdit, setBusyEdit] = useState(false);
  const [busyArchive, setBusyArchive] = useState(false);
  const [busyAppreciation, setBusyAppreciation] = useState(false);
  const [busyPdf, setBusyPdf] = useState(false);
  const [appriseForm, setAppriseForm] = useState<{
    nature: NatureAppreciation;
    motif: string;
  }>({ nature: 'positive', motif: '' });

  const load = useCallback(async () => {
    if (!id) return;
    // Optimisé 200 : selects minimaux, évite select * sur 52 samedis + évite in() overflow via jointure
    const [rL, rG, rH, rP, rC, rPartJoin, rA, rProf, rSet, rPerm] = await Promise.all([
      supabase.from('lecteurs').select('*').eq('id', id).maybeSingle(),
      supabase.from('grades').select('id, nom').order('id'),
      supabase
        .from('lecteur_grades')
        .select('id, grade_id, changed_at')
        .eq('lecteur_id', id)
        .order('id', { ascending: false }),
      supabase
        .from('presences')
        .select('id, date_samedi, statut')
        .eq('lecteur_id', id)
        .order('date_samedi'),
      supabase
        .from('cotisations')
        .select('id, date_samedi, paye, montant')
        .eq('lecteur_id', id)
        .order('date_samedi'),
      // Jointure directe évite in('id', [N UUIDs]) qui dépasse la limite URL à 200
      supabase
        .from('evenement_participants')
        .select('event_id, evenements(id, nom, date_evenement, lieu, montant_participation, statut)')
        .eq('lecteur_id', id),
      supabase
        .from('appreciations')
        .select('id, nature, motif, created_by, created_at, deleted')
        .eq('lecteur_id', id),
      supabase.from('profiles').select('id, full_name'),
      supabase.from('app_settings').select('value').eq('key', 'montant_cotisation').maybeSingle(),
      supabase
        .from('permissions')
        .select('id, lecteur_id, type_permission, samedis, motif, created_by, created_at')
        .eq('lecteur_id', id)
        .order('created_at', { ascending: false }),
    ]);
    const lecteur = (rL.data as Lecteur | null) ?? null;
    if (!lecteur) {
      navigate('/lecteurs');
      return;
    }
    setL(lecteur);
    setGrades((rG.data ?? []) as Grade[]);
    setHistory((rH.data ?? []) as LecteurGrade[]);
    setPresences((rP.data ?? []) as Presence[]);
    setCotisations((rC.data ?? []) as Cotisation[]);
    setAprises((rA.data ?? []) as Appreciation[]);
    setPermissions((rPerm.data ?? []) as Permission[]);
    setProfiles((rProf.data ?? []) as Profile[]);
    if (rSet.data) setMontantCot(Number(rSet.data.value) || 50);

    const evs = (rPartJoin.data ?? [])
      .map((r: any) => r.evenements)
      .filter(Boolean) as Evenement[];
    setEvenements(evs.sort((a, b) => (a.date_evenement < b.date_evenement ? -1 : 1)));
    const rF = await supabase.from('fraternites').select('id, nom').order('nom');
    setFraternites((rF.data ?? []) as { id: string; nom: string }[]);
    setLoading(false);
  }, [id, navigate]);

  useEffect(() => {
    load();
  }, [load]);

  // Synchronisation temps réel : si la présence de ce lecteur est modifiée ailleurs, la fiche se met à jour
  useRealtime(`realtime-profil-${id}`, [
    { table: 'presences', filter: `lecteur_id=eq.${id}` },
    { table: 'cotisations', filter: `lecteur_id=eq.${id}` },
    { table: 'lecteurs', event: 'UPDATE', filter: `id=eq.${id}` },
    { table: 'permissions', filter: `lecteur_id=eq.${id}` },
  ], load);

  // Le select de fraternité suit la fiche chargée (y compris après un
  // rafraîchissement temps réel déclenché par une modification externe).
  useEffect(() => {
    setFratSel(l?.fraternite_id ?? '');
  }, [l?.fraternite_id]);

  const gradeNom = (gid: number) => grades.find((g) => g.id === gid)?.nom ?? '—';
  const auteurName = (uid: string | null) =>
    profiles.find((p) => p.id === uid)?.full_name ?? '—';

  // ---- calculs mois sélectionnés
  const samedisP = useMemo(
    () => samedisDuMois(aP, mP).map(dateISO),
    [aP, mP]
  );
  const samedisC = useMemo(
    () => samedisDuMois(aC, mC).map(dateISO),
    [aC, mC]
  );
  const presMoisP = useMemo(
    () => new Map(presences.map((p) => [p.date_samedi, p.statut])),
    [presences]
  );
  const cotMoisC = useMemo(
    () =>
      new Map(
        cotisations
          .filter((c) => c.paye)
          .map((c) => [c.date_samedi, c.montant])
      ),
    [cotisations]
  );

  // ---- récap annuel (12 derniers mois) - optimisé pour 200 lecteurs
  const recapAnnuel = useMemo(() => {
    if (!l) return [];
    const rows: { label: string; present: number; absent: number; nonSaisi: number }[] = [];
    const ref = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
      const sam = samedisDuMois(d.getFullYear(), d.getMonth())
        .map(dateISO)
        .filter((s) => !estAvantPremierSamediActif(s, l.created_at));
      const pres = presences.filter((p) => sam.includes(p.date_samedi));
      rows.push({
        label: d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }),
        present: pres.filter((p) => p.statut === 'present').length,
        absent: pres.filter((p) => p.statut === 'absent').length,
        nonSaisi: sam.length - pres.length,
      });
    }
    return rows;
  }, [presences, l]);

  if (loading || !l) return <Spinner label="Chargement de la fiche…" />;

  async function changerGrade() {
    if (!l) return;
    setBusyGrade(true);
    const { error } = await supabase.rpc('changer_grade', {
      p_lecteur: l.id,
      p_grade: nouveauxGrade,
    });
    setBusyGrade(false);
    if (error) toast(traduireErreur(error, 'changer le grade de ce lecteur'), 'err');
    else {
      toast(`Grade mis à jour : ${gradeNom(nouveauxGrade)}`);
      load();
    }
  }

  async function archiver() {
    if (!l) return;
    if (
      !confirm(
        `Archiver ${l.matricule} — ${l.prenom} ${l.nom} ?\nLe lecteur disparaît des listes actives, ses données restent conservées.`
      )
    )
      return;
    setBusyArchive(true);
    const { error } = await supabase
      .from('lecteurs')
      .update({ archived: true, archived_at: new Date().toISOString() })
      .eq('id', l.id);
    setBusyArchive(false);
    if (error) {
      toast(traduireErreur(error, 'archiver ce lecteur'), 'err');
      return;
    }
    toast('Lecteur archivé.');
    navigate('/lecteurs');
  }

  async function restaurer() {
    if (!l) return;
    setBusyArchive(true);
    const { error } = await supabase
      .from('lecteurs')
      .update({ archived: false, archived_at: null })
      .eq('id', l.id);
    setBusyArchive(false);
    if (error) toast(traduireErreur(error, 'restaurer ce lecteur'), 'err');
    else {
      toast('Lecteur restauré.');
      load();
    }
  }

  function openEdit() {
    if (!l) return;
    setForm({
      nom: l.nom,
      prenom: l.prenom,
      date_naissance: l.date_naissance ?? '',
      annee_adhesion: l.annee_adhesion ? String(l.annee_adhesion) : '',
      fraternite_id: l.fraternite_id ?? '',
      adresse: l.adresse ?? '',
      contact_parent: l.contact_parent ?? '',
    });
    setShowEdit(true);
  }

  async function saveEdit() {
    if (!l) return;
    if (!form.nom.trim() || !form.prenom.trim()) {
      toast('Nom et prénom sont obligatoires.', 'err');
      return;
    }
    const v = validerAnneesLecteur(form.date_naissance, form.annee_adhesion);
    if (!v.ok) {
      toast(v.message ?? 'Saisie invalide.', 'err');
      return;
    }
    setBusyEdit(true);
    const { error } = await supabase
      .from('lecteurs')
      .update({
        nom: form.nom.trim(),
        prenom: form.prenom.trim(),
        date_naissance: form.date_naissance || null,
        annee_adhesion: form.annee_adhesion ? Number(form.annee_adhesion) : null,
        fraternite_id: form.fraternite_id || null,
        adresse: form.adresse.trim() || null,
        contact_parent: form.contact_parent.trim() || null,
      })
      .eq('id', l.id);
    setBusyEdit(false);
    if (error) toast(traduireErreur(error, 'mettre à jour cette fiche'), 'err');
    else {
      setShowEdit(false);
      toast('Fiche mise à jour.');
      load();
    }
  }

  /**
   * Changement de fraternité — autorisé à TOUS les rôles (cahier des charges :
   * information de vie de groupe, pas une donnée administrative).
   *
   * Passe exclusivement par la fonction SECURITY DEFINER `changer_fraternite`
   * (migration 20260914150600) qui valide la cible et journalise l'action.
   * L'UPDATE direct de la table n'est plus ouvert aux rôles non Admin/CO
   * (migration 20260916120000).
   */
  async function changerFraternite() {
    if (!l || !id) return;
    const cible = fratSel || null;
    setBusyFrat(true);

    const { error } = await supabase.rpc('changer_fraternite', {
      p_lecteur: id,
      p_fraternite: cible,
    });

    if (error) {
      setBusyFrat(false);
      toast(traduireErreur(error, 'changer la fraternité'), 'err');
      return;
    }

    setBusyFrat(false);
    toast(
      cible
        ? `Fraternité enregistrée : ${
            fraternites.find((f) => f.id === cible)?.nom ?? ''
          }.`
        : 'Lecteur détaché de sa fraternité.'
    );
    load();
  }

  async function addAppreciation() {
    if (!l || !appriseForm.motif.trim()) {
      toast('Le motif est obligatoire.', 'err');
      return;
    }
    setBusyAppreciation(true);
    const { error } = await supabase.from('appreciations').insert({
      lecteur_id: l.id,
      nature: appriseForm.nature,
      motif: appriseForm.motif.trim(),
      // created_by est posé par la base (trigger forcer_auteur = auth.uid()).
    });
    setBusyAppreciation(false);
    if (error) toast(traduireErreur(error, 'enregistrer cette appréciation'), 'err');
    else {
      setAppriseForm({ nature: 'positive', motif: '' });
      toast('Appréciation enregistrée.');
      load();
    }
  }

  async function deleteAppreciation(a: Appreciation) {
    if (!canEdit) return;
    if (!confirm('Supprimer cette appréciation ? (elle reste conservée en historique, masquée du profil)')) return;
    const { error } = await supabase
      .from('appreciations')
      .update({ deleted: true, deleted_at: new Date().toISOString() })
      .eq('id', a.id);
    if (error) toast(traduireErreur(error, 'retirer cette appréciation'), 'err');
    else {
      toast('Appréciation retirée du profil (historique conservé).');
      load();
    }
  }

  async function exportPdf() {
    if (!l) return;
    setBusyPdf(true);
    try {
      await exportFicheLecteur({
        lecteur: l,
        grades,
        history,
        presences,
        cotisations,
        evenements,
        appreciations: apprises.filter((a) => !a.deleted),
        auteur: profile?.full_name ?? '—',
        montantCot,
      });
      await journaliserExport('lecteur', l.matricule, { document: 'fiche_individuelle' });
      toast('PDF généré.');
    } catch (e) {
      toast(traduireErreur(e, 'générer la fiche PDF de ce lecteur'), 'err');
    } finally {
      setBusyPdf(false);
    }
  }

  const visiblesA = apprises.filter((a) => !a.deleted).sort((a, b) =>
    a.created_at < b.created_at ? 1 : -1
  );

  return (
    <div>
      <PageHeader
        title={`${l.prenom} ${l.nom.toUpperCase()}`}
        sub={`Matricule ${l.matricule}`}
        actions={
          <>
            {canEdit && <BtnGhost onClick={openEdit}>Modifier</BtnGhost>}
            {canEdit && (
              <BtnGhost onClick={exportPdf} busy={busyPdf} busyLabel="PDF…">
                ⬇ PDF
              </BtnGhost>
            )}
            {l.archived ? (
              isAdmin && (
                <BtnPrimary onClick={restaurer} busy={busyArchive} busyLabel="Restauration…">
                  Restaurer
                </BtnPrimary>
              )
            ) : (
              canEdit && (
                <BtnDanger onClick={archiver} busy={busyArchive} busyLabel="Archivage…">
                  Archiver
                </BtnDanger>
              )
            )}
          </>
        }
      />

      {l.archived && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
          ⚠️ Lecteur archivé le {fmtDateHeure(l.archived_at)} — visible uniquement
          dans l'historique.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Colonne 1 : infos + grade */}
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-bold text-slate-700">Informations</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Date de naissance</dt>
                <dd className="font-medium">{fmtDate(l.date_naissance)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Année d'adhésion</dt>
                <dd className="font-medium">{l.annee_adhesion ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Fraternité</dt>
                <dd className="font-medium">
                  {fraternites.find((f) => f.id === l.fraternite_id)?.nom ?? '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-slate-500">Adresse</dt>
                <dd className="text-right font-medium">{l.adresse || '—'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-slate-500">Contact parent</dt>
                <dd className="text-right font-medium">{l.contact_parent || '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Créé le</dt>
                <dd className="font-medium">{fmtDate(l.created_at)}</dd>
              </div>
            </dl>
          </div>

          {/* ---------------------------------------------------------- Fraternité
              Carte volontairement VISIBLE PAR TOUS LES RÔLES : le rattachement
              à une fraternité se corrige sur le terrain (Caissier, Responsable),
              pas seulement depuis l'Admin. */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-1 text-sm font-bold text-slate-700">Fraternité</h3>
            <p className="mb-3 text-xs text-slate-400">
              Rattachement actuel :{' '}
              <span className="font-semibold text-slate-600">
                {fraternites.find((f) => f.id === l.fraternite_id)?.nom ?? 'aucune'}
              </span>
            </p>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <select
                  aria-label="Fraternité du lecteur"
                  className={inputCls}
                  value={fratSel}
                  disabled={l.archived}
                  onChange={(e) => setFratSel(e.target.value)}
                >
                  <option value="">— Aucune fraternité —</option>
                  {fraternites.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nom}
                    </option>
                  ))}
                </select>
              </div>
              <BtnPrimary
                onClick={changerFraternite}
                busy={busyFrat}
                busyLabel="…"
                disabled={l.archived || fratSel === (l.fraternite_id ?? '')}
              >
                Changer
              </BtnPrimary>
            </div>
            {l.archived && (
              <p className="mt-2 text-xs font-medium text-amber-600">
                Lecteur archivé — rattachement verrouillé.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-bold text-slate-700">Grade</h3>
            <Badge tone="blue">{gradeNom(l.grade_id)}</Badge>
            {canEdit && !l.archived && (
              <div className="mt-3 flex items-center gap-2">
                <select
                  className={`${inputCls} w-auto`}
                  value={nouveauxGrade}
                  onChange={(e) => setNouveauxGrade(Number(e.target.value))}
                >
                  {grades.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.nom}
                    </option>
                  ))}
                </select>
                <BtnPrimary
                  onClick={changerGrade}
                  disabled={nouveauxGrade === l.grade_id}
                  busy={busyGrade}
                  busyLabel="Changement…"
                >
                  Changer
                </BtnPrimary>
              </div>
            )}
            <h4 className="mb-2 mt-4 text-xs font-semibold uppercase text-slate-400">
              Historique
            </h4>
            {history.length === 0 ? (
              <p className="text-sm text-slate-400">Aucun changement de grade.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {history.map((h) => (
                  <li key={h.id} className="flex justify-between">
                    <span className="font-medium">{gradeNom(h.grade_id)}</span>
                    <span className="text-slate-500">{fmtDate(h.changed_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-bold text-slate-700">
              Événements ({evenements.length})
            </h3>
            {evenements.length === 0 ? (
              <p className="text-sm text-slate-400">Aucun événement suivi.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {evenements.map((e) => (
                  <li key={e.id} className="flex justify-between">
                    <a
                      href={`/evenements/${e.id}`}
                      className="font-medium text-cdlj hover:underline"
                    >
                      {e.nom}
                    </a>
                    <span className="text-slate-500">{fmtDate(e.date_evenement)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Permissions */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-bold text-slate-700">
              Permissions ({permissions.length})
            </h3>
            {permissions.length === 0 ? (
              <p className="text-sm text-slate-400">Aucune permission enregistrée.</p>
            ) : (
              <ul className="space-y-2">
                {permissions.map((perm) => {
                  const auj = dateISO(aujourdhuiBenin());
                  const enCours = perm.samedis.some((s) => s >= auj);
                  const typePermLabels: Record<TypePermission, string> = {
                    un_samedi: 'Un samedi',
                    plusieurs_samedis: 'Plusieurs samedis',
                  };
                  return (
                    <li
                      key={perm.id}
                      className={`rounded-lg border p-3 text-sm ${
                        enCours
                          ? 'border-emerald-200 bg-emerald-50'
                          : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <Badge tone={enCours ? 'green' : 'gray'}>
                            {enCours ? 'En cours' : 'Terminée'}
                          </Badge>
                          <Badge tone="blue">{typePermLabels[perm.type_permission]}</Badge>
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-slate-600">
                        <span className="font-semibold">
                          {perm.samedis.length} samedi{perm.samedis.length > 1 ? 's' : ''} :
                        </span>{' '}
                        {perm.samedis.map((s) => fmtDate(s)).join(', ')}
                      </div>
                      <p className="mt-1 text-xs italic text-slate-500 break-words">
                        « {perm.motif} »
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Colonne 2 : présences + cotisations */}
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-700">Présences</h3>
              <MonthNav annee={aP} mois={mP} onChange={(a, m) => { setAP(a); setMP(m); }} />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {samedisP.map((d) => {
                const neant = l ? estAvantPremierSamediActif(d, l.created_at) : false;
                const st = !neant ? presMoisP.get(d) : undefined;
                const arrive = samediEstArrive(d);
                const absent = !neant && (st === 'absent' || (!st && arrive));
                return (
                  <div
                    key={d}
                    className={`rounded-lg border px-3 py-2 text-center text-xs font-semibold ${
                      neant
                        ? 'border-slate-200 bg-slate-100 text-slate-400 font-normal italic'
                        : st === 'present'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : absent
                            ? 'border-red-200 bg-red-50 text-alerte'
                            : 'border-slate-200 bg-slate-50 text-slate-400'
                    }`}
                  >
                    <div>Samedi {fmtDate(d).slice(0, 5)}</div>
                    <div className={neant ? 'text-xs italic py-1' : 'text-lg'}>
                      {neant ? 'Néant' : st === 'present' ? '✓' : absent ? '✗' : '—'}
                    </div>
                    {!neant && !st && !arrive && (
                      <div className="text-[10px] font-medium">à venir</div>
                    )}
                  </div>
                );
              })}
            </div>
            <h4 className="mb-2 mt-4 text-xs font-semibold uppercase text-slate-400">
              Récapitulatif 12 derniers mois
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[240px] text-xs">
                <thead>
                  <tr className="text-left text-slate-400">
                    <th className="py-1">Mois</th>
                    <th className="py-1 text-right">Présents</th>
                    <th className="py-1 text-right">Absents</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recapAnnuel.map((r) => (
                    <tr key={r.label}>
                      <td className="whitespace-nowrap py-1 font-medium text-slate-600">
                        {r.label}
                      </td>
                      <td className="py-1 text-right text-emerald-600">{r.present}</td>
                      <td className="py-1 text-right text-alerte">{r.absent}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-700">Cotisations</h3>
              <MonthNav annee={aC} mois={mC} onChange={(a, m) => { setAC(a); setMC(m); }} />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {samedisC.map((d) => {
                const neant = l ? estAvantPremierSamediActif(d, l.created_at) : false;
                const m = !neant ? cotMoisC.get(d) : undefined;
                const du = !neant && !m && samediEstArrive(d);
                return (
                  <div
                    key={d}
                    className={`rounded-lg border px-3 py-2 text-center text-xs font-semibold ${
                      neant
                        ? 'border-slate-200 bg-slate-100 text-slate-400 font-normal italic'
                        : m
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : du
                            ? 'border-red-200 bg-red-50 text-alerte'
                            : 'border-slate-200 bg-slate-50 text-slate-400'
                    }`}
                  >
                    <div>Samedi {fmtDate(d).slice(0, 5)}</div>
                    <div className={neant ? 'text-xs italic py-1' : 'text-sm'}>
                      {neant ? 'Néant' : m ? `${m} F ✓` : du ? 'dû' : '—'}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 text-xs text-slate-500">
              Total payé sur le mois :{' '}
              <span className="font-bold text-emerald-600">
                {fmtMoney(samedisC.reduce((s, d) => s + (cotMoisC.get(d) ?? 0), 0))}
              </span>{' '}
              · Total dû :{' '}
              <span className="font-bold text-alerte">
                {fmtMoney(
                  samedisC
                    .filter((d) => !estAvantPremierSamediActif(d, l?.created_at) && !cotMoisC.get(d) && samediEstArrive(d))
                    .reduce((s) => s + 50, 0)
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Colonne 3 : appréciations */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-slate-700">
            Blâmes, avertissements & appréciations
          </h3>
          <div className="mb-4 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex gap-2">
              <select
                className={`${inputCls} w-auto`}
                value={appriseForm.nature}
                onChange={(e) =>
                  setAppriseForm({ ...appriseForm, nature: e.target.value as NatureAppreciation })
                }
              >
                <option value="positive">Appréciation</option>
                <option value="avertissement">Avertissement</option>
                <option value="blame">Blâme</option>
              </select>
            </div>
            <textarea
              className={inputCls}
              rows={2}
              placeholder="Motif…"
              value={appriseForm.motif}
              onChange={(e) => setAppriseForm({ ...appriseForm, motif: e.target.value })}
            />
            <BtnPrimary
              onClick={addAppreciation}
              className="w-full"
              busy={busyAppreciation}
              busyLabel="Enregistrement…"
            >
              Ajouter
            </BtnPrimary>
          </div>
          {visiblesA.length === 0 ? (
            <EmptyState msg="Aucune appréciation enregistrée." />
          ) : (
            <ul className="space-y-2">
              {visiblesA.map((a) => (
                <li
                  key={a.id}
                  className={`rounded-lg border p-3 text-sm ${
                    a.nature === 'positive'
                      ? 'border-emerald-200 bg-emerald-50'
                      : a.nature === 'blame'
                        ? 'border-red-200 bg-red-50'
                        : 'border-amber-200 bg-amber-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <Badge
                      tone={
                        a.nature === 'positive' ? 'green' : a.nature === 'blame' ? 'red' : 'amber'
                      }
                    >
                      {a.nature === 'positive'
                        ? 'Appréciation'
                        : a.nature === 'blame'
                          ? 'Blâme'
                          : 'Avertissement'}
                    </Badge>
                    {canEdit && (
                      <button
                        onClick={() => deleteAppreciation(a)}
                        className={`text-xs font-semibold text-slate-400 hover:text-alerte ${pressCls}`}
                      >
                        Supprimer
                      </button>
                    )}
                  </div>
                  <p className="mt-2 text-slate-700">{a.motif}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {auteurName(a.created_by)} — {fmtDateHeure(a.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Modif fiche */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Modifier la fiche">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nom">
              <input className={inputCls} value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} />
            </Field>
            <Field label="Prénom">
              <input className={inputCls} value={form.prenom} onChange={(e) => setForm({ ...form, prenom: e.target.value })} />
            </Field>
            <Field label="Date de naissance">
              <input
                type="date"
                className={inputCls}
                value={form.date_naissance}
                min={bornesAnneeNaissance().min}
                max={bornesAnneeNaissance().max}
                onChange={(e) => setForm({ ...form, date_naissance: e.target.value })}
              />
            </Field>
            <Field
              label="Année d'adhésion"
              hint={`De ${bornesAnneeAdhesion().min} à ${anneeCourante()} (année en cours au maximum)`}
            >
              <input
                type="number"
                className={inputCls}
                value={form.annee_adhesion}
                inputMode="numeric"
                min={bornesAnneeAdhesion().min}
                max={bornesAnneeAdhesion().max}
                onChange={(e) => setForm({ ...form, annee_adhesion: e.target.value })}
              />
            </Field>
            <Field label="Fraternité">
              <select className={inputCls} value={form.fraternite_id} onChange={(e) => setForm({ ...form, fraternite_id: e.target.value })}>
                <option value="">— aucune —</option>
                {fraternites.map((f) => (
                  <option key={f.id} value={f.id}>{f.nom}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Adresse">
            <input className={inputCls} value={form.adresse} onChange={(e) => setForm({ ...form, adresse: e.target.value })} />
          </Field>
          <Field label="Contact parent / tuteur">
            <input className={inputCls} value={form.contact_parent} onChange={(e) => setForm({ ...form, contact_parent: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
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
