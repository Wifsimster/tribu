import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Vector3 } from 'three'

const warn = console.warn
console.warn = (...a) => {
  if (!String(a[0]).includes('indisponible')) warn(...a)
}

const { Island, GROUND_Y } = await import('../src/render/island.ts')
const { Village } = await import('../src/render/village.ts')
const { Fauna } = await import('../src/render/fauna.ts')
const { Settler } = await import('../src/render/settler.ts')
const { Villagers } = await import('../src/render/villagers.ts')
const { Ground } = await import('../src/render/ground.ts')
const { TECHS, RELICS, livingBuildings } = await import('../src/game/content.ts')

const HEARTH = { x: -1.15, z: 1.15 }

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

function town(seed, age) {
  seeded(seed * 7 + age)
  const built = new Set(TECHS.filter((t) => t.age <= age).flatMap((t) => t.effects.filter((e) => e.kind === 'building').map((e) => e.building)))
  const island = new Island(seed, age, [])
  const village = new Village(island, age, age >= 8, false)
  village.setWonder(age, 4)
  village.sync(livingBuildings(built, age))
  village.setRelics(RELICS.slice(0, Math.floor(age * 1.2)).map((r) => r.id))
  const settler = new Settler(island)
  const fauna = new Fauna(island, village.obstaclePoints)
  const villagers = new Villagers(island, village.obstaclePoints)
  villagers.setPopulation(2)
  fauna.setKnown(true, true, true, true)
  const ground = new Ground(island, [village, fauna])
  settler.setGround(ground)
  fauna.setGround(ground)
  villagers.setGround(ground)
  return { island, village, settler, fauna, villagers, ground }
}

function solids(v) {
  const tris = []
  const add = (geo, ox = 0, oz = 0, k = 1, minY = GROUND_Y + 0.12) => {
    if (!geo) return
    const P = geo.getAttribute('position').array
    const I = geo.index ? geo.index.array : null
    const n = I ? I.length / 3 : P.length / 9
    for (let t = 0; t < n; t++) {
      const ids = [0, 1, 2].map((c) => (I ? I[t * 3 + c] : t * 3 + c))
      const ys = ids.map((i) => P[i * 3 + 1] * k + (k === 1 ? 0 : GROUND_Y))
      if (Math.max(...ys) < minY) continue
      tris.push(ids.flatMap((i) => [ox + P[i * 3] * k, oz + P[i * 3 + 2] * k]))
    }
  }
  add(v.propsGeo)
  add(v.wonderGeo)
  add(v.museumGeo, 0, 0, 1, GROUND_Y + 0.05)
  add(v.campGeo, HEARTH.x, HEARTH.z, 1.2, GROUND_Y + 0.12 * 1.2)
  const cells = new Map()
  for (const t of tris) {
    const x0 = Math.floor(Math.min(t[0], t[2], t[4])), x1 = Math.floor(Math.max(t[0], t[2], t[4]))
    const z0 = Math.floor(Math.min(t[1], t[3], t[5])), z1 = Math.floor(Math.max(t[1], t[3], t[5]))
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const key = i * 4096 + j
      if (!cells.has(key)) cells.set(key, [])
      cells.get(key).push(t)
    }
  }
  return (x, z) => {
    for (const t of cells.get(Math.floor(x) * 4096 + Math.floor(z)) ?? []) {
      const [ax, az, bx, bz, cx, cz] = t
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
      if (Math.abs(d) < 1e-12) continue
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d
      const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d
      if (l1 >= 0 && l2 >= 0 && 1 - l1 - l2 >= 0) return true
    }
    return false
  }
}

const CASES = [[42, 7], [99, 10], [7, 5]]

test('le colon ne traverse aucun bâtiment ni abri pour aller travailler', () => {
  for (const [seed, age] of CASES) {
    const w = town(seed, age)
    const inside = solids(w.village)
    seeded(seed)
    const spots = []
    for (const m of w.island.pickables)
      for (let i = 0; i < m.count; i += 3) if (!w.island.isFelled(m, i)) spots.push(w.island.instancePosition(m, i))
    let frames = 0
    let hits = 0
    let trips = 0
    for (let k = 0; k < 6; k++) {
      w.settler.sendTo(spots[(k * 7) % spots.length])
      for (let s = 0; s < 60 * 40; s++) {
        w.settler.update(1 / 60, 1)
        const p = w.settler.group.position
        frames++
        if (inside(p.x, p.z)) hits++
        if (w.settler.phase === 'work') {
          trips++
          break
        }
      }
    }
    assert.equal(hits, 0, `graine ${seed} âge ${age} : ${hits} images sur ${frames} dans un mur`)
    assert.ok(trips >= 5, `graine ${seed} âge ${age} : ${trips} cibles atteintes sur 6`)
  }
  Math.random = random
})

test('villageois et faune restent hors du bâti et sur la terre, sans rester plantés', () => {
  for (const [seed, age] of CASES) {
    const w = town(seed, age)
    const inside = solids(w.village)
    seeded(seed + 1)
    const far = new Vector3(1e4, 0, 1e4)
    const herds = [w.fauna.deer, w.fauna.sheep, w.fauna.hens, w.fauna.horses]
    const last = new Map()
    let wall = 0
    let water = 0
    let stuck = 0
    for (let s = 0; s < 60 * 120; s++) {
      const t = s / 60
      w.villagers.update(1 / 60, t, false, false)
      w.fauna.update(1 / 60, t, far, false)
      const bodies = [...w.villagers.souls.slice(0, 2), ...herds.flat()]
      bodies.forEach((b, i) => {
        if (inside(b.x, b.z)) wall++
        if (!w.island.isLand(b.x, b.z)) water++
        const l = last.get(i) ?? { x: b.x, z: b.z, t }
        if (Math.hypot(b.x - l.x, b.z - l.z) > 0.02) last.set(i, { x: b.x, z: b.z, t })
        else {
          last.set(i, l)
          if (t - l.t > 25) stuck++
        }
      })
    }
    assert.equal(wall, 0, `graine ${seed} âge ${age} : ${wall} images dans un mur`)
    assert.equal(water, 0, `graine ${seed} âge ${age} : ${water} images dans l'eau`)
    assert.equal(stuck, 0, `graine ${seed} âge ${age} : un mobile immobile plus de 25 s`)
  }
  Math.random = random
})

test("le cadastre ne déplace rien : le plan et le quai restent au millième", () => {
  const island = new Island(42, 7, [])
  const village = new Village(island, 7, false, false)
  const built = new Set(TECHS.filter((t) => t.age <= 7).flatMap((t) => t.effects.filter((e) => e.kind === 'building').map((e) => e.building)))
  village.sync(livingBuildings(built, 7))
  village.setTools(['etain', 'sel'])
  const before = JSON.stringify({ l: village.layout, g: village.goodsAt })
  const fauna = new Fauna(island, village.obstaclePoints)
  fauna.setKnown(true, true, true, true)
  const ground = new Ground(island, [village, fauna])
  ground.refresh()
  assert.equal(JSON.stringify({ l: village.layout, g: village.goodsAt }), before)
})

test('une emprise posée en cours de partie refait le cadastre et en chasse le colon', () => {
  const w = town(42, 2)
  const r0 = w.ground.revision
  assert.equal(w.ground.refresh(), false, 'rien de neuf : pas de reconstruction')
  w.village.setTools(['etain', 'sel'])
  const g = w.village.goodsAt
  assert.ok(g, 'le quai est posé')
  assert.equal(w.ground.refresh(), true)
  assert.ok(w.ground.revision > r0)
  assert.ok(w.ground.clearAt(g.x, g.z) < 0, 'le centre du quai est plein')
  w.settler.group.position.set(g.x, GROUND_Y, g.z)
  w.settler.sendTo(new Vector3(HEARTH.x + 1.8, 0, HEARTH.z))
  w.settler.update(1 / 60, 1)
  const p = w.settler.group.position
  assert.ok(w.ground.clearAt(p.x, p.z) >= 0, 'sorti du quai')
})

test('un chemin contourne un obstacle au lieu de le traverser', () => {
  const w = town(42, 7)
  const v = w.village
  const pl = v.layout.find((p) => p.id === 'forge') ?? v.layout[0]
  const a = { x: pl.x - 3, z: pl.z }
  const b = { x: pl.x + 3, z: pl.z }
  const A = w.ground.nearestFree(a.x, a.z, 0.3, 4)
  const B = w.ground.nearestFree(b.x, b.z, 0.3, 4)
  const r = w.ground.route(A.x, A.z, B.x, B.z, 0.3)
  assert.ok(r.reached, 'chemin trouvé')
  let px = A.x
  let pz = A.z
  for (const q of r.pts) {
    assert.ok(w.ground.lineClear(px, pz, q.x, q.z, 0.3), 'chaque segment est dégagé')
    px = q.x
    pz = q.z
  }
})

test("un villageois dont le chemin devient impossible après une pose ne traverse pas la nouvelle emprise", () => {
  const w = town(42, 2)
  w.village.setTools(['etain', 'sel'])
  const g = w.village.goodsAt
  w.village.setTools([])
  w.ground.refresh()
  assert.ok(g, 'le quai a une place')
  const s = w.villagers.souls[0]
  const a = w.ground.nearestFree(g.x + 3, g.z, 0.25, 3)
  assert.ok(a, 'un départ libre devant le quai')
  s.home = false
  w.villagers.update(1 / 60, 0, false, false)
  s.x = a.x
  s.z = a.z
  s.walking = true
  s.tx = g.x - 3
  s.tz = g.z
  s.path = [{ x: g.x, z: g.z }, { x: g.x - 3, z: g.z }]
  w.village.setTools(['etain', 'sel'])
  assert.equal(w.ground.refresh(), true)
  const plan = w.villagers.plan
  let calls = 0
  w.villagers.plan = function (so) {
    if (calls++ === 0) return false
    return plan.call(this, so)
  }
  const inside = solids(w.village)
  let walled = 0
  let moved = 0
  const start = { x: s.x, z: s.z }
  for (let f = 0; f < 60 * 30; f++) {
    w.ground.refresh()
    w.villagers.update(1 / 60, f / 60, false, false)
    if (w.ground.clearAt(s.x, s.z) < 0 || inside(s.x, s.z)) walled++
    moved = Math.max(moved, Math.hypot(s.x - start.x, s.z - start.z))
  }
  assert.ok(calls >= 1, 'la pose a fait replanifier')
  assert.equal(walled, 0, `${walled} images dans le quai posé`)
  assert.ok(moved > 0.5, 'il repart vers une autre cible')
})

function pocket(ground, r) {
  const main = ground.mainComponent(r)
  for (let z = -20; z <= 20; z += 0.2)
    for (let x = -20; x <= 20; x += 0.2)
      if (ground.free(x, z, r)) {
        const c = ground.componentAt(x, z, r)
        if (c >= 0 && c !== main) return { x, z }
      }
  return null
}

test('mobiles : nés dans leur composante, sortis d\'une poche, jamais immobiles plus de 10 s', () => {
  let tried = 0
  for (const [seed, age] of [[42, 7], [99, 10], [7, 5], [5, 10], [777, 10]]) {
    const w = town(seed, age)
    const g = w.ground
    const herds = [[w.fauna.deer, 0.3], [w.fauna.sheep, 0.28], [w.fauna.hens, 0.12], [w.fauna.horses, 0.35]]
    w.villagers.update(1 / 60, 0, false, false)
    w.fauna.update(1 / 60, 0, new Vector3(1e4, 0, 1e4), false)
    for (const [herd, r] of herds)
      for (const b of herd)
        if (herd !== w.fauna.sheep) assert.equal(g.componentAt(b.x, b.z, r), g.mainComponent(r), `graine ${seed} âge ${age} : bête née hors de la composante principale`)
    for (const s of w.villagers.souls) assert.equal(g.componentAt(s.x, s.z, 0.25), g.mainComponent(0.25), `graine ${seed} âge ${age} : villageois hors de la composante principale`)
    const P = pocket(g, 0.35)
    if (!P) continue
    tried++
    const victims = [[w.fauna.deer[0], 0.3], [w.fauna.horses[0], 0.35], [w.villagers.souls[0], 0.25]]
    for (const [b] of victims) {
      b.x = P.x
      b.z = P.z
      b.path = []
      if ('state' in b) b.state = 2, b.timer = 0.5
      else b.walking = false, b.timer = 0.5, b.home = false
    }
    const inside = solids(w.village)
    const last = victims.map(([b]) => ({ x: b.x, z: b.z, t: 0 }))
    let worst = 0
    let walled = 0
    let jump = 0
    const prev = victims.map(([b]) => ({ x: b.x, z: b.z }))
    for (let f = 1; f < 60 * 60; f++) {
      const t = f / 60
      w.ground.refresh()
      w.villagers.update(1 / 60, t, false, false)
      w.fauna.update(1 / 60, t, new Vector3(1e4, 0, 1e4), false)
      victims.forEach(([b], i) => {
        if (inside(b.x, b.z)) walled++
        jump = Math.max(jump, Math.hypot(b.x - prev[i].x, b.z - prev[i].z))
        prev[i] = { x: b.x, z: b.z }
        if (Math.hypot(b.x - last[i].x, b.z - last[i].z) > 0.02) last[i] = { x: b.x, z: b.z, t }
        worst = Math.max(worst, t - last[i].t)
      })
    }
    victims.forEach(([b, r]) => assert.equal(g.componentAt(b.x, b.z, r), g.mainComponent(r), `graine ${seed} âge ${age} : toujours dans la poche`))
    assert.equal(walled, 0, `graine ${seed} âge ${age} : ${walled} images dans un mur`)
    assert.ok(worst <= 10, `graine ${seed} âge ${age} : immobile ${worst.toFixed(1)} s`)
    assert.ok(jump < 6, `graine ${seed} âge ${age} : saut de ${jump.toFixed(2)} u`)
  }
  assert.ok(tried >= 1, 'au moins une poche trouvée pour le test')
  Math.random = random
})
