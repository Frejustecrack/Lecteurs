import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import {
  dateISO,
  deplaceMois,
  dernierSamedi,
  estGelee,
  fmtDate,
  moisLabel,
  samedisDuMois,
} from '../lib/dates';
import type { Fraternite, Lecteur, Presence } from '../lib/types';
import {
  EmptyState,
  inputCls,
  PageHeader,
  Spinner,
  useToast,
} from '../components/ui';
import { exportPresences } from '../pdf/export';

export default function Presences() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const { toast } = useToast();

  const now = new Date();
  const [annee, setAnnee] = useState(now.getFullYear());
  const [mois, setMois] = useState(now.getMonth());
  const [fId, setFId] = useState('');
  const [search, setSearch] = useState('');

  const [lecteurs, setLecteurs] = useState<Lecteur[]>([]);
  const [fraternites, setFraternites] = useState<Fraternite[]>([]);
  const [presences, setPresences] = useState<Presence[]>([]);
  const [loading, setLoading] = useState(true);

  const samedis = useMemo(
    () => samedisDuMois(annee, mois).map(dateISO),
    [annee, mois]
  );
  const dernierSam = useMemo(() => dateISO(dernierSamedi()), []);

  const load = useCallback(async () => {
    if (samedis.length === 0) {
      setPresences([]);
      return;
    }
    const [rL, rF, rP] = await Promise.all([
      supabase.from('lecteurs').select('*').eq('archived', false).order('matricule'),
      supabase.from('fraternites').select('*').order('nom'),
      supabase
        .from('presences')
        .select('*')
        .gte('date_samedi', samedis[0])
        .lte('date_samedi', samedis[samedis.length - 1]),
    ]);
    setLecteurs((rL.data ?? []) as Lecteur[]);
    setFraternites((rF.data ?? []) as Fraternite[]);
    setPresences((rP.data ?? []) as Presence[]);
    setLoading(false);
  }, [samedis]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const map = useMemo(() => {
    const m = new Map<string, Presence>();
    presences.forEach((p) => m.set(`${p.lecteur_id}|${p.date_samedi}`, p));
    return m;
  }, [presences]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lecteurs.filter((l) => {
      if (fId && l.fraternite_id !== fId) return false;
      if (!q) return true;
      return (
        l.matricule.toLowerCase().includes(q) ||
        l.nom.toLowerCase().includes(q) ||
        l.prenom.toLowerCase().includes(q)
      );
    });
  }, [lecteurs, fId, search]);

  async function toggle(l: Lecteur, sam: string) {
    const current = map.get(`${l.id}|${sam}`);
    const gelee = sam < dernierSam;
    if (gelee && !isAdmin) {
      toast(
        'Ce samedi est gelé (passé). Seule l’Administrateur peut effectuer une correction exceptionnelle, tracée dans les logs.',
        'err'
      );
      return;
    }
    const next = current?.statut === 'present' ? 'absent' : 'present';
    const { error } = await supabase
      .from('presences')
      .upsert(
        {
          lecteur_id: l.id,
          date_samedi: sam,
          statut: next,
          recorded_by: profile?.id ?? null,
        },
        { onConflict: 'lecteur_id,date_samedi' }
      );
    if (error) {
      toast(
        gelee
          ? 'Correction refusée par la sécurité de la base. Vérifiez votre rôle.'
          : error.message,
        'err'
      );
      return;
    }
    if (gelee && isAdmin) {
      await supabase.rpc('log_action', {
        p_action: 'presence.correction_gelee',
        p_objet_type: 'presences',
        p_objet_ref: l.matricule,
        p_detail: JSON.stringify({ date_samedi: sam, nouveau_statut: next }),
      });
      toast(`Présence corrigée (${l.matricule}, ${fmtDate(sam)}) — tracée dans les logs.`);
    }
    load();
  }

  // ---- recherche par samedi
  const [rechercheSam, setRechercheSam] = useState('');
  const [rechercheStatut, setRechercheStatut] = useState<'present' | 'absent'>('absent');
  const resultats = useMemo(() => {
    if (!rechercheSam) return null;
    return lecteurs.filter((l) => {
      const p = map.get(`${l.id}|${rechercheSam}`);
      if (rechercheStatut === 'present') return p?.statut === 'present';
      return p?.statut === 'absent' || !p; // absents = marqués absents ou non saisis
    });
  }, [rechercheSam, rechercheStatut, lecteurs, map]);

  if (loading) return <Spinner label="Chargement des présences…" />;

  return (
    <div>
      <PageHeader
        title="Présences"
        sub="Enregistrement des samedis — un samedi passé est gelé automatiquement"
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  const d = deplaceMois(annee, mois, -1);
                  setAnnee(d.annee);
                  setMois(d.mois);
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50"
              >
                ←
              </button>
              <span className="min-w-[150px] px-1 text-center text-sm font-bold text-slate-700">
                {moisLabel(annee, mois)}
              </span>
              <button
                onClick={() => {
                  const d = deplaceMois(annee, mois, 1);
                  setAnnee(d.annee);
                  setMois(d.mois);
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50"
              >
                →
              </button>
            </div>
            {(profile?.role === 'admin' ||
              profile?.role === 'co' ||
              profile?.role === 'caissier') && (
              <button
                onClick={async () => {
                  try {
                    exportPresences({
                      annee,
                      mois,
                      fraternite: fraternites.find((f) => f.id === fId)?.nom ?? null,
                      lecteurs: filtered,
                      presences,
                      auteur: profile?.full_name ?? '—',
                    });
                    await supabase.rpc('log_action', {
                      p_action: 'export.pdf',
                      p_objet_type: 'presences',
                      p_objet_ref: `${annee}-${String(mois + 1).padStart(2, '0')}`,
                      p_detail: JSON.stringify({
                        document: 'fiche_presences',
                        fraternite: fId || 'globale',
                      }),
                    });
                    toast('PDF généré.');
                  } catch (err) {
                    toast(err instanceof Error ? err.message : 'Erreur PDF.', 'err');
                  }
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                ⬇ PDF
              </button>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={fId}
          onChange={(e) => setFId(e.target.value)}
          className={`${inputCls} w-auto`}
        >
          <option value="">Vue globale — toutes les fraternités</option>
          {fraternites.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nom}
            </option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un lecteur (matricule…)"
          className={`${inputCls} max-w-xs flex-1`}
        />
        <select
          value={rechercheSam}
          onChange={(e) => setRechercheSam(e.target.value)}
          className={`${inputCls} w-auto`}
        >
          <option value="">— Recherche d'un samedi —</option>
          {samedis.map((s) => (
            <option key={s} value={s}>
              Samedi {fmtDate(s)}
            </option>
          ))}
        </select>
        {rechercheSam && (
          <select
            value={rechercheStatut}
            onChange={(e) => setRechercheStatut(e.target.value as 'present' | 'absent')}
            className={`${inputCls} w-auto`}
          >
            <option value="absent">Absents</option>
            <option value="present">Présents</option>
          </select>
        )}
      </div>

      {rechercheSam ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-bold text-slate-700">
            {rechercheStatut === 'absent' ? 'Absents' : 'Présents'} du samedi{' '}
            {fmtDate(rechercheSam)}
          </h3>
          {resultats && resultats.length === 0 ? (
            <p className="text-sm text-slate-400">Personne.</p>
          ) : (
            resultats && (
              <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {resultats.map((l) => (
                  <li key={l.id} className="flex justify-between rounded px-2 py-1 hover:bg-slate-50">
                    <span>
                      <span className="font-mono text-xs text-cdlj">{l.matricule}</span>{' '}
                      {l.prenom} {l.nom.toUpperCase()}
                    </span>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState msg="Aucun lecteur actif. Créez des lecteurs pour enregistrer les présences." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-3">Matricule</th>
                <th className="px-3 py-3">Lecteur</th>
                {samedis.map((s) => (
                  <th key={s} className="px-2 py-3 text-center">
                    {fmtDate(s).slice(0, 5)}
                    {s >= dernierSam && (
                      <span className="ml-1 rounded bg-blue-50 px-1 text-[10px] font-bold text-cdlj">
                        {s === dernierSam ? 'CE SAM' : ''}
                      </span>
                    )}
                  </th>
                ))}
                <th className="px-2 py-3 text-center">Récap</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((l) => {
                const pres = samedis.filter((s) => map.get(`${l.id}|${s}`)?.statut === 'present').length;
                const abs = samedis.filter((s) => map.get(`${l.id}|${s}`)?.statut === 'absent').length;
                return (
                  <tr key={l.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-cdlj">
                      {l.matricule}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        to={`/lecteurs/${l.id}`}
                        className="font-medium text-slate-700 hover:text-cdlj"
                      >
                        {l.prenom} {l.nom.toUpperCase()}
                      </Link>
                    </td>
                    {samedis.map((s) => {
                      const p = map.get(`${l.id}|${s}`);
                      const gelee = estGelee(new Date(s + 'T12:00:00'));
                      const clickable = !gelee || isAdmin;
                      return (
                        <td key={s} className="px-2 py-2 text-center">
                          <button
                            onClick={() => clickable && toggle(l, s)}
                            disabled={!clickable}
                            title={
                              clickable
                                ? 'Cliquez pour basculer présent/absent'
                                : 'Samedi gelé — correction Admin uniquement'
                            }
                            className={`h-8 w-10 rounded-md text-sm font-bold transition-colors ${
                              p?.statut === 'present'
                                ? 'bg-emerald-500 text-white'
                                : p?.statut === 'absent'
                                  ? 'bg-alerte text-white'
                                  : 'border border-dashed border-slate-300 text-slate-300'
                            } ${clickable ? 'cursor-pointer hover:opacity-80' : 'cursor-not-allowed opacity-70'}`}
                          >
                            {p?.statut === 'present' ? '✓' : p?.statut === 'absent' ? '✗' : '—'}
                          </button>
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 text-center text-xs font-semibold text-slate-500">
                      {pres}P · {abs}A
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-slate-400">
        ✓ Présent · ✗ Absent · — Non saisi. Un samedi est gelé à partir de dimanche
        00:00 — correction exceptionnelle possible par l'Administrateur (tracée dans
        les logs).
      </p>
    </div>
  );
}
