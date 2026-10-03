/**
 * Vérification du PARCOURS RÉEL « cotisation Animateur à 100 F ».
 *
 * Exécution :  npm run verif:parcours
 *
 * Les autres harnais vérifient des morceaux : verif.ts la logique d'affichage,
 * verif-db.mjs les droits et les triggers. Celui-ci rejoue le scénario complet
 * de bout en bout, dans un vrai PostgreSQL (PGlite), exactement dans l'ordre
 * où la paroisse le vivra :
 *
 *   désigner la fraternité → cocher un samedi → lire la caisse → muter un
 *   membre → décocher/recocher → changer le tarif.
 *
 * Il répond à une seule question, celle qui compte : « est-ce qu'on verra
 * vraiment 100 F, et est-ce que cet argent sera vraiment compté ? »
 */
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const dossier = join(process.cwd(), 'supabase', 'migrations');
const db = new PGlite();
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create or replace function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin; create role authenticated nologin; create role supabase_admin nologin;
  create publication supabase_realtime;`);
for (const f of readdirSync(dossier).filter(f=>f.endsWith('.sql')).sort()) {
  try { await db.exec(readFileSync(join(dossier,f),'utf8')); }
  catch(e){ console.log('MIGRATION KO',f,e.message); process.exit(1); }
}
const q = async (s,p=[]) => (await db.query(s,p)).rows;
let ok=0, ko=0;
const t=(n,a,e)=>{ const p=JSON.stringify(a)===JSON.stringify(e);
  console.log(`  ${p?'✓':'✗'} ${n}${p?'':`  → obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(e)}`}`); p?ok++:ko++; };

// --- Mise en place : un admin, une fraternité "Animateurs", deux lecteurs
const admin='11111111-1111-1111-1111-111111111111';
await q(`insert into auth.users (id,email) values ($1,'a@x.bj')`,[admin]);
await q(`update public.profiles set role='admin' where id=$1`,[admin]);
if ((await q(`select 1 from public.profiles where id=$1`,[admin])).length===0)
  await q(`insert into public.profiles (id,full_name,role) values ($1,'Admin','admin')`,[admin]);

const co='22222222-2222-2222-2222-222222222222';
await q(`insert into auth.users (id,email) values ($1,'co@x.bj')`,[co]);
if ((await q(`select 1 from public.profiles where id=$1`,[co])).length===0)
  await q(`insert into public.profiles (id,full_name,role) values ($1,'CO','co_paroissial')`,[co]);
else await q(`update public.profiles set role='co_paroissial' where id=$1`,[co]);

const fAnim=(await q(`insert into public.fraternites (nom,responsables) values ('Les Animateurs',array[]::text[]) returning id`))[0].id;
const fOrd=(await q(`insert into public.fraternites (nom,responsables) values ('Saint Jean',array[]::text[]) returning id`))[0].id;
const anim=(await q(`insert into public.lecteurs (nom,prenom,matricule,fraternite_id,created_at) values ('AGBO','Paul','',$1,'2020-01-01') returning id`,[fAnim]))[0].id;
const ordi=(await q(`insert into public.lecteurs (nom,prenom,matricule,fraternite_id,created_at) values ('KOUDJO','Marie','',$1,'2020-01-01') returning id`,[fOrd]))[0].id;

console.log('\n1. AVANT désignation — tout le monde au tarif normal');
t('tarif animateur = 50 F (dispositif inerte)', (await q(`select public.montant_cotisation_lecteur($1) m`,[anim]))[0].m, 50);

console.log('\n2. L’admin désigne « Les Animateurs » dans Admin → Paramètres');
await db.exec(`set role authenticated`);
await q(`select set_config('request.jwt.claim.sub',$1,false)`,[admin]);
await q(`select public.definir_fraternite_animateur($1)`,[fAnim]);
await db.exec(`reset role`);
t('la fraternité porte le marqueur système', (await q(`select system_key k from public.fraternites where id=$1`,[fAnim]))[0].k, 'animateur');
t('tarif de l’animateur = 100 F', (await q(`select public.montant_cotisation_lecteur($1) m`,[anim]))[0].m, 100);
t('tarif du lecteur ordinaire inchangé = 50 F', (await q(`select public.montant_cotisation_lecteur($1) m`,[ordi]))[0].m, 50);

console.log('\n3. Le caissier coche « payé » pour un samedi');
// Le client envoie volontairement 0 F, comme le ferait un navigateur trafiqué.
await q(`insert into public.cotisations (lecteur_id,date_samedi,paye,montant) values ($1,'2026-10-03',true,0)`,[anim]);
await q(`insert into public.cotisations (lecteur_id,date_samedi,paye,montant) values ($1,'2026-10-03',true,0)`,[ordi]);
t('montant ENREGISTRÉ pour l’animateur = 100 F', (await q(`select montant from public.cotisations where lecteur_id=$1`,[anim]))[0].montant, 100);
t('montant enregistré pour l’ordinaire = 50 F', (await q(`select montant from public.cotisations where lecteur_id=$1`,[ordi]))[0].montant, 50);
t('le client ne peut pas imposer 0 F (le trigger corrige)', (await q(`select count(*)::int n from public.cotisations where montant=0`))[0].n, 0);

console.log('\n4. L’argent arrive-t-il DANS LA CAISSE ?');
const caisse=(await q(`select * from public.v_caisse_totaux`))[0];
console.log('     v_caisse_totaux =', JSON.stringify(caisse));
t('la caisse encaisse bien 150 F (100 + 50)', Number(caisse.total_cotisations), 150);
const parMois=(await q(`select * from public.v_cotisations_par_mois`));
console.log('     v_cotisations_par_mois =', JSON.stringify(parMois));
t('le détail mensuel totalise 150 F', parMois.reduce((s,r)=>s+Number(r.total??r.montant??0),0), 150);
const parAn=(await q(`select * from public.v_cotisations_par_annee`));
t('le cumul annuel totalise 150 F', parAn.reduce((s,r)=>s+Number(r.total??r.montant??0),0), 150);

console.log('\n5. Mutation : l’animateur rejoint une fraternité ordinaire');
await db.exec(`set role authenticated`);
await q(`select set_config('request.jwt.claim.sub',$1,false)`,[admin]);
// L'admin doit être refusé : seul le CO paroissial touche à cette fraternité.
let refuseAdmin=false;
try { await q(`select public.changer_fraternite($1,$2)`,[anim,fOrd]); } catch(e){ refuseAdmin=true; }
await db.exec(`reset role`); await db.exec(`set role authenticated`);
await q(`select set_config('request.jwt.claim.sub',$1,false)`,[co]);
await q(`select public.changer_fraternite($1,$2)`,[anim,fOrd]);
await db.exec(`reset role`);
t('un ADMIN est refusé (règle de sécurité)', refuseAdmin, true);
t('son historique est recalculé à 50 F', (await q(`select montant from public.cotisations where lecteur_id=$1`,[anim]))[0].montant, 50);
t('la caisse suit : 100 F (50 + 50)', Number((await q(`select * from public.v_caisse_totaux`))[0].total_cotisations), 100);

console.log('\n6. Retour dans la fraternité animateur');
await db.exec(`set role authenticated`);
await q(`select set_config('request.jwt.claim.sub',$1,false)`,[co]);
await q(`select public.changer_fraternite($1,$2)`,[anim,fAnim]);
await db.exec(`reset role`);
t('l’historique repasse à 100 F', (await q(`select montant from public.cotisations where lecteur_id=$1`,[anim]))[0].montant, 100);
t('la caisse revient à 150 F', Number((await q(`select * from public.v_caisse_totaux`))[0].total_cotisations), 150);

console.log('\n7. Décocher puis recocher');
await q(`update public.cotisations set paye=false where lecteur_id=$1`,[anim]);
t('décoché : 0 F, rien en caisse', Number((await q(`select * from public.v_caisse_totaux`))[0].total_cotisations), 50);
await q(`update public.cotisations set paye=true where lecteur_id=$1`,[anim]);
t('recoché : de nouveau 100 F', (await q(`select montant from public.cotisations where lecteur_id=$1`,[anim]))[0].montant, 100);

console.log('\n8. L’admin change le tarif animateur à 200 F');
await q(`update public.app_settings set value='200' where key='montant_cotisation_animateur'`);
await q(`insert into public.cotisations (lecteur_id,date_samedi,paye) values ($1,'2026-10-10',true)`,[anim]);
t('la nouvelle cotisation vaut 200 F', (await q(`select montant from public.cotisations where lecteur_id=$1 and date_samedi='2026-10-10'`,[anim]))[0].montant, 200);
t('l’ancienne reste à 100 F (pas de réécriture du passé)', (await q(`select montant from public.cotisations where lecteur_id=$1 and date_samedi='2026-10-03'`,[anim]))[0].montant, 100);

console.log(`\n${ko===0?'✅':'❌'} ${ok} vérifications réussies, ${ko} échec(s).`);
process.exit(ko?1:0);
