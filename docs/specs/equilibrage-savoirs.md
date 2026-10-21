# Équilibrage du coût des savoirs

Base : master `9772d54` (v3.69.0). Tient compte de la nuit au tiers du cycle prévue en 3.70.0.
Aucun code du jeu n'est modifié par cette spec. Les chiffres viennent de `tools/sim-savoirs.mjs`, qui fait tourner le vrai `Game` de `src/game/sim.ts` sous Node.

## 1. Le retour

Capture de l'humain en prod, au Néolithique, 0/4 : nourriture 16,1 k (1,58/s), bois 3,17 k, fibre 9,3, savoir 6,71 k (0,34/s). Lampe à graisse et cordage végétal déjà connus. Agriculture coûte 110 de savoir, le Grenier 340 : le stock de savoir couvre 20 à 60 fois chaque coût, et seule la fibre bloque.
Son verdict : « Les savoirs se débloquent facilement dès le début. » Puis : « Et pas forcément proportionnel aux besoins. » Les coûts ne correspondent pas à ce que l'île produit : la nourriture et le savoir s'entassent sans usage, et la fibre bloque seule. Ce second point est traité en section 9.

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
10. Coûts en matériaux (section 9) : ceux de `content.ts` égalent la table 9.3 pour les âges 0 à 3.
11. `tools/sim-savoirs.mjs --night=3.70 --no-encourage --until=4 --eco` : aucune ressource débloquée à l'âge 1 ou 2 n'a « dépensé 0 » à son âge, et aucun ratio produit/dépensé n'est < 0,8 (hors savoir).
12. Même commande avec `--focus=food` : chaque âge est atteint au plus 5 % plus tard que sans (le joueur qui ne change jamais de récolte n'est plus bloqué par un matériau).

## 8. Limites de la simulation

- Pas d'expéditions, de Merveille ni de pêche : elles ajoutent un peu de savoir (≤ 12 + 25 × âge par voyage) et ne changent pas le diagnostic.
- Le joueur achète par coût croissant et pose toujours la première terre offerte.
- La nuit 3.70 est une copie de la formule de `src/game/clock.ts` (branche `feat/nuit-plus-courte`) dans `tools/sim-savoirs.mjs`. Une fois la 3.70 mergée, ce mode et le patch de l'absence (`(1 + plancher) / 2`) sont à retirer du script.
- Le bilan par âge range la production par âge courant et la dépense par âge du savoir : un savoir d'un âge acheté au suivant (le Grenier, la Voile) décale un peu les ratios.
- Les taux de référence de la section 9 sont relevés sur la partie de référence, avec la saison du moment : ±12 % sur la nourriture.
- Pierre de la sauvegarde de l'humain : supposée à 3 000 (illisible sur la capture). Elle ne joue que sur la Hache polie, et elle n'est jamais limitante dans les deux runs.

## 9. Coûts proportionnels à ce que l'île produit

### 9.1 Mesure : production et besoins par âge

`tools/sim-savoirs.mjs --night=3.70 --no-encourage --until=4 --eco` (joueur qui focalise ce qui manque) et la même chose avec `--focus=food` (joueur qui ne change jamais de récolte, comme la capture). « Produit » : récolté en jouant pendant l'âge. « Dépensé » : matériaux des savoirs de l'âge. Les taux sont ceux de l'entrée dans l'âge, focalisé / au repos.

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
