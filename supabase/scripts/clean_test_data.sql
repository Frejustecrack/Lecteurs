-- Remise à zéro avant livraison — à exécuter UNE SEULE FOIS, à la main, dans
-- Supabase Dashboard → SQL Editor. Ce fichier n'est volontairement PAS une
-- migration : une migration serait rejouée sur toute nouvelle instance.
-- Conserve les comptes (profiles), les grades et le paramétrage.

truncate table
  public.evenement_paiements,
  public.evenement_participants,
  public.caisse_operations,
  public.cotisations,
  public.presences,
  public.appreciations,
  public.lecteur_grades,
  public.logs
restart identity cascade;

truncate table
  public.evenements,
  public.lecteurs,
  public.fraternites
restart identity cascade;

-- Remet la cotisation à 50 F
insert into public.app_settings (key, value) values ('montant_cotisation', '50')
on conflict (key) do update set value = '50', updated_at = now();

-- Vérifiez :
-- select count(*) as lecteurs from public.lecteurs;
-- select count(*) as presences from public.presences;
