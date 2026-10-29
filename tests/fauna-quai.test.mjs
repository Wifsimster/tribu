import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Vector3 } from 'three'

const warn = console.warn
console.warn = (...a) => {
  if (!String(a[0]).includes('indisponible')) warn(...a)
}

const { Island } = await import('../src/render/island.ts')
const { Village } = await import('../src/render/village.ts')
const { Fauna } = await import('../src/render/fauna.ts')
const { TECHS, livingBuildings } = await import('../src/game/content.ts')

const ALL = new Set(TECHS.flatMap((t) => t.effects.filter((e) => e.kind === 'building').map((e) => e.building)))
const TOOLS = ['etain', 'sel', 'papyrus', 'gouvernail', 'real', 'caoutchouc', 'roulement', 'conteneur', 'terresrares']
const CASES = [[7, 5], [42, 5], [99, 6], [3, 4], [13, 8], [21, 10]]
const HEARTH = { x: -1.15, z: 1.15 }
const FAR = new Vector3(1e4, 0, 1e4)

function seeded(seed, fn) {
  const random = Math.random
  let a = seed >>> 0
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  try {
    return fn()
  } finally {
    Math.random = random
  }
}

function town(seed, age) {
  const island = new Island(seed, age, [])
  const village = new Village(island, age, true, false)
  village.sync(livingBuildings(ALL, age))
  return { island, village }
}

function quayDist(g, x, z) {
  const { w, d } = Village.QUAY
  const rot = Math.atan2(HEARTH.x - g.x, HEARTH.z - g.z)
  const dx = x - g.x
  const dz = z - g.z
  const lx = dx * Math.cos(rot) - dz * Math.sin(rot)
  const lz = dx * Math.sin(rot) + dz * Math.cos(rot)
  const qx = Math.abs(lx) - (w + 0.2) / 2
  const qz = Math.abs(lz) - (d + 0.2) / 2
  const out = Math.hypot(Math.max(qx, 0), Math.max(qz, 0))
  return out > 0 ? out : Math.max(qx, qz)
}

const herds = (f) => [...f.deer, ...f.sheep, ...f.hens, ...f.horses]
const spots = (f) => [...f.deerSpots, ...f.sheepSpots, ...f.henSpots, ...f.horseSpots]

function walk(f, g, secs) {
  f.setKnown(true, true, true, true)
  let min = Infinity
  for (let i = 0; i < secs * 20; i++) {
    f.update(0.05, i * 0.05, FAR, false)
    for (const b of herds(f)) min = Math.min(min, quayDist(g, b.x, b.z))
  }
  return min
}

const snapshot = (f) =>
  JSON.stringify({
    spots: [f.deerSpots, f.sheepSpots, f.henSpots, f.horseSpots],
    pen: f.penCenter,
    coop: f.coopAt,
    beasts: herds(f).map((b) => [b.x, b.z, b.tx, b.tz, b.state]),
  })

function checkClear(f, g, label) {
  for (const s of spots(f)) assert.ok(quayDist(g, s.x, s.z) > 0.5, `${label} : point d'habitat sur le quai`)
  if (f.penCenter)
    assert.ok(
      Math.hypot(f.penCenter.x - g.x, f.penCenter.z - g.z) >= Village.GOODS_R + f.pen.r - 1e-9,
      `${label} : la palissade touche le quai`,
    )
  if (f.coopAt) assert.ok(quayDist(g, f.coopAt.x, f.coopAt.z) > 0.5, `${label} : poulailler sur le quai`)
}

test('quai au chargement : ni bête, ni habitat, ni enclos sur le quai', () => {
  for (const [seed, age] of CASES) {
    const { island, village } = town(seed, age)
    village.setTools(TOOLS.slice(0, age - 1))
    const g = village.goodsAt
    assert.ok(g, `graine ${seed} : pas de quai`)
    for (const rng of [1, 2, 3]) {
      const label = `graine ${seed}, tirage ${rng}`
      seeded(rng, () => {
        const f = new Fauna(island, village.obstaclePoints)
        f.setBlockers(village.blockers)
        checkClear(f, g, label)
        for (const b of herds(f)) assert.ok(quayDist(g, b.x, b.z) > 0, `${label} : bête posée sur le quai`)
        const min = walk(f, g, 60)
        assert.ok(min > 0, `${label} : une bête passe à ${min.toFixed(2)} du bord`)
      })
    }
  }
})

test('quai posé en cours de partie : les bêtes déjà là le quittent et n’y reviennent pas', () => {
  for (const [seed, age] of CASES) {
    const { island, village } = town(seed, age)
    village.setTools(['etain'])
    for (const rng of [1, 2, 3]) {
      const label = `graine ${seed}, tirage ${rng}`
      seeded(rng, () => {
        const f = new Fauna(island, village.obstaclePoints)
        f.setBlockers(village.blockers)
        f.setKnown(true, true, true, true)
        for (let i = 0; i < 200; i++) f.update(0.05, i * 0.05, FAR, false)
        const v = new Village(island, age, true, false)
        v.sync(livingBuildings(ALL, age))
        v.goodsAvoid = [f.pen]
        v.setTools(['etain', 'sel'])
        const g = v.goodsAt
        assert.ok(g, `${label} : pas de quai`)
        f.setBlockers(v.blockers)
        checkClear(f, g, label)
        const min = walk(f, g, 60)
        assert.ok(min > 0, `${label} : une bête passe à ${min.toFixed(2)} du bord`)
      })
    }
  }
})

test('sans quai, la faune reste exactement celle d’avant', () => {
  for (const [seed, age] of CASES) {
    const { island, village } = town(seed, age)
    village.setTools(['etain'])
    assert.equal(village.blockers.length, 0)
    const before = seeded(5, () => snapshot(new Fauna(island, village.obstaclePoints)))
    const after = seeded(5, () => {
      const f = new Fauna(island, village.obstaclePoints)
      f.setBlockers(village.blockers)
      return snapshot(f)
    })
    assert.equal(after, before, `graine ${seed} : setBlockers([]) a changé la faune`)
  }
})

function penVsBuildings(f, village) {
  const FP = Village.FOOTPRINT
  let min = Infinity
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2
    const px = f.penCenter.x + Math.cos(a) * 3.1
    const pz = f.penCenter.z + Math.sin(a) * 3.1
    for (const p of village.propPlacements) min = Math.min(min, Math.hypot(px - p.x, pz - p.z) - (FP[p.id] ?? 0.5))
  }
  return min
}

test('l’enclos ne plante jamais sa palissade dans un bâtiment ni sur le quai', () => {
  for (const [seed, age] of CASES) {
    for (const quay of [true, false]) {
      const { island, village } = town(seed, age)
      village.setTools(quay ? TOOLS.slice(0, age - 1) : ['etain'])
      const g = village.goodsAt
      assert.equal(!!g, quay, `graine ${seed} : quai inattendu`)
      for (let rng = 1; rng <= 8; rng++) {
        const label = `graine ${seed}, ${quay ? 'quai' : 'sans quai'}, tirage ${rng}`
        seeded(rng, () => {
          const f = new Fauna(island, village.obstaclePoints)
          f.setBlockers(village.blockers)
          assert.ok(f.penCenter, `${label} : plus d'enclos`)
          const m = penVsBuildings(f, village)
          assert.ok(m >= 0.2, `${label} : palissade à ${m.toFixed(2)} d'un bâtiment`)
          if (g)
            for (let i = 0; i < 48; i++) {
              const a = (i / 48) * Math.PI * 2
              const d = quayDist(g, f.penCenter.x + Math.cos(a) * 3.1, f.penCenter.z + Math.sin(a) * 3.1)
              assert.ok(d > 0.2, `${label} : palissade à ${d.toFixed(2)} du quai`)
            }
        })
      }
    }
  }
})

test('les villageois contournent un quai posé après eux', async () => {
  const { Villagers } = await import('../src/render/villagers.ts')
  for (const [seed, age] of CASES) {
    const { island, village } = town(seed, age)
    village.setTools(TOOLS.slice(0, age - 1))
    const g = village.goodsAt
    assert.ok(g, `graine ${seed} : pas de quai`)
    seeded(1, () => {
      const v = new Villagers(island, village.obstaclePoints)
      v.setBlockers(village.blockers)
      v.setPopulation(2)
      for (const s of v.souls) {
        s.x = g.x + 0.3
        s.z = g.z - 0.2
      }
      let worst = -Infinity
      for (let i = 0; i < 400; i++) {
        v.update(0.05, i * 0.05, false)
        if (i === 0) for (const s of v.souls) assert.ok(quayDist(g, s.x, s.z) > 0, `graine ${seed} : âme laissée sur le quai`)
        for (const s of v.souls) worst = Math.max(worst, -quayDist(g, s.x, s.z))
      }
      assert.ok(worst < 0, `graine ${seed} : villageois à ${worst.toFixed(2)} dans le quai`)
    })
  }
})
