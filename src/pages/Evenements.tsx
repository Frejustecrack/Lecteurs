import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { fmtDate, fmtMoney } from '../lib/dates';
import { traduireErreur } from '../lib/errors';
import type { Evenement } from '../lib/types';
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

export default function Evenements() {
  const { profile } = useAuth();
  const isCO = profile?.role === 'co';
  const isAdmin = profile?.role === 'admin';
  const canManage = isCO || isAdmin;
  const navigate = useNavigate();
  const { toast } = useToast();

  const [evenements, setEvenements] = useState<Evenement[]>([]);
  const [nbParticipants, setNbParticipants] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'en_cours' | 'termine'>('en_cours');
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    nom: '',
    date_evenement: '',
    lieu: '',
    montant_participation: '',
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [rE, rP] = await Promise.all([
      supabase.from('evenements').select('*').order('date_evenement', { ascending: false }),
      supabase.from('evenement_participants').select('event_id'),
    ]);
    const list = ((rE.data ?? []) as Evenement[]);
    setEvenements(list);
    const counts: Record<string, number> = {};
    ((rP.data ?? []) as { event_id: string }[]).forEach((p) => {
      counts[p.event_id] = (counts[p.event_id] ?? 0) + 1;
    });
    setNbParticipants(counts);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    if (!isCO) {
      toast('Seul le Chargé des Opérations peut créer un événement.', 'err');
      return;
    }
    setEditId(null);
    setForm({
      nom: '',
      date_evenement: new Date().toISOString().slice(0, 10),
      lieu: '',
      montant_participation: '',
    });
    setFormOpen(true);
  }

  function openEdit(e: Evenement) {
    if (!canManage || e.statut === 'termine') return;
    setEditId(e.id);
    setForm({
      nom: e.nom,
      date_evenement: e.date_evenement,
      lieu: e.lieu ?? '',
      montant_participation: String(e.montant_participation),
    });
    setFormOpen(true);
  }

  async function save() {
    if (!form.nom.trim() || !form.date_evenement) {
      toast('Nom et date sont obligatoires.', 'err');
      return;
    }
    setBusy(true);
    const payload = {
      nom: form.nom.trim(),
      date_evenement: form.date_evenement,
      lieu: form.lieu.trim() || null,
      montant_participation: Number(form.montant_participation) || 0,
      // Créateur de l'événement (cahier des charges §18 : actions tracées
      // avec leur auteur).
      ...(editId ? {} : { created_by: profile?.id ?? null }),
    };
    try {
      if (editId) {
        const { error } = await supabase
          .from('evenements')
          .update(payload)
          .eq('id', editId);
        if (error) throw error;
        toast('Événement mis à jour.');
      } else {
        const { error } = await supabase.from('evenements').insert(payload);
        if (error) throw error;
        toast('Événement créé.');
      }
      setFormOpen(false);
      load();
    } catch (e) {
      toast(
        traduireErreur(e, editId ? 'modifier cet événement' : 'créer cet événement'),
        'err'
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="Chargement des événements…" />;

  const list = evenements.filter((e) => e.statut === tab);

  return (
    <div>
      <PageHeader
        title="Événements"
        sub="Fêtes, activités, sorties… — gérés par le Chargé des Opérations"
        actions={
          isCO ? <BtnPrimary onClick={openCreate}>+ Nouvel événement</BtnPrimary> : undefined
        }
      />

      <div className="mb-4 flex rounded-lg border border-slate-200 bg-white p-0.5 w-fit">
        <button
          onClick={() => setTab('en_cours')}
          aria-pressed={tab === 'en_cours'}
          className={`rounded-md px-4 py-1.5 text-sm font-semibold ${pressCls} ${
            tab === 'en_cours' ? 'bg-cdlj text-white' : 'text-slate-600'
          }`}
        >
          En cours
        </button>
        <button
          onClick={() => setTab('termine')}
          aria-pressed={tab === 'termine'}
          className={`rounded-md px-4 py-1.5 text-sm font-semibold ${pressCls} ${
            tab === 'termine' ? 'bg-cdlj text-white' : 'text-slate-600'
          }`}
        >
          Terminés
        </button>
      </div>

      {list.length === 0 ? (
        <EmptyState
          msg={
            tab === 'en_cours'
              ? 'Aucun événement en cours.'
              : 'Aucun événement terminé.'
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((e) => (
            <button
              key={e.id}
              onClick={() => navigate(`/evenements/${e.id}`)}
              className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-bold text-slate-800">{e.nom}</h3>
                <Badge tone={e.statut === 'en_cours' ? 'green' : 'gray'}>
                  {e.statut === 'en_cours' ? 'En cours' : 'Terminé'}
                </Badge>
              </div>
              <div className="mt-2 space-y-1 text-sm text-slate-600">
                <div>📅 {fmtDate(e.date_evenement)}</div>
                {e.lieu && <div>📍 {e.lieu}</div>}
                <div>💰 Participation : {fmtMoney(e.montant_participation)}</div>
                <div>👥 {nbParticipants[e.id] ?? 0} participant(s)</div>
              </div>
              {e.statut === 'en_cours' && canManage && (
                <div className="mt-3 text-xs font-semibold text-cdlj">
                  Modifier →
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editId ? 'Modifier l’événement' : 'Nouvel événement'}
      >
        <div className="space-y-4">
          <Field label="Nom *">
            <input
              className={inputCls}
              value={form.nom}
              onChange={(e) => setForm({ ...form, nom: e.target.value })}
              placeholder="Ex. Journée de détente"
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Date *">
              <input
                type="date"
                className={inputCls}
                value={form.date_evenement}
                onChange={(e) => setForm({ ...form, date_evenement: e.target.value })}
              />
            </Field>
            <Field label="Lieu">
              <input
                className={inputCls}
                value={form.lieu}
                onChange={(e) => setForm({ ...form, lieu: e.target.value })}
              />
            </Field>
          </div>
          <Field
            label="Montant de participation (F CFA)"
            hint="Fixé à la création, les participants paient en une ou plusieurs tranches."
          >
            <input
              type="number"
              className={inputCls}
              value={form.montant_participation}
              onChange={(e) =>
                setForm({ ...form, montant_participation: e.target.value })
              }
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
