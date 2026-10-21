// 3.71.1 — l'absence et l'économie : les bugs de la passe QA/design du
// 2026-10-21, un test par point (voir CHANGELOG 3.71.1).
//   corepack pnpm test
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { Game, meanLightFactor, sunHeightAt } = await import('../src/game/sim.ts')
const { SAVE_KEY, emptySave } = await import('../src/game/state.ts')
const C = await import('../src/game/content.ts')
const { TECHS, TOOLS, TECH_BY_ID, TOOL_BY_ID, DAY_SECONDS, SEASON_DAYS, SEASONS, WONDER_BY_AGE, DESTINATION_BY_ID } = C

const NOW = 1_800_000_000_000
const MATERIALS = ['food', 'wood', 'stone', 'fiber', 'clay', 'copper', 'iron']
const realRandom = Math.random

beforeEach(() => {
  store.clear()
  Math.random = realRandom
})

/** Une tribu à l'entrée de l'âge `age` : tous les savoirs et outils des âges
 *  d'avant (`all` : ceux de l'âge aussi), ni événement ni marchand en vue. */
function gameAt(age, { all = false, tools, drop = [], patch = {} } = {}) {
  store.clear()
  const s = emptySave(NOW)
  s.seed = 7
  s.age = age
  s.techs = TECHS.filter((t) => t.age < age && !drop.includes(t.id)).map((t) => t.id)
  s.tools = tools ?? TOOLS.filter((t) => t.age < age).map((t) => t.id)
  s.eventIn = 1e9
  s.caravan.nextIn = 1e9
  Object.assign(s, patch)
  store.set(SAVE_KEY, JSON.stringify(s))
  const g = new Game(NOW)
  assert.equal(g.save.age, age, 'âge stable au chargement')
  // Les savoirs de l'âge s'ajoutent après coup : chargés d'emblée, ils
  // ouvriraient l'âge suivant.
  if (all) {
    g.save.techs.push(...TECHS.filter((t) => t.age === age && !drop.includes(t.id)).map((t) => t.id))
    g.recompute()
  }
  return g
}

const materialSum = (g) => MATERIALS.reduce((a, r) => a + g.rates[r], 0)

// ── 1. Le savoir des matériaux ne compte encourager, lumière et legs qu'une fois
test('M1 : encourager double le savoir, la nuit le réduit d’autant, cinq Exodes font +40 %', () => {
  const g = gameAt(6)
  g.lightFactor = 1
  g.refreshRates()
  const base = g.rates.insight
  g.encourageLeft = 15
  g.refreshRates()
  assert.ok(Math.abs(g.rates.insight / base - 2) < 1e-12, `encourager ×${g.rates.insight / base}`)
  g.encourageLeft = 0
  g.lightFactor = 0.5
  g.refreshRates()
  assert.ok(Math.abs(g.rates.insight / base - 0.5) < 1e-12, `lumière 0,5 → ×${g.rates.insight / base}`)
  const h = gameAt(6, { patch: { legacy: 5 } })
  h.lightFactor = 1
  h.refreshRates()
  assert.ok(Math.abs(h.rates.insight / base - 1.4) < 1e-12, `5 Exodes → ×${h.rates.insight / base}`)
})

test('M1 : sur un cycle jour-nuit entier, le savoir gagné est celui d’un tour à parts égales (neutralité 3.70)', () => {
  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  let even = 0
  for (let i = 0; i < 7200; i++) even += smooth(-0.06, 0.2, Math.sin(((i + 0.5) / 7200) * Math.PI * 2))
  even /= 7200
  for (const age of [0, 2, 5]) {
    const g = gameAt(age)
    g.lightFactor = 1
    g.refreshRates()
    const full = g.rates.insight
    const floor = g.nightFloor
    const i0 = g.amount('insight')
    for (let i = 0; i < DAY_SECONDS / 0.25; i++) g.tick(0.25, NOW)
    const got = g.amount('insight') - i0
    const expected = full * DAY_SECONDS * (floor + (1 - floor) * even)
    assert.ok(Math.abs(got / expected - 1) < 1e-3, `âge ${age} : ${got} au lieu de ${expected}`)
  }
})

// ── 2. Encourager au départ ne double pas l'absence
test('M2 : encourager juste avant de partir ne change rien à l’absence', () => {
  const gains = []
  for (const enc of [false, true]) {
    const g = gameAt(3)
    if (enc) assert.ok(g.encourage())
    const before = { food: g.amount('food'), wood: g.amount('wood'), insight: g.amount('insight') + g.save.insightReserve }
    g.creditAbsence(8 * 3600)
    gains.push({
      food: g.amount('food') - before.food,
      wood: g.amount('wood') - before.wood,
      insight: g.amount('insight') + g.save.insightReserve - before.insight,
    })
    assert.equal(g.encourageLeft, 0, 'le geste est épuisé')
    assert.equal(g.encourageCooldown, 0, 'et prêt à resservir')
  }
  for (const k of ['food', 'wood', 'insight'])
    assert.ok(Math.abs(gains[1][k] - gains[0][k]) < 1e-6 * gains[0][k], `${k} : ${gains[1][k]} contre ${gains[0][k]}`)
})

// ── 3. L'écart vu par la boucle de jeu est crédité, une seule fois
test('M3 : un écart de 2 min est crédité et la sauvegarde datée du retour (pas de double crédit au rechargement)', () => {
  const g = gameAt(2)
  const food0 = g.amount('food')
  const events = []
  g.on((e) => events.push(e))
  const back = NOW + 120_000
  g.creditGap(120, back)
  assert.ok(g.amount('food') > food0 + 1, 'nourriture créditée')
  assert.ok(events.some((e) => e.type === 'offline' && e.seconds === 120), 'le retour est annoncé')
  assert.equal(JSON.parse(store.get(SAVE_KEY)).t, back, 'sauvegarde réécrite au retour')
  const food1 = g.amount('food')
  const reload = new Game(back)
  assert.equal(reload.amount('food'), food1, 'le rechargement ne recrédite pas l’écart')
  // Les petits à-coups de la boucle ne sont pas des absences.
  g.creditGap(4, back + 4000)
  assert.equal(g.amount('food'), food1)
})

// ── 4. La Merveille avance pendant l'absence, et attend le colon parti
test('Merveille : 8 h d’absence font avancer le chantier au débit du jeu, sans passer sous le plancher', () => {
  const g = gameAt(3, { patch: { res: { food: 1e5, wood: 1e5, stone: 1e5, fiber: 1e4, clay: 1e4, copper: 2e3, iron: 50, insight: 0 } } })
  assert.ok(g.startWonder())
  const def = WONDER_BY_AGE.get(3)
  const paid0 = { ...g.save.wonder.paid }
  const res0 = { ...g.save.res }
  g.creditAbsence(8 * 3600)
  const w = g.save.wonder ?? { paid: Object.fromEntries(Object.entries(def.cost)) }
  const floor = 50 + 3 * 30
  let advanced = 0
  for (const [id, total] of Object.entries(def.cost)) {
    const paid = w.paid[id] ?? 0
    assert.ok(paid <= total + 1e-9, `${id} payé ${paid} > ${total}`)
    if (paid > (paid0[id] ?? 0)) advanced++
    // Ce qui est versé ne dépasse jamais ce qui était là ou a été produit.
    assert.ok(g.amount(id) >= Math.min(floor, res0[id] ?? 0) - 1e-6, `${id} sous le plancher : ${g.amount(id)}`)
  }
  assert.ok(advanced >= 2, `le chantier a avancé sur ${advanced} matériaux`)
  // Le fer manque (50 < plancher) : rien n'est pris dessus.
  if (def.cost.iron) assert.equal(w.paid.iron ?? 0, 0)
})

test('Merveille : le chantier s’achève pendant l’absence si l’île le peut, et le dit au retour', () => {
  const def = WONDER_BY_AGE.get(2)
  const g = gameAt(2, { all: false, patch: { res: { food: 1e7, wood: 1e7, stone: 1e7, fiber: 1e7, clay: 1e7, copper: 1e7, insight: 0 } } })
  const events = []
  g.on((e) => events.push(e))
  assert.ok(g.startWonder())
  g.creditAbsence(8 * 3600)
  assert.ok(g.save.wonders.includes(def.age), 'Merveille achevée')
  assert.equal(g.save.wonder, null)
  assert.ok(events.some((e) => e.type === 'wonderDone'))
})

test('Merveille : en expédition, le chantier ne prélève rien', () => {
  const g = gameAt(3, { patch: { res: { food: 1e6, wood: 1e6, stone: 1e6, fiber: 1e5, clay: 1e5, copper: 1e5, iron: 1e5, insight: 0 } } })
  assert.ok(g.startWonder())
  g.tick(1, NOW)
  g.save.expedition = { remaining: 500, total: 500, dest: 'cote' }
  g.refreshRates()
  const paid = JSON.stringify(g.save.wonder.paid)
  const res = JSON.stringify(g.save.res)
  for (let i = 0; i < 100; i++) g.tick(0.5, NOW)
  assert.equal(JSON.stringify(g.save.wonder.paid), paid)
  assert.equal(JSON.stringify(g.save.res), res)
  const d = g.wonderDetail()
  assert.ok(d.lines.every((l) => l.flow === 0) && d.eta === Infinity, 'le détail dit « en pause »')
})

// ── 5. La saison de l'absence : la moyenne des quatre
// Au Néolithique : pas encore de marchand pour troquer la nourriture du retour.
test('Saison : une absence au cœur de l’été ou de l’hiver rapporte autant, la moyenne des quatre saisons', () => {
  const season = DAY_SECONDS * SEASON_DAYS
  const got = {}
  for (const [name, idx] of [['été', 1], ['hiver', 3]]) {
    const g = gameAt(1, { patch: { totalPlaySeconds: season * idx + 10 } })
    const f0 = g.amount('food')
    g.creditAbsence(8 * 3600)
    got[name] = g.amount('food') - f0
    // La saison du retour reste celle du départ : seul le crédit change.
    assert.equal(g.season.id, idx)
  }
  assert.ok(Math.abs(got.été / got.hiver - 1) < 1e-9, `été ${got.été}, hiver ${got.hiver}`)
  // L'automne vaut ×1 : le taux du retour (lumière moyenne) × la moyenne
  // des quatre saisons.
  const g = gameAt(1, { patch: { totalPlaySeconds: season * 2 + 10 } })
  const f0 = g.amount('food')
  g.creditAbsence(8 * 3600)
  assert.ok(!g.knows('granary'))
  const mean = SEASONS.reduce((a, s) => a + s.food, 0) / 4
  const expected = g.rates.food * 8 * 3600 * mean
  assert.ok(Math.abs((g.amount('food') - f0) / expected - 1) < 1e-9, `${g.amount('food') - f0} au lieu de ${expected}`)
  assert.ok(Math.abs(got.été / expected - 1) < 1e-9)
})

// ── 6. Le savoir des expéditions suit le savoir du camp
test('M5 : vers la côte, le savoir rapporté vaut 1,3 fois celui du camp sur la même durée, à tous les âges', () => {
  Math.random = () => 0.99 // ni revers, ni trouvaille
  for (let age = 2; age <= 10; age++) {
    const g = gameAt(age)
    g.lightFactor = meanLightFactor(g.nightFloor)
    g.refreshRates()
    const camp = g.rates.insight
    g.save.res.food = 1e12
    assert.ok(g.startExpedition('cote'), `départ âge ${age}`)
    const d = g.save.expedition.total
    const i0 = g.amount('insight')
    g.finishExpedition()
    const ratio = (g.amount('insight') - i0) / (camp * d)
    assert.ok(Math.abs(ratio - 1.3) < 0.01, `âge ${age} : ×${ratio.toFixed(3)}`)
  }
  // L'îlot : la même règle, au tempérament de la destination.
  const g = gameAt(1)
  g.lightFactor = meanLightFactor(g.nightFloor)
  g.refreshRates()
  const camp = g.rates.insight
  g.save.res.food = 1e9
  assert.ok(g.startExpedition('ilot'))
  const d = g.save.expedition.total
  const i0 = g.amount('insight')
  g.finishExpedition()
  const ilot = DESTINATION_BY_ID.get('ilot')
  const cote = DESTINATION_BY_ID.get('cote')
  const want = (1.3 * (ilot.lootK / ilot.durationK)) / (cote.lootK / cote.durationK)
  assert.ok(Math.abs((g.amount('insight') - i0) / (camp * d) - want) < 0.02)
})

// ── 7. Les récompenses fixes suivent la production après l'âge du bronze
test('Récompenses fixes : inchangées aux âges 0 à 2, jamais dérisoires ensuite', () => {
  for (let age = 0; age <= 2; age++) {
    const g = gameAt(age)
    const k = 1 + age
    assert.deepEqual(g.wreckLoot(), { wood: 40 * k, insight: 8 * k }, `épave âge ${age}`)
    assert.deepEqual(g.outpostLoot(), { food: 18 * k, wood: 10 * k, insight: 5 * k }, `comptoir âge ${age}`)
  }
  for (let age = 3; age <= 10; age++) {
    const g = gameAt(age)
    const insight = g.campMeanRates().insight
    const wreck = g.wreckLoot()
    const tribute = g.outpostLoot()
    assert.ok(wreck.insight >= 14 * insight - 1, `épave âge ${age} : ${wreck.insight} pour ${insight}/s`)
    assert.ok(tribute.insight >= 9 * insight - 1, `comptoir âge ${age}`)
    assert.ok(wreck.wood >= 40 * (1 + age) && tribute.food >= 18 * (1 + age), 'jamais moins qu’avant')
  }
  // À l'âge 10, l'épave vaut 14 s de savoir au lieu de ~0,1 s.
  const g = gameAt(10, { all: true })
  assert.ok(g.wreckLoot().insight > 50 * 88, `épave âge 10 : ${g.wreckLoot().insight}`)
})

test('Récompenses fixes : le savoir du troc suit la production après l’âge du bronze', () => {
  const insightOfTrade = (age) => {
    const g = gameAt(age, { patch: { res: { food: 5000, wood: 5000, stone: 100, insight: 0 } } })
    const i0 = g.amount('insight')
    g.doTrade(1, true)
    return { got: g.amount('insight') - i0, rate: g.campMeanRates().insight, bonus: g.tradeBonus }
  }
  for (const age of [2]) assert.equal(insightOfTrade(age).got, 6 + age * 8)
  for (const age of [6, 9]) {
    const { got, rate, bonus } = insightOfTrade(age)
    assert.ok(got >= Math.round(13 * rate * bonus) - 1, `âge ${age} : ${got} pour ${rate}/s`)
  }
})

// ── 8 et 11. Le marchand propose le plus ancien outil qui manque, le joueur décide
/** Midi : le marchand n'accoste pas de nuit, et une visite tient dans le jour. */
const NOON = (() => {
  let best = 0
  for (let t = 0; t < DAY_SECONDS; t++) if (sunHeightAt(t) > sunHeightAt(best)) best = t
  return best
})()
function merchantGame(res, tools = []) {
  const g = gameAt(3, { tools, patch: { res: { insight: 0, ...res }, totalPlaySeconds: DAY_SECONDS * 4 + NOON - 30 } })
  g.save.caravan.nextIn = 0
  return g
}
/** Une visite entière du marchand, jouée en direct. */
function visit(g) {
  const events = []
  g.on((e) => events.push(e))
  for (let i = 0; i < 200 && !events.some((e) => e.type === 'caravanLeave'); i++) g.tick(0.5, NOW)
  return events
}
const RICH = { food: 5000, wood: 5000, stone: 5000, fiber: 800, clay: 800, copper: 500 }

test('M7 : le marchand propose sans rien prendre ; accepter paie et installe l’outil', () => {
  const g = merchantGame(RICH)
  const events = []
  g.on((e) => events.push(e))
  for (let i = 0; i < 80 && !g.toolOffer; i++) g.tick(0.5, NOW)
  assert.equal(g.toolOffer?.id, 'etain', 'le plus ancien qui manque')
  assert.ok(events.some((e) => e.type === 'caravanOffer' && e.def.id === 'etain'))
  assert.deepEqual(g.save.tools, [], 'rien n’est acheté sans le joueur')
  const copper = g.amount('copper')
  assert.ok(g.acceptTool())
  assert.deepEqual(g.save.tools, ['etain'])
  assert.equal(g.amount('copper'), copper - TOOL_BY_ID.get('etain').price.copper)
  assert.ok(events.some((e) => e.type === 'caravanTool' && e.def.id === 'etain'))
  assert.equal(g.toolOffer, null)
  assert.equal(g.acceptTool(), false, 'on ne paie pas deux fois')
})

test('M7 : refuser ne coûte rien, et le même outil revient au passage suivant', () => {
  const g = merchantGame(RICH)
  let ev = visit(g)
  const offer = ev.find((e) => e.type === 'caravanOffer')
  assert.equal(offer?.def.id, 'etain')
  // Sans réponse, la barque repart avec : l'offre est retirée.
  assert.ok(ev.some((e) => e.type === 'caravanOfferGone'))
  assert.equal(g.toolOffer, null)
  assert.deepEqual(g.save.tools, [])
  g.save.caravan.nextIn = 0
  g.save.totalPlaySeconds = DAY_SECONDS * 6 + NOON - 30
  ev = []
  g.on((e) => ev.push(e))
  for (let i = 0; i < 80 && !g.toolOffer; i++) g.tick(0.5, NOW)
  assert.equal(g.toolOffer?.id, 'etain')
  g.declineTool()
  assert.equal(g.toolOffer, null)
  assert.equal(g.acceptTool(), false)
  assert.deepEqual(g.save.tools, [])
})

test('M7 : pendant l’absence, le marchand troque mais ne vend aucun outil', () => {
  const g = merchantGame(RICH)
  g.creditAbsence(8 * 3600)
  assert.deepEqual(g.save.tools, [])
  assert.equal(g.toolOffer, null)
})

test('Plus ancien qui manque : l’étain inabordable, le marchand attend au lieu de sortir le sel', () => {
  // Assez pour le sel (âge 3), pas de cuivre pour l'étain (âge 2).
  const g = merchantGame({ food: 5000, wood: 5000, stone: 5000, fiber: 800, clay: 800, copper: 0 })
  const ev = visit(g)
  assert.ok(!ev.some((e) => e.type === 'caravanOffer'), 'aucune offre')
  assert.deepEqual(g.save.tools, [])
})

test('Outils : terres rares et caoutchouc valent enfin leur prix', () => {
  const prev = (age) => TOOLS.filter((t) => t.age < age).map((t) => t.id)
  for (const all of [false, true]) {
    const a = gameAt(10, { all })
    const b = gameAt(10, { all, tools: [...prev(10), 'terresrares'] })
    const gain = b.rates.insight / a.rates.insight - 1
    assert.ok(gain >= 0.05 && gain <= 0.1, `terres rares : +${(gain * 100).toFixed(2)} %`)
    const c = gameAt(7, { all })
    const d = gameAt(7, { all, tools: [...prev(7), 'caoutchouc'] })
    const g2 = d.rates.food / c.rates.food - 1
    assert.ok(g2 >= 0.05 && g2 <= 0.11, `caoutchouc : +${(g2 * 100).toFixed(2)} %`)
  }
  assert.match(TOOL_BY_ID.get('terresrares').boon, /8 %/)
  assert.match(TOOL_BY_ID.get('caoutchouc').boon, /\+6 à 10 %/)
})

// ── 9. Les effets annoncés sont les effets réels
const SPEED_TECHS = TECHS.filter((t) => t.effects.some((e) => e.kind === 'expeditionSpeed'))

test('Vitesse : chaque savoir de vitesse divise la durée par son facteur, à son âge', () => {
  assert.ok(SPEED_TECHS.length >= 10)
  for (const t of SPEED_TECHS) {
    const mult = t.effects.find((e) => e.kind === 'expeditionSpeed').mult
    const own = TECHS.filter((x) => x.age === t.age && x.id !== t.id).map((x) => x.id)
    const without = gameAt(t.age, { all: true, drop: [t.id] })
    const withIt = gameAt(t.age, { all: true })
    for (const dest of ['ilot', 'cote', 'large']) {
      const d0 = without.expeditionDuration(dest)
      const d1 = withIt.expeditionDuration(dest)
      if (d0 / mult < 45) continue // plancher de 45 s
      assert.ok(Math.abs(d0 / d1 - mult) < 1e-9, `${t.id} vers ${dest} : ÷${(d0 / d1).toFixed(3)} au lieu de ÷${mult}`)
    }
    void own
  }
})

test('Gouvernail : les expéditions raccourcissent de près d’un quart, comme il l’annonce', () => {
  const tools = TOOLS.filter((t) => t.age < 5).map((t) => t.id)
  const a = gameAt(5, { all: true, tools })
  const b = gameAt(5, { all: true, tools: [...tools, 'gouvernail'] })
  const cut = 1 - b.expeditionDuration('cote') / a.expeditionDuration('cote')
  assert.ok(Math.abs(cut - (1 - 1 / 1.3)) < 1e-9, `−${(cut * 100).toFixed(1)} %`)
  assert.match(TOOL_BY_ID.get('gouvernail').boon, /quart/)
})

test('Vitesse : en fin d’arbre, les durées restent à ±20 % de la 3.71', () => {
  const old = (g, dest) =>
    Math.max(45, (90 + g.save.age * 45) * (0.45 + 0.55 / g.expeditionSpeed) * DESTINATION_BY_ID.get(dest).durationK)
  const end = gameAt(10, { all: true, tools: TOOLS.map((t) => t.id) })
  // Avec en plus quatre terres de vitesse : le pire cas raisonnable.
  const lands = gameAt(10, {
    all: true,
    tools: TOOLS.map((t) => t.id),
    patch: { land: [0, 4, 8, 12].map((q) => ({ kind: 'crique', q, r: -12 })) },
  })
  for (const dest of ['ilot', 'cote', 'large', 'arriere', 'monde']) {
    for (const g of [end, lands]) {
      const ratio = g.expeditionDuration(dest) / old(end, dest)
      assert.ok(ratio > 0.8 && ratio < 1.2, `${dest} : ×${ratio.toFixed(3)}`)
    }
  }
})

test('IA : son effet sur le savoir est réel, +10 % en plus de son apport', () => {
  const withAi = gameAt(10, { all: true })
  const noAi = gameAt(10, { all: true, drop: ['ai'] })
  withAi.lightFactor = noAi.lightFactor = 1
  noAi.insightAdd += 220
  noAi.refreshRates()
  withAi.refreshRates()
  assert.ok(Math.abs(withAi.rates.insight / noAi.rates.insight - 1.1) < 1e-9, `×${withAi.rates.insight / noAi.rates.insight}`)
  assert.ok(TECH_BY_ID.get('ai').effects.some((e) => e.kind === 'gatherRate' && e.resource === 'insight' && e.mult > 1))
})

// ── 10. L'Exode garde ce qui appartient à la tribu
test('Exode : hauts faits et nom du village gardés, pas de « Première vitrine » rejouée, réserve à zéro', () => {
  const g = gameAt(10, {
    all: true,
    patch: {
      feats: ['etincelle', 'bronze', 'relique', 'sage'],
      relics: ['venus'],
      village: 'Mon village',
      insightReserve: 5000,
    },
  })
  assert.ok(g.exodus())
  const events = []
  g.on((e) => events.push(e))
  for (let i = 0; i < 4; i++) g.tick(0.5, NOW)
  assert.deepEqual(g.save.feats.slice(0, 4), ['etincelle', 'bronze', 'relique', 'sage'])
  assert.ok(g.save.feats.includes('exode'), 'le haut fait de l’Exode s’ajoute')
  assert.equal(g.save.village, 'Mon village')
  assert.equal(g.save.insightReserve, 0)
  const feats = events.filter((e) => e.type === 'feat').map((e) => e.id)
  assert.deepEqual(feats, ['exode'], `hauts faits annoncés : ${feats}`)
})

// ── Sauvegardes : une partie 3.71 se recharge sans perte
test('Sauvegarde 3.71 (âge 10, neuf outils, réserve, chantier) : rechargée sans rien perdre', async () => {
  const { readFileSync } = await import('node:fs')
  const s = JSON.parse(readFileSync(new URL('../tools/saves/age10.json', import.meta.url), 'utf8'))
  // Les champs de la 3.71 : la réserve de savoir, un chantier, un nom de village.
  Object.assign(s, {
    t: NOW,
    insightReserve: 4321.5,
    wonder: { age: 10, paid: { iron: 1234, copper: 99 } },
    village: 'Les Grèves',
    feats: ['etincelle', 'bronze'],
  })
  store.clear()
  store.set(SAVE_KEY, JSON.stringify(s))
  const g = new Game(NOW)
  for (const k of ['res', 'techs', 'tools', 'relics', 'land', 'layout', 'wonder', 'wonders', 'village', 'feats', 'insightReserve', 'age', 'legacy'])
    assert.deepEqual(g.save[k], s[k], k)
  assert.equal(g.toolOffer, null)
  g.flush(NOW)
  const again = new Game(NOW)
  for (const k of ['res', 'techs', 'tools', 'insightReserve', 'wonder']) assert.deepEqual(again.save[k], s[k], `${k} au 2ᵉ chargement`)
})
