/** Logique et vrais PDF d'anniversaire. Aucun accès à la base de production. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { ageAnniversaire, anniversaireValide, dateAnniversaire, messagesAnniversaire, nomFichierAnniversaire, periodeAnniversaires } from '../src/lib/anniversaires.ts';

let succes = 0;
function test(nom, fn) { fn(); succes++; console.log(`  ✓ ${nom}`); }
const lecteur = { id: 'l1', matricule: 'LEC101', nom: 'Dupont', prenom: 'Jean', jour: 24, mois: 9, annee: 2026, age_atteint: 18 };

test('âge atteint cette année même avant le jour de naissance', () => assert.equal(ageAnniversaire('2008-09-24', 2026), 18));
test('âge au changement d’année', () => assert.equal(ageAnniversaire('2008-09-24', 2027), 19));
test('29 février, anniversaire en année commune', () => assert.equal(ageAnniversaire('2008-02-29', 2026), 18));
test('libellé 29 février sans report involontaire en mars', () => assert.equal(dateAnniversaire(29, 2), '29 février'));
test('dates nulles, impossibles, futures et malformées', () => {
  for (const d of [null, '', '2009-02-29', '2008-02-31', '2027-09-24', '24/09/2008', '0000-01-01', '2008-13-01', 'infinity']) assert.equal(ageAnniversaire(d, 2026), null);
});
test('minuit du Bénin : septembre → octobre', () => {
  assert.deepEqual(periodeAnniversaires(new Date('2026-09-30T22:59:59Z')), {annee:2026,mois:9});
  assert.deepEqual(periodeAnniversaires(new Date('2026-09-30T23:00:00Z')), {annee:2026,mois:10});
});
test('décembre → janvier au Bénin', () => assert.deepEqual(periodeAnniversaires(new Date('2026-12-31T23:00:00Z')), {annee:2027,mois:1}));
test('réponses API invalides exclues', () => {
  assert(anniversaireValide(lecteur));
  for (const l of [null, {...lecteur, jour:31,mois:2}, {...lecteur,age_atteint:-1}, {...lecteur,nom:null}, {...lecteur,jour:NaN}]) assert(!anniversaireValide(l));
});
test('texte neutre sans sexe connu', () => assert(messagesAnniversaire().at(-1).includes('au sein des Lecteurs Juniors')));
test('formulations fille/garçon correctes si disponibles à l’avenir', () => {
  assert(messagesAnniversaire('fille').at(-1).includes('de lectrice junior'));
  assert(messagesAnniversaire('garcon').at(-1).includes('de lecteur junior'));
});
test('nom de fichier lisible, sûr et année dynamique', () => {
  const nom = nomFichierAnniversaire({...lecteur,nom:'D’Álmeida / ../',prenom:'Éloïse',annee:2027});
  assert.match(nom,/^Carte-anniversaire-Eloise-D-Almeida-LEC101-2027\.pdf$/);
});

const source = readFileSync('Gemini_Generated_Image_xi7rhdxi7rhdxi7r.jpeg');
test('source officielle du commit 5604296 conservée à l’identique', () => assert.equal(createHash('sha256').update(source).digest('hex'), 'ebcbec0ec052a81e0a49d8d6af5a02f75edef12b621e7c74cf9f18cea2f51d96'));
const dossier = resolve('tmp/anniversaires');
mkdirSync(dossier, {recursive:true});
await build({ configFile:false, logLevel:'silent', build: { outDir:resolve('tmp/anniversaire-bundle'), emptyOutDir:true, ssr:resolve('src/pdf/anniversaire.ts'), rollupOptions:{output:{format:'es',entryFileNames:'anniversaire.mjs'}}, minify:false }, ssr:{noExternal:true} });
const { creerCarteAnniversaire, LARGEUR_CARTE, HAUTEUR_CARTE } = await import(pathToFileURL(resolve('tmp/anniversaire-bundle/anniversaire.mjs')).href);
const fond = new Uint8Array(readFileSync('src/assets/anniversaires/fond.jpg'));
for (const [cas, l] of [
  ['Jean', lecteur],
  ['Eloise', {...lecteur,prenom:'Éloïse',nom:'D’Almeida',age_atteint:12}],
  ['Nom-long', {...lecteur,prenom:'Marie-Thérèse Anne-Charlotte',nom:'Dossou-Ahouansou de la Sainte-Famille D’Almeida Agossou Hounkpatin'.repeat(2), age_atteint:21}],
  ['Mot-long', {...lecteur,nom:'A'.repeat(140),age_atteint:100}],
  ['Fevrier', {...lecteur,jour:29,mois:2,age_atteint:18}],
  ['Annee-suivante', {...lecteur,annee:2027,age_atteint:19}],
]) {
  const {doc,textes,nomFichier} = creerCarteAnniversaire(l, fond);
  writeFileSync(resolve(dossier, `${cas}.pdf`), Buffer.from(doc.output('arraybuffer')));
  test(`${cas} : une page paysage aux proportions du template`, () => {
    assert.equal(doc.getNumberOfPages(),1);
    assert(Math.abs(doc.internal.pageSize.getWidth()-LARGEUR_CARTE)<0.01);
    assert(Math.abs(doc.internal.pageSize.getHeight()-HAUTEUR_CARTE)<0.01);
  });
  test(`${cas} : vrai template incorporé en haute résolution`, () => {
    const images=Object.values(doc.internal.collections.addImage_images);
    assert.equal(images.length,1); assert.equal(images[0].width,2720);assert.equal(images[0].height,1536);
  });
  test(`${cas} : toutes les zones respectées, aucun texte superposé`, () => {
    for (const t of textes) {
      assert(t.largeurTexte<=t.largeur+0.01); assert(t.hauteurTexte<=t.hauteur); assert(t.taille>=7);
      assert(t.x>=0 && t.y>=0 && t.x+t.largeur<=LARGEUR_CARTE && t.y+t.hauteur<=HAUTEUR_CARTE);
    }
    for(let i=0;i<textes.length;i++) for(let j=i+1;j<textes.length;j++) {
      const a=textes[i],b=textes[j];
      assert(a.x+a.largeur<=b.x || b.x+b.largeur<=a.x || a.y+a.hauteur<=b.y || b.y+b.hauteur<=a.y);
    }
  });
  test(`${cas} : nom complet et année sans troncature`, () => {
    assert(textes.some(t=>t.texte===`${l.prenom} ${l.nom}`.toLocaleUpperCase('fr')));
    assert(textes.some(t=>t.texte===String(l.annee)));
    assert(textes.some(t=>t.texte===`${l.age_atteint} ${l.age_atteint>1?'ans':'an'}`));
    assert(nomFichier.endsWith(`-${l.annee}.pdf`));
  });
}
test('date API invalide : pas de PDF produit', () => assert.throws(()=>creerCarteAnniversaire({...lecteur,jour:31,mois:2},fond),/invalides/));
console.log(`\n✅ ${succes} vérifications anniversaires réussies. PDF témoins dans tmp/anniversaires.`);
