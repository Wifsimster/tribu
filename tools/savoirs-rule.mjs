// La règle proposée par docs/specs/equilibrage-savoirs.md, posée PAR-DESSUS
// le `Game` de master pour la simuler sans toucher au code du jeu. Ce n'est
// pas l'implémentation : c'est un modèle fidèle de ses chiffres.
//
// 1. Une absence ne verse tout de suite que τ·(1 − e^(−s/τ)) secondes de
//    savoir au taux moyen : ~toute une courte pause, au plus τ pour une nuit.
// 2. Le reste part en RÉSERVE (plafonnée à RESERVE_CAP secondes de ce même
//    taux) : pendant le jeu, la réserve se vide au rythme du savoir produit —
//    le savoir rentre deux fois plus vite tant qu'elle n'est pas vide.
// 3. Migration d'une partie existante : le stock au-delà de
//    max(coût du savoir disponible le moins cher, τ de savoir) part en
//    réserve, sans plafond (rien n'est perdu).

export const TAU = 10 * 60
export const RESERVE_CAP = 2 * 3600

export function immediateSeconds(s) {
  return TAU * (1 - Math.exp(-s / TAU))
}

export function applyProposal(Game) {
  const P = Game.prototype
  const credit = P.creditAbsence
  P.creditAbsence = function (raw) {
    const before = this.amount('insight')
    credit.call(this, raw)
    const s = Math.min(raw, 8 * 3600)
    const gained = this.amount('insight') - before
    if (!(gained > 0) || s <= 3) return
    const mean = gained / s
    const now = mean * immediateSeconds(s)
    const excess = gained - now
    this.save.res.insight = before + now
    const R = this.save.insightReserve ?? 0
    const room = Math.max(0, mean * RESERVE_CAP - R)
    this.save.insightReserve = R + Math.min(excess, room)
  }
  const tick = P.tick
  P.tick = function (dt, now) {
    tick.call(this, dt, now)
    const R = this.save.insightReserve ?? 0
    if (R <= 0) return
    const d = Math.min(R, Math.max(0, this.rates.insight) * dt)
    this.save.res.insight = this.amount('insight') + d
    this.save.insightReserve = R - d
  }
}

/** Le traitement d'une sauvegarde existante, au premier chargement après la
 *  mise à jour : `meanRate` est le taux de savoir moyen sur un cycle. */
export function migrate(game, meanRate) {
  if (game.save.insightReserve !== undefined) return
  const cheapest = Math.min(...game.available().map((t) => t.cost), Infinity)
  const keep = Math.max(Number.isFinite(cheapest) ? cheapest : 0, meanRate * TAU)
  const S = game.amount('insight')
  game.save.insightReserve = Math.max(0, S - keep)
  game.save.res.insight = Math.min(S, keep)
}

// ── Coûts en matériaux proportionnels à la production (section 9) ──────────
// coût(r) = γ · w_r · T · taux_r, avec T = coût en savoir / taux de savoir
// moyen, et taux_r le taux moyen de r FOCALISÉE, nuit comprise, à l'instant où
// le savoir apparaît dans la liste. w_r : la part du temps du savoir à passer
// sur r ; la somme des parts d'un savoir ne dépasse pas 0,9, et aucune
// ressource autre que la nourriture ne dépasse 0,5.
export const GAMMA = 0.8

/** Les parts, explicites jusqu'à l'âge du bronze. La nourriture, ce sont les
 *  provisions de ceux qui cherchent : semences, graisse, grain à engranger. */
export const WEIGHTS = {
  flint: { stone: 0.5 },
  fire: { wood: 0.5 },
  shelter: { wood: 0.4, stone: 0.2 },
  spear: { wood: 0.3, stone: 0.3 },
  lamp: { food: 0.5, stone: 0.2 },
  cordage: { wood: 0.4, food: 0.3 },
  agriculture: { food: 0.4, wood: 0.2, fiber: 0.2 },
  pottery: { wood: 0.3, food: 0.3 },
  weaving: { fiber: 0.5, food: 0.2 },
  polished_axe: { stone: 0.4, wood: 0.2 },
  granary: { food: 0.4, wood: 0.3, clay: 0.2 },
  copper: { stone: 0.4, wood: 0.2, food: 0.2 },
  bronze: { copper: 0.5, wood: 0.2 },
  wheel: { wood: 0.4, copper: 0.2, food: 0.2 },
  writing: { clay: 0.5, food: 0.2 },
  sail: { fiber: 0.4, wood: 0.3 },
}

/** La règle par défaut, pour la suite de l'arbre : les ressources actuelles du
 *  savoir se partagent 0,6 au prorata du TEMPS qu'elles coûtent aujourd'hui
 *  (quantité / taux focalisé), et la nourriture prend 0,25 si elle n'y est pas. */
export function defaultWeights(tech, rates) {
  const mats = Object.entries(tech.materials ?? {}).filter(([r]) => rates[r] > 0)
  const time = mats.map(([r, n]) => [r, n / rates[r]])
  const sum = time.reduce((a, [, x]) => a + x, 0) || 1
  const w = Object.fromEntries(time.map(([r, x]) => [r, Math.min(0.5, (0.6 * x) / sum)]))
  if (!w.food) w.food = 0.25
  return w
}

export function nice(x) {
  if (x < 10) return Math.max(2, Math.round(x))
  if (x < 100) return Math.round(x / 5) * 5
  if (x < 1000) return Math.round(x / 10) * 10
  if (x < 10000) return Math.round(x / 50) * 50
  return Math.round(x / 500) * 500
}

/** `seen` : { insight, rates } relevés par sim-savoirs.mjs (--json, `avail`). */
/** Arrondi de la section 10 : comme `nice` sous 10 000, trois chiffres
 *  significatifs au-dessus (4 020 000 plutôt que 4 015 500). */
export function nice3(x) {
  if (x < 10000) return nice(x)
  const step = 10 ** (Math.floor(Math.log10(x)) - 2)
  return Math.round(x / step) * step
}

export function proportionalCost(tech, seen, weights = WEIGHTS, round = nice) {
  const T = tech.cost / seen.insight
  const w = weights[tech.id] ?? defaultWeights(tech, seen.rates)
  const out = {}
  for (const [r, k] of Object.entries(w)) if (seen.rates[r] > 0) out[r] = round(GAMMA * k * T * seen.rates[r])
  return out
}

// ── Section 10 : les âges 4 à 10 et les Merveilles 3 à 10 ──────────────────
// Même règle que la section 9, parts explicites. Chaque âge donne un débouché
// à la nourriture, à l'argile et aux fibres ; le fer et le cuivre gardent des
// parts faibles (≤ 0,3) parce que la Merveille de l'âge en prend déjà 60 %.
export const WEIGHTS_372 = {
  plough: { food: 0.4, iron: 0.2, wood: 0.1, fiber: 0.1 }, // le harnais : la fibre sert enfin à l'âge du fer
  // 4 — Antiquité
  concrete: { stone: 0.4, clay: 0.2, food: 0.2 }, // chaux, pouzzolane
  watermill: { wood: 0.4, food: 0.3, iron: 0.1 }, // le grain à moudre
  glass: { wood: 0.3, clay: 0.3, copper: 0.1 }, // le four, le sable
  roads: { stone: 0.5, food: 0.2, iron: 0.1 },
  codex: { fiber: 0.4, food: 0.2, clay: 0.1 }, // parchemin, papyrus
  // 5 — Moyen Âge
  horsecollar: { food: 0.3, fiber: 0.3, iron: 0.1 }, // l'avoine, le cuir
  threefield: { food: 0.4, wood: 0.3 }, // les semences
  windmill: { wood: 0.4, stone: 0.3, fiber: 0.1 }, // les toiles des ailes
  clock: { iron: 0.2, clay: 0.2, copper: 0.1, wood: 0.1 }, // moules de fonderie
  press: { fiber: 0.3, food: 0.2, iron: 0.1 }, // le papier de chiffon
  // 6 — Renaissance
  caravel: { wood: 0.4, fiber: 0.3, food: 0.2 }, // voiles, vivres de bord
  perspective: { clay: 0.3, wood: 0.2, food: 0.2 }, // ocres et terres
  observatory: { stone: 0.3, copper: 0.2, clay: 0.1 },
  bank: { food: 0.2, stone: 0.2, fiber: 0.2, copper: 0.2 }, // papier des lettres de change
  anatomy: { food: 0.3, fiber: 0.2, iron: 0.1 },
  // 7 — Ère industrielle
  steamengine: { wood: 0.3, stone: 0.2, iron: 0.2, copper: 0.1, food: 0.1 },
  railway: { wood: 0.3, food: 0.2, stone: 0.2, iron: 0.2 }, // traverses, ballast
  gaslight: { stone: 0.3, clay: 0.2, iron: 0.1 }, // cornues réfractaires
  bessemer: { iron: 0.3, stone: 0.2, clay: 0.1 }, // briques du convertisseur
  telegraph: { wood: 0.3, copper: 0.2, fiber: 0.2, food: 0.2 }, // poteaux, gaine des fils
  // 8 — Ère moderne
  electricity: { copper: 0.3, wood: 0.2, iron: 0.1 },
  automobile: { wood: 0.3, iron: 0.2, fiber: 0.2 }, // carrosserie, pneus, sellerie ; le fer à 0,2 : le gratte-ciel en prend déjà
  radio: { copper: 0.3, wood: 0.3, clay: 0.1 }, // isolateurs en céramique
  flight: { wood: 0.3, fiber: 0.3, iron: 0.2 }, // cellule bois et toile
  penicillin: { food: 0.5, clay: 0.2 }, // le milieu de culture
  // 9 — Ère contemporaine
  computer: { copper: 0.3, stone: 0.2, food: 0.2, iron: 0.1, wood: 0.1 }, // silicium ; l'Apple I en boîte de bois
  satellite: { iron: 0.2, copper: 0.2, fiber: 0.2 }, // fibres composites
  internet: { stone: 0.3, copper: 0.2, food: 0.2 }, // fibre optique : de la silice
  solar: { stone: 0.4, copper: 0.2, clay: 0.1 },
  smartphone: { stone: 0.2, clay: 0.2, copper: 0.2, iron: 0.1 }, // céramiques, terres rares
  // 10 — Ère des limites
  ai: { copper: 0.3, stone: 0.2, fiber: 0.1, iron: 0.1 },
  storage: { copper: 0.3, iron: 0.2, clay: 0.2 }, // le lithium des argiles
  desal: { stone: 0.3, food: 0.2, iron: 0.2 },
  crispr: { food: 0.4, fiber: 0.3, copper: 0.1 },
  carbon: { stone: 0.4, iron: 0.2, wood: 0.2, copper: 0.1 }, // la biomasse captée
  quantum: { copper: 0.3, iron: 0.2, fiber: 0.1, clay: 0.1 },
}

/** Coût en savoir de la Charrue (section 10.4) : le seul coût en savoir qui
 *  bouge. 12 min au taux de savoir moyen mesuré quand elle apparaît. */
export const PLOUGH_T = 12 * 60

/** La Merveille d'un âge coûte, pour chacun de ses matériaux, la part que le
 *  chantier prend (60 % de la production) de ce que l'île produit de ce
 *  matériau pendant les 80 premiers % de l'âge, chez le joueur de référence
 *  qui la lance en entrant dans l'âge (sim-savoirs --wonders=v1). */
export const WONDER_DRAW = 0.6
export const WONDER_SHARE = 0.8
export function wonderCost(def, made) {
  const out = {}
  for (const r of Object.keys(def.cost)) out[r] = nice3(WONDER_DRAW * (made[r] ?? 0))
  return out
}

/** La table que donne `proportionalCost` sur la partie de référence
 *  (tools/sim-savoirs.mjs --night=3.70 --no-encourage --until=4 --json, avant la
 *  fusion de la 3.70.0). */
export const PROPORTIONAL = {
  flint: {stone: 3},
  fire: {wood: 10},
  shelter: {wood: 10, stone: 6},
  spear: {wood: 15, stone: 15},
  lamp: {food: 60, stone: 10},
  cordage: {wood: 25, food: 80},
  agriculture: {food: 200, wood: 20, fiber: 10},
  pottery: {wood: 35, food: 330},
  weaving: {fiber: 40, food: 300},
  polished_axe: {stone: 90, wood: 45},
  granary: {food: 820, wood: 65, clay: 15},
  copper: {stone: 130, wood: 120, food: 640},
  bronze: {copper: 50, wood: 160},
  wheel: {wood: 660, copper: 35, food: 1350},
  writing: {clay: 110, food: 1600},
  sail: {fiber: 190, wood: 1050},
  ironworking: {stone: 170, copper: 110, food: 3000},
  plough: {iron: 70, wood: 95, food: 3650},
  alphabet: {clay: 230, food: 4700},
  coinage: {copper: 35, iron: 30, food: 5450},
  lighthouse: {stone: 860, wood: 430, food: 4500},
  aqueduct: {stone: 180, iron: 70, food: 6250},
}


/** La table de la section 10, telle que la donne tools/couts-ages-tardifs.mjs
 *  (convergée en 5 tours) sur master a0932d0. `--costs=3.72` la pose dans le
 *  simulateur. */
export const COSTS_372 = {
  techs: {
    plough: { cost: 1600, materials: { food: 3700, iron: 15, wood: 220, fiber: 25 } },
    concrete: { materials: { stone: 510, clay: 30, food: 3600 } },
    watermill: { materials: { wood: 950, food: 8250, iron: 15 } },
    glass: { materials: { wood: 890, clay: 85, copper: 25 } },
    roads: { materials: { stone: 1750, food: 11200, iron: 15 } },
    codex: { materials: { fiber: 130, food: 10800, clay: 25 } },
    horsecollar: { materials: { food: 20700, fiber: 120, iron: 20 } },
    threefield: { materials: { food: 43500, wood: 1400 } },
    windmill: { materials: { wood: 1700, stone: 1100, fiber: 30 } },
    clock: { materials: { iron: 25, clay: 45, copper: 20, wood: 370 } },
    press: { materials: { fiber: 100, food: 44700, iron: 15 } },
    caravel: { materials: { wood: 2000, fiber: 110, food: 46600 } },
    perspective: { materials: { clay: 110, wood: 1200, food: 56400 } },
    observatory: { materials: { stone: 1500, copper: 70, clay: 35 } },
    bank: { materials: { food: 89300, stone: 1450, fiber: 120, copper: 100 } },
    anatomy: { materials: { food: 138000, fiber: 130, iron: 30 } },
    steamengine: { materials: { wood: 2700, stone: 1450, iron: 65, copper: 50, food: 61300 } },
    railway: { materials: { wood: 6700, food: 139000, stone: 3700, iron: 80 } },
    gaslight: { materials: { stone: 6700, clay: 170, iron: 50 } },
    bessemer: { materials: { iron: 200, stone: 6050, clay: 110 } },
    telegraph: { materials: { wood: 13100, copper: 250, fiber: 350, food: 319000 } },
    electricity: { materials: { copper: 420, wood: 9650, iron: 190 } },
    automobile: { materials: { wood: 17300, iron: 460, fiber: 460 } },
    radio: { materials: { copper: 680, wood: 21300, clay: 220 } },
    flight: { materials: { wood: 54100, fiber: 2150, iron: 1950 } },
    penicillin: { materials: { food: 1730000, clay: 630 } },
    computer: { materials: { copper: 1200, stone: 16500, food: 1010000, iron: 540, wood: 9900 } },
    satellite: { materials: { iron: 1300, copper: 950, fiber: 1050 } },
    internet: { materials: { stone: 29900, copper: 950, food: 1420000 } },
    solar: { materials: { stone: 49100, copper: 1150, clay: 500 } },
    smartphone: { materials: { stone: 30200, clay: 1250, copper: 1450, iron: 990 } },
    ai: { materials: { copper: 2250, stone: 39700, fiber: 740, iron: 1000 } },
    storage: { materials: { copper: 2550, iron: 2350, clay: 1350 } },
    desal: { materials: { stone: 79500, food: 4020000, iron: 6000 } },
    crispr: { materials: { food: 9920000, fiber: 3700, copper: 2700 } },
    carbon: { materials: { stone: 102000, iron: 5800, wood: 71500, copper: 2100 } },
    quantum: { materials: { copper: 3900, iron: 3600, fiber: 590, clay: 460 } },
  },
  wonders: {
    trophee: { stone: 1300, iron: 50, copper: 180 },
    phare: { stone: 2900, wood: 2150, iron: 120 },
    cathedrale: { stone: 3250, wood: 3350, iron: 130 },
    dome: { stone: 3900, clay: 270, iron: 170 },
    tour: { iron: 450, stone: 23900, wood: 22200 },
    gratteciel: { iron: 4500, stone: 51800, copper: 2300 },
    fusee: { iron: 5400, copper: 3950, fiber: 4200 },
    fusion: { iron: 26600, copper: 13100, stone: 208000 },
  },
}
