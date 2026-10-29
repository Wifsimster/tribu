const warn = console.warn
console.warn = (...a) => {
  if (!String(a[0]).includes('indisponible')) warn(...a)
}

export const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { Game } = await import('../src/game/sim.ts')
const { SAVE_KEY } = await import('../src/game/state.ts')
const { TECHS, TOOLS, RELICS, livingBuildings } = await import('../src/game/content.ts')
const { raiseWorld, planOf } = await import('../src/render/plan.ts')
const { Fauna } = await import('../src/render/fauna.ts')

export const NOW = 1_800_000_000_000
const random = Math.random
export function seeded(seed) {
  let a = seed >>> 0
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function load(game) {
  const s = game.save
  const stageOf = (v) => (v >= 0.75 ? 3 : v >= 0.5 ? 2 : v >= 0.25 ? 1 : 0)
  const ws = s.wonder ? game.wonderState() : null
  const wonder = s.wonder
    ? { age: s.wonder.age, stage: ws ? stageOf(ws.progress) : 0 }
    : s.wonders.length > 0
      ? { age: s.wonders[s.wonders.length - 1], stage: 4 }
      : null
  const raised = raiseWorld(s, {
    electric: game.knows('electricity'),
    yule: false,
    rates: game.rates,
    wonder,
    relics: s.relics,
  })
  const { island, village } = raised
  s.layoutV = raised.layoutV
  const fauna = new Fauna(island, village.faunaObstacles)
  if (wonder) village.setWonder(wonder.age, wonder.stage)
  village.sync(livingBuildings(game.buildings, s.age))
  village.setRelics(s.relics)
  Object.assign(s, planOf(village))
  const pen = fauna.pen
  village.goodsAvoid = pen ? [pen] : []
  village.setTools(s.tools)
  s.goods = village.goodsAt
  return { island, village }
}

export function reload(randomSeed) {
  seeded(randomSeed)
  const game = new Game(NOW)
  const world = load(game)
  game.flush(NOW)
  Math.random = random
  return { game, ...world }
}

export function techsUpTo(age) {
  const cur = TECHS.filter((t) => t.age === age)
  const skip = cur.findLast((t) => !t.effects.some((e) => e.kind === 'building')) ?? cur.at(-1)
  return TECHS.filter((t) => t.age <= age && t !== skip).map((t) => t.id)
}

export function play(seed, age, parcels) {
  store.clear()
  seeded(seed)
  const g0 = new Game(NOW)
  g0.save.seed = seed
  g0.flush(NOW)
  let played = null
  for (let a = 0; a <= age; a++) {
    const raw = JSON.parse(store.get(SAVE_KEY))
    raw.age = a
    raw.techs = techsUpTo(a)
    raw.seenFacts = raw.techs
    raw.wonders = [...Array(a).keys()]
    raw.relics = RELICS.slice(0, Math.floor(a * 1.2)).map((r) => r.id)
    raw.tools = TOOLS.filter((t) => t.age <= a).map((t) => t.id)
    raw.res = { food: 900 + a, wood: 800, stone: 700, fiber: 300, clay: 200, copper: 90, iron: 70, insight: 40 + a }
    store.set(SAVE_KEY, JSON.stringify(raw))
    played = raw
    let { game, island } = reload(seed * 97 + a)
    while (game.save.land.length < parcels && game.landOffer) {
      const kind = game.landOffer.kinds[0]
      const at = island.anchorCandidates(kind)[0]
      if (!at || !game.chooseLand(kind, at.q, at.r)) break
      game.flush(NOW)
      ;({ game, island } = reload(seed * 89 + a * 7 + game.save.land.length))
    }
  }
  return { saved: JSON.parse(store.get(SAVE_KEY)), played }
}

if (import.meta.main) {
  const [seed, age, parcels] = process.argv.slice(2).map(Number)
  if (![seed, age, parcels].every(Number.isInteger)) {
    console.error('usage : save-play.mjs <graine> <âge> <parcelles>')
    process.exit(1)
  }
  const { saved } = play(seed, age, parcels)
  process.stdout.write(JSON.stringify(saved, null, 1) + '\n')
}
