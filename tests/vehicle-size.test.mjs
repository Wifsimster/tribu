import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Box3, Matrix4, Quaternion, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

const warn = console.warn
console.warn = (...a) => {
  if (!String(a[0]).includes('indisponible')) warn(...a)
}

const { Island, GROUND_Y } = await import('../src/render/island.ts')
const { Village } = await import('../src/render/village.ts')
const { Fauna } = await import('../src/render/fauna.ts')
const { Ground } = await import('../src/render/ground.ts')
const { Settler } = await import('../src/render/settler.ts')
const { ExpeditionBoat } = await import('../src/render/expedition-boat.ts')
const { Caravan } = await import('../src/render/caravan.ts')
const { adoptModel } = await import('../src/render/models.ts')
const { BOAT_MODELS, FILE_SIZE, REAL_SIZE_M, UNITS_PER_METRE, VEHICLE_SCALE } = await import('../src/render/vehicles.ts')
const { TECHS, TOOLS, RELICS, livingBuildings } = await import('../src/game/content.ts')

const IDS = [...BOAT_MODELS, 'merchant', 'car', 'plane']

for (const id of IDS) {
  const b = readFileSync(new URL(`../src/assets/models/${id}.glb`, import.meta.url))
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '')
  let geo = null
  gltf.scene.traverse((o) => {
    if (!geo && o.isMesh) geo = o.geometry
  })
  assert.ok(adoptModel(id, geo), `${id}.glb adopté`)
}

function worldBox(root) {
  root.updateWorldMatrix(true, true)
  const box = new Box3()
  root.traverse((o) => {
    if (o.isMesh && o.visible) box.union(new Box3().setFromObject(o, true))
  })
  return box
}
const size = (b) => b.getSize(new Vector3())
const span = (b) => Math.max(size(b).x, size(b).z)

const applied = (id) => (FILE_SIZE[id] * VEHICLE_SCALE[id]) / UNITS_PER_METRE

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

function town(seed, age) {
  seeded(seed * 7 + age)
  const island = new Island(seed, age, [])
  const village = new Village(island, age, age >= 8, false)
  village.setWonder(age, 4)
  village.sync(builtFor(age))
  village.setRelics(RELICS.slice(0, Math.floor(age * 1.2)).map((r) => r.id))
  const fauna = new Fauna(island, village.obstaclePoints)
  village.goodsAvoid = fauna.pen ? [fauna.pen] : []
  village.setTools(TOOLS.filter((t) => t.age <= age).map((t) => t.id))
  fauna.setKnown(true, true, true, true)
  const ground = new Ground(island, [village, fauna])
  village.fitMovers((x, z) => ground.clearAt(x, z), [fauna])
  for (let i = 0; i < 3 && ground.refresh(); i++) village.fitMovers((x, z) => ground.clearAt(x, z), [fauna])
  Math.random = random
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
        const top = Math.max(...ids.map((i) => oy + P[i * 3 + 1] * k))
        if (top < Math.max(f.minY, GROUND_Y + 0.2)) continue
        const xz = ids.flatMap((i) => [ox + P[i * 3] * k, oz + P[i * 3 + 2] * k])
        tris.push({ xz, top, x0: Math.min(xz[0], xz[2], xz[4]), x1: Math.max(xz[0], xz[2], xz[4]), z0: Math.min(xz[1], xz[3], xz[5]), z1: Math.max(xz[1], xz[3], xz[5]) })
      }
    }
  const seg = (px, pz, ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az
    const L = dx * dx + dz * dz
    const u = L < 1e-12 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L))
    return Math.hypot(px - ax - u * dx, pz - az - u * dz)
  }
  const C = 1, R = 3
  const grid = new Map()
  for (const t of tris)
    for (let i = Math.floor((t.x0 - R) / C); i <= Math.floor((t.x1 + R) / C); i++)
      for (let j = Math.floor((t.z0 - R) / C); j <= Math.floor((t.z1 + R) / C); j++) {
        const k = i * 100003 + j
        if (!grid.has(k)) grid.set(k, [])
        grid.get(k).push(t)
      }
  return (x, z, y = -Infinity) => {
    let best = R
    for (const { xz: [ax, az, bx, bz, cx, cz], top, x0, x1, z0, z1 } of grid.get(Math.floor(x / C) * 100003 + Math.floor(z / C)) ?? []) {
      if (top <= y) continue
      if (x < x0 - best || x > x1 + best || z < z0 - best || z > z1 + best) continue
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

function trees(island) {
  const out = []
  const m = new Matrix4(), p = new Vector3(), q = new Quaternion(), s = new Vector3()
  for (const mesh of island.pickables) {
    if (island.kindFor(mesh) !== 'wood') continue
    mesh.geometry.computeBoundingBox()
    const g = mesh.geometry.boundingBox
    for (let i = 0; i < mesh.count; i++) {
      if (island.isFelled(mesh, i)) continue
      mesh.getMatrixAt(i, m)
      m.decompose(p, q, s)
      if (s.x < 0.01) continue
      out.push({ x: p.x, z: p.z, r: Math.max(-g.min.x, g.max.x, -g.min.z, g.max.z) * s.x, top: p.y + g.max.y * s.y })
    }
  }
  return out
}

function samples(root) {
  root.updateWorldMatrix(true, true)
  const out = []
  const v = [new Vector3(), new Vector3(), new Vector3()]
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return
    const pos = o.geometry.getAttribute('position')
    const idx = o.geometry.index
    const n = idx ? idx.count / 3 : pos.count / 3
    for (let t = 0; t < n; t++) {
      for (let c = 0; c < 3; c++) v[c].fromBufferAttribute(pos, idx ? idx.getX(t * 3 + c) : t * 3 + c).applyMatrix4(o.matrixWorld)
      out.push(v[0].clone(), v[0].clone().add(v[1]).add(v[2]).multiplyScalar(1 / 3))
    }
  })
  return out
}

function hullGrid(root, margin) {
  const b = worldBox(root)
  const out = []
  for (let x = b.min.x - margin; x <= b.max.x + margin + 1e-9; x += 0.25)
    for (let z = b.min.z - margin; z <= b.max.z + margin + 1e-9; z += 0.25) out.push({ x, z })
  return out
}

function settlerHeight() {
  const s = new Settler(new Island(42, 0, []))
  return size(worldBox(s.rig)).y
}

const CASES = [[42, 8], [99, 10], [7, 8], [1337042, 9], [2024, 10]]

test('le colon mesure bien 2,2 u, l’étalon des tailles réelles', () => {
  const h = settlerHeight()
  assert.ok(Math.abs(h - 2.2) < 0.15, `colon : ${h.toFixed(2)} u`)
  assert.ok(Math.abs(UNITS_PER_METRE - 2.2 / 1.7) < 1e-9)
})

test('chaque véhicule est, à 10 % près, à la taille appliquée par rapport au colon', () => {
  const h = settlerHeight()
  const got = {}
  const boat = new ExpeditionBoat()
  BOAT_MODELS.forEach((id, t) => {
    boat.setTier(t)
    boat.adopt(t)
    boat.group.rotation.set(0, 0, 0)
    got[id] = span(worldBox(boat.tiers[t]))
  })
  const caravan = new Caravan()
  caravan.adopt()
  caravan.group.visible = true
  got.merchant = span(worldBox(caravan.hull))
  const { village } = town(42, 8)
  village.car.rotation.set(0, 0, 0)
  got.car = span(worldBox(village.car))
  const roomy = town(42, 10).village
  assert.equal(roomy.planeK, VEHICLE_SCALE.plane)
  roomy.plane.rotation.set(0, 0, 0)
  got.plane = span(worldBox(roomy.plane))
  for (const id of IDS) {
    const ratio = got[id] / h
    const want = applied(id) / 1.7
    assert.ok(Math.abs(ratio / want - 1) <= 0.1, `${id} : ${ratio.toFixed(2)} colons, visé ${want.toFixed(2)}`)
  }
})

test('le réel partout où il tient ; sinon au plafond, jamais plus grand que le réel', () => {
  const CAPPED = new Set(['caravel', 'steamer', 'merchant', 'plane'])
  for (const id of IDS) {
    const real = REAL_SIZE_M[id]
    const r = applied(id) / real
    if (CAPPED.has(id)) assert.ok(r < 0.9, `${id} : ${(r * 100).toFixed(0)} % du réel, il n'est plus plafonné`)
    else assert.ok(Math.abs(r - 1) <= 0.1, `${id} : ${(r * 100).toFixed(0)} % du réel`)
    assert.ok(r <= 1.1, `${id} plus grand que nature`)
  }
  for (const id of ['caravel', 'steamer', 'merchant']) assert.ok(FILE_SIZE[id] * VEHICLE_SCALE[id] <= 12.5 + 1e-6, id)
  const len = BOAT_MODELS.map((id) => FILE_SIZE[id] * VEHICLE_SCALE[id])
  for (let t = 1; t < 4; t++) assert.ok(len[t] > len[t - 1], `${BOAT_MODELS[t]} plus court que ${BOAT_MODELS[t - 1]}`)
})

test('le passager reste assis sur le pont, à la taille du colon', () => {
  const boat = new ExpeditionBoat()
  BOAT_MODELS.forEach((id, t) => {
    boat.setTier(t)
    boat.adopt(t)
    const deck = worldBox(boat.tiers[t])
    const rider = worldBox(boat.rider)
    const c = rider.getCenter(new Vector3())
    assert.ok(c.x > deck.min.x && c.x < deck.max.x && Math.abs(c.z) < deck.max.z, `${id} : passager hors de la coque`)
    assert.ok(Math.abs(size(rider).y - 1.63) < 0.2, `${id} : passager de ${size(rider).y.toFixed(2)} u`)
    assert.ok(rider.min.y > deck.min.y && rider.min.y < deck.max.y, `${id} : assise à ${rider.min.y.toFixed(2)}`)
  })
})

test('à quai, chaque palier de la barque flotte, poupe au bout du ponton, sans toucher la côte', () => {
  for (const [seed, age] of CASES) {
    const { island, village } = town(seed, age)
    const jetty = solids([{ groundFootprints: () => village.groundFootprints().filter((f) => f.tris && f.minY === -Infinity) }])
    const boat = new ExpeditionBoat()
    boat.moorAt(village.jettyEnd)
    BOAT_MODELS.forEach((id, t) => {
      boat.setTier(t)
      boat.adopt(t)
      boat.update(0, 0)
      for (const p of hullGrid(boat.tiers[t], 0.3)) {
        boat.group.updateWorldMatrix(true, false)
        const local = boat.group.worldToLocal(new Vector3(p.x, 0, p.z))
        const b = boat.tiers[t].geometry.boundingBox
        const k = boat.tiers[t].scale.x
        if (local.x < b.min.x * k - 0.3 || local.x > b.max.x * k + 0.3 || Math.abs(local.z) > b.max.z * k + 0.3) continue
        assert.ok(!island.isLand(p.x, p.z), `graine ${seed} âge ${age} : ${id} à quai touche la terre en ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`)
        assert.ok(jetty(p.x, p.z) > 0.2, `graine ${seed} âge ${age} : ${id} sur le ponton`)
      }
    })
  }
})

test('la barque appareille là où sa coque entière flotte', () => {
  for (const [seed, age] of CASES) {
    const island = new Island(seed, age, [])
    const settler = new Settler(island)
    const isLand = (x, z) => island.isLand(x, z)
    const boat = new ExpeditionBoat()
    BOAT_MODELS.forEach((id, t) => {
      boat.setTier(t)
      boat.adopt(t)
      for (const out of [true, false]) {
        if (out) boat.launchOut(settler.shorePoint, isLand)
        else boat.sailIn(settler.shorePoint, isLand)
        const k = boat.tiers[t].scale.x
        const b = boat.tiers[t].geometry.boundingBox
        const dir = new Vector3(settler.shorePoint.x, 0, settler.shorePoint.z).normalize()
        const c = out ? boat.from : boat.to
        for (let u = b.min.x * k; u <= b.max.x * k; u += 0.25)
          for (let v = -b.max.z * k; v <= b.max.z * k; v += 0.25)
            assert.ok(!island.isLand(c.x + dir.x * u - dir.z * v, c.z + dir.z * u + dir.x * v), `graine ${seed} : ${id} appareille sur la plage`)
        boat.state = 'hidden'
      }
    })
  }
})

test('la barque marchande mouille en eau libre, et sa route reste au large', () => {
  for (const [seed, age] of [...CASES, [20, 8], [41, 10], [777, 8]]) {
    const island = new Island(seed, age, [])
    const caravan = new Caravan()
    caravan.adopt()
    caravan.fitShore((x, z) => island.isLand(x, z))
    caravan.arrive()
    const check = (where) => {
      caravan.group.rotation.x = caravan.group.rotation.z = 0
      const mesh = caravan.hull
      mesh.updateWorldMatrix(true, false)
      const b = mesh.geometry.boundingBox ?? (mesh.geometry.computeBoundingBox(), mesh.geometry.boundingBox)
      for (let u = b.min.x; u <= b.max.x; u += 0.2)
        for (let v = b.min.z; v <= b.max.z; v += 0.2) {
          const p = mesh.localToWorld(new Vector3(u, 0, v))
          assert.ok(!island.isLand(p.x, p.z), `graine ${seed} : marchand ${where} sur la terre (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`)
        }
    }
    for (let i = 0; i < 80; i++) {
      caravan.update(0.1, i * 0.1, true)
      check('en approche')
    }
    assert.equal(caravan.docked, true)
    check('à quai')
    caravan.depart()
    for (let i = 0; i < 80; i++) {
      caravan.update(0.1, i * 0.1, true)
      if (caravan.group.visible) check('au départ')
    }
  }
})

const PLANE_CASES = [
  [1, 9], [2, 10], [3, 9], [5, 10], [10, 10], [11, 9], [123, 8], [777, 8],
  [31337, 10], [4242, 9], [900, 8], [65, 9], [8, 9], [314, 10], [2718, 8], [555, 10],
]

test('l’auto ne roule que là où sa caisse passe : ni bâtiment, ni réverbère, ni arbre', () => {
  let rolling = 0
  for (const [seed, age] of CASES) {
    const w = town(seed, age)
    const v = w.village
    assert.ok(v.carSpan || v.carPark, `graine ${seed} âge ${age} : ni route ni place pour l'auto`)
    if (v.carSpan) {
      rolling++
      assert.ok(v.carSpan.to - v.carSpan.from >= Village.CAR_MIN_RUN, `graine ${seed} âge ${age} : portion trop courte`)
    }
    const sd = solids([v, w.fauna])
    const tr = trees(w.island)
    const len = v.carSpan ? v.carSpan.to - v.carSpan.from : 0
    const total = len * 2 + 10
    let worst = Infinity
    for (let s = 0; s < total / 3.4; s += 0.1) {
      v.carT = s
      v.tickCar(0)
      if (!v.car.visible) continue
      for (const p of samples(v.car)) {
        worst = Math.min(worst, sd(p.x, p.z, p.y))
        for (const t of tr) if (p.y < t.top) assert.ok(Math.hypot(p.x - t.x, p.z - t.z) > t.r, `graine ${seed} : l'auto dans un sapin`)
        assert.ok(w.island.isLand(p.x, p.z), `graine ${seed} : l'auto dans l'eau`)
      }
    }
    assert.ok(worst >= 0.1, `graine ${seed} âge ${age} : l'auto à ${worst.toFixed(2)} u d'un bâtiment`)
  }
  for (const [seed, age] of PLANE_CASES) if (town(seed, age).village.carSpan) rolling++
  const n = CASES.length + PLANE_CASES.length
  assert.ok(rolling >= 11, `l'auto ne roule que dans ${rolling} bourgs sur ${n}`)
})


test('l’avion, au repos, au roulage, au décollage et au retour : « clear » veut dire 0,5 u de tout plein (bâtiments et faune) et de tout sapin', (t) => {
  const sizes = new Map()
  for (const [seed, age] of PLANE_CASES) {
    const w = town(seed, age)
    const v = w.village
    assert.ok(v.plane, 'un avion')
    const sd = solids([v, w.fauna])
    const tr = trees(w.island)
    let worst = Infinity
    let worstTree = Infinity
    const probe = () => {
      for (const p of samples(v.plane)) {
        worst = Math.min(worst, sd(p.x, p.z, p.y))
        for (const t of tr) if (p.y < t.top + 0.5) worstTree = Math.min(worstTree, Math.hypot(p.x - t.x, p.z - t.z) - t.r)
      }
    }
    v.planeRest()
    probe()
    let onTrain = 0
    for (const dir of [1, -1]) {
      if (dir === 1) v.planeDepart()
      else v.planeArrive()
      for (let i = 0; i < 200 * 50 && v.flight >= 0; i++) {
        v.tickTrain(5.5 / 200)
        v.tickPlane(5.5 / 200)
        if (!v.plane.visible) continue
        if (v.plane.position.y - GROUND_Y > Village.PLANE_LOW + 2) continue
        probe()
        for (const p of samples(v.plane)) {
          if (p.y > GROUND_Y + 0.215 + 1.45) continue
          for (const c of v.trainPoses) {
            const dx = p.x - c.x
            const dz = p.z - c.z
            const along = dx * Math.sin(c.yaw) + dz * Math.cos(c.yaw)
            const across = dx * Math.cos(c.yaw) - dz * Math.sin(c.yaw)
            if (Math.abs(along) < c.len / 2 + 0.1 && Math.abs(across) < 0.72) onTrain++
          }
        }
      }
      assert.ok(v.flight < 0, `graine ${seed} âge ${age} : le vol ne finit pas`)
    }
    assert.equal(onTrain, 0, `graine ${seed} âge ${age} : l'avion traverse la rame`)
    v.planeRest()
    for (const p of samples(v.plane))
      if (p.y < GROUND_Y + 0.215 + 1.45) assert.ok(v.beltDist(p.x, p.z) >= 0.72, `graine ${seed} âge ${age} : l'avion garé sur la voie`)
    if (v.planeFit === 'clear') assert.ok(worst >= 0.5, `graine ${seed} âge ${age} : « clear », et l'avion à ${worst.toFixed(2)} u d'un plein`)
    else {
      assert.equal(v.planeK, 1, `graine ${seed} : serré, l'avion devait reprendre sa taille 3.62.0`)
      assert.ok(worst > 0, `graine ${seed} âge ${age} : serré, l'avion dans un plein`)
    }
    assert.ok(!(Math.min(v.planeClearance, 3) > worst + 0.05), `graine ${seed} : le jeu voit ${v.planeClearance?.toFixed(2)} u, il y en a ${worst.toFixed(2)}`)
    assert.ok(worstTree >= 0.5, `graine ${seed} âge ${age} : l'avion à ${worstTree.toFixed(2)} u d'un sapin`)
    v.planeRest()
    const b = worldBox(v.plane)
    assert.ok(Math.abs(b.min.y - (GROUND_Y + 0.06)) < 0.08, `roues à ${b.min.y.toFixed(2)}`)
    for (const p of samples(v.plane))
      if (p.y < GROUND_Y + 0.3) assert.ok(w.island.isLand(p.x, p.z), `graine ${seed} : l'avion garé sur l'eau en ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`)
    const key = `×${v.planeK}${v.planeFit === 'tight' ? ' (serré)' : ''}`
    sizes.set(key, (sizes.get(key) ?? 0) + 1)
    t.diagnostic(`graine ${seed} âge ${age} : ×${v.planeK} ${v.planeFit}, marge mesurée ${worst.toFixed(2)} u (jeu : ${v.planeClearance?.toFixed(2)})`)
  }
  t.diagnostic(`tailles sur ${PLANE_CASES.length} bourgs : ${[...sizes].map(([k, n]) => `${k} : ${n}`).join(', ')}`)
})
