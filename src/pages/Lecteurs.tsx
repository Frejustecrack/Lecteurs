import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { fmtDateHeure } from '../lib/dates';
import { traduireErreur } from '../lib/errors';
import {
  anneeCourante,
  bornesAnneeAdhesion,
  bornesAnneeNaissance,
  validerAnneesLecteur,
} from '../lib/validation';
import type { Fraternite, Grade, Lecteur } from '../lib/types';
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
  const canEdit = profile?.role === 'admin' || profile?.role === 'co';
  const isAdmin = profile?.role === 'admin';
  const navigate = useNavigate();
  const { toast } = useToast();

  const [lecteurs, setLecteurs] = useState<Lecteur[]>([]);
  const [fraternites, setFraternites] = useState<Fraternite[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [fId, setFId] = useState('');
  const [tab, setTab] = useState<'actifs' | 'archives'>('actifs');
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormLecteur>(FORM_VIDE);
  const [busy, setBusy] = useState(false);
  const [busyArchivage, setBusyArchivage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [rL, rF, rG] = await Promise.all([
      supabase.from('lecteurs').select('*').order('matricule'),
      supabase.from('fraternites').select('*').order('nom'),
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lecteurs.filter((l) => {
      if (tab === 'actifs' ? l.archived : !l.archived) return false;
      if (fId && l.fraternite_id !== fId) return false;
      if (!q) return true;
      return (
        l.matricule.toLowerCase().includes(q) ||
        l.nom.toLowerCase().includes(q) ||
        l.prenom.toLowerCase().includes(q)
      );
    });
  }, [lecteurs, tab, fId, search]);

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

  async function restaurer(l: Lecteur) {
    if (!confirm(`Restaurer ${l.matricule} — ${l.prenom} ${l.nom} ?`)) return;
    setBusyArchivage(l.id);
    const { error } = await supabase
      .from('lecteurs')
      .update({ archived: false, archived_at: null })
      .eq('id', l.id);
    setBusyArchivage(null);
    if (error) toast(traduireErreur(error, 'restaurer ce lecteur'), 'err');
    else toast('Lecteur restauré.');
    load();
  }

  if (loading) return <Spinner label="Chargement des lecteurs…" />;

  const gradeNom = (id: number) => grades.find((g) => g.id === id)?.nom ?? '—';
  const fraterniteNom = (id: string | null) =>
    fraternites.find((f) => f.id === id)?.nom ?? '—';

  return (
    <div>
      <PageHeader
        title="Lecteurs"
        sub={`${lecteurs.filter((l) => !l.archived).length} lecteur(s) actif(s)`}
        actions={
          <BtnPrimary onClick={openCreate}>+ Nouveau lecteur</BtnPrimary>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
          <button
            onClick={() => setTab('actifs')}
            aria-pressed={tab === 'actifs'}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${pressCls} ${
              tab === 'actifs' ? 'bg-cdlj text-white' : 'text-slate-600'
            }`}
          >
            Actifs
          </button>
          {canEdit && (
            <button
              onClick={() => setTab('archives')}
              aria-pressed={tab === 'archives'}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold ${pressCls} ${
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
          className={`${inputCls} w-auto`}
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
          placeholder="Rechercher (matricule, nom…)"
          className={`${inputCls} max-w-xs flex-1`}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          msg={
            tab === 'archives'
              ? 'Aucun lecteur archivé.'
              : 'Aucun lecteur trouvé. Créez le premier lecteur ou ajustez les filtres.'
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
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
          <div className="flex justify-end gap-2 pt-2">
            <BtnGhost onClick={() => setFormOpen(false)}>Annuler</BtnGhost>
            <BtnPrimary onClick={save} busy={busy} busyLabel="Enregistrement…">
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
