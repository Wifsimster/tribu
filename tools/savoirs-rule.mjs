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

export function migrate(game, meanRate) {
  if (game.save.insightReserve !== undefined) return
  const cheapest = Math.min(...game.available().map((t) => t.cost), Infinity)
  const keep = Math.max(Number.isFinite(cheapest) ? cheapest : 0, meanRate * TAU)
  const S = game.amount('insight')
  game.save.insightReserve = Math.max(0, S - keep)
  game.save.res.insight = Math.min(S, keep)
}

export const GAMMA = 0.8

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

export const WEIGHTS_372 = {
  plough: { food: 0.4, iron: 0.2, wood: 0.1, fiber: 0.1 },
  concrete: { stone: 0.4, clay: 0.2, food: 0.2 },
  watermill: { wood: 0.4, food: 0.3, iron: 0.1 },
  glass: { wood: 0.3, clay: 0.3, copper: 0.1 },
  roads: { stone: 0.5, food: 0.2, iron: 0.1 },
  codex: { fiber: 0.4, food: 0.2, clay: 0.1 },
  horsecollar: { food: 0.3, fiber: 0.3, iron: 0.1 },
  threefield: { food: 0.4, wood: 0.3 },
  windmill: { wood: 0.4, stone: 0.3, fiber: 0.1 },
  clock: { iron: 0.2, clay: 0.2, copper: 0.1, wood: 0.1 },
  press: { fiber: 0.3, food: 0.2, iron: 0.1 },
  caravel: { wood: 0.4, fiber: 0.3, food: 0.2 },
  perspective: { clay: 0.3, wood: 0.2, food: 0.2 },
  observatory: { stone: 0.3, copper: 0.2, clay: 0.1 },
  bank: { food: 0.2, stone: 0.2, fiber: 0.2, copper: 0.2 },
  anatomy: { food: 0.3, fiber: 0.2, iron: 0.1 },
  steamengine: { wood: 0.3, stone: 0.2, iron: 0.2, copper: 0.1, food: 0.1 },
  railway: { wood: 0.3, food: 0.2, stone: 0.2, iron: 0.2 },
  gaslight: { stone: 0.3, clay: 0.2, iron: 0.1 },
  bessemer: { iron: 0.3, stone: 0.2, clay: 0.1 },
  telegraph: { wood: 0.3, copper: 0.2, fiber: 0.2, food: 0.2 },
  electricity: { copper: 0.3, wood: 0.2, iron: 0.1 },
  automobile: { wood: 0.3, iron: 0.2, fiber: 0.2 },
  radio: { copper: 0.3, wood: 0.3, clay: 0.1 },
  flight: { wood: 0.3, fiber: 0.3, iron: 0.2 },
  penicillin: { food: 0.5, clay: 0.2 },
  computer: { copper: 0.3, stone: 0.2, food: 0.2, iron: 0.1, wood: 0.1 },
  satellite: { iron: 0.2, copper: 0.2, fiber: 0.2 },
  internet: { stone: 0.3, copper: 0.2, food: 0.2 },
  solar: { stone: 0.4, copper: 0.2, clay: 0.1 },
  smartphone: { stone: 0.2, clay: 0.2, copper: 0.2, iron: 0.1 },
  ai: { copper: 0.3, stone: 0.2, fiber: 0.1, iron: 0.1 },
  storage: { copper: 0.3, iron: 0.2, clay: 0.2 },
  desal: { stone: 0.3, food: 0.2, iron: 0.2 },
  crispr: { food: 0.4, fiber: 0.3, copper: 0.1 },
  carbon: { stone: 0.4, iron: 0.2, wood: 0.2, copper: 0.1 },
  quantum: { copper: 0.3, iron: 0.2, fiber: 0.1, clay: 0.1 },
}

export const PLOUGH_T = 12 * 60

export const INSIGHT_AGES = [4, 5, 6, 7, 8, 9, 10]
export const INSIGHT_T = 10.5 * 60

export const WONDER_DRAW = 0.6
export const WONDER_SHARE = 0.8
export const WONDER_TARGET = 0.83
export function wonderCost(def, made) {
  const out = {}
  for (const r of Object.keys(def.cost)) out[r] = nice3(WONDER_DRAW * (made[r] ?? 0))
  return out
}

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
    3: { stone: 1300, iron: 50, copper: 180 },
    4: { stone: 2900, wood: 2150, iron: 120 },
    5: { stone: 3250, wood: 3350, iron: 130 },
    6: { stone: 3900, clay: 270, iron: 170 },
    7: { iron: 450, stone: 23900, wood: 22200 },
    8: { iron: 4500, stone: 51800, copper: 2300 },
    9: { iron: 5400, copper: 3950, fiber: 4200 },
    10: { iron: 26600, copper: 13100, stone: 208000 },
  },
}

export const COSTS_3720 = {
  techs: {
    plough: { cost: 1600, materials: { food: 3700, iron: 15, wood: 220, fiber: 25 } },
    concrete: { cost: 6550, materials: { stone: 750, clay: 45, food: 5250 } },
    watermill: { cost: 7350, materials: { wood: 1250, food: 10700, iron: 15 } },
    glass: { cost: 9850, materials: { wood: 1250, clay: 120, copper: 35 } },
    roads: { cost: 10600, materials: { stone: 2200, food: 13800, iron: 20 } },
    codex: { cost: 14900, materials: { fiber: 190, food: 14700, clay: 40 } },
    horsecollar: { cost: 18200, materials: { food: 31600, fiber: 170, iron: 25 } },
    threefield: { cost: 21800, materials: { food: 59000, wood: 2150 } },
    windmill: { cost: 28500, materials: { wood: 2650, stone: 1750, fiber: 50 } },
    clock: { cost: 45100, materials: { iron: 55, clay: 90, copper: 45, wood: 780 } },
    press: { cost: 55800, materials: { fiber: 180, food: 86500, iron: 30 } },
    caravel: { cost: 79400, materials: { wood: 3800, fiber: 220, food: 111000 } },
    perspective: { cost: 62800, materials: { clay: 130, wood: 1500, food: 88200 } },
    observatory: { cost: 68800, materials: { stone: 2000, copper: 90, clay: 45 } },
    bank: { cost: 83500, materials: { food: 83600, stone: 1350, fiber: 120, copper: 95 } },
    anatomy: { cost: 128000, materials: { food: 222000, fiber: 210, iron: 55 } },
    steamengine: { cost: 155000, materials: { wood: 4150, stone: 2250, iron: 95, copper: 75, food: 104000 } },
    railway: { cost: 154000, materials: { wood: 8850, food: 205000, stone: 4900, iron: 110 } },
    gaslight: { cost: 215000, materials: { stone: 10300, clay: 250, iron: 75 } },
    bessemer: { cost: 226000, materials: { iron: 300, stone: 9100, clay: 170 } },
    telegraph: { cost: 247000, materials: { wood: 18000, copper: 350, fiber: 480, food: 375000 } },
    electricity: { cost: 338000, materials: { copper: 580, wood: 13500, iron: 270 } },
    automobile: { cost: 254000, materials: { wood: 15200, iron: 400, fiber: 400 } },
    radio: { cost: 543000, materials: { copper: 1400, wood: 34800, clay: 360 } },
    flight: { cost: 581000, materials: { wood: 42900, fiber: 1700, iron: 1550 } },
    penicillin: { cost: 393000, materials: { food: 1660000, clay: 520 } },
    computer: { cost: 532000, materials: { copper: 960, stone: 13400, food: 909000, iron: 440, wood: 8050 } },
    satellite: { cost: 896000, materials: { iron: 1500, copper: 1100, fiber: 1200 } },
    internet: { cost: 615000, materials: { stone: 23400, copper: 740, food: 949000 } },
    solar: { cost: 715000, materials: { stone: 30000, copper: 720, clay: 310 } },
    smartphone: { cost: 891000, materials: { stone: 21000, clay: 610, copper: 780, iron: 540 } },
    ai: { cost: 914000, materials: { copper: 1200, stone: 21500, fiber: 400, iron: 550 } },
    storage: { cost: 1230000, materials: { copper: 1250, iron: 1150, clay: 660 } },
    desal: { cost: 1250000, materials: { stone: 31500, food: 1490000, iron: 2400 } },
    crispr: { cost: 2230000, materials: { food: 5320000, fiber: 2100, copper: 1550 } },
    carbon: { cost: 4250000, materials: { stone: 75300, iron: 4250, wood: 52700, copper: 1550 } },
    quantum: { cost: 4690000, materials: { copper: 2850, iron: 2600, fiber: 430, clay: 330 } },
  },
  wonders: {
    0: { stone: 15, wood: 25 },
    1: { stone: 95, wood: 90 },
    2: { stone: 450, clay: 100, wood: 970 },
    3: { stone: 1600, iron: 55, copper: 260 },
    4: { stone: 4300, wood: 2950, iron: 160 },
    5: { stone: 5500, wood: 5750, iron: 220 },
    6: { stone: 6000, clay: 420, iron: 260 },
    7: { iron: 580, stone: 28000, wood: 29400 },
    8: { iron: 3600, stone: 54900, copper: 2600 },
    9: { iron: 4250, copper: 3100, fiber: 3300 },
    10: { iron: 9350, copper: 6800, stone: 107000 },
  },
}
