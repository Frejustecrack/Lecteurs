import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useRealtime } from '../lib/useRealtime';
import { useAuth } from '../context/AuthContext';
import { useDebounce } from '../lib/useDebounce';
import {
  aujourdhuiBenin,
  dateISO,
  deplaceMois,
  fmtDate,
  moisLabel,
  samedisDuMois,
} from '../lib/dates';
import { traduireErreur } from '../lib/errors';
import {
  estAdmin,
  estCO,
  type Fraternite,
  type Grade,
  type Lecteur,
  type Permission,
  type TypePermission,
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
  Segmented,
  Spinner,
  useToast,
} from '../components/ui';

// ---------------------------------------------------------------------------
// Helpers de statut
// ---------------------------------------------------------------------------

type StatutFiltre = 'en_cours' | 'terminee';

const TYPE_LABELS: Record<TypePermission, string> = {
  un_samedi: 'Un samedi',
  plusieurs_samedis: 'Plusieurs samedis',
};

/**
 * Statut déduit des dates : une permission est « en_cours » tant qu'au moins
 * un de ses samedis est >= aujourd'hui (fuseau Bénin). Sinon « terminee ».
 */
function statutPermission(p: Pick<Permission, 'samedis'>): StatutFiltre {
  const auj = dateISO(aujourdhuiBenin());
  const futur = p.samedis.some((s) => s >= auj);
  return futur ? 'en_cours' : 'terminee';
}

// ---------------------------------------------------------------------------
// Page principale
// ---------------------------------------------------------------------------

export default function Permissions() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const peutCreer = estAdmin(profile?.role) || estCO(profile?.role);

  // ---- état données
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [lecteurs, setLecteurs] = useState<Lecteur[]>([]);
  const [fraternites, setFraternites] = useState<Fraternite[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [loading, setLoading] = useState(true);

  // ---- filtres
  const [filtreStatut, setFiltreStatut] = useState<StatutFiltre>('en_cours');
  const [fId, setFId] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  // ---- modale création
  const [formOpen, setFormOpen] = useState(false);

  // ---------------------------------------------------------------- chargement
  const load = useCallback(async () => {
    const [rP, rL, rF, rG] = await Promise.all([
      supabase
        .from('permissions')
        .select('id, lecteur_id, type_permission, samedis, motif, created_by, created_at')
        .order('created_at', { ascending: false }),
      supabase
        .from('lecteurs')
        .select('id, matricule, nom, prenom, grade_id, fraternite_id, archived')
        .eq('archived', false)
        .order('matricule'),
      supabase.from('fraternites').select('id, nom').order('nom'),
      supabase.from('grades').select('id, nom').order('id'),
    ]);
    setPermissions((rP.data ?? []) as Permission[]);
    setLecteurs((rL.data ?? []) as Lecteur[]);
    setFraternites((rF.data ?? []) as Fraternite[]);
    setGrades((rG.data ?? []) as Grade[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useRealtime('realtime-permissions', ['permissions'], load);

  // ----------------------------------------------------------- maps (perf)
  const lecteurMap = useMemo(
    () => new Map(lecteurs.map((l) => [l.id, l])),
    [lecteurs]
  );
  const gradeMap = useMemo(
    () => new Map(grades.map((g) => [g.id, g.nom])),
    [grades]
  );
  const fratMap = useMemo(
    () => new Map(fraternites.map((f) => [f.id, f.nom])),
    [fraternites]
  );

  // ---------------------------------------------------- filtrage + recherche
  const liste = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return permissions
      .map((p) => ({ ...p, statut: statutPermission(p) }))
      .filter((p) => {
        // Statut
        if (p.statut !== filtreStatut) return false;
        // Lecteur existant
        const l = lecteurMap.get(p.lecteur_id);
        if (!l) return false;
        // Fraternité
        if (fId && l.fraternite_id !== fId) return false;
        // Grade
        if (gradeId && l.grade_id !== Number(gradeId)) return false;
        // Recherche
        if (q) {
          return (
            l.matricule.toLowerCase().includes(q) ||
            l.nom.toLowerCase().includes(q) ||
            l.prenom.toLowerCase().includes(q)
          );
        }
        return true;
      });
  }, [permissions, lecteurMap, filtreStatut, fId, gradeId, search]);

  if (loading) return <Spinner label="Chargement des permissions…" />;

  return (
    <div>
      <PageHeader
        title="Permissions"
        sub="Absences autorisées des lecteurs — une permission couvre un ou plusieurs samedis futurs"
        actions={
          peutCreer ? (
            <BtnPrimary onClick={() => setFormOpen(true)}>
              + Créer une permission
            </BtnPrimary>
          ) : undefined
        }
      />

      {/* ---- Sélecteur statut ---- */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Segmented
          value={filtreStatut}
          onChange={setFiltreStatut}
          options={[
            { value: 'en_cours', label: 'En cours', icon: '🟢' },
            { value: 'terminee', label: 'Terminées', icon: '⏹️' },
          ]}
        />
      </div>

      {/* ---- Filtres + recherche ---- */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={fId}
          onChange={(e) => setFId(e.target.value)}
          aria-label="Filtrer par fraternité"
          className={`${inputCls} w-full sm:w-auto`}
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
          className={`${inputCls} w-full sm:w-auto`}
        >
          <option value="">Tous les grades</option>
          {grades.map((g) => (
            <option key={g.id} value={g.id}>
              {g.nom}
            </option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher (matricule, nom…)"
          aria-label="Rechercher une permission"
          className={`${inputCls} min-w-0 flex-1 sm:max-w-xs`}
        />
      </div>

      {/* ---- Liste ---- */}
      {liste.length === 0 ? (
        <EmptyState
          msg={
            filtreStatut === 'en_cours'
              ? 'Aucune permission en cours pour ces filtres.'
              : 'Aucune permission terminée pour ces filtres.'
          }
        />
      ) : (
        <>
          {/* Mobile : cartes */}
          <ul className="space-y-2 sm:hidden">
            {liste.map((p) => {
              const l = lecteurMap.get(p.lecteur_id)!;
              return (
                <li
                  key={p.id}
                  className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-semibold text-cdlj">
                        {l.matricule}
                      </div>
                      <Link
                        to={`/lecteurs/${l.id}`}
                        className="block truncate text-sm font-semibold text-slate-800 hover:text-cdlj"
                      >
                        {l.prenom} {l.nom.toUpperCase()}
                      </Link>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge tone={p.statut === 'en_cours' ? 'green' : 'gray'}>
                        {p.statut === 'en_cours' ? 'En cours' : 'Terminée'}
                      </Badge>
                      <Badge tone="blue">{TYPE_LABELS[p.type_permission]}</Badge>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                    <span>🎓 {gradeMap.get(l.grade_id) ?? '—'}</span>
                    <span>🤝 {fratMap.get(l.fraternite_id ?? "") ?? '—'}</span>
                  </div>
                  <div className="mt-2 text-xs text-slate-600">
                    <span className="font-semibold">
                      {p.samedis.length} samedi{p.samedis.length > 1 ? 's' : ''} :
                    </span>{' '}
                    {p.samedis.map((s) => fmtDate(s)).join(', ')}
                  </div>
                  <p className="mt-1.5 text-xs italic text-slate-500">
                    « {p.motif} »
                  </p>
                </li>
              );
            })}
          </ul>

          {/* Desktop : tableau */}
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm sm:block">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-3">Matricule</th>
                  <th className="px-3 py-3">Lecteur</th>
                  <th className="px-3 py-3">Grade</th>
                  <th className="px-3 py-3">Fraternité</th>
                  <th className="px-3 py-3">Type</th>
                  <th className="px-3 py-3">Samedi(s)</th>
                  <th className="px-3 py-3">Motif</th>
                  <th className="px-3 py-3">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {liste.map((p) => {
                  const l = lecteurMap.get(p.lecteur_id)!;
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/60">
                      <td className="px-3 py-2 font-mono text-xs font-semibold text-cdlj">
                        {l.matricule}
                      </td>
                      <td className="max-w-[180px] truncate px-3 py-2">
                        <Link
                          to={`/lecteurs/${l.id}`}
                          className="font-medium text-slate-700 hover:text-cdlj"
                        >
                          {l.prenom} {l.nom.toUpperCase()}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone="blue">{gradeMap.get(l.grade_id) ?? '—'}</Badge>
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {fratMap.get(l.fraternite_id ?? "") ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-xs font-semibold text-slate-700">
                        {TYPE_LABELS[p.type_permission]}
                      </td>
                      <td className="max-w-[200px] px-3 py-2 text-xs text-slate-600">
                        {p.samedis.map((s) => fmtDate(s)).join(', ')}
                      </td>
                      <td className="max-w-[200px] truncate px-3 py-2 text-xs italic text-slate-500">
                        {p.motif}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={p.statut === 'en_cours' ? 'green' : 'gray'}>
                          {p.statut === 'en_cours' ? 'En cours' : 'Terminée'}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ---- Modale création ---- */}
      {formOpen && (
        <FormulairePermission
          lecteurs={lecteurs}
          grades={grades}
          fraternites={fraternites}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}

// ===========================================================================
// Formulaire de création (composant interne)
// ===========================================================================

function FormulairePermission({
  lecteurs,
  grades,
  fraternites,
  onClose,
  onSaved,
}: {
  lecteurs: Lecteur[];
  grades: Grade[];
  fraternites: Fraternite[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  // ---- sélection lecteur
  const [lecteurId, setLecteurId] = useState('');
  const [rechercheLecteur, setRechercheLecteur] = useState('');

  // ---- type de permission
  const [typePerm, setTypePerm] = useState<TypePermission | ''>('');

  // ---- sélection des samedis
  const now = new Date();
  const [annee, setAnnee] = useState(now.getFullYear());
  const [mois, setMois] = useState(now.getMonth());
  const [samedisSelectionnes, setSamedisSelectionnes] = useState<Set<string>>(
    new Set()
  );

  // ---- motif
  const [motif, setMotif] = useState('');

  // ---- samedis disponibles (futurs uniquement)
  const auj = dateISO(aujourdhuiBenin());

  const samedisDisponibles = useMemo(() => {
    const tous = samedisDuMois(annee, mois).map(dateISO);
    return tous.filter((s) => s >= auj);
  }, [annee, mois, auj]);

  // ---- lecteurs filtrés par recherche
  const lecteursFiltres = useMemo(() => {
    const q = rechercheLecteur.trim().toLowerCase();
    if (!q) return lecteurs.slice(0, 50);
    return lecteurs.filter(
      (l) =>
        l.matricule.toLowerCase().includes(q) ||
        l.nom.toLowerCase().includes(q) ||
        l.prenom.toLowerCase().includes(q)
    ).slice(0, 50);
  }, [lecteurs, rechercheLecteur]);

  const lecteurSelectionne = lecteurs.find((l) => l.id === lecteurId) ?? null;
  const gradeMap = new Map(grades.map((g) => [g.id, g.nom]));
  const fratMap = new Map(fraternites.map((f) => [f.id, f.nom]));

  // ---- toggle samedi
  function toggleSamedi(s: string) {
    setSamedisSelectionnes((prev) => {
      const next = new Set(prev);
      if (next.has(s)) {
        next.delete(s);
      } else {
        // Si type = un_samedi, remplacer la sélection
        if (typePerm === 'un_samedi') {
          next.clear();
        }
        next.add(s);
      }
      return next;
    });
  }

  // ---- navigation mois
  function moisPrecedent() {
    const d = deplaceMois(annee, mois, -1);
    // Empêcher d'aller avant le mois courant
    const nowDate = new Date();
    const limite = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1);
    const cible = new Date(d.annee, d.mois, 1);
    if (cible >= limite) {
      setAnnee(d.annee);
      setMois(d.mois);
    }
  }

  function moisSuivant() {
    const d = deplaceMois(annee, mois, 1);
    setAnnee(d.annee);
    setMois(d.mois);
  }

  // ---- validation
  function valider(): string | null {
    if (!lecteurId) return 'Veuillez sélectionner un lecteur.';
    if (!typePerm) return 'Veuillez sélectionner le type de permission.';
    if (samedisSelectionnes.size === 0)
      return 'Veuillez sélectionner au moins un samedi.';
    if (typePerm === 'un_samedi' && samedisSelectionnes.size !== 1)
      return 'Le type « Un samedi » nécessite exactement un samedi.';
    if (typePerm === 'plusieurs_samedis' && samedisSelectionnes.size < 2)
      return 'Le type « Plusieurs samedis » nécessite au moins deux samedis.';
    // Vérifier qu'aucun samedi sélectionné n'est passé
    for (const s of samedisSelectionnes) {
      if (s < auj)
        return 'Un samedi sélectionné est déjà passé. Veuillez le retirer.';
    }
    if (!motif.trim()) return 'Le motif est obligatoire.';
    return null;
  }

  // ---- enregistrement
  async function enregistrer() {
    const err = valider();
    if (err) {
      toast(err, 'err');
      return;
    }
    setBusy(true);
    const { error } = await supabase.from('permissions').insert({
      lecteur_id: lecteurId,
      type_permission: typePerm,
      samedis: Array.from(samedisSelectionnes).sort(),
      motif: motif.trim(),
    });
    setBusy(false);
    if (error) {
      toast(traduireErreur(error, 'créer cette permission'), 'err');
      return;
    }
    toast(
      `Permission créée pour ${lecteurSelectionne?.prenom} ${lecteurSelectionne?.nom.toUpperCase()} — ${samedisSelectionnes.size} samedi(s).`
    );
    onSaved();
  }

  // Quand le type change, ajuster la sélection si incohérente
  function changerType(t: TypePermission) {
    setTypePerm(t);
    if (t === 'un_samedi' && samedisSelectionnes.size > 1) {
      // Garder le premier seulement
      const premier = samedisSelectionnes.values().next().value;
      setSamedisSelectionnes(premier ? new Set([premier]) : new Set());
    }
  }

  return (
    <Modal open onClose={onClose} title="Créer une permission" wide>
      <div className="space-y-5">
        {/* ---- 1. Sélection du lecteur ---- */}
        <div>
          <h4 className="mb-2 text-sm font-bold text-slate-700">
            1. Lecteur concerné
          </h4>
          {lecteurSelectionne ? (
            <div className="flex items-center justify-between rounded-lg border border-cdlj/20 bg-blue-50 px-3 py-2">
              <div>
                <span className="font-mono text-xs font-bold text-cdlj">
                  {lecteurSelectionne.matricule}
                </span>
                <span className="ml-2 text-sm font-semibold text-slate-700">
                  {lecteurSelectionne.prenom}{' '}
                  {lecteurSelectionne.nom.toUpperCase()}
                </span>
                <span className="ml-2 text-xs text-slate-500">
                  {gradeMap.get(lecteurSelectionne.grade_id) ?? '—'} ·{' '}
                  {fratMap.get(lecteurSelectionne.fraternite_id ?? "") ?? '—'}
                </span>
              </div>
              <button
                onClick={() => {
                  setLecteurId('');
                  setRechercheLecteur('');
                }}
                className="text-xs font-semibold text-cdlj hover:underline"
              >
                Changer
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <input
                value={rechercheLecteur}
                onChange={(e) => setRechercheLecteur(e.target.value)}
                placeholder="Rechercher un lecteur (matricule, nom…)"
                aria-label="Rechercher un lecteur"
                className={inputCls}
                autoFocus
              />
              <div className="max-h-[180px] overflow-y-auto rounded-lg border border-slate-200">
                {lecteursFiltres.length === 0 ? (
                  <p className="p-3 text-center text-sm text-slate-400">
                    Aucun lecteur trouvé.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {lecteursFiltres.map((l) => (
                      <li key={l.id}>
                        <button
                          onClick={() => {
                            setLecteurId(l.id);
                            setRechercheLecteur('');
                          }}
                          className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-blue-50 ${pressCls}`}
                        >
                          <span className="font-mono text-xs font-bold text-cdlj">
                            {l.matricule}
                          </span>
                          <span className="font-medium text-slate-700">
                            {l.prenom} {l.nom.toUpperCase()}
                          </span>
                          <span className="text-xs text-slate-400">
                            {gradeMap.get(l.grade_id) ?? '—'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ---- 2. Type de permission ---- */}
        <div>
          <h4 className="mb-2 text-sm font-bold text-slate-700">
            2. Type de permission
          </h4>
          <div className="flex gap-2">
            <button
              onClick={() => changerType('un_samedi')}
              className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-all ${pressCls} ${
                typePerm === 'un_samedi'
                  ? 'border-cdlj bg-cdlj text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              Un samedi
            </button>
            <button
              onClick={() => changerType('plusieurs_samedis')}
              className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-all ${pressCls} ${
                typePerm === 'plusieurs_samedis'
                  ? 'border-cdlj bg-cdlj text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              Plusieurs samedis
            </button>
          </div>
          {typePerm && (
            <p className="mt-1.5 text-xs text-slate-400">
              {typePerm === 'un_samedi'
                ? 'Sélectionnez exactement un samedi.'
                : 'Sélectionnez au moins deux samedis.'}
            </p>
          )}
        </div>

        {/* ---- 3. Sélection des samedis ---- */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-700">
              3. Samedi(s)
            </h4>
            <div className="flex items-center gap-1">
              <button
                onClick={moisPrecedent}
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                aria-label="Mois précédent"
              >
                ←
              </button>
              <span className="min-w-[140px] px-1 text-center text-sm font-bold text-slate-700">
                {moisLabel(annee, mois)}
              </span>
              <button
                onClick={moisSuivant}
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                aria-label="Mois suivant"
              >
                →
              </button>
            </div>
          </div>

          {samedisDisponibles.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
              <p className="text-sm text-slate-500">
                Aucun samedi disponible ce mois (tous les samedis sont passés).
              </p>
              <button
                onClick={moisSuivant}
                className="mt-2 text-xs font-semibold text-cdlj hover:underline"
              >
                Voir le mois suivant →
              </button>
            </div>
          ) : (
            <div className="space-y-1.5 rounded-lg border border-slate-200 bg-white p-3">
              {samedisDisponibles.map((s) => {
                const checked = samedisSelectionnes.has(s);
                const disabled =
                  typePerm === 'un_samedi' &&
                  samedisSelectionnes.size >= 1 &&
                  !checked;
                return (
                  <label
                    key={s}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
                      checked
                        ? 'bg-blue-50 ring-1 ring-cdlj/20'
                        : disabled
                          ? 'cursor-not-allowed opacity-40'
                          : 'hover:bg-slate-50 cursor-pointer'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleSamedi(s)}
                      className="h-4 w-4 rounded border-slate-300 text-cdlj focus:ring-cdlj/30"
                    />
                    <span
                      className={`text-sm font-medium ${checked ? 'text-cdlj font-semibold' : 'text-slate-700'}`}
                    >
                      Samedi {fmtDate(s)}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          {samedisSelectionnes.size > 0 && (
            <p className="mt-1.5 text-xs font-semibold text-cdlj">
              {samedisSelectionnes.size} samedi(s) sélectionné(s) :{' '}
              {Array.from(samedisSelectionnes)
                .sort()
                .map((s) => fmtDate(s))
                .join(', ')}
            </p>
          )}
        </div>

        {/* ---- 4. Motif ---- */}
        <Field label="4. Motif de la permission *">
          <textarea
            className={`${inputCls} min-h-[80px]`}
            rows={3}
            placeholder="Raison de l'absence autorisée…"
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
          />
        </Field>

        {/* ---- Boutons ---- */}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <BtnGhost onClick={onClose} className="w-full sm:w-auto">
            Annuler
          </BtnGhost>
          <BtnPrimary
            onClick={enregistrer}
            busy={busy}
            busyLabel="Enregistrement…"
            className="w-full sm:w-auto"
          >
            Créer la permission
          </BtnPrimary>
        </div>
      </div>
    </Modal>
  );
}
