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
