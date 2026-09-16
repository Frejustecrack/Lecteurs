import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useRealtime } from '../lib/useRealtime';
import { useAuth } from '../context/AuthContext';
import { fmtDate, fmtMoney } from '../lib/dates';
import { traduireErreur } from '../lib/errors';
import { estAdmin, estCO, type Evenement } from '../lib/types';
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
  const isCO = estCO(profile?.role);
  const isAdmin = estAdmin(profile?.role);
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
  /** Identifiant de l'événement en cours de suppression (bouton désactivé). */
  const [busyDelete, setBusyDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [rE, rP] = await Promise.all([
      supabase.from('evenements').select('*').order('date_evenement', { ascending: false }),
      // Compteurs calculés en base (200 lecteurs × N événements dépasserait
      // vite la limite de 1 000 lignes de PostgREST).
      supabase.from('v_evenements_avancement').select('id, participants'),
    ]);
    const list = ((rE.data ?? []) as Evenement[]);
    setEvenements(list);
    const counts: Record<string, number> = {};
    ((rP.data ?? []) as { id: string; participants: number }[]).forEach((p) => {
      counts[p.id] = Number(p.participants);
    });
    setNbParticipants(counts);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Temps réel : un événement créé, modifié, supprimé ou dont les inscrits
   * changent ailleurs est reflété ici sans rechargement manuel.
   * (Tables publiées par la migration 20260915180000.)
   */
  useRealtime('realtime-evenements', ['evenements', 'evenement_participants'], load);

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
      // created_by est posé par la base (trigger forcer_auteur = auth.uid()).
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

  /** Suppression depuis la liste : même contrôle et même message qu'en fiche. */
  async function supprimer(e: Evenement) {
    if (!canManage) {
      toast(
        "Seul le Chargé des Opérations ou l'Administrateur peut supprimer un événement.",
        'err'
      );
      return;
    }
    if (
      !confirm(
        `Supprimer l'événement « ${e.nom} » ?\n\nLes participants, les paiements et la caisse liée seront supprimés en cascade. Cette action est irréversible.`
      )
    )
      return;
    if (!confirm("Confirmation finale : supprimer définitivement l'événement ?")) return;
    setBusyDelete(e.id);
    const { error } = await supabase.from('evenements').delete().eq('id', e.id);
    setBusyDelete(null);
    if (error) {
      // Jamais de message PostgreSQL brut à l'écran (voir lib/errors.ts).
      toast(traduireErreur(error, 'supprimer cet événement'), 'err');
      return;
    }
    toast("L'événement a été supprimé.");
    load();
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
          {list.map((e) => {
            const nb = nbParticipants[e.id] ?? 0;
            return (
              /* Un <button> ne peut pas en contenir un autre : la carte est
                 donc un conteneur cliquable, ce qui garde l'accessibilité
                 clavier sans invalider le HTML. */
              <div
                key={e.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/evenements/${e.id}`)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    navigate(`/evenements/${e.id}`);
                  }
                }}
                className="cursor-pointer rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cdlj/45"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="min-w-0 break-words font-bold text-slate-800">{e.nom}</h3>
                  <Badge tone={e.statut === 'en_cours' ? 'green' : 'gray'}>
                    {e.statut === 'en_cours' ? 'En cours' : 'Terminé'}
                  </Badge>
                </div>
                <div className="mt-2 space-y-1 text-sm text-slate-600">
                  <div>📅 {fmtDate(e.date_evenement)}</div>
                  {e.lieu && <div className="break-words">📍 {e.lieu}</div>}
                  <div>💰 Participation : {fmtMoney(e.montant_participation)}</div>
                  <div>
                    👥 {nb} participant{nb > 1 ? 's' : ''}
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-cdlj">
                    {e.statut === 'en_cours' && canManage ? 'Voir le détail →' : 'Voir →'}
                  </span>
                  {canManage && (
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation();
                        supprimer(e);
                      }}
                      disabled={busyDelete === e.id}
                      className="shrink-0 text-xs font-semibold text-alerte hover:underline disabled:pointer-events-none disabled:opacity-50"
                    >
                      {busyDelete === e.id ? 'Suppression…' : 'Supprimer'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editId ? "Modifier l'événement" : 'Nouvel événement'}
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
            hint="Fixé à la création ; les participants paient en une ou plusieurs tranches."
          >
            <input
              type="number"
              min={0}
              inputMode="numeric"
              enterKeyHint="done"
              aria-label="Montant de participation en francs CFA"
              className={inputCls}
              value={form.montant_participation}
              onChange={(e) =>
                setForm({ ...form, montant_participation: e.target.value })
              }
            />
          </Field>
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
    </div>
  );
}
