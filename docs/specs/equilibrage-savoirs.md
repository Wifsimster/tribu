# Équilibrage du coût des savoirs

Base : master `9772d54` (v3.69.0). Tient compte de la nuit au tiers du cycle prévue en 3.70.0.
Aucun code du jeu n'est modifié par cette spec. Les chiffres viennent de `tools/sim-savoirs.mjs`, qui fait tourner le vrai `Game` de `src/game/sim.ts` sous Node.

## 1. Le retour

Capture de l'humain en prod, au Néolithique, 0/4 : nourriture 16,1 k (1,58/s), bois 3,17 k, fibre 9,3, savoir 6,71 k (0,34/s). Lampe à graisse et cordage végétal déjà connus. Agriculture coûte 110 de savoir, le Grenier 340 : le stock de savoir couvre 20 à 60 fois chaque coût, et seule la fibre bloque.
Son verdict : « Les savoirs se débloquent facilement dès le début. »

Reproduction : 6,71 k de savoir à 0,25/s de moyenne (taux du Néolithique, nuit comprise), c'est 7,4 h de production. C'est une seule absence au plafond (`OFFLINE_CAP_SECONDS = 8 h`). La fibre à 9,3 dit la même chose : le cordage a été acheté au retour, sinon l'absence aurait aussi crédité ~1 500 fibres.

## 2. Mesures

Joueur simulé : achète chaque savoir dès qu'il est abordable (le moins cher d'abord), travaille la ressource qui retarde le plus le prochain savoir, sinon la nourriture, pose chaque terre offerte. Pas d'expédition, pas de Merveille, pas de pêche. Graine 7, pas de 0,5 s. « Abordable » = premier instant où `canResearch` est vrai ; ce joueur achète au même instant.

```
node --import ./tests/resolve-ts.mjs tools/sim-savoirs.mjs --night=3.70 --no-encourage --until=3
node --import ./tests/resolve-ts.mjs tools/sim-savoirs.mjs --night=3.70 --no-encourage --away=660:28800 --until=3
node --import ./tests/resolve-ts.mjs tools/sim-savoirs.mjs --night=3.70 --no-encourage --cycle=1200:28800 --until=6 --max=20000
node --import ./tests/resolve-ts.mjs tools/sim-savoirs.mjs --night=3.70 --no-encourage --from=human --until=3
# même chose avec --rule=proposal pour la règle de la section 5
```

### 2.1 Jeu actif seul : le rythme est bon

Temps de jeu actif auquel chaque savoir devient abordable, partie neuve.

| Savoir | Coût savoir + matériaux | 3.69 sans encourager | 3.70 sans encourager | 3.70 en encourageant |
|---|---|---|---|---|
| Taille du silex | 8 + 12 pierre | 1:13 | 0:50 | 0:36 |
| Maîtrise du feu | 18 + 15 bois | 3:24 | 2:55 | 2:20 |
| Abri de branchages | 30 + 30 bois, 10 pierre | 5:33 | 4:38 | 3:32 |
| Épieu de chasse | 45 + 20 bois, 15 pierre | 8:37 | 7:49 | 5:36 |
| → Néolithique | | 8:37 | 7:49 | 5:37 |
| Lampe à graisse | 55 + 12 pierre, 25 nourriture | 12:20 | 11:12 | 7:43 |
| Cordage végétal | 70 + 30 bois | 16:03 | 14:48 | 10:23 |
| Agriculture | 110 + 40 bois, 25 fibre | 21:59 | 20:24 | 14:17 |
| Poterie | 150 + 50 bois | 28:07 | 26:28 | 17:57 |
| Tissage | 200 + 60 fibre | 35:23 | 33:57 | 22:35 |
| Hache polie | 260 + 50 pierre, 30 bois | 43:08 | 41:11 | 26:55 |
| → Âge du bronze | | 43:09 | 41:12 | 26:56 |
| Grenier | 340 + 80 bois, 40 fibre | 51:28 | 49:32 | 32:09 |
| → Âge du fer | | 1:43:00 | 1:39:42 | 1:04:52 |

Au-delà (3.70, sans encourager) : un savoir toutes les 9:30 à 12:40 de l'Antiquité à l'ère industrielle. Exception : les deux premiers savoirs de l'âge du fer (Forge du fer 23 min, Charrue 20 min), un creux hors du sujet de cette spec. Les coûts suivent la croissance du savoir actif à chaque âge : en jeu actif, le stock de savoir retombe à ~0 après chaque achat. Le savoir est déjà la contrainte.

La 3.70 fait gagner ~5 % de temps (la moyenne de lumière passe de 0,634 à 0,751 sans feu, de 0,922 à 0,947 avec la lampe). Ça ne change pas l'analyse.

### 2.2 Une absence de 8 h : elle saute un âge et demi

Partie neuve, 11 min de jeu (Néolithique, lampe et cordage pas encore achetés), puis 8 h d'absence.

- Crédit de l'absence : savoir 51 → **8 053**, nourriture 446 → 41 227, bois 31 → 2 851, pierre 33 → 3 041.
- Au retour : lampe et cordage tout de suite, Agriculture, Poterie et Hache polie dès que la fibre arrive (1:56 plus tard), Néolithique bouclé en 6 min, âge du fer à **26:34** de jeu actif, contre 1:39:42 sans absence. Il reste 4 571 de savoir en arrivant à l'âge du fer.

Le joueur occasionnel (20 min de jeu, 8 h d'absence, en boucle) : Âge du bronze au retour de la 1ʳᵉ nuit, âge du fer 7 min plus tard, **Moyen Âge au retour de la 2ᵉ nuit**, Renaissance pendant la 3ᵉ session.

### 2.3 La partie de l'humain

Sa sauvegarde reconstituée (pierre illisible sur la capture : 3 000). Agriculture, Poterie et Hache polie à 1:09 (le temps de la fibre), Âge du bronze à 4:57, âge du fer à **13:58**, toujours avec 3 290 de savoir en stock.

## 3. Diagnostic

1. En jeu actif, les coûts sont bien calés : un savoir toutes les 2-4 min au Paléolithique, 6-8 min au Néolithique, 10-12 min ensuite ; le savoir est la contrainte.
2. L'absence crédite le savoir au même taux que le jeu (seulement nuit moyenne, sans encourager) pendant 8 h : à tout âge, une nuit vaut ~75 % de 8 h de jeu actif, soit 6 à 7 fois le coût total de l'âge en cours.
3. Les coûts sont fixes par savoir, alors que le gain d'une absence est proportionnel au taux de l'âge : le rapport reste mauvais à tous les âges (âge du fer : ~38 k crédités pour ~16 k d'arbre).
4. `insight = 0.2 + insightAdd + material × 0.05` n'est pas en cause : le terme `material` pèse ~0,08/s au Néolithique, et ce taux est déjà intégré dans le rythme actif mesuré.
5. Les matériaux suivent la même inondation (41 k de nourriture), mais ils ne bloquent qu'en jeu actif ; après une absence, seul un matériau débloqué au retour (la fibre de l'humain) freine encore.

## 4. Cible de rythme

Temps de jeu actif, 3.70, sans encourager (encourager fait gagner ~35 %) :

| Âge | Intervalle entre deux savoirs | Mesuré aujourd'hui |
|---|---|---|
| Paléolithique | 1er savoir < 1 min, puis 2-3 min | 0:50, puis 1:43-3:36 |
| Néolithique | 5-8 min | 5:36-8:21 |
| Bronze | 8-14 min | 9:00-14:30 |
| Fer et au-delà | 10-12 min | 9:30-12:40 (sauf Forge du fer 23 min, Charrue 20 min) |

Et deux règles :

- **Une absence avance la partie, elle ne la joue pas à la place du joueur.** Au retour : de quoi acheter 1 à 2 savoirs tout de suite, puis un rythme accéléré pendant qu'on joue. Jamais un âge entier d'un coup.
- **Le savoir reste la contrainte.** Après une absence, le joueur choisit dans quel ordre dépenser un stock court (2 à 3 savoirs disponibles, 4 suffisent pour passer l'âge), au lieu de tout cocher.

## 5. Règle recommandée : l'absence verse peu tout de suite, le reste en réserve

Les coûts de la table **ne changent pas** (voir 5.4). La règle porte sur le crédit d'absence du savoir, et seulement lui.

### 5.1 Formules

Soit `r` le taux de savoir moyen d'un cycle (celui que `creditAbsence` utilise déjà) et `s` les secondes de travail créditées (déjà plafonnées à 8 h, expédition déduite).

- **Savoir versé tout de suite** : `r · τ · (1 − e^(−s/τ))`, avec **τ = 600 s**.
  5 min d'absence → 79 % du gain d'avant ; 10 min → 63 % ; au-delà d'une heure, ~10 min de savoir.
- **Le reste va en réserve** : `R += min(r·s − versé, r · 7 200 − R)`. La réserve se plafonne à **2 h** de savoir au taux `r`. Au-delà, le savoir de l'absence est perdu.
- **La réserve se vide en jouant** : à chaque `tick`, `d = min(R, rates.insight · dt)` passe de la réserve au stock. Le savoir rentre deux fois plus vite tant que la réserve n'est pas vide. Encourager double aussi la vidange ; une expédition l'arrête (taux nul), comme la récolte.
- Seule la **production** de savoir de l'absence passe par cette règle. Le butin d'une expédition finie pendant l'absence et les trocs crédités en silence restent versés tels quels.
- L'**Exode** remet la réserve à 0, avec le stock de savoir.

Bilan d'une nuit de 8 h : 10 min de savoir tout de suite, 2 h de plus à toucher en 2 h de jeu, au lieu de 6 h de savoir d'un coup. Les matériaux gardent leur crédit intégral : c'est la promesse de l'idle, et ils ne gouvernent pas le rythme.

Pourquoi une réserve plutôt qu'une simple perte : la même mécanique sert à la migration (section 6) sans rien retirer à personne, et une pause de quelques minutes, versée en partie plus tard, n'est pas perdue.

### 5.2 Où dans le code

- `src/game/state.ts` : `SaveV1.insightReserve?: number`. Absent = sauvegarde d'avant la règle (déclenche la migration). `emptySave` le met à 0. `loadSave` le relit comme nombre fini ≥ 0, sinon 0. Vérifier que `transfer.ts` le transporte.
- `src/game/sim.ts`, `creditAbsence` : isoler la part savoir de `produce(workSeconds)` et lui appliquer 5.1. Constantes `OFFLINE_INSIGHT_TAU = 600` et `INSIGHT_RESERVE_HOURS = 2` à côté de `OFFLINE_CAP_SECONDS`.
- `src/game/sim.ts`, `tick` : la vidange, après `produce(dt)`.
- HUD : à côté du savoir, la réserve et son effet (« réserve 2 001 — savoir ×2 »). Le toast d'absence sépare « savoir +218 » et « réserve +2 001 ».
- Changelog : une phrase sur la réserve.

### 5.3 Simulation avec la règle

`--rule=proposal` applique ces formules par-dessus le `Game` de master (`tools/savoirs-rule.mjs`). Le crédit de la caravane est modélisé avec la production : ça ne joue qu'à partir de l'âge du bronze, et seulement sur 3 trocs.

**Jeu actif seul** : sortie identique au savoir près (`diff` vide). La règle ne touche pas au joueur qui ne s'absente pas.

**Absences, à 11 min de jeu (Néolithique)** :

| Absence | Savoir crédité avant | Après : tout de suite | Après : en réserve |
|---|---|---|---|
| 5 min | 134 | 116 | 18 |
| 10 min | 218 | 156 | 61 |
| 1 h | 1 051 | 217 | 834 |
| 8 h | 8 053 | 218 | 2 001 (plafond ; 5 834 perdus) |

**8 h d'absence à 11:00, puis jeu actif** (temps où le savoir devient abordable) :

| Savoir | Coût | Sans absence | Absence, avant | Absence, après |
|---|---|---|---|---|
| Lampe à graisse | 55 | 11:12 | 11:00 | 11:00 |
| Cordage végétal | 70 | 14:48 | 11:00 | 11:00 |
| Agriculture | 110 | 20:24 | 12:56 | 12:56 |
| Poterie | 150 | 26:28 | 12:56 | 14:54 |
| Hache polie | 260 | 41:11 | 12:56 | 22:45 |
| Tissage | 200 | 33:57 | 17:09 | 19:22 |
| → Âge du bronze | | 41:12 | 17:10 | 22:46 |
| Grenier | 340 | 49:32 | 19:44 | 27:16 |
| Métallurgie du cuivre | 450 | 58:32 | 19:44 | 32:16 |
| → Âge du fer | | 1:39:42 | 26:34 | 54:09 |
| Stock de savoir à l'âge du fer | | 1 | 4 571 | 2 (+ réserve 252) |

Au retour : lampe et cordage (125 de savoir) tout de suite, puis un savoir toutes les 2 à 5 min tant que la réserve dure, au lieu de cinq savoirs en deux minutes.

**Joueur occasionnel** (20 min de jeu, 8 h d'absence, en boucle) :

| Âge atteint | Avant | Après |
|---|---|---|
| Néolithique | 7:49 (session 1) | 7:49 (session 1) |
| Âge du bronze | 20:00 (retour de la nuit 1) | 26:05 (session 2) |
| Âge du fer | 27:17 (session 2) | 53:14 (session 3) |
| Antiquité | — sautée en une nuit | 1:23:53 (session 5) |
| Moyen Âge | 40:00 (retour de la nuit 2) | 1:51:37 (session 6) |
| Renaissance | 58:47 (session 3) | 2:11:53 (session 7) |

Avant : deux nuits suffisaient pour passer du Néolithique au Moyen Âge. Après : environ un âge par jour.

### 5.4 Pourquoi les coûts ne bougent pas

| Savoir | Coût avant | Coût après | Temps actif (3.70) pour l'atteindre depuis le précédent |
|---|---|---|---|
| Taille du silex | 8 + 12 pierre | inchangé | 0:50 |
| Maîtrise du feu | 18 + 15 bois | inchangé | 2:05 |
| Abri de branchages | 30 + 30 bois, 10 pierre | inchangé | 1:43 |
| Épieu de chasse | 45 + 20 bois, 15 pierre | inchangé | 3:11 |
| Lampe à graisse | 55 + 12 pierre, 25 nourriture | inchangé | 3:23 |
| Cordage végétal | 70 + 30 bois | inchangé | 3:36 |
| Agriculture | 110 + 40 bois, 25 fibre | inchangé | 5:36 |
| Poterie | 150 + 50 bois | inchangé | 6:04 |
| Tissage | 200 + 60 fibre | inchangé | 7:29 |
| Hache polie | 260 + 50 pierre, 30 bois | inchangé | 7:14 |
| Grenier | 340 + 80 bois, 40 fibre | inchangé | 8:21 |

Les intervalles mesurés tombent dans la cible de la section 4. Les pistes écartées, chiffres à l'appui :

- **Coûts qui croissent avec le nombre de savoirs connus** (+20 % par savoir déjà acquis dans l'âge) : le Paléolithique passe de 226 à 383 de savoir (+70 %), soit ~25 min au lieu de 15 pour un joueur actif qui n'a rien demandé. Et une nuit de 8 h crédite toujours 8 k : elle couvrirait encore tout le Néolithique, même renchéri. Ça punit le joueur actif sans corriger l'absence.
- **Coûts multipliés par un facteur global** : même défaut. Pour que 8 h ne couvrent plus un âge, il faudrait multiplier les coûts par ~7, et un joueur actif mettrait 40 min par savoir au Néolithique.
- **Simple baisse du plafond d'absence** (8 h → 1 h) : casse aussi l'idle des matériaux, alors que seuls les savoirs posent problème.

Pour les savoirs à venir, la formule reste celle que les coûts suivent déjà : **coût = T(âge) × taux de savoir actif mesuré à l'entrée de l'âge**, avec T de la section 4 (2-3 min, 6, 10, puis 10-12 min). Toute nouvelle table se vérifie avec `tools/sim-savoirs.mjs --night=3.70 --no-encourage` : chaque intervalle doit tomber dans la fourchette, à ±25 %.

## 6. Parties existantes

Au premier chargement après la mise à jour (`insightReserve` absent de la sauvegarde), avant le crédit de l'absence :

- On garde dans le stock `max(coût du savoir disponible le moins cher, r · τ)`.
- Le surplus va en réserve, **sans plafond** : rien n'est retiré, il est rendu en jouant, au double du rythme.
- Aucun savoir acquis ne bouge, aucun matériau non plus. L'âge et les jalons ne changent pas.
- Une partie neuve ou d'après la règle a déjà le champ : la migration ne repasse jamais.

L'humain : 6 710 de savoir → **191 dans le stock, 6 519 en réserve**. Simulation (`--from=human --rule=proposal`) :

| | Avant | Après |
|---|---|---|
| Agriculture | 1:09 | 1:09 |
| Poterie | 1:09 | 1:48 |
| Hache polie | 1:09 | 9:49 |
| Tissage | 4:56 | 6:26 |
| → Âge du bronze | 4:57 | 9:49 |
| Grenier | 7:19 | 14:23 |
| Métallurgie du cuivre | 7:19 | 19:32 |
| → Âge du fer | 13:58 | 43:05 |
| Réserve restante à l'âge du fer | — | 4 794 |

Il achète l'Agriculture dès que sa fibre arrive, puis un savoir toutes les 4 à 8 min, deux fois plus vite qu'une partie neuve, pendant plusieurs heures. Le changelog lui explique la réserve en une phrase : « Le savoir accumulé pendant ton absence rentre maintenant en jouant : ta réserve double ton savoir jusqu'à épuisement. »

## 7. Critères d'acceptation

1. `tools/sim-savoirs.mjs --night=3.70 --no-encourage --until=3` donne la même sortie avant et après l'implémentation (le jeu actif ne change pas).
2. Néolithique, `creditAbsence(28800)` : savoir versé tout de suite ≤ `r · 600` (± 1), réserve ≤ `r · 7200`, matériaux identiques à aujourd'hui.
3. `creditAbsence(300)` verse au moins 78 % du savoir d'aujourd'hui, et le reste va en réserve sans perte.
4. Absence d'1 h : versé + réserve = gain d'aujourd'hui (rien n'est perdu sous le plafond).
5. Réserve `R > 0`, hors expédition : sur un `tick(dt)`, le savoir gagne `2 · rates.insight · dt` (sauf si `R` est plus petit) et `R` baisse d'autant.
6. Sauvegarde de l'humain (section 6) chargée : 191 ± 1 dans le stock, 6 519 ± 1 en réserve, 6 savoirs connus, âge 1. Au chargement, le stock ne paie qu'un savoir (Agriculture, 110 ; Poterie, 150, attend la réserve). Recharger ne remigre pas.
7. Absence de 8 h à 11 min de jeu, puis jeu actif : âge du fer pas avant 45 min de jeu (26:34 aujourd'hui).
8. Exode : réserve à 0.
9. Sauvegarde transférée (`transfer.ts`) : la réserve suit.

## 8. Limites de la simulation

- Pas d'expéditions, de Merveille ni de pêche : elles ajoutent un peu de savoir (≤ 12 + 25 × âge par voyage) et ne changent pas le diagnostic.
- Le joueur achète par coût croissant et pose toujours la première terre offerte.
- La nuit 3.70 est une copie de la formule de `src/game/clock.ts` (branche `feat/nuit-plus-courte`) dans `tools/sim-savoirs.mjs`. Une fois la 3.70 mergée, ce mode et le patch de l'absence (`(1 + plancher) / 2`) sont à retirer du script.
- Pierre de la sauvegarde de l'humain : supposée à 3 000 (illisible sur la capture). Elle ne joue que sur la Hache polie, et elle n'est jamais limitante dans les deux runs.
