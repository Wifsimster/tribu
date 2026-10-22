# Équilibrage du coût des savoirs

Base : master `9772d54` (v3.69.0). Tient compte de la nuit au tiers du cycle prévue en 3.70.0 (fusionnée depuis, voir section 8).
Aucun code du jeu n'est modifié par cette spec. Les chiffres viennent de `tools/sim-savoirs.mjs`, qui fait tourner le vrai `Game` de `src/game/sim.ts` sous Node.

La section 10 (âges 4 à 10, Charrue, Merveilles) part de master `a0932d0` (v3.71.1). Implémentée en 3.72.0 avec les ajouts de 10.10 : Merveilles 0 à 2, coût en savoir des âges 4 à 10, plancher du chantier, part laissée aux savoirs par le chantier et le marchand.

Implémentée en 3.71.0 : réserve et migration dans `src/game/sim.ts` et `src/game/state.ts`, table 9.3 dans `src/game/content.ts`, tests dans `tests/insight-reserve.test.mjs`. Le taux `r` de l'absence et de la migration est la moyenne de la vraie courbe jour/nuit (`meanLightFactor`), pas `(1 + plancher) / 2`. Depuis, `--rule=proposal` est ignoré par le simulateur (la règle est dans le jeu) et `--costs=proportional` ne change plus rien.

## 1. Le retour

Capture de l'humain en prod, au Néolithique, 0/4 : nourriture 16,1 k (1,58/s), bois 3,17 k, fibre 9,3, savoir 6,71 k (0,34/s). Lampe à graisse et cordage végétal déjà connus. Agriculture coûte 110 de savoir, le Grenier 340 : le stock de savoir couvre 20 à 60 fois chaque coût, et seule la fibre bloque.
Son verdict : « Les savoirs se débloquent facilement dès le début. » Puis : « Et pas forcément proportionnel aux besoins. » Les coûts ne correspondent pas à ce que l'île produit : la nourriture et le savoir s'entassent sans usage, et la fibre bloque seule. Ce second point est traité en section 9.

Reproduction : 6,71 k de savoir à 0,25/s de moyenne (taux du Néolithique, nuit comprise), c'est 7,4 h de production. C'est une seule absence au plafond (`OFFLINE_CAP_SECONDS = 8 h`). La fibre à 9,3 dit la même chose : le cordage a été acheté au retour, sinon l'absence aurait aussi crédité ~1 500 fibres.

## 2. Mesures

Joueur simulé : achète chaque savoir dès qu'il est abordable (le moins cher d'abord), travaille la ressource qui retarde le plus le prochain savoir, sinon la nourriture, pose chaque terre offerte. Pas d'expédition, pas de Merveille, pas de pêche. Graine 7, pas de 0,5 s. « Abordable » = premier instant où `canResearch` est vrai ; ce joueur achète au même instant.

```
node --import ./tests/resolve-ts.mjs tools/sim-savoirs.mjs --no-encourage --until=3
node --import ./tests/resolve-ts.mjs tools/sim-savoirs.mjs --no-encourage --away=660:28800 --until=3
node --import ./tests/resolve-ts.mjs tools/sim-savoirs.mjs --no-encourage --cycle=1200:28800 --until=6 --max=20000
node --import ./tests/resolve-ts.mjs tools/sim-savoirs.mjs --no-encourage --from=human --until=3
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
6. La composition des coûts ignore l'économie (section 9) : aucun savoir du Néolithique ou du Bronze ne demande de nourriture, la ressource la plus produite du jeu. La fibre, la plus lente, est réclamée en quantités fixes : un joueur qui garde la récolte par défaut attend la fibre jusqu'à 13 min, alors qu'il a 6 k de savoir en stock.

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

Les coûts **en savoir** ne changent pas (voir 5.4). La règle porte sur le crédit d'absence du savoir, et seulement lui. Les coûts en matériaux sont revus à part (section 9) ; les deux changements sont indépendants.

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

### 5.4 Pourquoi les coûts en savoir ne bougent pas

Coûts en savoir et matériaux d'aujourd'hui. Les matériaux changent en section 9.

| Savoir | Coût avant | Coût en savoir après | Temps actif (3.70) pour l'atteindre depuis le précédent |
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

Pour les savoirs à venir, la formule reste celle que les coûts suivent déjà : **coût = T(âge) × taux de savoir actif mesuré à l'entrée de l'âge**, avec T de la section 4 (2-3 min, 6, 10, puis 10-12 min). Toute nouvelle table se vérifie avec `tools/sim-savoirs.mjs --no-encourage` : chaque intervalle doit tomber dans la fourchette, à ±25 %.

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

1. `tools/sim-savoirs.mjs --no-encourage --until=3` donne la même sortie avant et après l'implémentation (le jeu actif ne change pas).
2. Néolithique, `creditAbsence(28800)` : savoir versé tout de suite ≤ `r · 600` (± 1), réserve ≤ `r · 7200`, matériaux identiques à aujourd'hui.
3. `creditAbsence(300)` verse au moins 78 % du savoir d'aujourd'hui, et le reste va en réserve sans perte.
4. Absence d'1 h : versé + réserve = gain d'aujourd'hui (rien n'est perdu sous le plafond).
5. Réserve `R > 0`, hors expédition : sur un `tick(dt)`, le savoir gagne `2 · rates.insight · dt` (sauf si `R` est plus petit) et `R` baisse d'autant.
6. Sauvegarde de l'humain (section 6) chargée : 191 ± 1 dans le stock, 6 519 ± 1 en réserve, 6 savoirs connus, âge 1. Au chargement, le stock ne paie qu'un savoir (Agriculture, 110 ; Poterie, 150, attend la réserve). Recharger ne remigre pas.
7. Absence de 8 h à 11 min de jeu, puis jeu actif : âge du fer pas avant 45 min de jeu (26:34 aujourd'hui).
8. Exode : réserve à 0.
9. Sauvegarde transférée (`transfer.ts`) : la réserve suit.
10. Coûts en matériaux (section 9) : ceux de `content.ts` égalent la table 9.3 pour les âges 0 à 3.
11. `tools/sim-savoirs.mjs --no-encourage --until=4 --eco` : aucune ressource débloquée à l'âge 1 ou 2 n'a « dépensé 0 » à son âge, et aucun ratio produit/dépensé n'est < 0,8 (hors savoir).
12. Même commande avec `--focus=food` : chaque âge est atteint au plus 5 % plus tard que sans (le joueur qui ne change jamais de récolte n'est plus bloqué par un matériau).

## 8. Limites de la simulation

- Pas d'expéditions, de Merveille ni de pêche (sections 2 à 9 ; la section 10 construit les Merveilles avec `--wonders=v1`) : elles ajoutent un peu de savoir (≤ 12 + 25 × âge par voyage) et ne changent pas le diagnostic.
- Le joueur achète par coût croissant et pose toujours la première terre offerte.
- Les mesures des sections 2 à 9 ont été faites avec une copie de la nuit 3.70 dans `tools/sim-savoirs.mjs` (`--night=3.70`, courbe sans mise à l'échelle), avant la fusion de la 3.70.0. Depuis, le jeu porte la nuit et `lightScaleFor` garde le rendement d'un tour : le mode est retiré du script, le savoir de l'absence et de la migration passe par `meanLightFactor` de `src/game/sim.ts`.
- Le bilan par âge range la production par âge courant et la dépense par âge du savoir : un savoir d'un âge acheté au suivant (le Grenier, la Voile) décale un peu les ratios.
- Les taux de référence de la section 9 sont relevés sur la partie de référence, avec la saison du moment : ±12 % sur la nourriture.
- Pierre de la sauvegarde de l'humain : supposée à 3 000 (illisible sur la capture). Elle ne joue que sur la Hache polie, et elle n'est jamais limitante dans les deux runs.

## 9. Coûts proportionnels à ce que l'île produit

### 9.1 Mesure : production et besoins par âge

`tools/sim-savoirs.mjs --no-encourage --until=4 --eco` (joueur qui focalise ce qui manque) et la même chose avec `--focus=food` (joueur qui ne change jamais de récolte, comme la capture). « Produit » : récolté en jouant pendant l'âge. « Dépensé » : matériaux des savoirs de l'âge. Les taux sont ceux de l'entrée dans l'âge, focalisé / au repos.

| Âge | Ressource | Produit | Dépensé | Ratio | Taux focalisé / au repos |
|---|---|---|---|---|---|
| Paléolithique (7:49) | nourriture | 189 | 25 | ×7,6 | 0,53 / 0,16 |
| | bois | 78 | 95 | ×0,8 | 0,36 / 0,11 |
| | pierre | 51 | 49 | ×1,0 | 0,24 / 0,07 |
| Néolithique (33 min) | nourriture | 5 919 | **0** | ∞ | 1,7 / 0,5 |
| | bois | 272 | 200 | ×1,4 | 0,39 / 0,12 |
| | pierre | 273 | 50 | ×5,5 | 0,41 / 0,12 |
| | fibre | 141 | 125 | ×1,1 | 0,20 / 0,06 |
| | argile | 49 | **0** | ∞ | 0,19 / 0,06 |
| Bronze (58 min) | nourriture | 25 301 | **0** | ∞ | 3,4 / 1,0 |
| | bois | 2 209 | 200 | ×11 | 0,86 / 0,26 |
| | pierre | 1 149 | 60 | ×19 | 0,46 / 0,14 |
| | fibre | 381 | 120 | ×3,2 | 0,24 / 0,07 |
| | argile | 296 | 60 | ×4,9 | 0,18 / 0,05 |
| | cuivre | 233 | 90 | ×2,6 | 0,15 / 0,05 |
| Fer (76 min) | nourriture | 120 878 | **0** | ∞ | 13,5 / 4,1 |
| | bois | 5 435 | 130 | ×42 | 4,2 / 1,3 |
| | fibre | 667 | **0** | ∞ | 0,51 / 0,15 |

Le savoir a un ratio de 0,4 à 1,0 à tous les âges : c'est lui qui règle le rythme, tout ce qui est produit est dépensé.

Lecture :

- **La nourriture n'a aucun débouché dans l'arbre.** Elle est la récolte par défaut, a le taux de base le plus haut (0,5/s) et cinq multiplicateurs avant l'âge du fer (feu ×1,5, épieu ×1,7, agriculture ×2,2, bronze ×1,4, charrue ×2,4). En dehors des savoirs, seuls les expéditions (~30 s de récolte focalisée par voyage) et trois outils du marchand (400 à 900) en consomment. Les 16,1 k de l'humain n'ont nulle part où aller.
- **L'argile** arrive avec la Poterie et ne sert à rien au Néolithique.
- **Bois et pierre** sont 11 à 42 fois au-dessus des besoins à partir du Bronze. Ils ont un débouché hors de l'arbre : les Merveilles (dolmen 2 200 pierre + 900 bois, ziggourat 4 500 + 1 500 + 2 500 argile).
- **La fibre est le goulot isolé.** Elle a le taux le plus lent (0,18 de base, aucun multiplicateur avant la roselière), et le Néolithique en demande 125 pour 141 produits. Le joueur `--focus=food` en souffre :

| Savoir | Partie neuve, focalise ce qui manque | Partie neuve, `--focus=food` | Partie de l'humain, `--focus=food` |
|---|---|---|---|
| Taille du silex (12 pierre) | 0:50 | **3:47** | — |
| Tissage (60 fibre) | 33:57 | 42:42 | **16:33**, avec 6 k de savoir en stock |
| → Âge du bronze | 41:12 | 42:43 | 16:34 |

La pierre au départ et la fibre au Néolithique bloquent seules pendant que le savoir et la nourriture s'entassent. C'est le « pas proportionnel aux besoins ».

### 9.2 Règle : chaque matériau coûte du temps de récolte, pas une quantité fixe

Pour chaque savoir et chaque matériau `r` qu'il demande :

**coût(r) = γ · w_r · T · taux_r**

- `T = coût en savoir / taux de savoir moyen` : le temps que le savoir met à s'accumuler.
- `taux_r` : taux **focalisé** moyen de `r` (nuit comprise, sans encourager) au moment où le savoir apparaît dans la liste. Une ressource qui s'est multipliée coûte en proportion.
- `w_r` : la part de ce temps à passer sur `r`. La somme des parts d'un savoir ne dépasse pas 0,9, aucune part hors nourriture ne dépasse 0,5.
- `γ = 0,8`.
- Arrondi lisible : à l'unité sous 10, à 5 sous 100, à 10 sous 1 000, à 50 sous 10 000.

Ce que la règle garantit :

- Un joueur qui ne change jamais de récolte obtient chaque matériau au repos à 30 % du taux focalisé. Il lui faut au plus `0,8 × 0,5 = 0,4` du taux sur `T`. Le retard est donc borné à ×1,33 sur un seul savoir ; dans les faits, le savoir arrive après (voir 9.4) : **aucun matériau ne bloque seul**.
- Chaque ressource débloquée a un débouché dans son âge, en proportion de ce que l'île en produit.
- **La nourriture devient un coût régulier**, celui des provisions de ceux qui cherchent : semences de l'Agriculture, graisse de la Lampe, grain du Grenier.
- Le savoir reste la seule contrainte du rythme. Les coûts en savoir ne bougent pas.

Parts explicites jusqu'au Bronze (`WEIGHTS`, `tools/savoirs-rule.mjs`) :

| Savoir | Parts |
|---|---|
| Taille du silex | pierre 0,5 |
| Maîtrise du feu | bois 0,5 |
| Abri de branchages | bois 0,4, pierre 0,2 |
| Épieu de chasse | bois 0,3, pierre 0,3 |
| Lampe à graisse | nourriture 0,5, pierre 0,2 |
| Cordage végétal | bois 0,4, nourriture 0,3 |
| Agriculture | nourriture 0,4, bois 0,2, fibre 0,2 |
| Poterie | bois 0,3, nourriture 0,3 |
| Tissage | fibre 0,5, nourriture 0,2 |
| Hache polie | pierre 0,4, bois 0,2 |
| Grenier | nourriture 0,4, bois 0,3, argile 0,2 |
| Métallurgie du cuivre | pierre 0,4, bois 0,2, nourriture 0,2 |
| Alliage de bronze | cuivre 0,5, bois 0,2 |
| Roue | bois 0,4, cuivre 0,2, nourriture 0,2 |
| Écriture | argile 0,5, nourriture 0,2 |
| Voile | fibre 0,4, bois 0,3 |

**Pour la suite de l'arbre** (`defaultWeights`) : le savoir garde ses ressources d'aujourd'hui. Elles se partagent 0,6 au prorata du temps de récolte qu'elles coûtent aujourd'hui (quantité / taux focalisé), et la nourriture prend 0,25 si elle n'y est pas. Pour chaque âge à reprendre : relever les taux avec `tools/sim-savoirs.mjs --json` (champ `avail`), appliquer `proportionalCost`, puis vérifier avec `--eco` (critères 11 et 12).

### 9.3 Table avant / après

Coût en savoir inchangé. Matériaux :

| Âge | Savoir | Savoir | T | Matériaux avant | Matériaux après |
|---|---|---|---|---|---|
| 0 | Taille du silex | 8 | 47 s | 12 pierre | 3 pierre |
| 0 | Maîtrise du feu | 18 | 107 s | 15 bois | 10 bois |
| 0 | Abri de branchages | 30 | 122 s | 30 bois, 10 pierre | 10 bois, 6 pierre |
| 0 | Épieu de chasse | 45 | 183 s | 20 bois, 15 pierre | 15 bois, 15 pierre |
| 0 | Lampe à graisse | 55 | 224 s | 12 pierre, 25 nourriture | 60 nourriture, 10 pierre |
| 0 | Cordage végétal | 70 | 256 s | 30 bois | 25 bois, 80 nourriture |
| 1 | Agriculture | 110 | 322 s | 40 bois, 25 fibre | 200 nourriture, 20 bois, 10 fibre |
| 1 | Poterie | 150 | 334 s | 50 bois | 35 bois, 330 nourriture |
| 1 | Tissage | 200 | 433 s | 60 fibre | 40 fibre, 300 nourriture |
| 1 | Hache polie | 260 | 563 s | 50 pierre, 30 bois | 90 pierre, 45 bois |
| 1 | Grenier | 340 | 548 s | 80 bois, 40 fibre | 820 nourriture, 65 bois, 15 argile |
| 2 | Métallurgie du cuivre | 450 | 631 s | 60 pierre, 40 bois | 130 pierre, 120 bois, 640 nourriture |
| 2 | Alliage de bronze | 600 | 834 s | 60 cuivre | 50 cuivre, 160 bois |
| 2 | Roue | 780 | 879 s | 100 bois, 30 cuivre | 660 bois, 35 cuivre, 1 350 nourriture |
| 2 | Écriture | 950 | 1 070 s | 60 argile | 110 argile, 1 600 nourriture |
| 2 | Voile | 1 200 | 1 211 s | 120 fibre, 60 bois | 190 fibre, 1 050 bois |
| 3 | Forge du fer | 1 600 | 850 s | 90 pierre, 60 cuivre | 170 pierre, 110 cuivre, 3 000 nourriture |
| 3 | Charrue | 2 100 | 1 157 s | 50 fer, 60 bois | 70 fer, 95 bois, 3 650 nourriture |
| 3 | Alphabet | 2 700 | 1 488 s | 40 argile | 230 argile, 4 700 nourriture |
| 3 | Monnaie frappée | 3 400 | 615 s | 40 cuivre, 30 fer | 35 cuivre, 30 fer, 5 450 nourriture |
| 3 | Tour à feu | 2 400 | 1 274 s | 140 pierre, 70 bois | 860 pierre, 430 bois, 4 500 nourriture |
| 3 | Aqueduc | 4 200 | 792 s | 150 pierre, 60 fer | 180 pierre, 70 fer, 6 250 nourriture |

Le Paléolithique baisse un peu (silex 3 pierre au lieu de 12 : le premier savoir ne doit pas attendre la pierre au repos). La fibre du Néolithique passe de 125 à 50. La nourriture entre partout où elle a un sens.

### 9.4 Simulation avec les coûts proportionnels

`--costs=proportional` remplace les matériaux de `content.ts` par la table 9.3 (export `PROPORTIONAL`).

Bilan par âge, joueur qui focalise ce qui manque :

| Âge | Ressource | Ratio avant | Ratio après |
|---|---|---|---|
| Paléolithique | nourriture / bois / pierre | ×7,6 / ×0,8 / ×1,0 | ×1,8 / ×0,9 / ×1,3 |
| Néolithique | nourriture | ∞ (0 dépensé) | ×3,8 (1 650 dépensés) |
| | fibre | ×1,1 | ×2,2 |
| | argile | ∞ | ×3,2 |
| | pierre | ×5,5 | ×2,9 |
| Bronze | nourriture | ∞ | ×6,9 |
| | bois | ×11 | ×1,1 |
| | pierre | ×19 | ×8,9 |
| Fer | nourriture | ∞ | ×5,7 (21 300 dépensés) |
| | bois | ×42 | ×11 |
| | pierre | ×16 | ×3,6 |

Il ne reste ni ∞ ni ressource sous ×0,8 avant l'âge du fer. Une ressource au-dessus de ×1 n'est pas un défaut : ce surplus va aux Merveilles, aux expéditions et au marchand. Deux restes, que je laisse :

- **La fibre à l'âge du fer** (∞) : aucun savoir de l'âge n'en veut, et la Voile, au Bronze, est son débouché. La règle par défaut garde les ressources d'aujourd'hui ; la question reviendra au rééquilibrage de l'âge du fer.
- **Le bois à l'âge du fer** (×11) : la hache polie et le bronze le multiplient par 3,2 ; c'est le débouché de la colonne trophée.

Rythme, temps où chaque âge s'ouvre (3.70, sans encourager) :

| | Coûts d'aujourd'hui | Coûts proportionnels |
|---|---|---|
| Focalise ce qui manque : Néolithique / Bronze / Fer | 7:49 / 41:12 / 1:39:42 | 7:43 / 40:00 / 1:38:47 |
| `--focus=food` : 1er savoir | 3:47 | 0:42 |
| `--focus=food` : Néolithique / Bronze / Fer | 8:36 / 42:43 / 1:39:31 | 7:41 / 39:46 / 1:36:26 |
| Partie de l'humain, `--focus=food` : Tissage / Bronze | 16:33 / 16:34 (avec 6 k de savoir) | voir 9.6 |

Le rythme du joueur attentif ne bouge pas (le savoir reste la contrainte). Le joueur qui ne touche pas à la récolte va désormais au même rythme : la récolte focalisée sert aux Merveilles et aux expéditions, plus à débloquer un savoir.

### 9.5 Débouchés des surplus : on n'ajoute pas de mécanique

J'ai envisagé trois réponses pour la nourriture :

1. **Baisser ses multiplicateurs** (feu, épieu, agriculture…) : refusé. Ce sont les gains les plus visibles du début de partie, et ça ne crée aucun débouché ; on aurait seulement moins de stock inutile.
2. **Une nouvelle mécanique de consommation** (festins, population à nourrir, conversion nourriture → savoir) : refusé. C'est une fonctionnalité, pas un équilibrage. Une conversion vers le savoir annulerait aussi la section 5.
3. **La nourriture dans les coûts des savoirs, proportionnelle à sa production** (9.2) : retenu. Elle s'ajoute aux débouchés qui suivent déjà la production : l'expédition, dont le coût vaut ~30 s de récolte focalisée, et les outils du marchand.

Bois et pierre ont déjà leur gros débouché, les Merveilles : la règle n'y touche pas. Le stock de 16 k de l'humain reste à lui ; il paiera les provisions des savoirs suivants (200 pour l'Agriculture, 820 pour le Grenier, 640 pour la Métallurgie du cuivre…).

### 9.6 Compatibilité et effet combiné

- Les savoirs déjà acquis ne sont ni repayés ni remboursés. Les nouveaux coûts ne valent que pour les achats à venir.
- Un savoir dont le coût baisse (silex, fibre du Tissage) ne pose aucun problème. Un savoir dont le coût monte (nourriture) reste payable par n'importe quelle partie existante : il ne réclame que des ressources déjà produites, en quantité de l'ordre de quelques minutes de récolte.
- **Partie de l'humain, réserve (section 5) et coûts proportionnels** (`--from=human --rule=proposal --costs=proportional`) :

| | Aujourd'hui, `--focus=food` | Réserve seule | Réserve + coûts proportionnels | Réserve + coûts, `--focus=food` |
|---|---|---|---|---|
| Agriculture | 3:53 | 1:09 | 0:03 | 0:10 |
| Poterie | 3:53 | 1:48 | 1:20 | 1:22 |
| Tissage | 16:33 | 6:26 | 5:27 | 9:08 |
| Hache polie | 3:53 | 9:49 | 8:49 | 5:53 |
| → Âge du bronze | 16:34 | 9:49 | 8:49 | 9:08 |
| → Âge du fer | 31:40 | 43:05 | 41:20 | 40:23 |

Il n'attend plus la fibre : l'Agriculture se paie à l'ouverture, sur sa nourriture. Ensuite, un savoir toutes les 4 à 6 min, réglé par le savoir et la réserve, quelle que soit la récolte choisie.

- **Partie neuve, 8 h d'absence à 11 min, avec les deux règles** : Bronze à 21:45, âge du fer à 53:23 (aujourd'hui 17:10 et 26:34).
- **Joueur occasionnel avec les deux règles** : Bronze 25:57, Fer 52:52, Antiquité 1:24:11, Moyen Âge 1:51:49 (proche de la réserve seule).

### 9.7 Où dans le code

- `src/game/content.ts` : remplacer les `materials` des âges 0 à 3 par la table 9.3. Pas de calcul au chargement : les coûts restent des constantes lisibles dans `TECHS`, et la règle sert à les produire.
- La feuille de savoir affiche déjà les matériaux manquants (`missingFor`) : la nourriture y apparaît comme les autres.
- Changelog : « Les découvertes demandent maintenant des provisions : la nourriture sert enfin, et la fibre ne bloque plus le Néolithique. »

## 10. Âges 4 à 10, Charrue et Merveilles

Base : master `a0932d0` (v3.71.1 : savoir compté une fois, `INSIGHT_PER_MATERIAL = 0,07`, Merveille qui avance hors ligne, marchand qui propose). Aucun code du jeu ne change ici. La table est dans `tools/savoirs-rule.mjs` (`COSTS_372`), produite par `tools/couts-ages-tardifs.mjs` ; `tools/sim-savoirs.mjs --costs=3.72` la pose dans le simulateur.

### 10.1 Constat

Joueur de référence (section 2, sans encourager, focalise ce qui manque), partie complète jusqu'au dernier savoir :

```
node --import ./tests/resolve-ts.mjs tools/sim-savoirs.mjs --no-encourage --until=11 --max=200000 --eco
node --import ./tests/resolve-ts.mjs tools/sim-savoirs.mjs --no-encourage --until=11 --max=200000 --eco --wonders=v1
```

- **Les matériaux des âges 4 à 10 ne suivent pas l'île.** Nourriture : rien à dépenser aux âges 4, 6, 7, 9 et 10, ×2 100 au Moyen Âge, ×7 500 à l'ère moderne. Argile sans emploi aux âges 5, 7, 9 et 10, fibre aux âges 3, 7 et 9. Bois ×16 à ×400, pierre ×11 à ×210, ou sans emploi (pierre aux âges 6 et 8, bois aux âges 9 et 10). Table complète en 10.6.
- **Les Merveilles 3 à 10 sont hors d'atteinte.** Lancée en entrant à l'âge du fer, la colonne trophée finit 241:36 plus tard (à 325:54 de jeu), soit 3,7 fois la durée de l'âge. Comme on ne construit qu'un chantier à la fois, elle bloque les quatre Merveilles suivantes : à la fin de l'arbre (679 min), deux Merveilles sur huit ont été lancées et une seule est achevée. Au débit de ce joueur, chaque Merveille demande 17 à 76 h de jeu actif dans son âge (dernière colonne de 10.4). Ce n'est pas qu'une question d'attente : la Merveille prend 60 % de ce que l'île produit et laisse les savoirs à court. L'arbre finit 39 min plus tard qu'avec un joueur qui ne construit rien (679 contre 640 min).
- **Rythme de l'âge du fer.** Charrue : 16:46 après la Forge du fer, hors cible (10-12 min, ±25 % : 7:30 à 15:00). La Forge du fer, elle, met 11:03 après la Voile : elle est dans la cible. Les « 23 min » de la section 2.1 se comptaient depuis l'entrée dans l'âge, avec `INSIGHT_PER_MATERIAL = 0,05` : le joueur y achète d'abord la Voile, un savoir de l'âge du bronze (9:29), puis la Forge.

### 10.2 Règle des savoirs : celle de la section 9, avec des parts explicites

**coût(r) = 0,8 · w_r · T · taux_r**, comme en 9.2 : `T` = coût en savoir / taux de savoir moyen, `taux_r` = taux focalisé moyen de `r` (nuit comprise, sans encourager) à l'apparition du savoir, `Σ w ≤ 0,9`, `w ≤ 0,5` hors nourriture. Les coûts en savoir ne changent pas, sauf celui de la Charrue (10.3).

Les parts (`WEIGHTS_372`) suivent trois contraintes :

1. **Nourriture, argile et fibres ont un débouché dans chaque âge**, de 3 à 10. La fibre entre à l'âge du fer par le harnais de la Charrue, seul savoir de l'âge qui change.
2. **Fer et cuivre ≤ 0,3.** La Merveille de l'âge prend déjà 60 % de leur production (10.4), et ce sont les deux ressources les plus lentes (fer focalisé : 0,23/s à l'Antiquité, 0,74/s à l'ère industrielle). L'Automobile est à fer 0,2 : à 0,3, elle attendait le fer 2:41 avec le gratte-ciel en chantier.
3. **Un matériau a un sens historique** : la chaux et la pouzzolane du béton, le grain du moulin à eau, le parchemin du codex, les moules en argile de l'horloge, les voiles de la caravelle, les cornues réfractaires de l'éclairage au gaz, la silice de la fibre optique, le lithium des argiles pour le stockage, la biomasse du captage du carbone. La nourriture est, comme en 9.2, les provisions de ceux qui cherchent.

Arrondi : `nice` sous 10 000, trois chiffres significatifs au-dessus (`nice3`).

### 10.3 Charrue : 1 600 de savoir au lieu de 2 100

`coût = 12 min × taux de savoir moyen à son apparition` (2,22/s) = 1 600. T = 719 s. Mesuré : 11:43 après la Forge du fer (16:46 avant). Ses matériaux suivent la règle avec les parts nourriture 0,4, fer 0,2, bois 0,1, fibre 0,1. La Forge du fer ne bouge pas (10.1).

### 10.4 Règle des Merveilles

Pour chaque matériau `r` de la Merveille d'un âge de durée `D` (jeu actif, de l'entrée dans l'âge à l'entrée dans le suivant ; à l'âge 10, jusqu'au dernier savoir) :

**coût(r) = 0,6 · production_r(entrée → entrée + 0,8 · D)**

- `0,6`, c'est la part que le chantier prend à la production (`wonderFlow`). Lancée en entrant dans l'âge, la Merveille finit donc vers 80 % de l'âge, au milieu de la cible 70-90 %.
- La production est celle du joueur de référence qui **lance la Merveille en entrant dans l'âge sans changer sa récolte** (`--wonders=v1`) : il focalise un matériau quand un savoir l'attend, sinon la nourriture. La Merveille vit de ce que l'île produit et le rythme des savoirs ne change pas.
- Pourquoi pas un joueur qui focalise le chantier (`--wonder-focus`) : focaliser le fer au lieu de la nourriture fait chuter le terme `material` du savoir (`0,07 × taux`, et la nourriture a de loin le plus gros taux). Avec la table ci-dessous, ce joueur finit chaque Merveille à 24-62 % de l'âge, mais l'arbre lui prend 677 min au lieu de 593. Calée sur lui, la Merveille obligerait le joueur à choisir entre elle et ses savoirs, puisqu'il faudrait focaliser pour l'avoir à temps.
- Les compositions restent celles de `content.ts` (elles portent les faits historiques), seules les quantités changent.
- C'est un point fixe : les Merveilles finies donnent +4 % de récolte, et la Charrue moins chère avance tout. `tools/couts-ages-tardifs.mjs` joue une partie sans Merveille, en tire une table, rejoue avec elle, et recommence jusqu'à ce que la table ne bouge plus (5 tours).

| Âge | Merveille | Avant | Après | Durée de l'âge | Achevée après | Avant, au même débit |
|---|---|---|---|---|---|---|
| 3 | La colonne trophée | 8 000 pierre, 2 000 fer, 1 500 cuivre | 1 300 pierre, 50 fer, 180 cuivre | 60:24 | 49:59 (83 %) | 32 h (×40) |
| 4 | Le grand phare | 15 000 pierre, 4 000 bois, 3 000 fer | 2 900 pierre, 2 150 bois, 120 fer | 52:12 | 41:56 (80 %) | 17 h (×25) |
| 5 | La cathédrale | 30 000 pierre, 9 000 bois, 5 000 fer | 3 250 pierre, 3 350 bois, 130 fer | 36:14 | 28:51 (80 %) | 19 h (×38) |
| 6 | Le grand dôme | 55 000 pierre, 20 000 argile, 9 000 fer | 3 900 pierre, 270 argile, 170 fer | 40:00 | 32:01 (80 %) | 40 h (×74) |
| 7 | La tour de fer | 60 000 fer, 25 000 pierre, 10 000 bois | 450 fer, 23 900 pierre, 22 200 bois | 42:46 | 34:15 (80 %) | 76 h (×133) |
| 8 | Le gratte-ciel | 120 000 fer, 50 000 pierre, 25 000 cuivre | 4 500 fer, 51 800 pierre, 2 300 cuivre | 62:59 | 53:56 (86 %) | 22 h (×27) |
| 9 | La fusée | 250 000 fer, 100 000 cuivre, 60 000 fibre | 5 400 fer, 3 950 cuivre, 4 200 fibre | 76:35 | 61:17 (80 %) | 47 h (×46) |
| 10 | Le réacteur à fusion | 900 000 fer, 400 000 cuivre, 300 000 pierre | 26 600 fer, 13 100 cuivre, 208 000 pierre | 137:16 | 110:43 (81 %) | 62 h (×34) |

« Avant, au même débit » : 0,8 · D × le plus grand rapport ancien / nouveau coût, soit le temps qu'il faudrait au joueur de référence, dans cet âge, pour le chantier d'aujourd'hui. Les chiffres de la passe précédente (tour de fer 11,4 h, fusion 26,6 h) supposaient un joueur qui focalise le chantier ; le rapport ×25 à ×133 reste le même ordre.

### 10.5 Table des savoirs, avant / après

Coût en savoir inchangé sauf la Charrue. T mesuré dans la partie de référence avec Merveilles.

| Âge | Savoir | Savoir | T | Matériaux avant | Matériaux après |
|---|---|---|---|---|---|
| 3 | Charrue | 2 100 → **1 600** | 719 s | 70 fer, 95 bois, 3 650 nourriture | 3 700 nourriture, 15 fer, 220 bois, 25 fibre |
| 4 | Béton romain | 4 800 | 515 s | 200 pierre, 80 argile | 510 pierre, 30 argile, 3 600 nourriture |
| 4 | Moulin à eau | 6 000 | 564 s | 180 bois, 50 fer | 950 bois, 8 250 nourriture, 15 fer |
| 4 | Verre soufflé | 7 500 | 705 s | 120 argile, 60 cuivre | 890 bois, 85 argile, 25 cuivre |
| 4 | Voies romaines | 9 000 | 643 s | 300 pierre, 60 fer | 1 750 pierre, 11 200 nourriture, 15 fer |
| 4 | Codex | 11 000 | 622 s | 200 fibre, 60 argile | 130 fibre, 10 800 nourriture, 25 argile |
| 5 | Collier d'épaule | 13 000 | 537 s | 180 fibre, 80 fer | 20 700 nourriture, 120 fibre, 20 fer |
| 5 | Assolement triennal | 16 000 | 496 s | 150 bois, 400 nourriture | 43 500 nourriture, 1 400 bois |
| 5 | Moulin à vent | 20 000 | 438 s | 300 bois, 150 pierre | 1 700 bois, 1 100 pierre, 30 fibre |
| 5 | Horloge mécanique | 24 000 | 391 s | 150 fer, 80 cuivre | 25 fer, 45 argile, 20 cuivre, 370 bois |
| 5 | Imprimerie | 30 000 | 416 s | 120 fer, 150 fibre | 100 fibre, 44 700 nourriture, 15 fer |
| 6 | Caravelle | 38 000 | 481 s | 400 bois, 250 fibre | 2 000 bois, 110 fibre, 46 600 nourriture |
| 6 | Perspective | 46 000 | 583 s | 200 bois, 150 argile | 110 argile, 1 200 bois, 56 400 nourriture |
| 6 | Lunette astronomique | 56 000 | 558 s | 300 cuivre, 200 argile | 1 500 pierre, 70 cuivre, 35 argile |
| 6 | Lettre de change | 68 000 | 790 s | 300 fibre, 250 cuivre | 89 300 nourriture, 1 450 pierre, 120 fibre, 100 cuivre |
| 6 | Anatomie | 82 000 | 817 s | 250 fibre, 200 fer | 138 000 nourriture, 130 fibre, 30 fer |
| 7 | Machine à vapeur | 100 000 | 476 s | 400 fer, 250 cuivre | 2 700 bois, 1 450 pierre, 65 fer, 50 cuivre, 61 300 nourriture |
| 7 | Chemin de fer | 120 000 | 601 s | 600 fer, 400 bois | 6 700 bois, 139 000 nourriture, 3 700 pierre, 80 fer |
| 7 | Éclairage au gaz | 145 000 | 726 s | 350 fer, 400 pierre | 6 700 pierre, 170 argile, 50 fer |
| 7 | Acier Bessemer | 175 000 | 592 s | 800 fer, 300 pierre | 200 fer, 6 050 pierre, 110 argile |
| 7 | Télégraphe | 210 000 | 710 s | 600 cuivre, 300 bois | 13 100 bois, 250 cuivre, 350 fibre, 319 000 nourriture |
| 8 | Électricité | 250 000 | 697 s | 900 cuivre, 500 fer | 420 cuivre, 9 650 bois, 190 fer |
| 8 | Automobile | 300 000 | 837 s | 900 fer, 400 cuivre | 17 300 bois, 460 fer, 460 fibre |
| 8 | Radio | 360 000 | 1 006 s | 800 cuivre, 300 bois | 680 cuivre, 21 300 bois, 220 argile |
| 8 | Aviation | 430 000 | 1 601 s | 700 fer, 400 fibre | 54 100 bois, 2 150 fibre, 1 950 fer |
| 8 | Pénicilline | 520 000 | 1 453 s | 500 argile, 2 000 nourriture | 1 730 000 nourriture, 630 argile |
| 9 | Ordinateur personnel | 620 000 | 851 s | 1 200 cuivre, 600 fer | 1 200 cuivre, 16 500 pierre, 1 010 000 nourriture, 540 fer, 9 900 bois |
| 9 | Satellites | 750 000 | 1 030 s | 1 000 fer, 800 cuivre | 1 300 fer, 950 cuivre, 1 050 fibre |
| 9 | Internet | 900 000 | 1 029 s | 1 500 cuivre, 800 fer | 29 900 pierre, 950 cuivre, 1 420 000 nourriture |
| 9 | Énergie solaire | 1 100 000 | 1 267 s | 1 800 cuivre, 800 pierre | 49 100 pierre, 1 150 cuivre, 500 argile |
| 9 | Smartphone | 1 350 000 | 1 554 s | 2 000 cuivre, 1 000 fer | 30 200 pierre, 1 250 argile, 1 450 cuivre, 990 fer |
| 10 | Intelligence artificielle | 2 000 000 | 1 415 s | 3 000 cuivre, 1 500 fer, 1 000 fibre | 2 250 cuivre, 39 700 pierre, 740 fibre, 1 000 fer |
| 10 | Stockage du réseau | 2 600 000 | 1 629 s | 4 000 cuivre, 2 500 fer | 2 550 cuivre, 2 350 fer, 1 350 argile |
| 10 | Dessalement | 3 400 000 | 1 891 s | 3 000 fer, 6 000 pierre | 79 500 pierre, 4 020 000 nourriture, 6 000 fer |
| 10 | Édition du génome | 4 200 000 | 2 336 s | 3 000 fibre, 2 000 cuivre | 9 920 000 nourriture, 3 700 fibre, 2 700 cuivre |
| 10 | Captage du carbone | 5 600 000 | 1 821 s | 6 000 fer, 9 000 pierre, 3 000 cuivre | 102 000 pierre, 5 800 fer, 71 500 bois, 2 100 cuivre |
| 10 | Ordinateur quantique | 7 400 000 | 1 097 s | 8 000 cuivre, 5 000 fer, 4 000 fibre | 3 900 cuivre, 3 600 fer, 590 fibre, 460 argile |

Le fer et le cuivre baissent presque partout (le fer de l'Antiquité à 15 au lieu de 50-60) : leurs anciens coûts valaient plusieurs minutes de récolte focalisée, et c'était la Merveille qu'ils étranglaient. La nourriture, le bois et la pierre montent en proportion de ce que l'île en produit.

### 10.6 Simulation

```
S="node --import ./tests/resolve-ts.mjs tools/sim-savoirs.mjs --no-encourage --until=11 --max=200000"
$S --eco                    # avant, sans Merveille
$S --eco --wonders=v1       # avant, Merveilles 3 à 10
$S --costs=3.72 --eco                          # après, sans Merveille
$S --costs=3.72 --eco --wonders=v1             # après : la référence
$S --costs=3.72 --eco --wonders=v1 --focus=food
$S --costs=3.72 --eco --wonders=v1 --wonder-focus
$S --costs=3.72 --wonders=v1 --cycle=1200:28800    # joueur occasionnel
$S --costs=3.72 --wonders=v1 --away=9000:28800     # une nuit à 2 h 30 de jeu
node --import ./tests/resolve-ts.mjs tools/couts-ages-tardifs.mjs   # refait la table
```

**Ouverture des âges** (jeu actif, minutes) :

| Âge ouvert | Avant, sans Merveille | Après, sans Merveille | Avant, Merveilles | Après, Merveilles |
|---|---|---|---|---|
| Âge du fer | 84:17 | 84:17 | 84:17 | 84:17 |
| Antiquité | 150:22 | 144:45 | 150:22 | 144:41 |
| Moyen Âge | 202:37 | 197:27 | 202:37 | 196:53 |
| Renaissance | 241:17 | 235:42 | 243:13 | 233:07 |
| Ère industrielle | 283:50 | 278:23 | 289:23 | 273:08 |
| Ère moderne | 332:14 | 323:34 | 358:08 | 315:54 |
| Ère contemporaine | 398:55 | 390:11 | 424:48 | 378:53 |
| Ère des limites | 487:17 | 479:07 | 514:52 | 455:28 |
| Fin de l'arbre | 639:57 | 628:30 | 679:02 | 592:44 |

Sans Merveille, l'arbre gagne 11 min (la Charrue). Avec les Merveilles, il gagne 86 min sur avant : elles ne prennent plus le fer des savoirs, et les huit bonus de +4 % arrivent à temps. Un seul savoir attend un matériau dans la partie de référence (Automobile, 41 s).

**Intervalle entre deux savoirs** (cible de la section 4 : 10-12 min, ±25 %) :

| Âge | Avant | Après, sans Merveille | Après, Merveilles |
|---|---|---|---|
| 3 | 8:37-16:46 (Charrue) | 8:50-11:43 | 8:48-11:43 |
| 4 | 7:38-9:11 | 7:53-8:47 | 7:47-9:05 |
| 5 | 6:51-8:25 | 6:07-8:52 | 6:10-8:31 |
| 6 | 7:05-9:34 | 7:40-9:10 | 7:15-8:45 |
| 7 | 7:51-11:56 | 7:55-11:13 | 7:38-9:35 |
| 8 | 11:43-15:40 | 11:18-16:03 | 9:48-14:23 |
| 9 | 13:05-20:50 | 13:36-20:05 | 12:04-18:56 |
| 10 | 19:18-33:56 | 18:38-33:44 | 15:50-36:07 |

Forge du fer 11:03, Charrue 11:43 : dans la cible. Aux âges 5 et 8 à 10, les intervalles sortent de la cible, des deux côtés (6 min au Moyen Âge, jusqu'à 36 min à l'ère des limites). C'est le coût en savoir qui les règle, hors du sujet de cette section (voir 10.8).

**Merveilles, achèvement en part de la durée de l'âge** (lancée à l'entrée dans l'âge, ou dès que la précédente est finie) :

| Âge | Référence | `--focus=food` | `--wonder-focus` | Une nuit de 8 h à 2:30 | Joueur occasionnel |
|---|---|---|---|---|---|
| 3 | 83 % | 90 % | 58 % | 83 % | 15:44 (au retour de la nuit) |
| 4 | 80 % | 94 % | 49 % | 22 % (finie pendant la nuit) | 9:05 (au retour) |
| 5 | 80 % | 81 % | 37 % | 118 % | 7:07 (au retour) |
| 6 | 80 % | 79 % | 24 % | 87 % (lancée à +4:23) | 12:27 (au retour) |
| 7 | 80 % | 102 % | 51 % | 101 % | 16:42 (au retour) |
| 8 | 86 % | 119 % (lancée à +1:00) | 54 % | 107 % | 19:44 (au retour) |
| 9 | 80 % | 103 % (lancée à +12:03) | 38 % | 86 % (lancée à +4:16) | 15:00 (au retour) |
| 10 | 81 % | 98 % atteints à la fin | 62 % | 81 % | 0:16 (au retour) |
| Fin de l'arbre | 592:44 | 578:14 | 676:36 | 545:26 | 244:53 |

- **Référence** : 80 à 86 %, dans la cible.
- **`--focus=food`** (ne touche jamais à la récolte) : 79 à 119 %. Les Merveilles des âges 7 à 9 débordent sur l'âge suivant, qui démarre la sienne en retard, et le réacteur reste à 98 %. Ce joueur attend aussi des matériaux que le chantier prend à 60 % : le fer de l'Aviation (18 min), la pierre des Voies romaines et de l'Acier Bessemer (9 min chacune). Il finit pourtant l'arbre 14 min avant la référence, sa nourriture focalisée nourrissant le savoir.
- **`--wonder-focus`** : chaque Merveille à 24-62 % de l'âge, au prix de 84 min de plus sur l'arbre.
- **Une nuit de 8 h** (à 2:30, au début de l'Antiquité) : le phare se finit pendant la nuit. La réserve de savoir (section 5) raccourcit ensuite le Moyen Âge (23:54 au lieu de 36:14), alors que la Merveille, elle, vit des matériaux, que la réserve n'accélère pas : la cathédrale déborde (118 %), le retard se propage jusqu'à l'ère moderne (101-107 %), puis tout revient à 81-86 %. Avant : une Merveille finie (la colonne, 234 %) et une à 94 % sur toute la partie.
- **Joueur occasionnel** (20 min de jeu, 8 h d'absence, en boucle ; les durées sont en jeu actif) : **chaque Merveille est achevée au premier retour qui suit son lancement**. Une nuit crédite 8 h au taux moyen, contre 30 à 110 min de production dans le coût. Les huit sont faites, l'arbre en 244:53 de jeu actif : 13 sessions, environ 4 jours à une nuit de 8 h entre deux. Avant : cinq sur huit, deux sautées parce que la précédente occupait le chantier, et le réacteur à 30 % à la fin. C'est voulu : la Merveille est une œuvre d'idle, que la 3.71.1 fait avancer hors ligne. Le joueur occasionnel la voit finie au retour plutôt que pendant sa session.

**Bilan production / dépense par âge** (jeu actif ; avant : savoirs seuls, sans Merveille ; après : savoirs seuls / savoirs et Merveille de l'âge, partie de référence) :

| Âge | Nourriture | Bois | Pierre | Fibres | Argile | Cuivre | Fer |
|---|---|---|---|---|---|---|---|
| 3 | ×3,4 → ×3,3 | ×8,8 → ×6,5 | ×2,5 → ×2,3 / ×1,1 | ∞ → ×21 | ×1,9 → ×1,8 | ×2,8 → ×2,6 / ×1,2 | ×0,9 → ×1,0 / ×0,7 |
| 4 | ∞ → ×7,4 | ×27 → ×2,7 / ×1,3 | ×11 → ×2,9 / ×1,3 | ×2,9 → ×4,6 | ×1,7 → ×3,3 | ×6,9 → ×17 | ×2,4 → ×9,1 / ×1,8 |
| 5 | ×2 122 → ×8,0 | ×16 → ×2,1 / ×1,1 | ×45 → ×6,3 / ×1,6 | ×1,8 → ×2,4 | ∞ → ×10 | ×5,6 → ×23 | ×0,8 → ×4,7 / ×1,5 |
| 6 | ∞ → ×5,7 | ×18 → ×3,6 | ∞ → ×3,1 / ×1,3 | ×1,0 → ×2,3 | ×1,8 → ×4,5 / ×1,6 | ×1,1 → ×3,8 | ×1,9 → ×13 / ×2,0 |
| 7 | ∞ → ×12 | ×70 → ×2,2 / ×1,1 | ×58 → ×2,8 / ×1,2 | ∞ → ×6,0 | ∞ → ×5,9 | ×1,8 → ×5,1 | ×0,7 → ×3,2 / ×1,5 |
| 8 | ×7 548 → ×9,0 | ×403 → ×1,3 | ∞ → ∞ / ×2,2 | ×13 → ×2,2 | ×7,9 → ×5,2 | ×2,1 → ×4,7 / ×1,5 | ×3,0 → ×3,6 / ×1,3 |
| 9 | ∞ → ×18 | ∞ → ×24 | ×213 → ×1,5 | ∞ → ×8,4 / ×1,7 | ∞ → ×3,9 | ×1,1 → ×1,5 / ×0,9 | ×3,2 → ×4,1 / ×1,4 |
| 10 | ∞ → ×15 | ∞ → ×8,8 | ×30 → ×2,3 / ×1,2 | ×1,8 → ×3,2 | ∞ → ×7,0 | ×1,4 → ×2,2 / ×1,1 | ×2,2 → ×2,9 / ×1,2 |

Plus aucun ∞ : chaque ressource a un débouché à chaque âge, la pierre de l'ère moderne par le gratte-ciel. Les ressources que la Merveille prend tombent à ×0,7-2,2 : c'est la Merveille qui absorbe le surplus de bois et de pierre (M6). Les ratios sous ×1 (fer de l'âge du fer, cuivre de l'ère contemporaine) se paient sur le stock d'entrée. Ce qui reste haut n'est pas un défaut (9.4) : nourriture ×6 à ×18, cuivre ×17-23 aux âges 4-5 (seul le verre et l'horloge en veulent, et à 0,1 ou 0,2), bois ×24 à l'ère contemporaine.

### 10.7 Où dans le code

- `src/game/content.ts` : les `materials` des 36 savoirs des âges 4 à 10, le `cost` et les `materials` de la Charrue, le `cost` des Merveilles 3 à 10, recopiés de `COSTS_372`. Toujours des constantes lisibles.
- **Chantier en cours dans une sauvegarde** : avec les nouveaux coûts, `paid` peut déjà dépasser le total de chaque matériau. `tickWonder` ne passe plus par aucun matériau dû, la progression vaut 1 avant et après, `stageOf` ne change pas : le chantier resterait « en cours » à 100 % pour toujours. Au chargement (ou dans `tickWonder`), une Merveille dont tout est payé doit être déclarée achevée : `wonders.push`, `wonderDone`, `refreshRates`. Le trop-versé n'est pas rendu.
- Les savoirs déjà acquis ne sont ni repayés ni remboursés.
- Changelog : « Les Merveilles se bâtissent maintenant dans leur époque, et chaque découverte réclame ce que l'île produit à ce moment-là. »

### 10.8 Ce qui reste

- **La tour de fer demande 450 fer pour 23 900 pierre.** C'est la règle appliquée telle quelle : à l'ère industrielle, l'île produit 0,74 fer/s focalisé contre 17 de pierre et 1 287 de nourriture. Trois savoirs seulement multiplient le fer (Monnaie ×1,5, Bessemer ×2,2, Stockage ×2,2, plus un outil du marchand ×1,25 et une terre ×1,1) ; une douzaine multiplient la nourriture. Une Merveille « de fer » qui compte surtout de la pierre se lit mal. Le levier serait l'économie du fer (multiplicateurs), pas le coût de la Merveille : je ne le tranche pas ici, c'est une décision de contenu pour le lead.
- **Merveilles 0 à 2, hors sujet ici, même défaut** : avec `--wonder-from=0`, les menhirs finissent à 79 min, soit 10 fois la durée du Paléolithique. La ziggourat, lancée à leur suite, occupe le chantier jusqu'au Moyen Âge : la colonne trophée et le phare ne sont jamais lancés, et la cathédrale démarre 9 min après l'entrée dans son âge (103 %). Les Merveilles 6 à 10 restent dans la cible (79-84 %). La même règle s'applique en changeant `w.age < 3` dans `tools/couts-ages-tardifs.mjs`.
- **Intervalles hors cible aux âges 5 et 8 à 10** (10.6) : réglés par les coûts en savoir, que cette section ne touche pas.
- **Le joueur qui ne touche jamais à la récolte et bâtit** attend trois fois un matériau (9, 9 et 18 min) ; sans Merveille, il n'attend jamais. La garantie de 9.2 (« aucun matériau ne bloque seul ») suppose que toute la production revienne aux savoirs, alors que la Merveille en prend 60 %. Les parts de fer à 0,1-0,3 limitent l'effet sans l'annuler.
- Taux relevés avec la saison du moment (±12 % sur la nourriture) et une seule graine (7).

### 10.9 Critères d'acceptation

13. Les `materials` des savoirs des âges 4 à 10, le coût et les matériaux de la Charrue et le `cost` des Merveilles 3 à 10 de `content.ts` égalent `COSTS_372`.
14. `tools/sim-savoirs.mjs --no-encourage --until=11 --max=200000 --wonders=v1` sur le code implémenté (sans `--costs`) : chaque Merveille des âges 3 à 10 est lancée à l'entrée de son âge et achevée entre 70 et 90 % de sa durée.
15. Même commande avec `--eco` : aux âges 3 à 10, aucune ressource débloquée n'a « dépensé 0 » et « Merveille 0 » à la fois. Nourriture, argile et fibres ont une dépense de savoirs non nulle à chaque âge de 4 à 10.
16. Même commande sans `--eco` : Forge du fer et Charrue deviennent abordables entre 7:30 et 15:00 après le savoir précédent.
17. Sans `--wonders`, `--focus=food` : le dernier savoir arrive au plus 5 % plus tard qu'avec le joueur qui focalise ce qui manque (621:51 contre 628:30 mesurés).
18. Une sauvegarde avec un chantier en cours dont `paid` couvre les nouveaux coûts : la Merveille est achevée au premier `tick` après le chargement, avec son bonus de +4 %.

### 10.10 Ce que la 3.72.0 applique

Sept décisions du lead s'ajoutent à 10.1-10.9 :

1. **Les Merveilles 0 à 2 suivent la même cible** : achevées vers 80 % de leur âge chez le joueur de référence qui les lance en entrant dans l'âge (`--wonder-from=0`).
2. **Le coût en savoir des âges 4 à 10 est recalé** (10.6 : 6 min au Moyen Âge, jusqu'à 36 min à l'ère des limites). Formule de la section 5 : **coût = T × taux de savoir actif**, avec T = 10,5 min (`INSIGHT_T`). Le taux est celui du joueur de référence qui bâtit, mesuré sur l'attente du savoir : (coût − stock laissé par l'achat précédent) / (instant où le savoir suffit − achat précédent). Les matériaux de ces savoirs sont refaits par la règle de 10.2 avec le nouveau T. La première passe ne recalait que les âges 5 et 8 à 10 ; la deuxième y a ajouté les âges 6 et 7 (6:14 entre deux savoirs avec les Merveilles, et l'Imprimerie à 53 000 coûtait plus que la Caravelle à 38 000, qu'elle précède dans l'histoire) ; la troisième l'âge 4 (7:08).
3. **La Charrue garde la table 10.5** telle quelle.
4. **Le chantier n'affame jamais les savoirs** (voir plus bas).
5. **Le marchand non plus** : il ne propose pas un outil dont le prix ferait passer un matériau sous la part réservée aux savoirs, et refuse la vente si l'outil est déjà proposé. C'est la même fonction que pour le chantier.
6. **Chaque Merveille vise 80 à 86 %** : à la première passe, la colonne trophée, alors à l'âge 3, finissait à 77 %.
7. **`--wonder-focus` peut attendre plus de 15 min** entre deux savoirs (jusqu'à 20:30 à l'âge 9) : ce joueur choisit de payer ses Merveilles en savoir. Ce n'est pas la cible, et rien ne le corrige.

**Pourquoi le taux mesuré sur l'attente, pas le taux à l'entrée de l'âge.** Le taux de savoir double ou triple d'un bout à l'autre d'un âge (×3,2 au Moyen Âge) : un taux d'entrée unique donnerait des savoirs au même prix, le premier à 10 min, le dernier à 3. Le taux relevé à l'instant de l'achat précédent ne va pas non plus : il dépend de la récolte du moment, et le fer focalisé nourrit très peu le savoir (terme `material`). Il donnait des coûts en dents de scie (Électricité 402 k, Automobile 245 k). Mesuré sur l'attente, le taux comprend la nuit et la récolte réelle, et le point fixe tombe juste.

**Pourquoi 10,5 min et pas 11.** Calé à 11 min sur le joueur qui bâtit, le même arbre sans Merveille (11 bonus de +4 % en moins) attend jusqu'à 15:14 à l'ère moderne, au-dessus des 15:00. À 10,5 min, il attend au plus 14:13.

**Le plancher du chantier passe de 50 + 30 × âge à 10 + 30 × âge** (`tickWonder`). Au Paléolithique, le joueur de référence dépense ses pierres et son bois dès qu'ils tombent : ses stocks ne dépassent jamais 17. Avec un plancher de 50, le chantier n'y prélève rien, quel que soit le coût. Même à 2 pierres et 2 bois, les menhirs (le cercle de stalagmites depuis la 3.71.2) ne s'achèvent qu'à 28:53, au Néolithique, et le dolmen démarre avec 21 min de retard (118 %). Plancher nul au Paléolithique : la Taille du silex attend 3 min ses 3 pierres, que le chantier boit (débit minimum de 0,4/s). À 10, aucun savoir n'attend de matériau, et le Paléolithique s'allonge de 5 s (8:01 au lieu de 7:56). Aux âges suivants, 40 de moins dans le matelas ne se voient pas.

**Le chantier et le marchand laissent aux savoirs ce qu'il leur faut** (`techReserve`, `WONDER_KEEP_HARVEST`). Au-dessus du plancher, le chantier ne descend pas un matériau sous ce que les savoirs restants de l'âge vont demander. Le marchand ne vend pas un outil dont le prix descendrait un matériau sous cette part :

- Les savoirs restants de l'âge sont rangés du moins cher au plus cher en savoir. Pour chacun, on cumule les matériaux demandés jusqu'à lui, et on retire ce que l'île en récoltera d'ici à ce que le savoir suffise : 70 % de la récolte du moment, pendant (savoir cumulé − stock de savoir) / taux de savoir. La part laissée est le maximum de ces restes.
- Un savoir déjà payable en savoir qui attend un matériau le reçoit tout entier : le chantier n'y touche plus jusqu'à l'achat.
- La carte « Le chantier » montre ces matériaux « laissés à tes savoirs », sans échéance.

Pourquoi pas seulement le savoir qui attend (la règle la plus simple) : le joueur qui ne change jamais de récolte attendait encore 33 min à l'âge du bronze. Le chantier avait bu, avant que la Roue et la Voile n'apparaissent, le bois qu'elles allaient demander. Pourquoi 70 % de la récolte à venir et pas 100 % : la nuit en prend sa part, et à 100 % il attendait encore 5 min à l'âge du bronze et 10 à l'ère moderne. Pourquoi le marchand aussi : avec le chantier seul, la Voile attendait encore 4:17, parce qu'à 90:28 le joueur payait 300 bois l'outil du sel, une minute avant que le savoir de la Voile suffise. Le joueur de référence n'en est presque pas gêné : il focalise ce qui manque, et sa récolte du moment couvre la part laissée. Les sept outils des âges 2 à 8 sont toujours achetés ; chez le joueur qui ne change jamais de récolte, le sel arrive à 99:30 au lieu de 90:28.

**Toutes les Merveilles : la règle de 10.4 est corrigée par un facteur mesuré.** Aux âges 0 à 2, le chantier ne prend pas 60 % de la production : le plancher, les achats de savoir qui vident le stock, le débit minimum de 0,4/s qui dépasse la récolte au repos, la part laissée aux savoirs. Plus tard, les +4 % des Merveilles précédentes arrivent avant l'âge, et la règle ne les compte pas. `tools/couts-ages-tardifs.mjs` multiplie donc la production de la fenêtre par un facteur par âge. À chaque tour, il le corrige vers un achèvement à 83 % (`WONDER_TARGET`, exposant 0,7 pour amortir). Les compositions restent celles de `content.ts`.

```
# depuis le content.ts de 1ebe61b (la première passe de la 3.72.0)
node --import ./tests/resolve-ts.mjs tools/couts-ages-tardifs.mjs --v=3.72.0 --rounds=16 --out=table.json
```

16 tours (50 s). Le gratte-ciel oscille entre 79 et 86 % d'un tour à l'autre : le recalage du savoir de l'ère moderne et le coût de sa Merveille se répondent. Sur les tours 15 à 20, le tour 15 laisse le gratte-ciel à 79 % ; le tour 16 met les onze Merveilles entre 81,9 et 83,9 %, la plus resserrée autour de 83 %, et c'est la table retenue. Elle est dans `tools/savoirs-rule.mjs` (`COSTS_3720`), et `content.ts` la porte (`tests/couts-372.test.mjs` compare les deux, et la table ci-dessous).

| Âge | Savoir | Savoir | Matériaux | Avant (3.71.1) |
|---|---|---|---|---|
| 3 | Charrue | 2 100 → **1 600** | 3 700 nourriture, 15 fer, 220 bois, 25 fibres | 70 fer, 95 bois, 3 650 nourriture (10.5) |
| 4 | Béton romain | 4 800 → **6 550** | 750 pierre, 45 argile, 5 250 nourriture | 200 pierre, 80 argile |
| 4 | Moulin à eau | 6 000 → **7 350** | 1 250 bois, 10 700 nourriture, 15 fer | 180 bois, 50 fer |
| 4 | Verre soufflé | 7 500 → **9 850** | 1 250 bois, 120 argile, 35 cuivre | 120 argile, 60 cuivre |
| 4 | Voies romaines | 9 000 → **10 600** | 2 200 pierre, 13 800 nourriture, 20 fer | 300 pierre, 60 fer |
| 4 | Codex | 11 000 → **14 900** | 190 fibres, 14 700 nourriture, 40 argile | 200 fibres, 60 argile |
| 5 | Collier d'épaule | 13 000 → **18 200** | 31 600 nourriture, 170 fibres, 25 fer | 180 fibres, 80 fer |
| 5 | Assolement triennal | 16 000 → **21 800** | 59 000 nourriture, 2 150 bois | 150 bois, 400 nourriture |
| 5 | Moulin à vent | 20 000 → **28 500** | 2 650 bois, 1 750 pierre, 50 fibres | 300 bois, 150 pierre |
| 5 | Horloge mécanique | 24 000 → **45 100** | 55 fer, 90 argile, 45 cuivre, 780 bois | 150 fer, 80 cuivre |
| 5 | Imprimerie | 30 000 → **55 800** | 180 fibres, 86 500 nourriture, 30 fer | 120 fer, 150 fibres |
| 6 | Caravelle | 38 000 → **79 400** | 3 800 bois, 220 fibres, 111 000 nourriture | 400 bois, 250 fibres |
| 6 | Perspective | 46 000 → **62 800** | 130 argile, 1 500 bois, 88 200 nourriture | 200 bois, 150 argile |
| 6 | Lunette astronomique | 56 000 → **68 800** | 2 000 pierre, 90 cuivre, 45 argile | 300 cuivre, 200 argile |
| 6 | Lettre de change | 68 000 → **83 500** | 83 600 nourriture, 1 350 pierre, 120 fibres, 95 cuivre | 300 fibres, 250 cuivre |
| 6 | Anatomie | 82 000 → **128 000** | 222 000 nourriture, 210 fibres, 55 fer | 250 fibres, 200 fer |
| 7 | Machine à vapeur | 100 000 → **155 000** | 4 150 bois, 2 250 pierre, 95 fer, 75 cuivre, 104 000 nourriture | 400 fer, 250 cuivre |
| 7 | Chemin de fer | 120 000 → **154 000** | 8 850 bois, 205 000 nourriture, 4 900 pierre, 110 fer | 600 fer, 400 bois |
| 7 | Éclairage au gaz | 145 000 → **215 000** | 10 300 pierre, 250 argile, 75 fer | 350 fer, 400 pierre |
| 7 | Acier Bessemer | 175 000 → **226 000** | 300 fer, 9 100 pierre, 170 argile | 800 fer, 300 pierre |
| 7 | Télégraphe | 210 000 → **247 000** | 18 000 bois, 350 cuivre, 480 fibres, 375 000 nourriture | 600 cuivre, 300 bois |
| 8 | Électricité | 250 000 → **338 000** | 580 cuivre, 13 500 bois, 270 fer | 900 cuivre, 500 fer |
| 8 | Automobile | 300 000 → **254 000** | 15 200 bois, 400 fer, 400 fibres | 900 fer, 400 cuivre |
| 8 | Radio | 360 000 → **543 000** | 1 400 cuivre, 34 800 bois, 360 argile | 800 cuivre, 300 bois |
| 8 | Aviation | 430 000 → **581 000** | 42 900 bois, 1 700 fibres, 1 550 fer | 700 fer, 400 fibres |
| 8 | Pénicilline | 520 000 → **393 000** | 1 660 000 nourriture, 520 argile | 500 argile, 2 000 nourriture |
| 9 | Ordinateur personnel | 620 000 → **532 000** | 960 cuivre, 13 400 pierre, 909 000 nourriture, 440 fer, 8 050 bois | 1 200 cuivre, 600 fer |
| 9 | Satellites | 750 000 → **896 000** | 1 500 fer, 1 100 cuivre, 1 200 fibres | 1 000 fer, 800 cuivre |
| 9 | Internet | 900 000 → **615 000** | 23 400 pierre, 740 cuivre, 949 000 nourriture | 1 500 cuivre, 800 fer |
| 9 | Énergie solaire | 1 100 000 → **715 000** | 30 000 pierre, 720 cuivre, 310 argile | 1 800 cuivre, 800 pierre |
| 9 | Smartphone | 1 350 000 → **891 000** | 21 000 pierre, 610 argile, 780 cuivre, 540 fer | 2 000 cuivre, 1 000 fer |
| 10 | Intelligence artificielle | 2 000 000 → **914 000** | 1 200 cuivre, 21 500 pierre, 400 fibres, 550 fer | 3 000 cuivre, 1 500 fer, 1 000 fibres |
| 10 | Stockage du réseau | 2 600 000 → **1 230 000** | 1 250 cuivre, 1 150 fer, 660 argile | 4 000 cuivre, 2 500 fer |
| 10 | Dessalement | 3 400 000 → **1 250 000** | 31 500 pierre, 1 490 000 nourriture, 2 400 fer | 3 000 fer, 6 000 pierre |
| 10 | Édition du génome | 4 200 000 → **2 230 000** | 5 320 000 nourriture, 2 100 fibres, 1 550 cuivre | 3 000 fibres, 2 000 cuivre |
| 10 | Captage du carbone | 5 600 000 → **4 250 000** | 75 300 pierre, 4 250 fer, 52 700 bois, 1 550 cuivre | 6 000 fer, 9 000 pierre, 3 000 cuivre |
| 10 | Ordinateur quantique | 7 400 000 → **4 690 000** | 2 850 cuivre, 2 600 fer, 430 fibres, 330 argile | 8 000 cuivre, 5 000 fer, 4 000 fibres |

| Âge | Merveille | Coût | Avant (3.71.1) |
|---|---|---|---|
| 0 | Le cercle de stalagmites | 15 pierre, 25 bois | 900 pierre, 300 bois |
| 1 | Le grand dolmen | 95 pierre, 90 bois | 2 200 pierre, 900 bois |
| 2 | La ziggourat | 450 pierre, 100 argile, 970 bois | 4 500 pierre, 2 500 argile, 1 500 bois |
| 3 | Le grand phare | 1 600 pierre, 55 fer, 260 cuivre | 8 000 pierre, 2 000 fer, 1 500 cuivre |
| 4 | La colonne trophée | 4 300 pierre, 2 950 bois, 160 fer | 15 000 pierre, 4 000 bois, 3 000 fer |
| 5 | La cathédrale | 5 500 pierre, 5 750 bois, 220 fer | 30 000 pierre, 9 000 bois, 5 000 fer |
| 6 | Le grand dôme | 6 000 pierre, 420 argile, 260 fer | 55 000 pierre, 20 000 argile, 9 000 fer |
| 7 | La tour de fer | 580 fer, 28 000 pierre, 29 400 bois | 60 000 fer, 25 000 pierre, 10 000 bois |
| 8 | Le gratte-ciel | 3 600 fer, 54 900 pierre, 2 600 cuivre | 120 000 fer, 50 000 pierre, 25 000 cuivre |
| 9 | La fusée | 4 250 fer, 3 100 cuivre, 3 300 fibres | 250 000 fer, 100 000 cuivre, 60 000 fibres |
| 10 | Le réacteur à fusion | 9 350 fer, 6 800 cuivre, 107 000 pierre | 900 000 fer, 400 000 cuivre, 300 000 pierre |

Les coûts en savoir ne croissent plus toujours avec la liste. L'Automobile passe avant l'Électricité : elle ne demande que l'Acier Bessemer et s'ouvre dès l'entrée dans l'âge. La Caravelle (79 400) coûte plus que l'Imprimerie (55 800), qu'elle suit dans l'histoire.

### 10.11 Simulation de la 3.72.0

```
S="node --import ./tests/resolve-ts.mjs tools/sim-savoirs.mjs --no-encourage --until=11 --max=200000"
$S --eco                                    # sans Merveille
$S --eco --wonders=v1 --wonder-from=0       # la référence : les onze Merveilles
$S --eco --wonders=v1                       # Merveilles 3 à 10, comme en 10.6
$S --focus=food                             # sans Merveille, sans changer de récolte
$S --wonders=v1 --wonder-from=0 --focus=food
$S --wonders=v1 --wonder-from=0 --focus=food --no-tools
$S --wonders=v1 --wonder-from=0 --wonder-focus
$S --wonders=v1 --wonder-from=0 --away=9000:28800
$S --wonders=v1 --wonder-from=0 --cycle=1200:28800   # joueur occasionnel
```

« Avant » : le même script sur le `content.ts` de a0932d0 (3.71.1).

**Ouverture des âges** (jeu actif) :

| Âge ouvert | Avant, sans Merveille | Après, sans Merveille | Avant, Merveilles 0-10 | Après, Merveilles 0-10 | Après, Merveilles 3-10 |
|---|---|---|---|---|---|
| Néolithique | 7:56 | 7:56 | 7:56 | 8:01 | 7:56 |
| Âge du bronze | 36:04 | 36:04 | 37:57 | 36:10 | 36:04 |
| Âge du fer | 84:17 | 84:37 | 88:44 | 86:11 | 84:37 |
| Antiquité | 150:22 | 145:07 | 169:36 | 144:39 | 145:46 |
| Moyen Âge | 202:37 | 209:16 | 220:41 | 206:02 | 210:44 |
| Renaissance | 241:17 | 268:15 | 258:46 | 258:33 | 266:34 |
| Ère industrielle | 283:50 | 327:45 | 300:36 | 310:54 | 322:38 |
| Ère moderne | 332:14 | 387:50 | 360:18 | 363:28 | 379:41 |
| Ère contemporaine | 398:55 | 450:46 | 425:21 | 415:35 | 435:46 |
| Ère des limites | 487:17 | 514:32 | 521:07 | 468:02 | 491:03 |
| Fin de l'arbre | 639:57 | 590:00 | 676:47 | 531:08 | 557:14 |

Avec les Merveilles, chaque âge de 4 à 9 dure maintenant 52 à 61 min, l'ère des limites 63. Les âges 4 à 7 s'allongent (Antiquité 49 min et Renaissance 38 min à la première passe). Les âges 8 à 10 raccourcissent : avec les Merveilles 3 à 10, l'ère des limites dure 66 min, contre 137 en 10.6. L'arbre finit 50 min plus tôt sans Merveille, 2 h 26 plus tôt avec. La première passe (âges 4, 6 et 7 non recalés) finissait en 545:12 et 493:33. Sans Merveille, l'âge du fer s'ouvre 20 s plus tard qu'en 3.71.1 : le marchand attend que la Voile ait son bois pour vendre le sel.

**Intervalle entre deux savoirs** (achat précédent → abordable ; cible 10-12 min, ±25 % : 7:30 à 15:00) :

| Âge | Avant, sans Merveille | Après, sans Merveille | Après, Merveilles 0-10 | Après, Merveilles 3-10 | Après, sans Merveille, `--focus=food` | Après, Merveilles 0-10, `--focus=food` |
|---|---|---|---|---|---|---|
| 3 | 8:37-16:46 | 8:57-11:50 | 8:19-11:59 | 8:54-11:48 | 8:48-11:29 | 8:15-11:46 |
| **4** | 7:38-9:11 | 9:37-11:34 | 10:21-10:32 | 10:29-11:47 | 9:40-11:23 | 9:23-11:02 |
| **5** | 6:51-8:25 | 11:12-12:18 | 10:28-10:32 | 10:36-11:24 | 11:14-12:07 | 9:51-11:21 |
| **6** | 7:05-9:34 | 10:44-13:18 | 10:14-10:36 | 9:57-12:09 | 10:42-13:09 | 9:57-10:53 |
| **7** | 7:51-11:56 | 10:54-13:09 | 10:29-10:34 | 10:05-12:14 | 10:57-13:16 | 10:01-10:53 |
| **8** | 11:43-15:40 | 11:29-13:31 | 9:46-10:43 | 9:52-12:13 | 11:09-13:36 | 9:47-11:25 |
| **9** | 13:05-20:50 | 11:38-13:24 | 10:26-10:35 | 9:43-12:16 | 11:24-13:49 | 9:56-11:01 |
| **10** | 19:18-33:56 | 11:44-13:10 | 10:16-10:48 | 10:15-11:59 | 12:04-13:19 | 10:10-11:03 |

Les âges 4 à 10 tiennent la cible dans les cinq conduites. L'ère contemporaine du joueur qui ne change jamais de récolte, sans Merveille, sortait de 36 s à la première passe (15:36 : les Satellites attendaient 3:30 leurs matériaux) : elle est à 13:49 au plus.

**Merveilles, achèvement en part de la durée de l'âge** (lancée à l'entrée ou dès que la précédente est finie) :

| Âge | Référence | Merveilles 3-10 | `--focus=food` | `--wonder-focus` | Une nuit de 8 h à 2:30 | Joueur occasionnel |
|---|---|---|---|---|---|---|
| 0 | 83 % | — | 359 % | 50 % | 83 % | 83 % |
| 1 | 83 % | — | 222 % (lancée à +20:23) | 35 % | 83 % | 79 % |
| 2 | 83 % | — | 144 % (+33:35) | 53 % | 83 % | 82 % |
| 3 | 83 % | 90 % | 112 % (+19:58) | 58 % | 83 % | 70 % |
| 4 | 83 % | 85 % | 114 % (+7:01) | 52 % | 19 % (pendant la nuit) | 48 % |
| 5 | 83 % | 87 % | 98 % (+8:32) | 38 % | 109 % | 29 % |
| 6 | 83 % | 84 % | 83 % | 28 % | 87 % (+3:42) | 20 % |
| 7 | 84 % | 79 % | 95 % | 50 % | 89 % | 7 % |
| 8 | 84 % | 85 % | 86 % | 46 % | 86 % | 3 % |
| 9 | 84 % | 87 % | 84 % | 40 % | 83 % | 100 % |
| 10 | 82 % | 84 % | 82 % | 53 % | 81 % | 92 % |
| Fin de l'arbre | 531:08 | 557:14 | 522:46 | 610:17 | 483:20 | 221:48 |

Avant (3.71.1), la référence avec les onze Merveilles en finissait trois : les menhirs à 79 min (997 % du Paléolithique), la ziggourat et la cathédrale ; le gratte-ciel restait à 56 %. Le joueur occasionnel en finissait huit, toutes en débordant sur l'âge suivant (125 à 347 %), et le réacteur restait à 31 %.

- **Référence** : 82 à 84 %. Le grand phare (âge 3) est à 83 % ; la colonne trophée, à l'âge 3 lors de la première passe, finissait à 77 %.
- **Merveilles 3 à 10** : 79 à 90 %, dans les 70-90 % du critère 14.
- **Joueur occasionnel** : chaque Merveille est finie dans son âge. Aux âges 5 à 8, le chantier avance pendant les absences de 8 h et s'achève tôt. La fusée s'achève pendant l'absence qui ouvre aussi l'ère des limites (100 %). L'arbre prend 222 min de jeu actif, contre 208 à la première passe.
- **`--wonder-focus`** (le joueur focalise le chantier quand aucun savoir n'attend de matériau) : jusqu'à 20:30 entre deux savoirs à l'âge 9. C'est un choix du joueur, qui paie ses Merveilles en savoir (décision 7).
- **`--focus=food`, avec les Merveilles des premiers âges, outils du marchand compris** : le joueur qui ne touche jamais à la récolte n'attend plus ses matériaux que deux fois. La Taille du silex attend 0:11, comme sans Merveille, et la Voile 0:13. Avec `--no-tools`, il attend au plus 0:19 par âge. À la première passe, il attendait 17 fois, dont 73 min à l'âge du bronze (15 à 22 min pour la Métallurgie du cuivre, l'Alliage de bronze, la Roue et la Voile). Son âge du bronze dure 46 min au lieu de 71 (47 sans Merveille). Ses Merveilles 0 à 5 finissent en retard : le chantier attend que la récolte au repos couvre d'abord les savoirs. Sans Merveille, il finit l'arbre en 586:46, contre 590:00 pour celui qui focalise ce qui manque (critère 17).

**Bilan par âge** (critère 15, `--eco`, référence) : aux âges 3 à 10, aucune ressource débloquée n'a « dépensé 0 » et « Merveille 0 » à la fois. Nourriture, argile et fibres ont une dépense de savoirs à chaque âge de 4 à 10.

**Ce qui reste** (en plus de 10.8, dont la tour de fer à 580 fer) :

- Les multiplicateurs de fer (10.8) ne bougent pas : hors du mandat de la 3.72.0.

### 10.12 Critères d'acceptation de la 3.72.0

19. `content.ts` égale `COSTS_3720` et la table de 10.10 (savoirs des âges 3 à 10, onze Merveilles) — `tests/couts-372.test.mjs`. L'Imprimerie ne coûte pas plus de savoir que la Caravelle.
20. `tools/sim-savoirs.mjs --no-encourage --until=11 --max=200000 --wonders=v1 --wonder-from=0` : chaque Merveille, lancée à l'entrée de son âge, s'achève entre 80 et 86 % de l'âge (même test).
21. Mêmes options, avec et sans `--wonders=v1 --wonder-from=0`, avec et sans `--focus=food` : aux âges 4 à 10, chaque intervalle tombe entre 7:30 et 15:00.
22. Un chantier dont `paid` couvre les nouveaux coûts est achevé au chargement (critère 18), une seule fois : rien n'est retiré du stock, le trop-versé n'est pas rendu, le bonus de +4 % s'applique, un second chargement ne l'annonce pas.
23. Une absence créditée au chargement réécrit la sauvegarde à la date du retour : un rechargement 3 s plus tard ne crédite rien.
24. Le chantier ne prend rien d'un matériau qu'attend un savoir déjà payable en savoir. Le marchand ne propose ni ne vend un outil qui descendrait un matériau sous la part réservée aux savoirs. `--focus=food --wonders=v1 --wonder-from=0`, outils compris : au plus 2 min d'attente de matériau par âge.
