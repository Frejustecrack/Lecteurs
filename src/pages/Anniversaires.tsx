import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { BtnGhost, BtnPrimary, EmptyState, PageHeader, Spinner, useToast } from '../components/ui';
import { anniversaireValide, dateAnniversaire, periodeAnniversaires, type Anniversaire } from '../lib/anniversaires';
import { moisLabel } from '../lib/dates';
import { traduireErreur } from '../lib/errors';
import { journaliserExport } from '../lib/journal';
import { trierLecteurs } from '../lib/lecteurs';
import { toutesLesLignes } from '../lib/pagination';
import { supabase } from '../lib/supabase';
import { peutExporter } from '../lib/types';
import { useMoisCourant } from '../lib/useMoisCourant';
import { useRealtime } from '../lib/useRealtime';

export default function Anniversaires() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const periode = useMoisCourant();
  const clePeriode = `${periode.annee}-${periode.mois}`;
  const canExport = peutExporter(profile?.role);
  const [donnees, setDonnees] = useState<{ periode: string; lecteurs: Anniversaire[] }>({ periode: '', lecteurs: [] });
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const requete = useRef(0);
  const exportEnCours = useRef(false);
  const monte = useRef(true);

  const load = useCallback(async () => {
    const numero = ++requete.current;
    setLoading(true);
    setErreur(null);
    try {
      // La vue filtre en SQL sur le mois ACTUEL. Aucun chargement de tous les
      // lecteurs, ni de la date de naissance complète, ni des autres mois.
      const { data, error } = await toutesLesLignes<Anniversaire>((de, a) => supabase
        .from('v_anniversaires_mois')
        .select('id, matricule, nom, prenom, jour, mois, annee, age_atteint')
        .order('nom').order('prenom').order('matricule').range(de, a));
      if (error) throw error;
      if (numero !== requete.current) return;
      const valides = data.filter((l) => anniversaireValide(l) && l.mois === periode.mois && l.annee === periode.annee);
      setDonnees({ periode: clePeriode, lecteurs: trierLecteurs(valides) });
    } catch (error) {
      if (numero === requete.current) {
        setDonnees({ periode: clePeriode, lecteurs: [] });
        setErreur(traduireErreur(error, 'charger les anniversaires du mois'));
      }
    } finally {
      if (numero === requete.current) setLoading(false);
    }
  }, [clePeriode, periode.mois, periode.annee]);

  useEffect(() => {
    monte.current = true;
    return () => { monte.current = false; };
  }, []);
  useEffect(() => {
    void load();
    return () => { requete.current++; };
  }, [load]);
  useRealtime('realtime-anniversaires', ['lecteurs'], load);

  async function telecharger(l: Anniversaire) {
    if (!canExport || exportEnCours.current) return;
    exportEnCours.current = true;
    setBusyId(l.id);
    try {
      // Vérification serveur des droits + relecture fraîche du lecteur : un
      // ancien onglet ne permet pas d'exporter un lecteur archivé/du mois passé.
      const { data, error } = await supabase.rpc('carte_anniversaire', { p_lecteur: l.id });
      if (error) throw error;
      const actuel = (data as Anniversaire[] | null)?.[0];
      const maintenant = periodeAnniversaires();
      if (!actuel || !anniversaireValide(actuel) || actuel.mois !== maintenant.mois || actuel.annee !== maintenant.annee) {
        if (monte.current) void load();
        throw new Error('Ce lecteur n’a plus d’anniversaire à célébrer ce mois-ci. La liste a été actualisée.');
      }
      // jsPDF et le fond ne sont chargés qu'au premier téléchargement.
      const { telechargerCarteAnniversaire } = await import('../pdf/anniversaire');
      if (!monte.current) return;
      await telechargerCarteAnniversaire(actuel);
      toast('Carte d’anniversaire téléchargée.');
      await journaliserExport('anniversaires', actuel.id, { annee: actuel.annee });
    } catch (error) {
      if (monte.current) toast(traduireErreur(error, 'télécharger la carte d’anniversaire'), 'err');
    } finally {
      exportEnCours.current = false;
      if (monte.current) setBusyId(null);
    }
  }

  function bouton(l: Anniversaire) {
    return canExport ? (
      <BtnPrimary onClick={() => void telecharger(l)} busy={busyId === l.id} busyLabel="Création…"
        disabled={busyId !== null} aria-label={`Télécharger la carte de ${l.prenom} ${l.nom}`}
        className="w-full whitespace-normal sm:w-auto">
        Télécharger la carte
      </BtnPrimary>
    ) : <span className="text-xs text-slate-500">Consultation uniquement</span>;
  }

  const lecteurs = donnees.lecteurs;
  return (
    <div>
      <PageHeader title={`🎂 Anniversaires — ${moisLabel(periode.annee, periode.mois - 1)}`}
        sub="Célébrons les lecteurs de ce mois avec une attention de toute la communauté." />
      <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        L’âge affiché est celui atteint à l’anniversaire de cette année, même si la date n’est pas encore passée.
        {!canExport && <p className="mt-1">Le téléchargement est réservé à l’Administrateur, aux Chargés des Opérations et aux Caissiers.</p>}
      </div>
      {loading || donnees.periode !== clePeriode ? <Spinner label="Chargement des anniversaires…" />
        : erreur ? (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p>{erreur}</p><BtnGhost onClick={() => void load()} className="mt-3">Réessayer</BtnGhost>
          </div>
        ) : lecteurs.length === 0 ? <EmptyState msg="Aucun anniversaire à célébrer ce mois-ci." /> : (
          <>
            <p className="mb-3 text-sm text-slate-500" role="status">{lecteurs.length} anniversaire{lecteurs.length > 1 ? 's' : ''} à célébrer</p>
            {/* Le schéma n'a pas de photo : initiales plutôt qu'une image inventée. */}
            <ul className="space-y-3 sm:hidden" aria-label="Anniversaires du mois">
              {lecteurs.map((l) => (
                <li key={l.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-4 flex items-start gap-3">
                    <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-50 font-bold text-amber-800">
                      {l.prenom.charAt(0)}{l.nom.charAt(0)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="break-words font-semibold text-slate-800">{l.nom.toUpperCase()} {l.prenom}</h2>
                      <p className="mt-1 text-sm text-slate-600">{dateAnniversaire(l.jour, l.mois)} · {l.age_atteint} {l.age_atteint > 1 ? 'ans' : 'an'}</p>
                    </div>
                  </div>
                  {bouton(l)}
                </li>
              ))}
            </ul>
            <div className="hidden rounded-xl border border-slate-200 bg-white shadow-sm sm:block">
              <table className="w-full table-fixed text-left text-sm">
                <caption className="sr-only">Anniversaires du mois courant, triés par nom de famille</caption>
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr><th className="w-[35%] px-4 py-3">Lecteur</th><th className="w-[21%] px-3 py-3">Date</th><th className="w-[12%] px-3 py-3">Âge</th><th className="w-[32%] px-3 py-3">Carte</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lecteurs.map((l) => (
                    <tr key={l.id}>
                      <td className="break-words px-4 py-4 font-semibold text-slate-800">{l.nom.toUpperCase()} {l.prenom}</td>
                      <td className="px-3 py-4 text-slate-600">{dateAnniversaire(l.jour, l.mois)}</td>
                      <td className="px-3 py-4 text-slate-600">{l.age_atteint} {l.age_atteint > 1 ? 'ans' : 'an'}</td>
                      <td className="px-3 py-4">{bouton(l)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
    </div>
  );
}
