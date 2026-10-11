// Tests du rendu des parcelles, sans navigateur : l'île se construit en Node
// (three n'a besoin de WebGL qu'au moment de dessiner).
//   corepack pnpm test
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { Island } = await import('../src/render/island.ts')

const SEED = 1_337_042
const KINDS = ['foret', 'carriere', 'prairie', 'roseliere', 'crique', 'affleurement']

/** Les matrices de chaque maillage de dispersion (bois, pierre, nourriture). */
function scatterMatrices(island) {
  const out = {}
  for (const mesh of island.pickables) {
    out[island.kindFor(mesh)] = { count: mesh.count, array: Array.from(mesh.instanceMatrix.array) }
  }
  return out
}

/** Pose `n` parcelles à l'emplacement par défaut, comme le jeu. */
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
  // Et avec vingt et une parcelles, la forêt d'origine n'a toujours pas bougé.
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
  // Toute la terre se tient : on la parcourt depuis la place du village.
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
  // Pas d'eau enclavée, sauf le centre d'une crique (qui doit, lui, rester de l'eau).
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
  // Aucune cellule ne flotte : toutes partent du fond.
  for (const c of island.cells) assert.ok(c.height > 0.05, `hauteur ${c.height}`)
})
