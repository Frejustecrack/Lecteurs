import { rechercherLecteurs, trierLecteurs } from '../lib/lecteurs';
import { candidatFraterniteAnimateur } from '../lib/fraternites';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { toutesLesLignes } from '../lib/pagination';
import { useRealtime } from '../lib/useRealtime';
import { useDebounce } from '../lib/useDebounce';
import { useAuth } from '../context/AuthContext';
import { traduireErreur } from '../lib/errors';
import {
  estAdmin,
  peutGererLecteurs,
  peutGererMembresFraternite,
  type Fraternite,
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

export default function Fraternites() {
  const { profile } = useAuth();
  const isAdmin = estAdmin(profile?.role);
  const canEdit = peutGererLecteurs(profile?.role);
  const canDeleteOrdinaire = !!profile?.role; // toute fraternité ordinaire vide
  const canDeleteSpeciale = isAdmin;
  const navigate = useNavigate();
  const { toast } = useToast();

  const [fraternites, setFraternites] = useState<Fraternite[]>([]);
  const [lecteurs, setLecteurs] = useState<Lecteur[]>([]);
  const [loading, setLoading] = useState(true);
  const [erreurChargement, setErreurChargement] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ nom: '', responsables: '' });
  const [busy, setBusy] = useState(false);
  const [busySuppr, setBusySuppr] = useState<string | null>(null);

  // --- Gestion des membres (ajout / retrait depuis la fiche de fraternité)
  const [membresId, setMembresId] = useState<string | null>(null);
  const [recherche, setRecherche] = useState('');
  const rechercheDebounce = useDebounce(recherche, 300);
  const [selection, setSelection] = useState<string[]>([]);
  const [busyMembres, setBusyMembres] = useState(false);
  const [busyRetrait, setBusyRetrait] = useState<string | null>(null);

  // --- Tarif Animateur : quelle fraternité en bénéficie (Admin uniquement).
  // Déplacé ici depuis Administration → Paramètres : cette désignation se
  // décide au vu des fraternités et de leurs membres, qui vivent sur CET
  // écran — pas sur un écran de réglages séparé que personne ne consultait.
  const [fratAnimateurSel, setFratAnimateurSel] = useState('');
  const [busyAnimateur, setBusyAnimateur] = useState(false);

  const load = useCallback(async () => {
    const [rF, rL] = await Promise.all([
      supabase.from('fraternites').select('id, nom, responsables, system_key').order('nom'),
      // 200 max : colonnes minimales, pas de select * (60% de gain)
      toutesLesLignes<Lecteur>((de, a) =>
        supabase
          .from('lecteurs')
          .select('id, matricule, nom, prenom, fraternite_id, archived')
          .order('nom').order('prenom').order('matricule')
          .range(de, a)
      ),
    ]);
    // Sans ce contrôle, un refus RLS ou une coupure réseau affichait
    // « Aucune fraternité. Créez la première ! » — un message FAUX qui pousse
    // à recréer des fraternités existantes (et à buter sur l'unicité du nom).
    if (rF.error || rL.error) {
      toast(traduireErreur(rF.error ?? rL.error, 'charger les fraternités'), 'err');
      setErreurChargement(true);
      setLoading(false);
      return;
    }
    setErreurChargement(false);
    const frats = (rF.data ?? []) as Fraternite[];
    const lecs = trierLecteurs((rL.data ?? []) as Lecteur[]);
    setFraternites(frats);
    setLecteurs(lecs);
    // Préremplit la sélection avec la désignation actuelle ; à défaut, avec
    // le candidat détecté automatiquement (voir `candidatFraterniteAnimateur`).
    const actuelle = frats.find((f) => f.system_key === 'animateur')?.id ?? '';
    setFratAnimateurSel(actuelle || candidatFraterniteAnimateur(frats, lecs)?.id || '');
    setLoading(false);
  }, [toast]);

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

  /**
   * Déplace le tarif Animateur vers une autre fraternité.
   *
   * Le tarif spécial ne suit pas le NOM d'une fraternité mais un marqueur
   * technique. Sans cette action, une communauté qui utilise sa propre
   * fraternité d'animateurs voit ses membres facturés au tarif normal, sans
   * aucun moyen de corriger depuis l'interface : poser le marqueur est
   * interdit par trigger à tout compte applicatif, et l'unique point
   * d'entrée autorisé est ce RPC réservé à l'Admin (migration 20261003234500,
   * auto-détection renforcée par la migration 20261004120000).
   */
  async function designerFraterniteAnimateur() {
    const cible = fratAnimateurSel || null;
    const nom = fraternites.find((f) => f.id === cible)?.nom;
    const actuelle = fraternites.find((f) => f.system_key === 'animateur');
    if ((actuelle?.id ?? '') === (cible ?? '')) return;

    const membres = cible
      ? `Les cotisations DÉJÀ PAYÉES des membres de « ${nom} » seront recalculées au tarif Animateur.`
      : 'Plus aucune fraternité ne bénéficiera du tarif Animateur.';
    const ancienne = actuelle
      ? `\n\nLes membres de « ${actuelle.nom} » repasseront au tarif normal, historique payé compris.`
      : '';
    if (!confirm(`${membres}${ancienne}\n\nContinuer ?`)) return;

    setBusyAnimateur(true);
    const { error } = await supabase.rpc('definir_fraternite_animateur', {
      p_fraternite: cible,
    });
    setBusyAnimateur(false);
    if (error) {
      toast(traduireErreur(error, 'désigner la fraternité au tarif Animateur'), 'err');
      return;
    }
    toast(
      cible
        ? `« ${nom} » applique désormais le tarif Animateur.`
        : 'Le tarif Animateur ne s’applique plus à aucune fraternité.'
    );
    load();
  }

  // ------------------------------------------------------------- membres
  const fratMembres = fraternites.find((f) => f.id === membresId) ?? null;

  /** Membres actuels : archivés exclus, ils ne se gèrent que depuis leur fiche. */
  const membresActuels = useMemo(
    () =>
      membresId
        ? lecteurs.filter((l) => l.fraternite_id === membresId && !l.archived)
        : [],
    [lecteurs, membresId]
  );

  /**
   * Candidats à l'ajout : lecteurs actifs qui ne sont pas déjà dans cette
   * fraternité. Ceux qui appartiennent à une AUTRE fraternité restent
   * proposés — les y ajouter revient à les déplacer, ce que la base fait en
   * une seule opération journalisée.
   */
  const candidats = useMemo(() => {
    if (!membresId) return [];
    const actifs = lecteurs.filter(
      (l) => !l.archived && l.fraternite_id !== membresId
    );
    const q = rechercheDebounce.trim();
    return q ? rechercherLecteurs(actifs, q) : trierLecteurs(actifs);
  }, [lecteurs, membresId, rechercheDebounce]);

  function ouvrirMembres(f: Fraternite) {
    setMembresId(f.id);
    setRecherche('');
    setSelection([]);
  }

  function fermerMembres() {
    setMembresId(null);
    setRecherche('');
    setSelection([]);
  }

  function basculerSelection(lecteurId: string) {
    setSelection((s) =>
      s.includes(lecteurId) ? s.filter((x) => x !== lecteurId) : [...s, lecteurId]
    );
  }

  /**
   * Applique une série de rattachements via `changer_fraternite`
   * (SECURITY DEFINER) : la base valide la cible, applique la règle
   * « Animateur réservé au CO paroissial », recalcule l'historique des
   * cotisations si nécessaire et journalise chaque mouvement.
   *
   * Les appels sont séquentiels et non transactionnels : on rend compte
   * précisément de ce qui est passé et de ce qui a été refusé plutôt que de
   * laisser croire à un succès global.
   */
  async function appliquerRattachements(
    ids: string[],
    cible: string | null,
    action: string
  ): Promise<number> {
    let faits = 0;
    let premiereErreur: unknown = null;
    for (const lecteurId of ids) {
      const { error } = await supabase.rpc('changer_fraternite', {
        p_lecteur: lecteurId,
        p_fraternite: cible,
      });
      if (error) premiereErreur = premiereErreur ?? error;
      else faits++;
    }
    if (premiereErreur) {
      const echecs = ids.length - faits;
      toast(
        faits > 0
          ? `${faits} lecteur(s) traité(s), ${echecs} refusé(s) : ${traduireErreur(premiereErreur, action)}`
          : traduireErreur(premiereErreur, action),
        'err'
      );
    }
    if (faits > 0) await load();
    return faits;
  }

  async function ajouterSelection() {
    if (!fratMembres || selection.length === 0) return;
    setBusyMembres(true);
    const faits = await appliquerRattachements(
      selection,
      fratMembres.id,
      `ajouter ces lecteurs à « ${fratMembres.nom} »`
    );
    setBusyMembres(false);
    if (faits > 0) {
      toast(
        `${faits} lecteur(s) ajouté(s) à « ${fratMembres.nom} ».`
      );
      setSelection([]);
      setRecherche('');
    }
  }

  async function retirerMembre(l: Lecteur) {
    if (!fratMembres) return;
    setBusyRetrait(l.id);
    const faits = await appliquerRattachements(
      [l.id],
      null,
      `retirer ${l.prenom} ${l.nom} de « ${fratMembres.nom} »`
    );
    setBusyRetrait(null);
    if (faits > 0) {
      toast(`${l.prenom} ${l.nom.toUpperCase()} n'appartient plus à aucune fraternité.`);
    }
  }

  if (loading) return <Spinner label="Chargement des fraternités…" />;

  const animateurActuelle = fraternites.find((f) => f.system_key === 'animateur') ?? null;
  const candidatAnimateur = candidatFraterniteAnimateur(fraternites, lecteurs);

  return (
    <div>
      <PageHeader
        title="Fraternités"
        sub={`${fraternites.length} fraternité(s) — chaque lecteur n'appartient qu'à une fraternité`}
        actions={<BtnPrimary onClick={openCreate}>+ Nouvelle fraternité</BtnPrimary>}
      />

      {/*
        Le tarif Animateur (100 F) ne suit JAMAIS le nom d'une fraternité,
        seulement cette désignation technique. Une fraternité qui ressemble à
        « Fraternité animateur » mais qui n'a pas été désignée ici facture ses
        membres au tarif normal sans que rien ne le signale ailleurs dans
        l'application — c'est le bug exact que cette alerte rend visible.
      */}
      {candidatAnimateur && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">
            ⚠️ Le tarif Animateur (100 F) n'est associé à aucune fraternité ayant des
            membres.
          </p>
          <p className="mt-1">
            « {candidatAnimateur.nom} » semble être le bon groupe
            {animateurActuelle ? ' — la fraternité système « Animateur » existe mais est vide' : ''}.
            Tant que ce n'est pas corrigé, ses membres sont facturés au tarif normal (50 F)
            dans Cotisations.
          </p>
          {isAdmin ? (
            <button
              type="button"
              onClick={() => {
                setFratAnimateurSel(candidatAnimateur.id);
                designerFraterniteAnimateur();
              }}
              disabled={busyAnimateur}
              className={`mt-2 rounded-lg bg-amber-600 px-3 py-1.5 font-semibold text-white hover:bg-amber-700 ${pressCls}`}
            >
              {busyAnimateur ? 'Application…' : `Appliquer le tarif Animateur à « ${candidatAnimateur.nom} »`}
            </button>
          ) : (
            <p className="mt-1 text-xs">
              Signalez-le à un Administrateur : lui seul peut appliquer cette correction
              (section « Tarif Animateur » plus bas sur cette page).
            </p>
          )}
        </div>
      )}

      {isAdmin && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-bold text-slate-700">Tarif Animateur</h3>
          <p className="mt-1 text-xs text-slate-400">
            La fraternité choisie ici bénéficie du tarif spécial (réglé en montant depuis
            Administration → Paramètres). Changer cette désignation recalcule
            l'historique des cotisations déjà payées des deux fraternités concernées.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              aria-label="Fraternité bénéficiant du tarif Animateur"
              className={inputCls}
              value={fratAnimateurSel}
              onChange={(e) => setFratAnimateurSel(e.target.value)}
            >
              <option value="">— Aucune fraternité au tarif Animateur —</option>
              {fraternites.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nom}
                </option>
              ))}
            </select>
            <BtnPrimary
              onClick={designerFraterniteAnimateur}
              busy={busyAnimateur}
              busyLabel="Application…"
              disabled={(animateurActuelle?.id ?? '') === fratAnimateurSel}
            >
              Appliquer
            </BtnPrimary>
          </div>
        </div>
      )}

      {erreurChargement ? (
        <EmptyState msg="Les fraternités n'ont pas pu être chargées. Vérifiez votre connexion puis rechargez la page." />
      ) : fraternites.length === 0 ? (
        <EmptyState msg="Aucune fraternité. Créez la première !" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {fraternites.map((f) => {
            const membres = lecteurs.filter((l) => l.fraternite_id === f.id);
            const canDelete = f.system_key === 'animateur' ? canDeleteSpeciale : canDeleteOrdinaire;
            // Admin, CO et CO paroissial gèrent toutes les fraternités ;
            // « Animateur » reste réservée au CO paroissial (règle en base).
            const canMembres = peutGererMembresFraternite(profile?.role, f.system_key);
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
                      {f.system_key === 'animateur' && <Badge tone="amber">Système · tarif spécial</Badge>}
                    </div>
                  </div>
                  {(canEdit || canDelete || canMembres) && (
                    <div className="flex flex-wrap justify-end gap-2 text-xs font-semibold">
                      {canMembres && (
                        <button
                          onClick={() => ouvrirMembres(f)}
                          className={`text-cdlj hover:underline ${pressCls}`}
                        >
                          Membres
                        </button>
                      )}
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

      {/* ------------------------------------------------- Membres */}
      <Modal
        open={!!fratMembres}
        onClose={fermerMembres}
        wide
        title={fratMembres ? `Membres — ${fratMembres.nom}` : 'Membres'}
      >
        {fratMembres && (
          <div className="space-y-5">
            {fratMembres.system_key === 'animateur' && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                Fraternité système : tout mouvement d'entrée ou de sortie recalcule
                l'historique des cotisations déjà payées du lecteur au tarif
                correspondant.
              </p>
            )}

            {/* ---- Membres actuels */}
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Membres actuels ({membresActuels.length})
              </h4>
              {membresActuels.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">
                  Aucun lecteur actif dans cette fraternité.
                </p>
              ) : (
                <ul className="mt-2 max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                  {membresActuels.map((l) => (
                    <li
                      key={l.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 truncate">
                        <span className="font-mono text-xs text-cdlj">{l.matricule}</span>{' '}
                        {l.prenom} {l.nom.toUpperCase()}
                      </span>
                      <button
                        onClick={() => retirerMembre(l)}
                        disabled={busyRetrait === l.id || busyMembres}
                        className={`shrink-0 text-xs font-semibold text-alerte hover:underline disabled:opacity-50 ${pressCls}`}
                      >
                        {busyRetrait === l.id ? 'Retrait…' : 'Retirer'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ---- Ajout */}
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Ajouter des lecteurs
              </h4>
              <input
                className={`${inputCls} mt-2`}
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder="Rechercher par nom, prénom ou matricule…"
                aria-label="Rechercher un lecteur à ajouter"
              />
              {candidats.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">
                  Aucun lecteur actif ne correspond.
                </p>
              ) : (
                <ul className="mt-2 max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                  {candidats.map((l) => {
                    const origine = fraternites.find((f) => f.id === l.fraternite_id);
                    // Sortir d'« Animateur » est aussi réservé au CO paroissial
                    // que d'y entrer : on désactive plutôt que d'échouer en base.
                    const deplacable = peutGererMembresFraternite(
                      profile?.role,
                      origine?.system_key ?? null
                    );
                    return (
                      <li key={l.id} className="px-3 py-2 text-sm">
                        <label
                          className={`flex items-center gap-3 ${
                            deplacable ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 shrink-0 accent-cdlj"
                            checked={selection.includes(l.id)}
                            disabled={!deplacable || busyMembres}
                            onChange={() => basculerSelection(l.id)}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            <span className="font-mono text-xs text-cdlj">
                              {l.matricule}
                            </span>{' '}
                            {l.prenom} {l.nom.toUpperCase()}
                          </span>
                          {origine && (
                            <span className="shrink-0 text-xs text-slate-400">
                              {deplacable
                                ? `déplacé depuis ${origine.nom}`
                                : `${origine.nom} — réservé au CO paroissial`}
                            </span>
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-xs text-slate-500">
                {selection.length > 0
                  ? `${selection.length} lecteur(s) sélectionné(s)`
                  : 'Aucune sélection'}
              </span>
              <div className="flex gap-2">
                <BtnGhost onClick={fermerMembres}>Fermer</BtnGhost>
                <BtnPrimary
                  onClick={ajouterSelection}
                  busy={busyMembres}
                  busyLabel="Ajout…"
                  disabled={selection.length === 0}
                >
                  Ajouter à « {fratMembres.nom} »
                </BtnPrimary>
              </div>
            </div>
          </div>
        )}
      </Modal>

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
