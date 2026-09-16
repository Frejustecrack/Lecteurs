import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { toutesLesLignes } from '../lib/pagination';
import { useRealtime } from '../lib/useRealtime';
import { useAuth } from '../context/AuthContext';
import { fmtDateHeure } from '../lib/dates';
import { traduireErreur } from '../lib/errors';
import { journaliserExport } from '../lib/journal';
import {
  anneeCourante,
  bornesAnneeAdhesion,
  bornesAnneeNaissance,
  validerAnneesLecteur,
} from '../lib/validation';
import {
  estAdmin,
  peutGererLecteurs,
  type Fraternite,
  type Grade,
  type Lecteur,
} from '../lib/types';
import {
  Badge,
  BtnGhost,
  BtnPrimary,
  EmptyState,
  Field,
  inputCls,
  Modal,
  PageHeader,
  pressCls,
  Spinner,
  useToast,
} from '../components/ui';
import { exportListeLecteurs } from '../pdf/export';

interface FormLecteur {
  nom: string;
  prenom: string;
  date_naissance: string;
  grade_id: number;
  annee_adhesion: string;
  fraternite_id: string;
  adresse: string;
  contact_parent: string;
}

const FORM_VIDE: FormLecteur = {
  nom: '',
  prenom: '',
  date_naissance: '',
  grade_id: 1,
  annee_adhesion: String(new Date().getFullYear()),
  fraternite_id: '',
  adresse: '',
  contact_parent: '',
};

export default function Lecteurs() {
  const { profile } = useAuth();
  const canEdit = peutGererLecteurs(profile?.role);
  const isAdmin = estAdmin(profile?.role);
  const navigate = useNavigate();
  const { toast } = useToast();

  const [lecteurs, setLecteurs] = useState<Lecteur[]>([]);
  const [fraternites, setFraternites] = useState<Fraternite[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [fId, setFId] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [tab, setTab] = useState<'actifs' | 'archives'>('actifs');
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormLecteur>(FORM_VIDE);
  const [busy, setBusy] = useState(false);
  const [busyArchivage, setBusyArchivage] = useState<string | null>(null);
  const [busyPdf, setBusyPdf] = useState(false);

  const load = useCallback(async () => {
    const [rL, rF, rG] = await Promise.all([
      // 200 max : on charge tout, mais on évite le `select *` trop large
      toutesLesLignes<Lecteur>((de, a) =>
        supabase
          .from('lecteurs')
          .select('id, matricule, nom, prenom, grade_id, fraternite_id, annee_adhesion, archived, archived_at, contact_parent')
          .order('matricule')
          .range(de, a)
      ),
      supabase.from('fraternites').select('id, nom').order('nom'),
      supabase.from('grades').select('*').order('id'),
    ]);
    setLecteurs((rL.data ?? []) as Lecteur[]);
    setFraternites((rF.data ?? []) as Fraternite[]);
    setGrades((rG.data ?? []) as Grade[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Temps réel : un lecteur créé ou rattaché à une fraternité ailleurs
   * apparaît ici sans rechargement.
   */
  useRealtime('realtime-lecteurs', ['lecteurs', 'fraternites'], load);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lecteurs.filter((l) => {
      if (tab === 'actifs' ? l.archived : !l.archived) return false;
      if (fId && l.fraternite_id !== fId) return false;
      if (gradeId && l.grade_id !== Number(gradeId)) return false;
      if (!q) return true;
      return (
        l.matricule.toLowerCase().includes(q) ||
        l.nom.toLowerCase().includes(q) ||
        l.prenom.toLowerCase().includes(q)
      );
    });
  }, [lecteurs, tab, fId, gradeId, search]);

  const filtresActifs = fId !== '' || gradeId !== '' || search.trim() !== '';

  function reinitialiserFiltres() {
    setFId('');
    setGradeId('');
    setSearch('');
  }

  function openCreate() {
    setEditId(null);
    setForm(FORM_VIDE);
    setFormOpen(true);
  }

  function openEdit(l: Lecteur) {
    setEditId(l.id);
    setForm({
      nom: l.nom,
      prenom: l.prenom,
      date_naissance: l.date_naissance ?? '',
      grade_id: l.grade_id,
      annee_adhesion: l.annee_adhesion ? String(l.annee_adhesion) : '',
      fraternite_id: l.fraternite_id ?? '',
      adresse: l.adresse ?? '',
      contact_parent: l.contact_parent ?? '',
    });
    setFormOpen(true);
  }

  async function save() {
    if (!form.nom.trim() || !form.prenom.trim()) {
      toast('Nom et prénom sont obligatoires.', 'err');
      return;
    }
    // Ni l'année de naissance ni l'année d'adhésion ne peuvent dépasser
    // l'année en cours.
    const v = validerAnneesLecteur(form.date_naissance, form.annee_adhesion);
    if (!v.ok) {
      toast(v.message ?? 'Saisie invalide.', 'err');
      return;
    }
    setBusy(true);
    const payload = {
      nom: form.nom.trim(),
      prenom: form.prenom.trim(),
      date_naissance: form.date_naissance || null,
      grade_id: Number(form.grade_id),
      annee_adhesion: form.annee_adhesion ? Number(form.annee_adhesion) : null,
      fraternite_id: form.fraternite_id || null,
      adresse: form.adresse.trim() || null,
      contact_parent: form.contact_parent.trim() || null,
    };
    try {
      if (editId) {
        const { error } = await supabase
          .from('lecteurs')
          .update(payload)
          .eq('id', editId);
        if (error) throw error;
        toast('Fiche lecteur mise à jour.');
      } else {
        const { data, error } = await supabase
          .from('lecteurs')
          .insert({ ...payload, matricule: '' })
          .select()
          .single();
        if (error) throw error;
        toast(`Lecteur créé — matricule ${(data as Lecteur).matricule}`);
      }
      setFormOpen(false);
      load();
    } catch (e) {
      toast(
        traduireErreur(e, editId ? 'mettre à jour cette fiche' : 'créer ce lecteur'),
        'err'
      );
    } finally {
      setBusy(false);
    }
  }

  async function archiver(l: Lecteur) {
    if (
      !confirm(
        `Archiver ${l.matricule} — ${l.prenom} ${l.nom} ?\n\nLe lecteur disparaît des listes actives mais toutes ses données sont conservées. Son matricule reste réservé. (Action réversible par l'Administrateur)`
      )
    )
      return;
    setBusyArchivage(l.id);
    const { error } = await supabase
      .from('lecteurs')
      .update({ archived: true, archived_at: new Date().toISOString() })
      .eq('id', l.id);
    setBusyArchivage(null);
    if (error) toast(traduireErreur(error, 'archiver ce lecteur'), 'err');
    else toast('Lecteur archivé.');
    load();
  }

  /**
   * Exporte en PDF la liste des lecteurs affichés, c'est-à-dire filtrés par
   * l'onglet (actifs / archivés), la fraternité, le grade et la recherche.
   * Le récapitulatif des filtres figure dans l'en-tête du document.
   */
  async function exporterPdf() {
    if (filtered.length === 0) {
      toast('Aucun lecteur à exporter avec les filtres actuels.', 'err');
      return;
    }
    setBusyPdf(true);
    try {
      exportListeLecteurs({
        lecteurs: filtered,
        grades,
        fraternites,
        fraternite: fraternites.find((f) => f.id === fId)?.nom ?? null,
        grade: grades.find((g) => g.id === Number(gradeId))?.nom ?? null,
        recherche: search.trim(),
        statut: tab,
        auteur: profile?.full_name ?? profile?.username ?? '—',
      });
      await journaliserExport('lecteurs', tab, {
        document: 'liste_lecteurs',
        statut: tab,
        fraternite: fId || 'toutes',
        grade: gradeId || 'tous',
        recherche: search.trim() || null,
        nombre: filtered.length,
      });
      toast(`PDF généré — ${filtered.length} lecteur(s).`);
    } catch (e) {
      toast(traduireErreur(e, 'générer le PDF de la liste des lecteurs'), 'err');
    } finally {
      setBusyPdf(false);
    }
  }

  if (loading) return <Spinner label="Chargement des lecteurs…" />;

  const actifsCount = lecteurs.filter((l) => !l.archived).length;
  const capaciteMax = 200;
  const plein = actifsCount >= capaciteMax;

  const gradeNom = (id: number) => grades.find((g) => g.id === id)?.nom ?? '—';
  const fraterniteNom = (id: string | null) =>
    fraternites.find((f) => f.id === id)?.nom ?? '—';

  return (
    <div>
      <PageHeader
        title="Lecteurs"
        sub={`${actifsCount} lecteur(s) actif(s) / ${capaciteMax} max${plein ? ' — capacité atteinte' : ''}`}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <BtnGhost
              onClick={exporterPdf}
              busy={busyPdf}
              busyLabel="PDF…"
              disabled={filtered.length === 0}
              title={
                filtered.length === 0
                  ? 'Aucun lecteur à exporter avec les filtres actuels'
                  : `Exporter les ${filtered.length} lecteur(s) affiché(s) en PDF`
              }
              className="w-full sm:w-auto"
            >
              ⬇ Export PDF ({filtered.length})
            </BtnGhost>
            <BtnPrimary onClick={openCreate} disabled={plein} title={plein ? `Capacité maximale ${capaciteMax} atteinte` : undefined} className="w-full sm:w-auto">
              + Nouveau lecteur
            </BtnPrimary>
          </div>
        }
      />
      {plein && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Capacité maximale de {capaciteMax} lecteurs actifs atteinte. Archivez un lecteur avant d'en créer un nouveau.
        </div>
      )}

      {/*
        Filtres — ordre demandé : fraternités, PUIS grade, PUIS recherche.
        Sur téléphone : une colonne pleine largeur (sans zoom auto iOS grâce
        au texte 16px) ; sur ordinateur : une ligne fluide.
      */}
      <div className="mb-3 grid gap-2 sm:flex sm:flex-wrap sm:items-center">
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
          <button
            onClick={() => setTab('actifs')}
            aria-pressed={tab === 'actifs'}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-semibold sm:flex-none ${pressCls} ${
              tab === 'actifs' ? 'bg-cdlj text-white' : 'text-slate-600'
            }`}
          >
            Actifs
          </button>
          {canEdit && (
            <button
              onClick={() => setTab('archives')}
              aria-pressed={tab === 'archives'}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-semibold sm:flex-none ${pressCls} ${
                tab === 'archives' ? 'bg-cdlj text-white' : 'text-slate-600'
              }`}
            >
              Archivés
            </button>
          )}
        </div>
        <select
          value={fId}
          onChange={(e) => setFId(e.target.value)}
          aria-label="Filtrer par fraternité"
          className={`${inputCls} w-full text-base sm:w-auto sm:text-sm`}
        >
          <option value="">Toutes les fraternités</option>
          {fraternites.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nom}
            </option>
          ))}
        </select>
        <select
          value={gradeId}
          onChange={(e) => setGradeId(e.target.value)}
          aria-label="Filtrer par grade"
          className={`${inputCls} w-full text-base sm:w-auto sm:text-sm`}
        >
          <option value="">Tous les grades</option>
          {grades.map((g) => (
            <option key={g.id} value={g.id}>
              {g.nom}
            </option>
          ))}
        </select>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher (matricule, nom…)"
          aria-label="Rechercher par matricule ou nom"
          autoComplete="off"
          enterKeyHint="search"
          className={`${inputCls} w-full text-base sm:min-w-0 sm:max-w-xs sm:flex-1 sm:text-sm`}
        />
      </div>

      {filtresActifs && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="font-semibold text-slate-500">
            {filtered.length} résultat(s) avec les filtres actuels
          </span>
          <button
            onClick={reinitialiserFiltres}
            className={`font-semibold text-cdlj hover:underline ${pressCls}`}
          >
            Réinitialiser les filtres
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          msg={
            tab === 'archives'
              ? 'Aucun lecteur archivé.'
              : 'Aucun lecteur trouvé. Créez le premier lecteur ou ajustez les filtres.'
          }
        />
      ) : (
        <>
          {/* Téléphones : cartes empilées — pas de scroll horizontal, lecture
              immédiate, zones tactiles larges (iOS / Android). */}
          <ul className="space-y-2 sm:hidden">
            {filtered.map((l) => (
              <li
                key={l.id}
                onClick={() => navigate(`/lecteurs/${l.id}`)}
                className="cursor-pointer rounded-xl border border-slate-200 bg-white p-3 shadow-sm active:bg-slate-50"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-xs font-semibold text-cdlj">
                      {l.matricule}
                    </div>
                    <div className="truncate text-sm font-semibold text-slate-800">
                      {l.prenom} {l.nom.toUpperCase()}
                    </div>
                  </div>
                  <Badge tone="blue">{gradeNom(l.grade_id)}</Badge>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                  <span className="min-w-0 truncate">
                    🤝 {fraterniteNom(l.fraternite_id)}
                  </span>
                  <span className="whitespace-nowrap">
                    Adhésion : {l.annee_adhesion ?? '—'}
                  </span>
                </div>
                {tab === 'actifs' && canEdit && (
                  <div
                    className="mt-2.5 flex gap-2 border-t border-slate-100 pt-2.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => openEdit(l)}
                      className={`flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-cdlj active:bg-slate-50 ${pressCls}`}
                    >
                      Modifier
                    </button>
                    <button
                      onClick={() => archiver(l)}
                      disabled={busyArchivage === l.id}
                      className={`flex-1 rounded-lg border border-red-100 bg-red-50/50 px-3 py-2 text-xs font-semibold text-alerte active:bg-red-50 ${pressCls}`}
                    >
                      {busyArchivage === l.id ? 'Archivage…' : 'Archiver'}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {/* Ordinateurs / tablettes : tableau complet. */}
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm sm:block">
            <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Matricule</th>
                <th className="px-4 py-3">Nom</th>
                <th className="px-4 py-3">Grade</th>
                <th className="px-4 py-3">Fraternité</th>
                <th className="px-4 py-3">Adhésion</th>
                {tab === 'actifs' && canEdit && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((l) => (
                <tr
                  key={l.id}
                  onClick={() => navigate(`/lecteurs/${l.id}`)}
                  className="cursor-pointer hover:bg-slate-50"
                >
                  <td className="px-4 py-3 font-mono font-semibold text-cdlj">
                    {l.matricule}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {l.prenom} {l.nom.toUpperCase()}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone="blue">{gradeNom(l.grade_id)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {fraterniteNom(l.fraternite_id)}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{l.annee_adhesion ?? '—'}</td>
                  {tab === 'actifs' && canEdit && (
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => openEdit(l)}
                        className={`mr-2 text-xs font-semibold text-cdlj hover:underline ${pressCls}`}
                      >
                        Modifier
                      </button>
                      <button
                        onClick={() => archiver(l)}
                        disabled={busyArchivage === l.id}
                        className={`text-xs font-semibold text-alerte hover:underline ${pressCls}`}
                      >
                        Archiver
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

      {tab === 'archives' &&
        filtered
          .filter((l) => l.archived_at)
          .length > 0 && (
          <p className="mt-2 text-xs text-slate-400">
            Archivage le plus récent :{' '}
            {fmtDateHeure(
              [...filtered]
                .sort((a, b) => (b.archived_at ?? '') < (a.archived_at ?? '') ? -1 : 1)[0]
                .archived_at
            )}
          </p>
        )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editId ? 'Modifier la fiche lecteur' : 'Nouveau lecteur'}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nom *">
              <input
                className={inputCls}
                value={form.nom}
                onChange={(e) => setForm({ ...form, nom: e.target.value })}
              />
            </Field>
            <Field label="Prénom *">
              <input
                className={inputCls}
                value={form.prenom}
                onChange={(e) => setForm({ ...form, prenom: e.target.value })}
              />
            </Field>
            <Field label="Date de naissance">
              <input
                type="date"
                className={inputCls}
                value={form.date_naissance}
                max={bornesAnneeNaissance().max}
                min={bornesAnneeNaissance().min}
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
            <Field label="Grade">
              <select
                className={inputCls}
                value={form.grade_id}
                onChange={(e) => setForm({ ...form, grade_id: Number(e.target.value) })}
              >
                {grades.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.nom}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Fraternité">
              <select
                className={inputCls}
                value={form.fraternite_id}
                onChange={(e) => setForm({ ...form, fraternite_id: e.target.value })}
              >
                <option value="">— aucune —</option>
                {fraternites.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nom}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Adresse">
            <input
              className={inputCls}
              value={form.adresse}
              onChange={(e) => setForm({ ...form, adresse: e.target.value })}
            />
          </Field>
          <Field label="Contact parent / tuteur">
            <input
              className={inputCls}
              value={form.contact_parent}
              onChange={(e) => setForm({ ...form, contact_parent: e.target.value })}
              placeholder="Nom et téléphone"
            />
          </Field>
          {!editId && (
            <p className="text-xs text-slate-400">
              Le matricule (LEC…) sera attribué automatiquement, dans la séquence
              croissante, et restera définitivement réservé.
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <BtnGhost onClick={() => setFormOpen(false)} className="w-full sm:w-auto">
              Annuler
            </BtnGhost>
            <BtnPrimary
              onClick={save}
              busy={busy}
              busyLabel="Enregistrement…"
              className="w-full sm:w-auto"
            >
              Enregistrer
            </BtnPrimary>
          </div>
        </div>
      </Modal>

      {tab === 'archives' && isAdmin && (
        <p className="mt-3 text-xs text-slate-400">
          💡 En tant qu'Administrateur, vous pouvez restaurer un lecteur archivé
          depuis sa fiche (bouton Restaurer).
        </p>
      )}
    </div>
  );
}
