import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { toutesLesLignes } from '../lib/pagination';
import { useRealtime } from '../lib/useRealtime';
import { useAuth } from '../context/AuthContext';
import { traduireErreur } from '../lib/errors';
import { peutGererLecteurs, type Fraternite, type Lecteur } from '../lib/types';
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

export default function Fraternites() {
  const { profile } = useAuth();
  const canEdit = peutGererLecteurs(profile?.role);
  const canDelete = !!profile?.role; // tout utilisateur connecté peut supprimer une fraternité vide
  const navigate = useNavigate();
  const { toast } = useToast();

  const [fraternites, setFraternites] = useState<Fraternite[]>([]);
  const [lecteurs, setLecteurs] = useState<Lecteur[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ nom: '', responsables: '' });
  const [busy, setBusy] = useState(false);
  const [busySuppr, setBusySuppr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [rF, rL] = await Promise.all([
      supabase.from('fraternites').select('id, nom, responsables').order('nom'),
      // 200 max : colonnes minimales, pas de select * (60% de gain)
      toutesLesLignes<Lecteur>((de, a) =>
        supabase
          .from('lecteurs')
          .select('id, matricule, nom, prenom, fraternite_id, archived')
          .eq('archived', false)
          .order('matricule')
          .range(de, a)
      ),
    ]);
    setFraternites((rF.data ?? []) as Fraternite[]);
    setLecteurs((rL.data ?? []) as Lecteur[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Synchronisation temps réel
  useRealtime('realtime-fraternites', ['fraternites', 'lecteurs'], load);

  function openCreate() {
    setEditId(null);
    setForm({ nom: '', responsables: '' });
    setFormOpen(true);
  }

  function openEdit(f: Fraternite) {
    setEditId(f.id);
    setForm({ nom: f.nom, responsables: f.responsables.join(', ') });
    setFormOpen(true);
  }

  async function save() {
    if (!form.nom.trim()) {
      toast('Le nom de la fraternité est obligatoire.', 'err');
      return;
    }
    setBusy(true);
    const payload = {
      nom: form.nom.trim(),
      responsables: form.responsables
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };
    try {
      if (editId) {
        const { error } = await supabase
          .from('fraternites')
          .update(payload)
          .eq('id', editId);
        if (error) throw error;
        toast('Fraternité mise à jour.');
      } else {
        const { error } = await supabase.from('fraternites').insert(payload);
        if (error) throw error;
        toast('Fraternité créée.');
      }
      setFormOpen(false);
      load();
    } catch (e) {
      toast(
        traduireErreur(e, editId ? 'modifier cette fraternité' : 'créer cette fraternité'),
        'err'
      );
    } finally {
      setBusy(false);
    }
  }

  async function supprimer(f: Fraternite) {
    const nb = lecteurs.filter((l) => l.fraternite_id === f.id).length;
    if (nb > 0) {
      toast(
        `Impossible : la fraternité « ${f.nom} » compte encore ${nb} lecteur(s) actif(s). Déplacez-les d'abord vers une autre fraternité.`,
        'err'
      );
      return;
    }
    if (!confirm(`Supprimer la fraternité « ${f.nom} » ? (elle est vide)`)) return;
    setBusySuppr(f.id);
    const { error } = await supabase.from('fraternites').delete().eq('id', f.id);
    setBusySuppr(null);
    if (error) toast(traduireErreur(error, 'supprimer cette fraternité'), 'err');
    else {
      toast('Fraternité supprimée.');
      load();
    }
  }

  if (loading) return <Spinner label="Chargement des fraternités…" />;

  return (
    <div>
      <PageHeader
        title="Fraternités"
        sub={`${fraternites.length} fraternité(s) — chaque lecteur n'appartient qu'à une fraternité`}
        actions={<BtnPrimary onClick={openCreate}>+ Nouvelle fraternité</BtnPrimary>}
      />

      {fraternites.length === 0 ? (
        <EmptyState msg="Aucune fraternité. Créez la première !" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {fraternites.map((f) => {
            const membres = lecteurs.filter((l) => l.fraternite_id === f.id);
            return (
              <div
                key={f.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-slate-800">{f.nom}</h3>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge tone="blue">{membres.length} lecteur(s)</Badge>
                    </div>
                  </div>
                  {(canEdit || canDelete) && (
                    <div className="flex gap-2 text-xs font-semibold">
                      {canEdit && (
                        <button
                          onClick={() => openEdit(f)}
                          className={`text-cdlj hover:underline ${pressCls}`}
                        >
                          Modifier
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => supprimer(f)}
                          disabled={busySuppr === f.id}
                          className={`text-alerte hover:underline ${pressCls}`}
                        >
                          {busySuppr === f.id ? 'Suppression…' : 'Supprimer'}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {f.responsables.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-semibold uppercase text-slate-400">
                      Responsable(s)
                    </div>
                    <div className="mt-0.5 text-sm text-slate-600">
                      {f.responsables.join(', ')}
                    </div>
                  </div>
                )}

                {membres.length > 0 && (
                  <div className="mt-3 border-t border-slate-100 pt-2">
                    <div className="text-xs font-semibold uppercase text-slate-400">
                      Lecteurs
                    </div>
                    <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto text-sm">
                      {membres.map((l) => (
                        <li key={l.id}>
                          <button
                            onClick={() => navigate(`/lecteurs/${l.id}`)}
                            className="hover:text-cdlj"
                          >
                            <span className="font-mono text-xs text-cdlj">
                              {l.matricule}
                            </span>{' '}
                            {l.prenom} {l.nom.toUpperCase()}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editId ? 'Modifier la fraternité' : 'Nouvelle fraternité'}
      >
        <div className="space-y-4">
          <Field label="Nom *">
            <input
              className={inputCls}
              value={form.nom}
              onChange={(e) => setForm({ ...form, nom: e.target.value })}
              placeholder="Ex. Fraternité Marie"
            />
          </Field>
          <Field
            label="Responsable(s)"
            hint="Un ou plusieurs noms, séparés par des virgules. (simples noms, sans compte applicatif)"
          >
            <input
              className={inputCls}
              value={form.responsables}
              onChange={(e) => setForm({ ...form, responsables: e.target.value })}
              placeholder="Ex. Jean K., Marie A."
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <BtnGhost onClick={() => setFormOpen(false)}>Annuler</BtnGhost>
            <BtnPrimary onClick={save} busy={busy} busyLabel="Enregistrement…">
              Enregistrer
            </BtnPrimary>
          </div>
        </div>
      </Modal>
    </div>
  );
}
