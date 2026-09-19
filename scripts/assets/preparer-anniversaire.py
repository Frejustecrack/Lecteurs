"""Préparation déterministe du JPEG officiel (commit 5604296), sans IA.
Usage: python3 scripts/assets/preparer-anniversaire.py
Dépendances de préparation uniquement : pillow, numpy, opencv-python-headless.
Aucun recadrage, redimensionnement ou changement des éléments hors zones masquées.
"""
from pathlib import Path
import cv2
import numpy as np
from PIL import Image

root = Path(__file__).resolve().parents[2]
source = root / 'Gemini_Generated_Image_xi7rhdxi7rhdxi7r.jpeg'
im = np.array(Image.open(source).convert('RGB'))
mask = np.zeros(im.shape[:2], np.uint8)
# Coordonnées sur une référence 1568 × 885, converties à la résolution source.
# Seuls âge, nom/ornement adjacent, vœux et année deviennent dynamiques.
rectangles = [
    (842, 320, 993, 410),
    (455, 499, 1120, 577),
    (462, 585, 1190, 618),
    (487, 617, 1175, 650),
    (562, 649, 1005, 683),
    (505, 690, 1188, 723),
    (466, 723, 1188, 753),
    (430, 765, 1220, 796),
    (512, 793, 1160, 829),
    (1470, 810, 1521, 837),
]
for x1,y1,x2,y2 in rectangles:
    x1,x2 = [round(v*im.shape[1]/1568) for v in (x1,x2)]
    y1,y2 = [round(v*im.shape[0]/885) for v in (y1,y2)]
    mask[y1:y2,x1:x2] = 255
clean = cv2.inpaint(im, mask, 5, cv2.INPAINT_NS)
Image.fromarray(clean).save(root/'src/assets/anniversaires/fond.jpg', quality=95, subsampling=0)
