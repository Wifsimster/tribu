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
export function proportionalCost(tech, seen) {
  const T = tech.cost / seen.insight
  const w = WEIGHTS[tech.id] ?? defaultWeights(tech, seen.rates)
  const out = {}
  for (const [r, k] of Object.entries(w)) if (seen.rates[r] > 0) out[r] = nice(GAMMA * k * T * seen.rates[r])
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
