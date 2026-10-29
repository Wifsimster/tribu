import { test } from 'node:test'
import assert from 'node:assert/strict'

const { Island, RAIL_AGE, BASE_GROWTH, GROWN_GROWTH, islandGrowth } = await import('../src/render/island.ts')
const B = await import('../src/render/belt.ts')

const SEEDS = [1_337_042, 7, 42, 99, 2024, 5, 11, 123, 777, 31_337]
const KINDS = ['foret', 'carriere', 'prairie', 'roseliere', 'crique', 'affleurement']

const cells = (seed, age, land) => new Island(seed, age, land, islandGrowth(age), true)

test('l’île grandit d’un seul palier, à l’âge du chemin de fer', () => {
  assert.equal(RAIL_AGE, 7)
  for (let age = 0; age <= 10; age++) assert.equal(islandGrowth(age), age >= 7 ? GROWN_GROWTH : BASE_GROWTH)
  assert.ok(Math.abs(GROWN_GROWTH / BASE_GROWTH - 1.2) < 0.01)
  const small = cells(42, 6, [])
  const big = cells(42, 7, [])
  for (const c of small.cells) assert.ok(big.isLand(c.x, c.z))
  assert.ok(big.cells.length > small.cells.length * 1.3)
})

test('B-spline polaire : un rayon qui grandit repousse la courbe, jamais ne la tire', () => {
  const r = Array.from({ length: 72 }, (_, j) => 15 + Math.sin(j / 5))
  const up = r.map((v, j) => (j === 20 ? v + 2 : v))
  for (let a = 0; a < Math.PI * 2; a += 0.01) assert.ok(B.beltRadius(up, a) >= B.beltRadius(r, a) - 1e-12)
})

test('growBelt : la ceinture ne recule jamais, et un tracé égal ne la fait pas dériver', () => {
  const prev = Array.from({ length: 72 }, (_, j) => 14 + (j % 7) * 0.1)
  const lower = prev.map((v) => v - 0.5)
  assert.deepEqual(B.growBelt(prev, lower), prev)
  let b = prev
  for (let k = 0; k < 1000; k++) b = B.growBelt(b, prev)
  assert.deepEqual(b, prev)
  const mixed = prev.map((v, j) => (j < 10 ? v + 1 : v - 1))
  const g = B.growBelt(prev, mixed)
  for (let j = 0; j < 72; j++) assert.ok(g[j] >= prev[j] && g[j] >= mixed[j])
})

test('cleanBelt : 72 rayons finis, ou rien', () => {
  assert.equal(B.cleanBelt(null), null)
  assert.equal(B.cleanBelt([1, 2, 3]), null)
  assert.equal(B.cleanBelt(Array(72).fill(Number.NaN)), null)
  assert.equal(B.cleanBelt(Array(72).fill('15')), null)
  assert.equal(B.cleanBelt(Array(72).fill(15.004)).every((r) => r === 15.01), true)
})

test('dix graines, de l’âge 4 à l’âge 7, douze parcelles : courbure, garde, monotonie', () => {
  const report = []
  for (const seed of SEEDS) {
    const land = []
    let belt = null
    for (let k = 0; k <= 12; k++) {
      const age = k < 6 ? 4 : 7
      const isl = cells(seed, age, [...land])
      const isLand = (x, z) => isl.isLand(x, z)
      const next = B.growBelt(belt, B.beltFor(isLand, age >= RAIL_AGE))
      if (belt) for (let j = 0; j < 72; j++) assert.ok(next[j] >= belt[j] - 0.01, `graine ${seed}, pose ${k} : la ceinture recule au rayon ${j}`)
      belt = next
      const path = B.beltPath(belt)
      const R = B.minCurvatureRadius(path.pts)
      const guard = B.beltGuard(isLand, path.pts)
      report.push({ seed, k, age, R, guard, L: path.cum.at(-1) })
      assert.ok(R >= 9, `graine ${seed}, ${k} parcelles : rayon de courbure ${R.toFixed(2)} u`)
      const fresh = k === 0 || k === 6
      assert.ok(guard >= (fresh ? 1.2 : 0.9) - 1e-9, `graine ${seed}, ${k} parcelles : garde ${guard.toFixed(2)} u`)
      if (age >= RAIL_AGE) assert.ok(R >= 11, `graine ${seed}, ${k} parcelles : ${R.toFixed(2)} u sur l’île agrandie`)
      if (k < 12) {
        const at = isl.defaultAnchor()
        if (!at) break
        land.push({ kind: KINDS[k % 6], q: at.q, r: at.r })
      }
    }
  }
  if (process.env.BELT_REPORT) console.log(JSON.stringify(report))
})
