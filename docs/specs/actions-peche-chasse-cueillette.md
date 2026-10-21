# Spec — pêche, chasse, cueillette : le bon outil, une animation Blender complète

Base : `master` v3.68.0, commit `00e741a`. Demande de l'humain : « sur les
actions pêche chasse cueillette, les bons outils et animation complète via
blender ». Version cible du premier incrément : **3.69.0**.

Non-objectifs : sons, nouvelles ressources, rééquilibrage économique,
changement du format de sauvegarde, animation des villageois (`villagers.ts`).

---

## 1. État actuel constaté

### Qui fait quoi

- **Un seul acteur anime le travail : le colon** (`src/render/settler.ts`).
  C'est un mime : l'économie est un débit (`gatherRate`), le colon ne fait
  que la jouer (`settler.ts:118-119`). La durée de ses gestes ne change rien
  aux chiffres.
- Cycle : `walkOut → work → walkHome → deposit` (`settler.ts:28`, `583-611`).
  `work` dure **2,6 s** fixes (`settler.ts:589`), multipliées par le
  boost d'encouragement ×1,7 (`main.ts:1788`, `settler.ts:597`).
- **Cueillette = chasse** aujourd'hui : c'est la même action, focus `food`,
  cible un **buisson à baies** (`island.ts:2238-2262`, `registerPickable(mesh,
  'food')`). Seul l'outil change avec les savoirs. Il n'y a pas de cible de
  chasse : le colon « chasse » un buisson à l'épieu.
- **Pêche** : un état de surface `fishing` dans `main.ts:143`, déclenché par un
  tap sur l'eau proche du rivage (`main.ts:966-993`). Focus `food`, le colon
  marche jusqu'à la plage la plus proche, la baie s'anime (poisson qui saute,
  `fauna.ts:1340-1404`), et une **prise bonus** tombe toutes les 13 à 26 s
  (`main.ts:1903-1914` → `game.landCatch()`, `sim.ts:974-978`). Rien ne
  relie cette prise à un geste du colon : le poisson saute au large, la
  nourriture arrive, le colon peut être en train de marcher.
- **La cueilleuse** (`villagers.ts:109-111`), présente dès l'âge 1
  (`main.ts:195`), est un seul maillage soudé, sans membres, avec un panier
  sur la hanche. Elle ne fait que se balancer (`villagers.ts:420-423`). Hors
  périmètre.

### Les outils existants

`setTool(kind, tier)` (`settler.ts:368-421`). Un seul outil, dans la **main
droite** (`armR`, socket `(0, −0,42, 0)`, `settler.ts:418-420`), géométrie
procédurale de 20 à 60 triangles, `castShadow = true`. Six formes : `hand`,
`spear`, `sickle`, `axe`, `pick`, `rod`. Le tier (0 silex, 1 cuivre/bronze,
2 fer, 3 acier) ne change que la couleur du tranchant (`settler.ts:378-379`).

Choix pour le focus `food` (`main.ts:1789-1803`) :

| Situation | Outil actuel |
| --- | --- |
| pêche, sans `cordage` | `spear` (même sans savoir `spear`) |
| pêche, `cordage` | `rod` (gaule + fil fixe, pas de flotteur) |
| buisson, `agriculture` | `sickle` |
| buisson, `spear` | `spear` |
| buisson, rien | `hand` |

### L'animation de travail aujourd'hui

Une seule pour toutes les actions : `animateWork` (`settler.ts:767-785`). Le
bras droit lève lentement puis frappe sec (période 1,43 s, `swing += dt·4,4`),
le bras gauche suit, le torse se penche. À chaque frappe `strike()`
(`settler.ts:813-826`) : huit éclats de silex blancs et le son du geste
(`main.ts:181-187`). La gaule « pêche » donc en frappant l'eau comme une hache,
et la faucille cogne le buisson comme un pic.

Le squelette est **rigide et plat** : six `Mesh` (`body`, `head`, `armL`,
`armR`, `legL`, `legR`), tous enfants directs de `rig` (×1,32,
`settler.ts:169-186`). La tête n'est pas enfant du torse. Chaque membre
porte sa coque de contour en enfant (`settler.ts:287-293`) : 12 appels de
dessin pour le corps, plus l'outil, plus les éclats quand ils volent, plus la
hotte d'expédition (`settler.ts:191-223`, cachée au camp).

Pivots (espace `rig`, avant ×1,32) : torse `(0, 0,44, 0)`, tête
`(0, 1,15, 0)`, bras `(±0,4, 0,86, 0)`, jambes `(±0,13, 0,44, 0)`
(`settler.ts:68-70`, `169-174`).

### Ce que fait le pipeline Blender aujourd'hui (faune, v3.66/3.67)

- Blender **ne produit que de la géométrie**. Un glb par espèce, un nœud par
  pièce, la translation du nœud = pivot, `extras.rig_id` = numéro de pièce ;
  float32, indices uint16, `COLOR_0`, ni matériau, ni rotation, ni échelle
  (`fauna-glb.ts:3-10`). Lu à la main, sans `GLTFLoader` (aucun fichier du dépôt
  n'importe `GLTFLoader`, `AnimationMixer` ni `SkinnedMesh`).
- **Le mouvement reste en TS + GLSL** : choix écrit et argumenté dans
  `fauna-rig.ts:7-12` (« pourquoi pas une animation cuite dans Blender : à
  3–40 px on ne verrait pas la finesse d'un rig »). Le vertex shader plie les
  pièces selon `aPivot`/`aAnim`.
- `tests/rig-parity.test.mjs` traduit le GLSL en JS (`glsl-subset.mjs`) et
  vérifie, sur 24 poses × tous les sommets de chaque glb, que le shader et la
  copie TS `rigPose` posent chaque sommet au même millième d'unité. Les autres
  tests (patinage, jonctions, `fauna-rig.test.mjs`) ne lisent que la copie
  TS : la parité garantit qu'ils mesurent bien ce que le GPU dessine.
- `tests/fauna-models.test.mjs` vérifie le **contrat** : chaque glb a les
  pièces et les pivots de la silhouette procédurale qu'il remplace.
- Les modèles arrivent en différé ; la silhouette procédurale sert de repli
  jusqu'au chargement (`main.ts:174-176`).
- Le script d'export (« compact.py de l'artiste », `fauna-glb.ts:7`) **n'est
  pas versionné** dans le dépôt, et Blender ne tourne pas sur le serveur : il
  est sur le poste « PC fixe », piloté par MCP.

### Écarts relevés en passant (hors périmètre, à signaler)

- `main.ts:186` teste `game.knows('farming')`, un savoir qui n'existe pas
  (le vrai est `agriculture`) : le son reste « chasse » même au Moyen Âge.
  C'est un bug de son, donc un non-objectif ici. À corriger à part.
- Pêche sans le savoir `spear` : le colon tient un épieu qu'il ne connaît pas
  (`main.ts:1793-1796`). Corrigé par la table du §2.

---

## 2. Outils par action × savoir

Règle : un outil n'apparaît qu'avec un savoir qui **existe** dans
`content.ts`. Les deux ajouts d'interprétation (arc et filet) s'appuient sur
le texte même du savoir `cordage` (`content.ts:326-327` : « l'arc, le filet,
le piège, le radeau »). Aucun savoir nouveau n'est créé. La matière du
tranchant suit le tier actuel (`main.ts:1790`), sans changement.

### Pêche (tap sur l'eau)

| Condition (premier vrai, de bas en haut) | Outil | Main(s) | Justification |
| --- | --- | --- | --- |
| `bessemer` (âge 7) | **canne à moulinet** | D + G (manivelle) | moulinet européen courant au XIXᵉ ; réutilise la porte « acier » déjà utilisée pour le tier 3. *Interprétation.* |
| `weaving` (âge 1) | **filet à lancer** (épervier) + panier | D + G | filets néolithiques en fibre (filet d'Antrea, ~8 500 av. J.-C.) ; le filet suit le tissage. *Interprétation, appuyée sur `cordage` + `weaving`.* |
| `cordage` (âge 0) | **gaule + ligne + flotteur** (hameçon d'os) | D | existant (`rod`), on ajoute le flotteur lisible. |
| `spear` (âge 0) | **foëne** (épieu à pointe barbelée) | D | épieu de chasse existant, piqué dans l'eau. |
| rien | **main nue** (pêche à la main, accroupi) | D + G | le colon ne tient plus un épieu qu'il ne connaît pas. |

### Chasse (focus `food` avant l'agriculture, cible : la lisière des chevreuils, voir §7 et question 1)

| Condition | Outil | Main(s) | Justification |
| --- | --- | --- | --- |
| `cordage` (âge 0) | **arc + flèche** | arc en G, flèche en D | « la corde change tout : l'arc… » (`content.ts:327`). Pas de savoir « tir à l'arc » dans le jeu : on n'en crée pas. *Interprétation.* |
| `spear` (âge 0) | **épieu de jet** | D | savoir `spear` (`content.ts:291`), Schöningen. Le propulseur n'est qu'une anecdote (`funFact`, `content.ts:299`), pas un savoir : il n'est pas montré. |
| rien | — (pas de chasse : cueillette à la main) | | |

Après `agriculture`, le focus `food` passe à la cueillette/moisson : la chasse
disparaît de l'écran comme aujourd'hui. Pas d'arme à feu, quel que soit l'âge.

### Cueillette (tap sur un buisson, ou focus `food` sans `spear`)

| Condition | Outil | Main(s) | Justification |
| --- | --- | --- | --- |
| `threefield` (âge 5) | **faux** | D + G | la faux se généralise avec l'assolement triennal médiéval. *Interprétation.* |
| `agriculture` (âge 1) | **faucille** + gerbe sous le bras | D (G tient les tiges) | existant (`sickle`). |
| rien | **main nue + panier** sur la hanche | D cueille, panier à G | le panier de la cueilleuse (`villagers.ts:111`), version colon. |

L'outil est rendu par une fonction pure `toolFor(action, knows, age)` (nouvelle,
testée contre ces trois tables), qui remplace le bloc `main.ts:1789-1803`.
`setTool` gagne une **main gauche** (socket `(0, −0,42, 0)` de `armL`) et
un **accessoire** (panier, gerbe, poisson, gibier), voir §5 pour le coût.

---

## 3. Les animations

### Lisibilité : ce qu'on voit à 50 px

Le colon fait ~1,85 u de haut (rig ×1,32) ; à 50 px de haut, **1 u ≈ 27 px**.

- Un objet de moins de **0,12 u** (3 px) n'existe pas à l'écran. La gaule
  actuelle (rayon 0,016–0,026 u, `settler.ts:401`) et son fil (0,006 u) sont
  sous ce seuil : il faut une gaule d'au moins 0,03 u au bout et un
  **flotteur rouge et blanc de 0,08 u de rayon**.
- Ce qui se lit, c'est le **changement de silhouette** : bras au-dessus de la
  tête, outil tendu loin du corps, corps accroupi, objet qui quitte la main.
  Chaque clip a au moins une pose extrême qui change la silhouette.
- Aucune phase lisible de moins de **0,15 s** (9 images à 60 i/s), sauf le
  geste lui-même, dont la brièveté fait la force (comme la frappe actuelle,
  `settler.ts:771`). L'impact est **tenu** 0,2–0,3 s.
- Le colon **fait face à sa cible** pendant `work` : la mer (dos au centre de
  l'île) pour la pêche, le chevreuil le plus proche pour la chasse, le buisson
  pour la cueillette. Aujourd'hui il garde le cap de sa dernière marche.
- Les éclats blancs de silex (`strike()`) ne vont qu'au bois et à la pierre.
  Cueillette : trois feuilles vertes ou brins dorés. Pêche : éclaboussure
  (mêmes 8 instances, teintées bleu-blanc). Même `InstancedMesh`, couleur par
  instance.

Notation : A = anticipation, G = geste, I = impact/prise, R = retour. Les
durées sont à boost 1 ; le boost les divise par 1,7. « Boucle » = la séquence
se répète tant que dure `work`. La durée de `work` devient celle du clip (elle
ne touche pas l'économie, §1).

### Pêche

| Outil | A | G | I | R | Total | Boucle | Ce qu'on lit à 50 px |
| --- | --- | --- | --- | --- | --- | --- | --- |
| main nue | s'accroupit au bord, mains au-dessus de l'eau, attente 1,6 s (boucle interne, tête qui suit un poisson) | plongée des deux mains 0,2 s | éclaboussure, tenue 0,25 s | se redresse, poisson brandi à deux mains 0,9 s | ~3,0 s | non (1 essai par `work`) | corps plié au ras de l'eau, puis bras levés |
| foëne | épieu levé pointe en bas, buste penché 0,6 s | piqué 0,15 s | éclaboussure, tenue 0,25 s | relève l'épieu 0,7 s, poisson embroché au bout 1 fois sur 2 | 1,7 s | oui, 2 cycles | la hampe verticale qui descend d'un coup |
| gaule + ligne | gaule ramenée par-dessus l'épaule 0,5 s | fouetté 0,25 s, le flotteur vole 0,5 s et se pose à ~2,5 u | **attente** : flotteur qui danse, 1,5 s en boucle | touche (flotteur plonge 0,2 s), ferrage (gaule levée sec 0,3 s), poisson qui pend au bout 0,8 s | 4–5 s | attente en boucle, le reste non | la gaule qui fouette, le point rouge sur l'eau, la gaule qui se lève |
| filet | torsion du buste, filet roulé à deux mains 0,6 s | lancer 0,4 s, le filet s'ouvre en disque sur l'eau | attente 0,8 s | ramené main sur main 1,0 s (boucle bras alternés), filet plein de 2–3 poissons | 3,0 s | non | le disque clair qui s'ouvre sur l'eau sombre |
| moulinet | comme la ligne, gaule plus droite | idem | idem | ramené au moulinet : la main gauche tourne 1,0 s | 4–5 s | idem ligne | idem ligne |

**Signe de réussite** : à chaque `work`, un petit poisson (géométrie du saut,
`fauna.ts:1353-1360`, ~100 triangles, ≥ 0,3 u de long) est montré à la main
puis **porté au retour** (pendu à la main droite pendant `walkHome`, déposé au
feu). Quand `landCatch()` tombe (`main.ts:1906`), la prochaine séquence de
prise est jouée **au moment même** (le clip saute à son événement `catch`)
avec un poisson ×1,6 : le toast « Ça mord » coïncide enfin avec le geste. Le
saut de poisson au large (`fauna.ts`) reste.

### Chasse

| Outil | A | G | I | R | Total | Boucle | Ce qu'on lit à 50 px |
| --- | --- | --- | --- | --- | --- | --- | --- |
| épieu de jet | accroupi, épieu ramené en arrière à hauteur d'oreille, bras gauche tendu vers la cible 0,7 s | jet 0,2 s ; l'épieu quitte la main, vole 0,5 s en cloche | l'épieu se plante (tenu planté 0,4 s) ; le troupeau fuit (état de fuite existant de la faune) | le colon va le chercher (marche courte), s'accroupit 0,6 s, hisse le gibier sur les épaules 0,8 s | ~3,5 s + marche | non | le corps arqué en arrière, puis le trait qui part |
| arc | arc levé main gauche, flèche encochée, bras droit tire jusqu'à la joue 0,8 s ; tenue 0,3 s | lâcher 0,1 s ; la flèche vole 0,35 s | impact, tenue 0,3 s | suivi 0,4 s ; au 2ᵉ tir, ramassage + gibier sur l'épaule comme l'épieu | 2 tirs ≈ 4 s + ramassage | 2 tirs, puis ramassage | les deux bras écartés en ligne : la seule pose « archer » qui se lit à cette taille |

**Signe de réussite** : un **gibier** (lièvre ou petit chevreuil couché, modèle
Blender ≤ 300 triangles, ≥ 0,45 u) jaillit du couvert au moment du tir, tombe
au point d'impact, et repart **sur les épaules du colon** pendant `walkHome`
(accessoire porté par `body`, à la place de la hotte cachée au camp). Il
disparaît au dépôt. Les trois chevreuils de la faune (`fauna.ts:911`) ne sont
**jamais** tués : ils fuient, et le troupeau reste entier (pas de nouvelle
ressource, pas de changement d'état de la faune sauvegardé).

### Cueillette

| Outil | A | G | I | R | Total | Boucle | Ce qu'on lit à 50 px |
| --- | --- | --- | --- | --- | --- | --- | --- |
| main + panier | se penche vers le buisson, bras droit tendu 0,4 s | deux picorages de la main 0,6 s | main portée au panier (bras qui croise le corps) 0,3 s ; le panier monte d'un cran | se redresse à moitié 0,5 s | 1,8 s | oui, 3 cycles | le dos plié et le va-et-vient buisson → hanche |
| faucille | main gauche saisit les tiges, faucille levée derrière 0,35 s | balayage horizontal 0,25 s, buste qui tourne | brins dorés, tenue 0,2 s | 0,6 s ; toutes les 2 coupes, la gerbe grossit sous le bras gauche | 1,4 s | oui | l'arc de la lame à hauteur de taille |
| faux | faux portée à droite, buste tourné 0,5 s | grand arc de ~150° à deux mains 0,4 s | brins dorés, tenue 0,2 s | ramène la faux, un demi-pas en avant 0,7 s | 1,8 s | oui | la longue hampe qui balaie |

**Signe de réussite** : le **contenu du panier** (ou de la gerbe) a 4 crans
visibles : vide, un tiers, deux tiers, plein, avec des baies rouges qui
dépassent. Il se remplit pendant `work`, reste plein pendant `walkHome` et se
vide au dépôt (`animateDeposit`). Le panier lui-même reste sur la hanche
gauche tant que l'action est la cueillette.

### Transitions

- Entrée et sortie de clip : **fondu de 0,15 s** depuis la pose courante
  (interpolation des rotations), sinon la silhouette saute au premier
  frame.
- `wake()`, `celebrate()`, le sommeil et l'expédition arrêtent le clip en
  cours avant d'écrire leur pose (`settler.ts:241-255` remet aujourd'hui les
  rotations à la main).
- Marche, dépôt, sommeil, fête restent **procéduraux** dans ce chantier
  (`animateWalk`, `animateDeposit`, `updateSleep`). Seul `work` passe aux
  clips Blender. Les passer aussi à Blender peut venir plus tard (§7, incr. 4).

---

## 4. Approche technique recommandée

### Recommandation : clips Blender sur le squelette actuel, pas de colon skinné

**Option A (recommandée) : clips keyframés dans Blender, joués sur les six
membres rigides existants.**

1. **Contrat de squelette unique** : les pivots (`HIP_Y`, `SHOULDER_Y`,
   `HEAD_Y`, écarts ±0,4 et ±0,13, socket d'outil `(0, −0,42, 0)`) sortent de
   `settler.ts` vers `src/render/settler-rig.json`, lu par `settler.ts` **et**
   par le script Blender. Une dérive de pivot entre jeu et Blender devient
   impossible.
2. **Côté Blender** (poste « PC fixe », via MCP) : `tools/blender/settler_rig.py`
   (versionné) construit une armature `Colon` aux os plats `body`, `head`,
   `armL`, `armR`, `legL`, `legR`, plus `toolR` (enfant de `armR`), `toolL`
   (enfant de `armL`), `prop` (enfant de `body`), `cast` (flotteur/filet/projectile,
   enfant de la racine). Têtes d'os = pivots du JSON. Le maillage de travail
   est la **vraie géométrie du colon**, exportée du jeu
   (`tools/export-settler-proxy.mjs`), attachée rigidement à chaque os :
   l'animateur voit la silhouette du jeu. Un clip = une Action Blender
   (`fish_hand`, `fish_spear`, `fish_line`, `fish_net`, `fish_reel`,
   `hunt_spear`, `hunt_bow`, `gather_hand`, `gather_sickle`, `gather_scythe`).
   Les **marqueurs** de la timeline donnent les événements (`strike`,
   `release`, `catch`, `fill`, `loop_in`, `loop_out`).
3. **Export** : `tools/blender/export_settler.py` (versionné) produit
   `src/assets/models/settler-clips.glb` (nœuds sans maillage + animations
   glTF `translation`/`rotation`, échantillonnées à 30 i/s puis décimées à
   0,002 rad d'erreur, `LINEAR`) et `settler-tools.glb` (un nœud par outil ou
   accessoire, origine = point de prise, `COLOR_0`, même format compact que la
   faune). Les marqueurs vont dans `animations[i].extras.events`. Le script
   écrit aussi, dans `extras.check`, la **position monde de la main droite, du
   bout d'outil et des pieds** calculée par Blender à 12 instants de chaque
   clip : c'est la référence de parité (§6).
4. **Côté jeu** : `src/render/settler-clips.ts` lit le glb à la main, comme
   `fauna-glb.ts` (accesseurs float32 `SCALAR`/`VEC3`/`VEC4`, refus de tout
   ce qui sort du format), et un **échantillonneur de 60 lignes** (recherche
   de clé, interpolation linéaire et slerp, fondu) écrit directement
   `position`/`quaternion` des six `Mesh` existants. Pas d'`AnimationMixer` ni
   de `GLTFLoader` : rien de plus à télécharger, et les tests lisent les clips
   sous Node. Les coques de contour suivent toutes seules (elles sont enfants
   des membres). Tant que les glb ne sont pas chargés, `animateWork` actuel
   sert de repli, comme les silhouettes de la faune.

**Pourquoi A** : on garde tout ce qui marche et qui est testé (contour par
membre, marche sans patinage, sommeil, expédition, `wake()`), on change
seulement le geste de travail, et l'animateur travaille vraiment dans Blender,
avec IK et courbes, ce que demande l'humain. Une hiérarchie d'objets rigides
animés par TRS, c'est exactement ce que glTF décrit sans skin. Le choix
« pas d'animation cuite » de `fauna-rig.ts:7-12` tenait à des bêtes de
3 à 40 px aux gestes cycliques ; le colon fait 50 px et ses gestes sont de la
mise en scène. Ce choix ne s'applique donc pas ici.

**Coût A** : 1 session Blender pour le rig + 2 à 3 clips par incrément ;
~500 lignes TS (lecteur, échantillonneur, `toolFor`, main gauche,
accessoires) + tests ; +60 à 100 Ko de glb (chargé en différé).

**Risques A et parades** :
- *Conversion d'axes Blender Z-up → glTF Y-up* (le colon regarde +z dans le
  jeu, donc −Y dans Blender) : la référence `extras.check` calculée par
  Blender, comparée à la cinématique directe TS, attrape toute erreur de
  repère au millième (§6).
- *Blender n'est que sur le PC fixe* : les deux scripts sont versionnés,
  rejouables, et le glb est commité. Si le poste est éteint, le jeu
  fonctionne avec le repli procédural. Le `compact.py` de la faune, non
  versionné, est le même risque, à corriger au passage.
- *Conflit clip / pose procédurale* (le bug du « colon couché » corrigé par
  `wake()`) : une seule fonction `stopClip()` appelée par `wake`, `celebrate`,
  `updateSleep`, `updateTrip` ; test dédié (§6).

**Option B (écartée pour l'instant) : remplacer le colon par un modèle
Blender skinné** (`SkinnedMesh` + `GLTFLoader` + `AnimationMixer`).
- Coût : +~45 Ko de code (`GLTFLoader` n'est pas dans le bundle aujourd'hui),
  réécriture de toutes les phases (marche, dépôt, sommeil, fête, expédition)
  et de leurs tests, contour à refaire (une coque skinnée double le skinning),
  colon et cueilleuse qui ne se ressemblent plus. 3 à 4 PR au lieu d'une.
- Gain à 50 px : la déformation des coudes et des genoux, invisible à cette
  taille.
- À reconsidérer seulement si l'humain veut un colon **remodelé** (nouvelle
  silhouette), pas seulement réanimé.

---

## 5. Perf

Base : plafonds de `tools/perf-budget.json` à 140 000 triangles et 90 appels
(mobile et bureau). Relevé actuel donné par le lead : **135,9 k triangles,
81 appels en mobile**. Marge : ~4,1 k triangles, 9 appels. Le relevé de
référence du fichier (126,5 k / 81, v3.67.0) date d'avant la boucle ferrée.

Attention : `renderer.info.render` compte aussi la passe d'ombre. Un maillage
`castShadow` coûte **deux** appels et deux fois ses triangles.

**Budget de ce chantier, au pire cadrage** (colon en plein geste, tout visible) :

| Poste | Appels | Triangles (ombre comprise) |
| --- | --- | --- |
| Outil main droite (existant, remplacé par la version Blender) | 0 (déjà compté) | ≤ 250 × 2 (ombre) |
| Outil main gauche (arc, panier, gerbe, moulinet) — **sans ombre** | +1 | ≤ 200 |
| Accessoire porté (poisson, gibier, contenu du panier) — **sans ombre**, réutilise le maillage de la hotte (`pack`, caché au camp) en changeant sa géométrie | 0 en plus de la hotte, +1 par rapport à aujourd'hui où elle est cachée | ≤ 300 |
| `cast` : flotteur + ligne, filet, épieu ou flèche en vol — **sans ombre**, visible seulement pendant le geste | +1 transitoire | ≤ 150 |
| Éclats (existant, teintés par instance) | 0 | 0 |
| **Total maximal** | **+3** (81 → 84) | **≤ +1,2 k** (→ ~137,1 k) |

Pour rester dedans :
- **Une géométrie par outil**, soudée (comme `weld()` aujourd'hui), pas de
  matériau : la couleur est dans `COLOR_0`, le matériau est le `skin` toon du
  colon (même programme, aucun shader de plus).
- Changer d'outil = changer la géométrie d'un maillage existant, jamais
  ajouter un maillage. Les géométries des outils sont chargées une fois et
  partagées.
- Pas d'ombre pour ce qui est petit ou transitoire. L'ombre de l'outil
  principal reste (elle existe déjà).
- Les clips ne coûtent aucun triangle. Côté CPU, 10 canaux à échantillonner par
  image : < 0,05 ms, mesuré avec `?fps=1` (panneau `main.ts:1755`).
- Taille : `settler-clips.glb` ≤ 60 Ko, `settler-tools.glb` ≤ 40 Ko, chargés en
  différé.

Si une mesure dépasse +1,2 k triangles ou 84 appels, on réduit l'outil, on ne
relève pas le plafond.

---

## 6. Critères d'acceptation

Chaque incrément doit tous les passer, et la PR donne les commandes avec leur sortie.

**Tests unitaires (`corepack pnpm test`)**
1. `toolFor` : chaque ligne des trois tables du §2 donne l'outil attendu ; la
   pêche sans `spear` donne la main nue ; aucun savoir inconnu n'est
   interrogé (le test liste les identifiants lus et les retrouve tous dans
   `TECHS`).
2. **Contrat du squelette** (analogue de `fauna-models.test.mjs`) :
   `settler-clips.glb` a exactement les nœuds `body head armL armR legL legR
   toolR toolL prop cast` ; à la frame 0 de chaque clip, la translation de
   chaque nœud égale le pivot de `settler-rig.json` à 10⁻³ u près ; tous les
   clips de la liste du §4 sont présents, avec les événements attendus
   (`strike` partout, `catch` pour la pêche, `release` pour la chasse, `fill`
   pour la cueillette).
3. **Parité du squelette du colon** (analogue de `rig-parity.test.mjs`,
   nouveau `tests/settler-clip-parity.test.mjs`) : pour chaque clip et chacun
   des 12 instants de `extras.check`, la cinématique directe TS (échantillonneur
   + hiérarchie réelle du `Settler`) place la main droite, le bout d'outil et
   les deux pieds au même endroit que Blender, à **10⁻³ u**. Le test échoue
   aussi si la comparaison est triviale (déplacement max < 0,2 u).
4. **Sol** : dans tous les clips, aucun pied ne passe à plus de 0,02 u sous le
   sol, et les pieds ne glissent pas de plus de 0,02 u quand le clip ne prévoit
   pas de pas.
5. **Impact au bon endroit** : à l'événement `strike` (ou `catch`), le bout
   d'outil est à ≤ 0,15 u de la surface visée : eau (y de la mer) pour la
   pêche, demi-hauteur du buisson pour la cueillette ; le projectile de
   chasse finit au sol.
6. **Continuité** : entrée et sortie de clip, `wake()` en plein clip,
   `celebrate()`, nuit, départ en expédition : aucune rotation de membre ne
   saute de plus de 0,05 rad d'une image à la suivante, et après `wake()` la
   pose est celle de repos (même test que le bug du colon couché).
7. **Réussite** : la cueillette passe le panier par ses 4 crans pendant
   `work` et le vide au dépôt ; un `landCatch()` pendant l'attente déclenche
   l'événement `catch` à moins de 0,1 s ; le gibier est porté pendant tout
   `walkHome` et disparaît au dépôt.
8. **Repli** : sans glb chargé, `animateWork` actuel joue et rien ne lève
   d'exception.

**Navigateur (headless, Playwright)**
9. `tools/shoot-actions.mjs` (nouveau, sur la base de `tools/shoot.mjs` et
   `contact-sheet.mjs`) : en 390×844, colon cadré à ~50 px, une **planche de
   8 images par action × outil**, plus un GIF si `ffmpeg` est présent. L'action
   est forcée par `?act=fish:line` (paramètre de débogage, ignoré sans lui).
   Les planches sont jointes à la PR et relues par `gamedev-qa`.
10. `corepack pnpm check:console` : **0** erreur et **0** avertissement de
    console, avec et sans `?act=`.
11. `corepack pnpm build && corepack pnpm perf:budget` vert, et un relevé
    supplémentaire avec `?act=` au pire outil de l'incrément : ≤ +3 appels et
    ≤ +1,2 k triangles par rapport au même cadrage sans action.

**Sauvegardes**
12. `tests/save-reload.test.mjs` vert, `tools/saves/*.json` non modifiés, aucune
    clé ajoutée ni retirée dans la sauvegarde : l'outil et l'action se
    déduisent de `techs`, `age`, `focus` et de l'état de surface `fishing`.

**Assets**
13. `ASSETS.md` : une ligne par glb (`settler-clips.glb`, `settler-tools.glb`,
    gibier), « Création originale du projet, modélisée dans Blender 5.2 pour
    Tribu ». Aucun modèle tiers. Si un CC0 est utilisé, sa source et sa licence
    sont dans la ligne.
14. Changelog (`CHANGELOG`/`src/game/changelog.ts`) et `package.json` à la
    version de l'incrément.

---

## 7. Découpage en incréments

Chaque incrément est une PR séparée, jouable seule, avec les critères du §6
qui la concernent.

**3.69.0 — Le pipeline et la cueillette.** *(premier livrable)*
- `settler-rig.json`, scripts `tools/blender/settler_rig.py` et
  `export_settler.py` versionnés, proxy exporté du jeu.
- Lecteur `settler-clips.ts`, échantillonneur, fondu, `stopClip()`, événements.
- `toolFor` + main gauche + accessoire ; panier à 4 crans, faucille, faux.
- Clips `gather_hand`, `gather_sickle`, `gather_scythe` ; éclats teintés.
- Tests 1–8 (partie cueillette), 9–14.
- Pourquoi d'abord la cueillette : la cible (buisson) et le déclencheur
  existent déjà, rien ne change dans le jeu hors du geste. Le pipeline est
  rodé sur le cas le plus simple.

**3.70.0 — La pêche.**
- Clips `fish_hand`, `fish_spear`, `fish_line`, `fish_net`, `fish_reel` ;
  nœud `cast` (flotteur et ligne, filet) ; poisson rapporté ; `landCatch`
  synchronisé sur l'événement `catch` ; le colon fait face à la mer.

**3.71.0 — La chasse.**
- Cible : la lisière des chevreuils (`deerSpots`) au lieu du buisson quand
  `toolFor` dit chasse ; clips `hunt_spear`, `hunt_bow` ; projectile ;
  gibier Blender ; fuite du troupeau sur l'événement `release` ; marche
  courte de ramassage. Dépend de la question 1.

**3.72.0 (optionnel) — Le reste du colon dans Blender.**
- Marche, dépôt, sommeil, fête en clips, si l'humain veut que tout le colon
  soit animé dans Blender. Contraint par les tests de marche existants
  (`ground.test.mjs`).

---

## Questions ouvertes pour l'humain

1. **Comment déclencher la chasse ?** Proposition : avant l'agriculture, le
   focus « nourriture » sans tap précis = chasse à la lisière, et un tap sur un
   buisson = cueillette. Variante : un tap sur un chevreuil = chasse (le cerf
   devient touchable). Ça ne change rien à l'économie dans les deux cas.
2. **« Animation complète »** : seulement les gestes de travail (incr. 1 à 3),
   ou aussi marche, dépôt et sommeil (incr. 4) ? Et faut-il remodeler le colon
   lui-même (ce qui ferait pencher vers l'option B) ?
3. **Arc, filet, faux et moulinet** sont des interprétations de savoirs
   existants (`cordage`, `weaving`, `threefield`, `bessemer`). OK, ou faut-il
   de vrais savoirs « arc » ou « filet » (ce qui touche à l'arbre des savoirs, donc
   hors de ce chantier) ?
