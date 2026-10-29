import { test } from 'node:test'
import assert from 'node:assert/strict'

const { Island, GROUND_Y } = await import('../src/render/island.ts')

const SEED = 1_337_042
const KINDS = ['foret', 'carriere', 'prairie', 'roseliere', 'crique', 'affleurement']

function scatterMatrices(island) {
  const out = {}
  for (const mesh of island.pickables) {
    out[island.kindFor(mesh)] = { count: mesh.count, array: Array.from(mesh.instanceMatrix.array) }
  }
  return out
}

function grow(n, age = 10, kinds = KINDS) {
  const land = []
  let island = new Island(SEED, age, land)
  for (let i = 0; i < n; i++) {
    const at = island.defaultAnchor()
    assert.ok(at, `ancre libre pour la parcelle ${i + 1}`)
    land.push({ kind: kinds[i % kinds.length], q: at.q, r: at.r })
    island = new Island(SEED, age, [...land])
  }
  return { island, land }
}

test("poser une parcelle ne change pas les matrices des arbres de l'île de base", () => {
  const base = scatterMatrices(new Island(SEED, 10, []))
  assert.ok(base.wood.count > 20, `pinède de base : ${base.wood.count} sapins`)
  for (const kind of KINDS) {
    const at = new Island(SEED, 10, []).defaultAnchor()
    const after = scatterMatrices(new Island(SEED, 10, [{ kind, q: at.q, r: at.r }]))
    for (const res of ['wood', 'stone', 'food']) {
      const n = base[res].count * 16
      assert.deepEqual(after[res].array.slice(0, n), base[res].array.slice(0, n), `${kind} : ${res} de base`)
    }
  }
  const full = scatterMatrices(grow(21).island)
  assert.deepEqual(full.wood.array.slice(0, base.wood.count * 16), base.wood.array.slice(0, base.wood.count * 16))
})

test('chaque parcelle apporte son décor', () => {
  const at = new Island(SEED, 10, []).defaultAnchor()
  const base = scatterMatrices(new Island(SEED, 10, []))
  const added = (kind) => {
    const m = scatterMatrices(new Island(SEED, 10, [{ kind, q: at.q, r: at.r }]))
    return { wood: m.wood.count - base.wood.count, stone: m.stone.count - base.stone.count, food: m.food.count - base.food.count }
  }
  assert.ok(added('foret').wood >= 5, 'des sapins sur la forêt')
  assert.ok(added('carriere').stone >= 3, 'des blocs dans la carrière')
  assert.ok(added('affleurement').stone >= 3, "de la roche sur l'affleurement")
  assert.ok(added('prairie').food >= 1, 'des buissons dans la prairie')
})

test('la pinède de base est plafonnée, quelle que soit la surface', () => {
  for (const age of [0, 5, 10]) {
    const n = scatterMatrices(new Island(SEED, age, [])).wood.count
    assert.ok(n <= 46, `âge ${age} : ${n} sapins`)
  }
})

test('21 parcelles : ni trou, ni cellule détachée, et la crique reste ouverte sur la mer', () => {
  const { island, land } = grow(21)
  const key = (q, r) => `${q},${r}`
  const cells = new Map(island.cells.map((c) => [key(c.gx, c.gz), c]))
  const NB = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]]
  const seen = new Set([key(0, 0)])
  const stack = [[0, 0]]
  while (stack.length) {
    const [q, r] = stack.pop()
    for (const [dq, dr] of NB) {
      const k = key(q + dq, r + dr)
      if (!seen.has(k) && cells.has(k)) {
        seen.add(k)
        stack.push([q + dq, r + dr])
      }
    }
  }
  assert.equal(seen.size, cells.size, 'aucune cellule détachée')
  let q0 = Infinity, q1 = -Infinity, r0 = Infinity, r1 = -Infinity
  for (const c of island.cells) {
    q0 = Math.min(q0, c.gx - 1); q1 = Math.max(q1, c.gx + 1)
    r0 = Math.min(r0, c.gz - 1); r1 = Math.max(r1, c.gz + 1)
  }
  const sea = new Set()
  const fill = []
  for (let q = q0; q <= q1; q++) for (let r = r0; r <= r1; r++) if (q === q0 || q === q1 || r === r0 || r === r1) fill.push([q, r])
  while (fill.length) {
    const [q, r] = fill.pop()
    const k = key(q, r)
    if (q < q0 || q > q1 || r < r0 || r > r1 || sea.has(k) || cells.has(k)) continue
    sea.add(k)
    for (const [dq, dr] of NB) fill.push([q + dq, r + dr])
  }
  const coves = land.filter((p) => p.kind === 'crique')
  assert.ok(coves.length > 0)
  for (const p of coves) {
    assert.ok(!cells.has(key(p.q, p.r)), 'le centre de la crique est de l’eau')
    assert.ok(sea.has(key(p.q, p.r)), 'la crique raccorde à la mer')
  }
  for (let q = q0; q <= q1; q++)
    for (let r = r0; r <= r1; r++) {
      const k = key(q, r)
      if (!cells.has(k) && !sea.has(k)) assert.fail(`eau enclavée en ${k}`)
    }
  const geo = island.terrainMesh.geometry
  const pos = geo.getAttribute('position')
  const nor = geo.getAttribute('normal')
  const slots = island.terrainSlots
  let tops = 0
  let minY = Infinity
  for (let i = 0; i < pos.count; i++) {
    if (slots[i] >= island.cells.length * 2) continue
    const y = pos.getY(i)
    assert.ok(y >= -1e-6 && y <= GROUND_Y + 1e-6, `sommet hors de [0, sol] : ${y}`)
    minY = Math.min(minY, y)
    if (nor.getY(i) > 0.99) {
      tops++
      assert.ok(Math.abs(y - GROUND_Y) < 1e-6, `dessus de cellule à ${y}, sol à ${GROUND_Y}`)
    }
  }
  assert.ok(Math.abs(minY) < 1e-6, 'les flancs descendent jusqu’au fond')
  assert.ok(tops >= island.cells.length * 6, 'chaque cellule a son dessus')
})

const { hexCenter } = await import('../src/render/island.ts')
const hexDist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q - b.q + a.r - b.r)) / 2
const RING = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]]

test("une ancre dont une cellule chevauche la terre est rejetée", () => {
  const island = new Island(SEED, 10, [])
  const land = new Set(island.cells.map((c) => `${c.gx},${c.gz}`))
  assert.equal(island.canAnchor(0, 0), false)
  const at = island.defaultAnchor()
  assert.ok(island.canAnchor(at.q, at.r))
  let overlapping = null
  for (const [dq, dr] of RING) {
    const q = at.q + dq
    const r = at.r + dr
    const cells = [[q, r], ...RING.map(([a, b]) => [q + a, r + b])]
    const hits = cells.filter(([x, y]) => land.has(`${x},${y}`)).length
    if (!land.has(`${q},${r}`) && hits > 0) {
      overlapping = { q, r, hits }
      break
    }
  }
  assert.ok(overlapping, 'une ancre voisine mord sur la côte')
  assert.equal(island.canAnchor(overlapping.q, overlapping.r), false)
  const withPlot = new Island(SEED, 10, [{ kind: 'foret', q: at.q, r: at.r }])
  assert.equal(withPlot.canAnchor(at.q, at.r), false)
  for (const [dq, dr] of RING) assert.equal(withPlot.canAnchor(at.q + 2 * dq, at.r + 2 * dr), false)
})

test('trois ancres valides, écartées, la première par défaut, le voisinage signalé', () => {
  const island = new Island(SEED, 10, [])
  const list = island.anchorCandidates('foret')
  assert.equal(list.length, 3)
  assert.deepEqual({ q: list[0].q, r: list[0].r }, island.defaultAnchor())
  for (const a of list) {
    assert.ok(island.canAnchor(a.q, a.r))
    assert.equal(a.bond, false, 'pas de forêt sur l’île : aucun voisinage')
  }
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(hexDist(list[i], list[j]) >= 4)
  const at = island.defaultAnchor()
  const grown = new Island(SEED, 10, [{ kind: 'foret', q: at.q, r: at.r }])
  const next = grown.anchorCandidates('foret')
  assert.equal(next.length, 3)
  const bond = next.filter((a) => a.bond)
  assert.ok(bond.length >= 1, 'une ancre de voisinage proposée')
  for (const a of bond) assert.equal(hexDist(a, at), 3)
  assert.ok(grown.anchorCandidates('prairie').every((a) => !a.bond))
  for (const a of next) {
    const [x, z] = hexCenter(a.q, a.r)
    assert.ok(Math.hypot(x, z) < grown.radius + 6, `${Math.hypot(x, z)} vs ${grown.radius}`)
  }
})

test('21 parcelles : il reste des ancres, et aucune ne recouvre une terre', () => {
  const { island } = grow(21)
  const cells = new Set(island.cells.map((c) => `${c.gx},${c.gz}`))
  const list = island.anchorCandidates('carriere')
  assert.equal(list.length, 3)
  for (const a of list) {
    for (const [dq, dr] of [[0, 0], ...RING]) assert.equal(cells.has(`${a.q + dq},${a.r + dr}`), false)
  }
})
