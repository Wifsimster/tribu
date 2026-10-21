// La réserve de savoir (docs/specs/equilibrage-savoirs.md, sections 5 et 6) :
// une absence verse r·τ·(1 − e^(−s/τ)) de savoir tout de suite, le reste va
// en réserve (plafonnée à 2 h de savoir) et rentre en jouant, au double du
// rythme. Les parties d'avant la règle passent une fois par la migration.
//   corepack pnpm test
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { Game, meanLightFactor } = await import('../src/game/sim.ts')
const { SAVE_KEY, emptySave, OFFLINE_INSIGHT_TAU, INSIGHT_RESERVE_HOURS } = await import('../src/game/state.ts')
const { TECHS } = await import('../src/game/content.ts')
const { encodeSave, decodeSave } = await import('../src/game/transfer.ts')

const NOW = 1_800_000_000_000
const PALEO = ['flint', 'fire', 'shelter', 'spear', 'lamp', 'cordage']
const MATERIALS = ['food', 'wood', 'stone', 'fiber', 'clay', 'copper', 'iron']

beforeEach(() => store.clear())

/** Une partie au Néolithique, lampe et cordage connus, chargée depuis sa
 *  sauvegarde (même instant : aucune absence créditée au chargement). */
function neolithic(res = { food: 400, wood: 30, stone: 30, insight: 50 }) {
  const s = emptySave(NOW)
  s.seed = 7
  s.age = 1
  s.techs = [...PALEO]
  s.seenFacts = [...PALEO]
  s.res = { ...res }
  s.totalPlaySeconds = 660
  store.set(SAVE_KEY, JSON.stringify(s))
  const g = new Game(NOW)
  g.tick(0.5, NOW)
  return g
}

/** Le taux de savoir moyen d'un tour, celui de la règle (lu sur un double).
 *  Depuis la 3.71.1, une absence compte la nourriture à la moyenne des quatre
 *  saisons (tests/absence-economie.test.mjs) : le double fait de même. */
function meanRate(g) {
  const twin = Object.create(Object.getPrototypeOf(g))
  Object.assign(twin, g, { rates: { ...g.rates }, seasonMean: true })
  return twin.meanInsightRate()
}

/** Ce que l'absence créditait avant la règle : tout au facteur moyen d'un tour. */
function oldCredit(g, seconds) {
  const twin = Object.create(Object.getPrototypeOf(g))
  Object.assign(twin, g, { rates: { ...g.rates }, seasonMean: true })
  twin.lightFactor = meanLightFactor(twin.nightFloor)
  twin.refreshRates()
  return Object.fromEntries(['insight', ...MATERIALS].map((r) => [r, twin.rates[r] * seconds]))
}

function absence(g, seconds) {
  const before = { ...g.save.res }
  const R0 = g.save.insightReserve
  g.creditAbsence(seconds)
  return {
    paid: g.amount('insight') - (before.insight ?? 0),
    reserve: g.save.insightReserve - R0,
    mat: Object.fromEntries(MATERIALS.map((r) => [r, g.amount(r) - (before[r] ?? 0)])),
  }
}

test('8 h d’absence au Néolithique : ~10 min de savoir tout de suite, réserve au plafond, matériaux inchangés', () => {
  const g = neolithic()
  const r = meanRate(g)
  const old = oldCredit(g, 28800)
  const got = absence(g, 28800)
  assert.ok(r > 0.2 && r < 0.6, `taux moyen ${r}`)
  assert.ok(got.paid <= r * OFFLINE_INSIGHT_TAU + 1, `versé ${got.paid} > r·τ ${r * OFFLINE_INSIGHT_TAU}`)
  assert.ok(got.paid >= r * OFFLINE_INSIGHT_TAU - 1, `versé ${got.paid}`)
  assert.ok(Math.abs(got.reserve - r * INSIGHT_RESERVE_HOURS * 3600) < 1, `réserve ${got.reserve}`)
  for (const m of MATERIALS)
    assert.ok(Math.abs(got.mat[m] - old[m]) < 1e-6 * Math.max(1, old[m]), `${m} : ${got.mat[m]} au lieu de ${old[m]}`)
  // Avant la règle, la même nuit versait ~37 fois plus de savoir.
  assert.ok(old.insight > 30 * got.paid, `avant ${old.insight}, maintenant ${got.paid}`)
})

test('5 min d’absence : au moins 78 % du savoir d’avant tout de suite, le reste en réserve sans perte', () => {
  const g = neolithic()
  const r = meanRate(g)
  const old = oldCredit(g, 300)
  const got = absence(g, 300)
  assert.ok(got.paid >= 0.78 * old.insight, `versé ${got.paid}, avant ${old.insight}`)
  const expected = r * OFFLINE_INSIGHT_TAU * (1 - Math.exp(-300 / OFFLINE_INSIGHT_TAU))
  assert.ok(Math.abs(got.paid - expected) < 1e-6)
  assert.ok(Math.abs(got.paid + got.reserve - r * 300) < 1e-6, 'versé + réserve = tout le savoir de l’absence')
})

test('1 h d’absence : sous le plafond, versé + réserve = tout le savoir produit', () => {
  const g = neolithic()
  const r = meanRate(g)
  const got = absence(g, 3600)
  assert.ok(Math.abs(got.paid + got.reserve - r * 3600) < 1e-6)
  assert.ok(got.reserve > got.paid, `réserve ${got.reserve}, versé ${got.paid}`)
})

test('le plafond tient sur plusieurs absences : deux nuits ne font pas plus de 2 h de réserve', () => {
  const g = neolithic()
  const r = meanRate(g)
  absence(g, 28800)
  const second = absence(g, 28800)
  assert.ok(Math.abs(g.save.insightReserve - r * 7200) < 1, `réserve ${g.save.insightReserve}`)
  assert.ok(second.reserve < 1, `la 2ᵉ nuit ajoute ${second.reserve} à une réserve pleine`)
})

test('l’absence annonce sa réserve au toast', () => {
  const g = neolithic()
  const events = []
  g.on((e) => events.push(e))
  g.creditAbsence(3600)
  const off = events.find((e) => e.type === 'offline')
  assert.ok(off, 'événement offline')
  assert.ok(Math.abs(off.reserve - g.save.insightReserve) < 1e-9)
  assert.ok(off.gained.insight > 0 && off.gained.insight < off.reserve)
})

test('la réserve se vide en jouant : savoir ×2, la réserve baisse d’autant', () => {
  const g = neolithic()
  g.save.insightReserve = 500
  const before = g.amount('insight')
  g.tick(0.5, NOW)
  const rate = g.rates.insight
  assert.ok(rate > 0)
  assert.ok(Math.abs(g.amount('insight') - before - 2 * rate * 0.5) < 1e-9, 'savoir gagné = 2 · taux · dt')
  assert.ok(Math.abs(500 - g.save.insightReserve - rate * 0.5) < 1e-9, 'réserve baissée de taux · dt')

  // Une réserve plus petite que le pas passe en entier, sans devenir négative.
  g.save.insightReserve = 0.01
  const b2 = g.amount('insight')
  g.tick(0.5, NOW)
  assert.equal(g.save.insightReserve, 0)
  assert.ok(Math.abs(g.amount('insight') - b2 - (g.rates.insight * 0.5 + 0.01)) < 1e-9)

  // En expédition, le camp ne produit rien : la réserve attend.
  g.save.insightReserve = 300
  g.save.expedition = { remaining: 100, total: 100 }
  g.tick(0.5, NOW)
  assert.equal(g.save.insightReserve, 300)
})

/** La partie de l'humain (prod, 3.69.0) : Néolithique 0/4, 6 savoirs, 6 710
 *  de savoir. Sauvegarde d'avant la règle : pas de champ `insightReserve`. */
function humanSave() {
  const s = emptySave(NOW)
  s.seed = 7
  s.age = 1
  s.techs = [...PALEO]
  s.seenFacts = [...PALEO]
  s.res = { food: 16100, wood: 3170, stone: 3000, fiber: 9.3, insight: 6710 }
  s.totalPlaySeconds = 3600
  delete s.insightReserve
  return s
}

// 3.71.0 : 191 + 6 519. La 3.71.1 tire 0,07 de savoir par matériau au lieu
// de 0,05 (voir INSIGHT_PER_MATERIAL) : dix minutes de savoir pèsent 217.
test('migration de la partie de l’humain : 6 710 → 217 en stock + 6 493 en réserve, une seule fois', () => {
  store.set(SAVE_KEY, JSON.stringify(humanSave()))
  const g = new Game(NOW)
  const events = []
  g.on((e) => events.push(e))
  const stock = g.amount('insight')
  const reserve = g.save.insightReserve
  assert.ok(Math.abs(stock - 217) <= 1, `stock ${stock}`)
  assert.ok(Math.abs(reserve - 6493) <= 1, `réserve ${reserve}`)
  assert.ok(Math.abs(stock + reserve - 6710) < 1e-9, 'aucun savoir retiré')
  assert.equal(g.save.techs.length, 6)
  assert.equal(g.save.age, 1)
  for (const r of ['food', 'wood', 'stone', 'fiber']) assert.equal(g.amount(r), humanSave().res[r], `${r} intact`)
  // Le stock paie l'Agriculture (110), pas l'Agriculture ET la Poterie (150).
  assert.ok(stock >= 110 && stock < 110 + 150, `stock ${stock}`)
  const mig = events.find((e) => e.type === 'reserveMigrated')
  assert.ok(mig && Math.abs(mig.reserve - reserve) < 1e-9, 'le joueur est prévenu')

  // Recharger ne remigre pas : stock et réserve restent ce qu'ils sont.
  g.flush(NOW)
  const g2 = new Game(NOW)
  const again = []
  g2.on((e) => again.push(e))
  assert.equal(g2.amount('insight'), stock)
  assert.equal(g2.save.insightReserve, reserve)
  assert.ok(!again.some((e) => e.type === 'reserveMigrated'))
})

test('migration d’un petit stock : rien ne part en réserve', () => {
  const s = humanSave()
  s.res.insight = 80
  store.set(SAVE_KEY, JSON.stringify(s))
  const g = new Game(NOW)
  assert.equal(g.amount('insight'), 80)
  assert.equal(g.save.insightReserve, 0)
})

test('migration avant le crédit de l’absence : le savoir de la nuit suit la nouvelle règle', () => {
  const s = humanSave()
  s.t = NOW - 8 * 3600 * 1000
  store.set(SAVE_KEY, JSON.stringify(s))
  const g = new Game(NOW)
  // Stock migré (~217) + ~10 min de savoir, pas 6 710 + 8 h.
  assert.ok(g.amount('insight') < 217 + 300, `stock ${g.amount('insight')}`)
  // La réserve migrée n'a pas de plafond, la nuit n'y ajoute rien.
  assert.ok(Math.abs(g.save.insightReserve - 6493) <= 1, `réserve ${g.save.insightReserve}`)
})

test('une partie neuve a déjà sa réserve (vide) : pas de migration', () => {
  const g = new Game(NOW)
  assert.equal(g.save.insightReserve, 0)
  g.flush(NOW)
  assert.equal(JSON.parse(store.get(SAVE_KEY)).insightReserve, 0)
})

test('réserve illisible dans la sauvegarde : relue à 0, sans migration', () => {
  for (const bad of ['beaucoup', -40, null]) {
    const s = humanSave()
    s.insightReserve = bad
    store.set(SAVE_KEY, JSON.stringify(s))
    const g = new Game(NOW)
    assert.equal(g.save.insightReserve, 0, `réserve ${JSON.stringify(bad)}`)
    assert.equal(g.amount('insight'), 6710, 'stock intact : la sauvegarde avait le champ')
  }
})

test('l’Exode remet la réserve à zéro, avec le stock de savoir', () => {
  const g = neolithic()
  g.save.techs = TECHS.map((t) => t.id)
  g.save.insightReserve = 1234
  g.save.res.insight = 99
  assert.ok(g.exodus())
  assert.equal(g.save.insightReserve, 0)
  assert.equal(g.amount('insight'), 0)
})

test('le transfert de tribu emporte la réserve', async () => {
  const g = neolithic()
  g.save.insightReserve = 777.5
  const code = await encodeSave(g.save)
  const back = await decodeSave(code)
  assert.ok(back.ok)
  assert.equal(back.save.insightReserve, 777.5)
  store.clear()
  store.set(SAVE_KEY, JSON.stringify({ ...back.save, t: NOW }))
  const g2 = new Game(NOW)
  assert.equal(g2.save.insightReserve, 777.5)
  assert.equal(g2.amount('insight'), g.amount('insight'), 'pas de migration sur une sauvegarde transférée')
})

test('coûts en matériaux des âges 0 à 3 : ceux de la table 9.3 (section 9)', async () => {
  const { PROPORTIONAL } = await import('../tools/savoirs-rule.mjs')
  const early = TECHS.filter((t) => t.age <= 3)
  assert.equal(early.length, Object.keys(PROPORTIONAL).length)
  for (const t of early) assert.deepEqual(t.materials, PROPORTIONAL[t.id], t.id)
})
