// Tests de simulation des parcelles (« la mer recule »), sans DOM :
//   corepack pnpm test
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// La sauvegarde vit dans localStorage : une table en mémoire suffit.
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { Game, drawLands, landMilestones, landBonds, hexDistance } = await import('../src/game/sim.ts')
const { SAVE_KEY, OFFLINE_CAP_SECONDS } = await import('../src/game/state.ts')
const { TECH_BY_ID, AGES } = await import('../src/game/content.ts')

const NOW = 1_800_000_000_000
const PALEO = ['flint', 'fire', 'shelter', 'spear', 'lamp', 'cordage']

beforeEach(() => store.clear())

/** Une partie neuve, graine fixée, qui découvre ses `n` premiers savoirs. */
function freshWith(seed, n) {
  const g = new Game(NOW)
  g.save.seed = seed
  for (const id of PALEO.slice(0, n)) {
    g.save.res.insight = 1e6
    for (const r of ['food', 'wood', 'stone', 'fiber']) g.save.res[r] = 1e6
    assert.ok(g.research(id), `recherche ${id}`)
  }
  return g
}

test('2e savoir paléolithique : une carte de trois terres distinctes de départ', () => {
  const g = freshWith(42, 1)
  assert.equal(g.save.landPending.length, 0)
  g.save.res.insight = 1e6
  g.research(PALEO[1])
  assert.equal(g.save.landPending.length, 1)
  const kinds = g.save.landPending[0].kinds
  assert.equal(new Set(kinds).size, 3)
  assert.deepEqual([...kinds].sort(), ['carriere', 'foret', 'prairie'])
})

test('tirage déterministe : même graine et même jalon, mêmes cartes', () => {
  const unlocked = new Set(['food', 'wood', 'stone', 'insight', 'fiber', 'clay', 'copper', 'iron'])
  for (let n = 0; n < 21; n++) {
    const a = drawLands(1_337_042, n, 6, unlocked)
    const b = drawLands(1_337_042, n, 6, unlocked)
    assert.deepEqual(a, b)
    assert.equal(new Set(a).size, 3)
  }
  // Et pas une constante déguisée : sur 21 jalons, plusieurs tirages diffèrent.
  const draws = new Set(Array.from({ length: 21 }, (_, n) => drawLands(1_337_042, n, 6, unlocked).join()))
  assert.ok(draws.size > 3, `tirages distincts : ${draws.size}`)
  // Deux parties de même graine reçoivent la même première carte.
  assert.deepEqual(freshWith(7, 2).save.landPending[0].kinds, freshWith(7, 2).save.landPending[0].kinds)
})

test('300 s sans choix : la carte attend toujours, aucune terre posée', () => {
  const g = freshWith(42, 2)
  g.setFocus('wood')
  const before = { ...g.rates }
  // Les taux varient avec l'heure : on compare à une partie jumelle sans carte.
  const twin = freshWith(42, 2)
  twin.setFocus('wood')
  twin.save.landPending = []
  for (let t = 0; t < 300; t += 0.5) {
    g.tick(0.5, NOW + t * 1000)
    twin.tick(0.5, NOW + t * 1000)
  }
  assert.equal(g.save.landPending.length, 1)
  assert.equal(g.save.land.length, 0)
  assert.ok(Math.abs(g.rates.wood - twin.rates.wood) < 1e-12, 'une carte en attente ne rapporte rien')
  assert.ok(before.wood > 0)
})

test('choisir une terre : parcelle ajoutée, taux multiplié', () => {
  const g = freshWith(42, 2)
  g.setFocus('wood')
  const wood = g.rates.wood
  assert.equal(g.chooseLand('crique', 3, -9), false, 'terre absente de la carte')
  assert.ok(g.chooseLand('foret', 3, -9))
  assert.deepEqual(g.save.land, [{ kind: 'foret', q: 3, r: -9 }])
  assert.equal(g.save.landPending.length, 0)
  assert.ok(Math.abs(g.rates.wood - wood * 1.08) < 1e-9, `${g.rates.wood} vs ${wood * 1.08}`)
  // Et la parcelle survit à la sauvegarde.
  g.flush(NOW)
  const back = new Game(NOW)
  assert.deepEqual(back.save.land, [{ kind: 'foret', q: 3, r: -9 }])
  assert.ok(Math.abs(back.rates.wood - g.rates.wood) < 1e-9)
})

/** Une save d'âge 1, deux cartes en file, absente depuis 8 h. */
function absentSave(pending) {
  const g = freshWith(99, 4)
  assert.equal(g.save.age, 1)
  assert.equal(g.save.landPending.length, 2)
  if (!pending) g.save.landPending = []
  g.save.res = { food: 10, wood: 10, stone: 10, insight: 10, fiber: 10 }
  g.flush(NOW - OFFLINE_CAP_SECONDS * 1000)
  return JSON.parse(store.get(SAVE_KEY))
}

test('8 h hors ligne avec deux cartes en attente : gains exacts, cartes toujours en file', () => {
  const save = absentSave(true)
  const g = new Game(NOW)
  assert.equal(g.save.landPending.length, 2, 'les cartes attendent le retour du joueur')
  assert.equal(g.save.land.length, 0)
  for (const id of ['food', 'wood', 'stone', 'fiber', 'insight']) {
    const expected = g.rates[id] * OFFLINE_CAP_SECONDS
    const got = g.save.res[id] - save.res[id]
    assert.ok(Math.abs(got - expected) < 1e-6 * Math.max(1, expected), `${id} : ${got} vs ${expected}`)
  }
  // Et exactement ce qu'aurait gagné la même tribu sans aucune carte.
  const gained = Object.fromEntries(['food', 'wood', 'stone', 'fiber', 'insight'].map((id) => [id, g.save.res[id]]))
  store.clear()
  absentSave(false)
  const bare = new Game(NOW)
  assert.equal(bare.save.landPending.length, 0)
  for (const id of Object.keys(gained)) assert.ok(Math.abs(bare.save.res[id] - gained[id]) < 1e-6, id)
})

test('save v3.47 avancée : tous les jalons franchis arrivent en file, sans erreur', () => {
  // La sauvegarde Renaissance semée par tools/screenshot-readme.mjs, telle
  // qu'une v3.47 l'écrivait : ni land, ni landPending, ni landN.
  const techs = [
    'flint', 'fire', 'shelter', 'spear', 'lamp', 'cordage',
    'agriculture', 'pottery', 'weaving', 'polished_axe', 'granary',
    'copper', 'bronze', 'wheel', 'writing', 'sail',
    'ironworking', 'plough', 'alphabet', 'coinage', 'lighthouse', 'aqueduct',
    'concrete', 'watermill', 'glass', 'roads', 'codex',
    'horsecollar', 'threefield', 'windmill', 'clock', 'press',
    'caravel', 'observatory', 'bank',
  ]
  for (const id of techs) assert.ok(TECH_BY_ID.has(id), id)
  const v347 = {
    v: 1, t: NOW, seed: 1_337_042,
    res: { food: 480, wood: 610, stone: 395, fiber: 210, clay: 168, copper: 92, iron: 74, insight: 46 },
    techs, age: 6, focus: 'wood', expedition: null,
    caravan: { nextIn: 200, visiting: false, visitLeft: 0, haggled: false, traded: false },
    seenFacts: techs, totalPlaySeconds: 41_000, relics: [], tools: [], eventIn: 500, feats: [],
    outpost: true, outpostIn: 260, wonder: null, wonders: [0, 1, 2, 3, 4, 5],
    layout: [], layoutV: 2, village: 'Aubevent', chronicle: [], legacy: 1, tribe: null,
  }
  store.set(SAVE_KEY, JSON.stringify(v347))
  const g = new Game(NOW)
  // Âge 6 (Renaissance) : six âges révolus × 2 jalons, et 3 savoirs de la
  // Renaissance sur 5 requis — le jalon de mi-âge (3) est franchi.
  assert.equal(g.save.age, 6)
  assert.equal(techs.filter((id) => TECH_BY_ID.get(id).age === 6).length, 3)
  assert.equal(g.save.landPending.length, 13)
  assert.equal(g.save.landN, 13)
  assert.deepEqual(g.save.land, [])
  assert.deepEqual(g.save.landPending.map((p) => p.n), [...Array(13).keys()])
  for (const p of g.save.landPending) assert.equal(new Set(p.kinds).size, 3)
  // Un rechargement ne redistribue rien.
  g.flush(NOW)
  assert.equal(new Game(NOW).save.landPending.length, 13)
})

test('fin de partie : 21 jalons au plus', () => {
  const last = AGES.length - 1
  assert.equal(landMilestones(last, [...TECH_BY_ID.keys()]), 21)
  assert.equal(landMilestones(0, []), 0)
})

test('sauvegarde bricolée : terres inconnues ou coordonnées folles ignorées', () => {
  const g = freshWith(5, 2)
  g.flush(NOW)
  const raw = JSON.parse(store.get(SAVE_KEY))
  raw.land = [{ kind: 'foret', q: 1, r: 2 }, { kind: 'volcan', q: 0, r: 0 }, { kind: 'prairie', q: 1e9, r: 0 }, 'x']
  raw.landPending = [{ n: 1, kinds: ['prairie', 'xx'] }, { n: 'a', kinds: [] }]
  store.set(SAVE_KEY, JSON.stringify(raw))
  const back = new Game(NOW)
  assert.deepEqual(back.save.land, [{ kind: 'foret', q: 1, r: 2 }])
  assert.deepEqual(back.save.landPending, [{ n: 1, kinds: ['prairie'] }])
})

// ── Incrément 3 : l'emplacement choisi et le voisinage ──────────────────────

/** Le taux de bois d'une partie dont les terres posées sont `land`. */
function woodWith(land) {
  const g = freshWith(42, 2)
  g.setFocus('wood')
  g.save.land = land
  g.recompute()
  return g.rates.wood
}

test('voisinage : deux forêts adjacentes donnent bois ×1,12², ×1,08² sinon', () => {
  const bare = woodWith([])
  // Centres à 3 cellules : les anneaux se touchent, bord contre bord.
  assert.equal(hexDistance(0, -12, 3, -12), 3)
  const near = woodWith([{ kind: 'foret', q: 0, r: -12 }, { kind: 'foret', q: 3, r: -12 }])
  // À 4 cellules : une rangée d'eau les sépare.
  assert.equal(hexDistance(0, -12, 4, -12), 4)
  const far = woodWith([{ kind: 'foret', q: 0, r: -12 }, { kind: 'foret', q: 4, r: -12 }])
  assert.ok(Math.abs(near - bare * 1.12 ** 2) < 1e-9, `${near} vs ${bare * 1.12 ** 2}`)
  assert.ok(Math.abs(far - bare * 1.08 ** 2) < 1e-9, `${far} vs ${bare * 1.08 ** 2}`)
  // Le voisinage ne vaut qu'entre terres du même type.
  const mixed = woodWith([{ kind: 'foret', q: 0, r: -12 }, { kind: 'prairie', q: 3, r: -12 }])
  assert.ok(Math.abs(mixed - bare * 1.08) < 1e-9)
  assert.deepEqual(landBonds([{ kind: 'foret', q: 0, r: 0 }, { kind: 'foret', q: 3, r: 0 }, { kind: 'foret', q: 9, r: 0 }]), [true, true, false])
})

test('une ancre qui chevauche une terre déjà gagnée est rejetée', () => {
  const g = freshWith(42, 2)
  g.save.land = [{ kind: 'foret', q: 3, r: -9 }]
  g.recompute()
  const kind = g.landOffer.kinds[0]
  for (const [q, r] of [[3, -9], [4, -9], [5, -9], [3, -7]]) {
    assert.ok(g.landOverlaps(q, r), `${q},${r}`)
    assert.equal(g.chooseLand(kind, q, r), false, `chevauchement ${q},${r} refusé`)
  }
  assert.equal(g.save.landPending.length, 1, 'la carte reste en file')
  assert.equal(g.save.land.length, 1)
  assert.equal(g.landOverlaps(6, -9), false)
  assert.ok(g.landBondAt('foret', 6, -9))
  assert.equal(g.landBondAt('prairie', 6, -9), false)
  assert.ok(g.chooseLand(kind, 6, -9))
})

test('annuler : la carte retourne dans la file, intacte, et rien ne se pose', () => {
  const g = freshWith(42, 2)
  g.setFocus('wood')
  const queue = structuredClone(g.save.landPending)
  assert.equal(g.pickLand('crique'), false, 'terre absente de la carte')
  assert.ok(g.pickLand('foret'))
  assert.equal(g.placing, 'foret')
  // Pendant le choix, la carte ne rapporte toujours rien.
  for (let t = 0; t < 300; t += 0.5) g.tick(0.5, NOW + t * 1000)
  assert.deepEqual(g.save.land, [])
  g.cancelLand()
  assert.equal(g.placing, null)
  assert.deepEqual(g.save.landPending, queue)
  assert.equal(g.placeLand(3, -9), false, 'plus rien à poser après annulation')
  // Et un rechargement rend la même carte.
  g.flush(NOW)
  const back = new Game(NOW)
  assert.deepEqual(back.save.landPending, queue)
  assert.deepEqual(back.save.land, [])
  // On peut y revenir : choisir, puis poser à l'ancre touchée.
  const wood = back.rates.wood
  assert.ok(back.pickLand('foret'))
  assert.ok(back.placeLand(3, -9))
  assert.deepEqual(back.save.land, [{ kind: 'foret', q: 3, r: -9 }])
  assert.equal(back.save.landPending.length, 0)
  assert.equal(back.placing, null)
  assert.ok(Math.abs(back.rates.wood - wood * 1.08) < 1e-9)
})

/** Les 21 parcelles d'une partie v3.50 d'âge 10, posées à l'ancre par défaut
 *  (save de mesure de l'incrément 2). */
const LAND_V350 = [
  { kind: 'crique', q: -12, r: 1 }, { kind: 'carriere', q: 7, r: -14 }, { kind: 'roseliere', q: -14, r: 4 },
  { kind: 'crique', q: 11, r: -14 }, { kind: 'foret', q: 3, r: 10 }, { kind: 'crique', q: 6, r: 8 },
  { kind: 'crique', q: -11, r: -2 }, { kind: 'roseliere', q: 5, r: -15 }, { kind: 'crique', q: -15, r: 7 },
  { kind: 'prairie', q: 14, r: -13 }, { kind: 'crique', q: 0, r: 13 }, { kind: 'carriere', q: 9, r: 7 },
  { kind: 'affleurement', q: -14, r: 0 }, { kind: 'roseliere', q: 10, r: -16 }, { kind: 'roseliere', q: -15, r: 12 },
  { kind: 'affleurement', q: 16, r: -10 }, { kind: 'affleurement', q: 4, r: 12 }, { kind: 'carriere', q: 12, r: 4 },
  { kind: 'crique', q: -11, r: -5 }, { kind: 'roseliere', q: 3, r: -16 }, { kind: 'prairie', q: -16, r: 10 },
]

test('save v3.50 avec 21 parcelles : rechargée à l’identique, positions conservées', () => {
  const g = freshWith(1_337_042, 2)
  g.flush(NOW)
  const raw = JSON.parse(store.get(SAVE_KEY))
  raw.land = structuredClone(LAND_V350)
  raw.landPending = []
  raw.landN = 21
  delete raw.placing
  store.set(SAVE_KEY, JSON.stringify(raw))
  const back = new Game(NOW)
  assert.deepEqual(back.save.land, LAND_V350)
  assert.deepEqual(back.save.landPending, [])
  assert.equal(back.save.landN, 21)
  // Rien de neuf n'est écrit dans la sauvegarde : la pose en cours n'y vit pas.
  back.flush(NOW)
  const again = JSON.parse(store.get(SAVE_KEY))
  assert.deepEqual(again.land, LAND_V350)
  assert.equal('placing' in again, false)
  // Les voisinages déjà présents sur cette île comptent, sans rien déplacer.
  assert.deepEqual(
    landBonds(LAND_V350).flatMap((b, i) => (b ? [i] : [])),
    LAND_V350.flatMap((a, i) =>
      LAND_V350.some((b, j) => j !== i && b.kind === a.kind && hexDistance(a.q, a.r, b.q, b.r) <= 3) ? [i] : [],
    ),
  )
})

test('8 h hors ligne avec deux forêts voisines : gains exacts au taux majoré', () => {
  const g = freshWith(99, 4)
  g.save.landPending = []
  g.save.land = [{ kind: 'foret', q: 0, r: -12 }, { kind: 'foret', q: 3, r: -12 }]
  g.setFocus('wood')
  g.save.res = { food: 10, wood: 10, stone: 10, insight: 10, fiber: 10 }
  g.flush(NOW - OFFLINE_CAP_SECONDS * 1000)
  const save = JSON.parse(store.get(SAVE_KEY))
  const back = new Game(NOW)
  for (const id of ['food', 'wood', 'stone', 'fiber', 'insight']) {
    const expected = back.rates[id] * OFFLINE_CAP_SECONDS
    const got = back.save.res[id] - save.res[id]
    assert.ok(Math.abs(got - expected) < 1e-6 * Math.max(1, expected), `${id} : ${got} vs ${expected}`)
  }
})
