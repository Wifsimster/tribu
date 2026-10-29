import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Matrix4, Quaternion, Vector3 } from 'three'

const warn = console.warn
console.warn = (...a) => {
  if (!String(a[0]).includes('indisponible')) warn(...a)
}

const { Island, DECOR_GAP } = await import('../src/render/island.ts')
const { Village } = await import('../src/render/village.ts')
const { Fauna } = await import('../src/render/fauna.ts')
const { Ground } = await import('../src/render/ground.ts')
const { TECHS, TOOLS, RELICS, livingBuildings } = await import('../src/game/content.ts')

function seeded(seed) {
  let a = seed >>> 0
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const random = Math.random

const builtFor = (age) =>
  livingBuildings(new Set(TECHS.filter((t) => t.age <= age).flatMap((t) => t.effects.filter((e) => e.kind === 'building').map((e) => e.building))), age)
const toolsFor = (age) => TOOLS.filter((t) => t.age <= age).map((t) => t.id)

function town(seed, age, land = []) {
  seeded(seed * 7 + age)
  const island = new Island(seed, age, land)
  const village = new Village(island, age, age >= 8, false)
  village.setWonder(age, 4)
  village.sync(builtFor(age))
  village.setRelics(RELICS.slice(0, Math.floor(age * 1.2)).map((r) => r.id))
  const fauna = new Fauna(island, village.obstaclePoints)
  village.goodsAvoid = fauna.pen ? [fauna.pen] : []
  village.setTools(toolsFor(age))
  fauna.setKnown(true, true, true, true)
  const ground = new Ground(island, [village, fauna])
  return { island, village, fauna, ground }
}

function solids(sources) {
  const tris = []
  for (const s of sources)
    for (const f of s.groundFootprints()) {
      const k = f.scale ?? 1
      const ox = f.ox ?? 0, oy = f.oy ?? 0, oz = f.oz ?? 0
      const P = f.geo ? f.geo.getAttribute('position').array : f.tris
      const I = f.geo?.index ? f.geo.index.array : null
      const n = I ? I.length / 3 : P.length / 9
      for (let t = 0; t < n; t++) {
        const ids = [0, 1, 2].map((c) => (I ? I[t * 3 + c] : t * 3 + c))
        if (Math.max(...ids.map((i) => oy + P[i * 3 + 1] * k)) < f.minY) continue
        tris.push(ids.flatMap((i) => [ox + P[i * 3] * k, oz + P[i * 3 + 2] * k]))
      }
    }
  const seg = (px, pz, ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az
    const L = dx * dx + dz * dz
    const u = L < 1e-12 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L))
    return Math.hypot(px - ax - u * dx, pz - az - u * dz)
  }
  return (x, z) => {
    let best = 3
    for (const [ax, az, bx, bz, cx, cz] of tris) {
      if (x < Math.min(ax, bx, cx) - best || x > Math.max(ax, bx, cx) + best) continue
      if (z < Math.min(az, bz, cz) - best || z > Math.max(az, bz, cz) + best) continue
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
      if (Math.abs(d) > 1e-12) {
        const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d
        const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d
        if (l1 >= 0 && l2 >= 0 && 1 - l1 - l2 >= 0) return -1
      }
      best = Math.min(best, seg(x, z, ax, az, bx, bz), seg(x, z, bx, bz, cx, cz), seg(x, z, cx, cz, ax, az))
    }
    return best
  }
}

const R = { wood: 0.16, stone: 0.42, food: 0.34 }
function decor(island) {
  const m = new Matrix4(), p = new Vector3(), q = new Quaternion(), s = new Vector3()
  const out = []
  for (const mesh of island.pickables) {
    const kind = island.kindFor(mesh)
    for (let i = 0; i < mesh.count; i++) {
      if (island.isFelled(mesh, i)) continue
      mesh.getMatrixAt(i, m)
      m.decompose(p, q, s)
      out.push({ kind, i, x: p.x, z: p.z, r: R[kind] * s.x, src: island.cellAt(p.x, p.z)?.plotOf ?? null })
    }
  }
  return out
}

function worstGap(island, sd) {
  let worst = { gap: Infinity }
  for (const d of decor(island)) {
    const gap = sd(d.x, d.z) - d.r
    if (gap < worst.gap) worst = { gap, ...d }
  }
  return worst
}

const CASES = [[42, 7], [99, 10], [7, 5], [1337042, 2]]

test('aucun rocher, buisson ni tronc dans un bâtiment, la Merveille, le quai, le camp ou l’enclos', () => {
  for (const [seed, age] of CASES) {
    const w = town(seed, age)
    const sd = solids([w.village, w.fauna])
    const worst = worstGap(w.island, sd)
    assert.ok(
      worst.gap >= DECOR_GAP,
      `graine ${seed} âge ${age} : ${worst.kind} n°${worst.i} à ${worst.gap.toFixed(2)} u d'une emprise (visé ≥ ${DECOR_GAP})`,
    )
  }
  Math.random = random
})

test('un atelier posé en cours de partie efface le décor qu’il recouvre, et seulement lui', () => {
  for (const [seed, age] of [[42, 7], [99, 10]]) {
    seeded(seed)
    const island = new Island(seed, age, [])
    const village = new Village(island, age, false, false)
    village.sync(builtFor(age - 1))
    const fauna = new Fauna(island, village.obstaclePoints)
    fauna.setKnown(true, true, true, true)
    const ground = new Ground(island, [village, fauna])
    const before = decor(island).length
    village.setWonder(age, 4)
    village.sync(builtFor(age))
    assert.equal(ground.refresh(), true, 'la pose refait le cadastre')
    const after = decor(island).length
    assert.ok(after < before, `graine ${seed} : du décor pris sous les nouveaux ateliers (${before} → ${after})`)
    const worst = worstGap(island, solids([village, fauna]))
    assert.ok(worst.gap >= DECOR_GAP, `graine ${seed} âge ${age} : ${worst.kind} à ${worst.gap.toFixed(2)} u`)
    for (const d of decor(island)) assert.ok(ground.clearAt(d.x, d.z) < 0 || d.kind === 'food', 'le décor debout reste un obstacle')
  }
  Math.random = random
})

test('le décor d’une terre gagnée ne chevauche pas le décor déjà là', () => {
  const kinds = ['foret', 'carriere', 'prairie', 'affleurement', 'crique']
  for (const [seed, pick] of [[11, 2], [42, 0], [99, 1]]) {
    let land = []
    for (let k = 0; k < 12; k++) {
      const isl = new Island(seed, 7, land)
      const kind = kinds[(k + seed) % 5]
      const cs = isl.anchorCandidates(kind, 3)
      const c = cs[pick] ?? cs[0]
      if (c) land = [...land, { kind, q: c.q, r: c.r }]
    }
    const base = decor(new Island(seed, 7, []))
    const island = new Island(seed, 7, land)
    const all = decor(island)
    let worst = Infinity
    for (let a = 0; a < all.length; a++)
      for (let b = a + 1; b < all.length; b++) {
        const A = all[a], B = all[b]
        if (A.src === B.src) continue
        worst = Math.min(worst, Math.hypot(A.x - B.x, A.z - B.z) - A.r - B.r)
      }
    assert.ok(worst >= DECOR_GAP, `graine ${seed} : décor de parcelle à ${worst.toFixed(2)} u d'un autre décor`)
    const kept = all.filter((d) => d.src === null)
    assert.equal(kept.length, base.length, `graine ${seed} : le décor de l'île de base reste entier`)
  }
})

test('l’île ne paraît pas déboisée : au plus un quart du décor est retiré', () => {
  for (const [seed, age] of CASES) {
    const w = town(seed, age)
    const total = w.island.pickables.reduce((n, m) => n + m.count, 0)
    const gone = w.island.decorRemoved.wood + w.island.decorRemoved.stone + w.island.decorRemoved.food
    assert.ok(gone > 0, `graine ${seed} âge ${age} : du décor était bien sous le bourg`)
    assert.ok(gone / total <= 0.25, `graine ${seed} âge ${age} : ${gone} sur ${total} retirés`)
  }
  Math.random = random
})

test('effacer le décor ne déplace rien de ce qui est sauvegardé', () => {
  seeded(5)
  const island = new Island(42, 7, [])
  const village = new Village(island, 7, false, false)
  village.setWonder(7, 4)
  village.sync(builtFor(7))
  village.setTools(['etain', 'sel'])
  const before = JSON.stringify({ l: village.layout, g: village.goodsAt })
  const fauna = new Fauna(island, village.obstaclePoints)
  fauna.setKnown(true, true, true, true)
  const ground = new Ground(island, [village, fauna])
  assert.ok(island.decorRemoved.stone + island.decorRemoved.food > 0, 'du décor a été retiré')
  village.sync(builtFor(8))
  ground.refresh()
  const after = JSON.parse(JSON.stringify({ l: village.layout, g: village.goodsAt }))
  const prev = JSON.parse(before)
  assert.deepEqual(after.g, prev.g)
  let same = 0
  for (const p of prev.l) {
    const a = after.l.find((x) => x.id === p.id)
    if (!a) continue
    same++
    assert.deepEqual(a, p, `${p.id} n'a pas bougé`)
  }
  assert.ok(same >= prev.l.length - 4, `${same} ateliers comparés sur ${prev.l.length}`)
  Math.random = random
})
