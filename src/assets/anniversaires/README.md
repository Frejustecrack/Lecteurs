# Template officiel de carte d'anniversaire

## Provenance

- Commit utilisateur : `5604296` (« Add files via upload »).
- Source **conservée intacte** à la racine : `Gemini_Generated_Image_xi7rhdxi7rhdxi7r.jpeg`.
- SHA-256 source : `ebcbec0ec052a81e0a49d8d6af5a02f75edef12b621e7c74cf9f18cea2f51d96`.
- JPEG sRGB, 2720 × 1536 pixels, paysage. Ce n'est pas un fichier à calques : le nom, l'âge, les paragraphes et l'année sont intégrés aux pixels.
- Référence : crème/ivoire, or et brun, ballons latéraux, filet, emblème paroissial, en-tête et titre à empattements.

## Préparation du fond

`fond.jpg` est **dérivé de cette source**, sans génération d'un autre design.
Le script `scripts/assets/preparer-anniversaire.py` efface uniquement les zones
personnalisables par interpolation locale (OpenCV Navier–Stokes). Les ballons,
l'emblème, le cadre, l'en-tête, « Joyeux » et « ANNIVERSAIRE » restent ceux du
fichier fourni. Le petit ornement à droite du nom est retiré dans la zone du nom
pour rendre possibles les noms longs. Aucun recadrage ni changement de proportions.

La préparation est faite **une fois**, hors du navigateur. Le projet n'a aucune
dépendance Python/OpenCV en fonctionnement ou lors du build. Pour régénérer le
fond : installer `pillow`, `numpy`, `opencv-python-headless` dans un environnement
Python, puis lancer `python3 scripts/assets/preparer-anniversaire.py`.

## PDF dynamique

- `src/pdf/anniversaire.ts` incorpore le fond une seule fois, à 240 × 135,529 mm
  (environ 288 ppp), sur une page, avec texte dynamique vectoriel.
- Le JPEG ne contient aucune police réutilisable. Times, disponible dans jsPDF,
  reprend le style à empattements ; Times italique pour l'âge, gras pour le nom.
- L'âge ordinal remplace « 18e », avec son libellé explicite « 18 ans » dessous.
- Les coordonnées sont documentées dans le générateur sur une grille de
  référence 1568 × 885. Les zones sont mesurées ; retour à la ligne et réduction
  progressive (nom : 24 à 7,25 pt pour les cas extrêmes), sans ellipse.
- Si une donnée dépasse même ces limites, l'export est refusé explicitement :
  jamais de texte coupé, de superposition ou de caractères microscopiques.
- Les vœux sont neutres en l'absence de champ sexe dans le schéma actuel.
- Fond et jsPDF sont chargés au clic seulement, puis le fond reste en mémoire.

## Vérification

`npm run verif:anniversaires` vérifie le hash de la source, l'âge, le 29 février,
les changements de mois au Bénin, les variantes de texte, les noms de fichiers,
le fond incorporé et les limites de toutes les zones des PDF. Six PDF témoins
sont écrits dans `tmp/anniversaires/` (hors Git) pour contrôle visuel.
