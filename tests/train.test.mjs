// La rame du chemin de fer (v3.57.0) : elle s'allonge avec les âges et charge
// les ressources que la tribu produit le plus. Demande du joueur : « Train
// should have more wagon with progress or resources ».
//   corepack pnpm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const warn = console.warn
console.warn = (...a) => {
  if (!String(a[0]).includes('indisponible')) warn(...a)
}

const C = await import('../src/render/consist.ts')
const { asPart } = await import('../src/render/model-geo.ts')
const { adoptModel } = await import('../src/render/models.ts')
const { Island, GROUND_Y } = await import('../src/render/island.ts')
const { Village } = await import('../src/render/village.ts')
const { TECHS, AGES, RESOURCES, livingBuildings } = await import('../src/game/content.ts')

const deg = (r) => (r * 180) / Math.PI
const angle = (a, b) => {
  const d = Math.abs(((a - b) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  return Math.min(d, 2 * Math.PI - d)
}

async function load(name) {
  const b = readFileSync(new URL(`../src/assets/models/${name}.glb`, import.meta.url))
  const gltf = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '')
  let geo = null
  gltf.scene.traverse((o) => {
    if (!geo && o.isMesh) geo = o.geometry
  })
  return geo
}

// ── La règle de composition ─────────────────────────────────────────────────

test('le chemin de fer est bien un savoir de l’âge 7, et le dernier âge est le 10', () => {
  assert.equal(TECHS.find((t) => t.id === 'railway').age, C.TRAIN_AGE)
  assert.equal(AGES.length - 1, 10)
})

test('chaque ressource matérielle du jeu a son wagon, et seulement elles', () => {
  const mats = Object.keys(RESOURCES).filter((id) => id !== 'insight').sort()
  assert.deepEqual([...C.CARGO].sort(), mats)
})

test('âge 7 : loco + 2 wagons ; un wagon de plus par âge ; voiture dès l’âge 8', () => {
  const rank = ['iron', 'wood', 'stone', 'copper', 'food', 'clay', 'fiber']
  assert.deepEqual(C.consistFor(7, rank), ['loco', 'iron', 'wood'])
  assert.deepEqual(C.consistFor(8, rank), ['loco', 'coach', 'iron', 'wood', 'stone'])
  assert.deepEqual(C.consistFor(9, rank), ['loco', 'coach', 'iron', 'wood', 'stone', 'copper'])
  assert.deepEqual(C.consistFor(10, rank), ['loco', 'coach', 'iron', 'wood', 'stone', 'copper', 'food'])
  // Longueurs annoncées par l'artiste : 5,11 à l'âge 7, 10,85 à l'âge 10.
  assert.ok(Math.abs(C.consistLength(C.consistFor(7, rank)) - 5.11) < 1e-9)
  assert.ok(Math.abs(C.consistLength(C.consistFor(10, rank)) - 10.85) < 1e-9)
})

test('les wagons suivent la production, du plus produit au moins produit', () => {
  const rates = { food: 3, wood: 9, stone: 1, fiber: 0, clay: 2, copper: 0, iron: 5, insight: 99 }
  assert.deepEqual(C.rankCargo(rates), ['wood', 'iron', 'food', 'clay', 'stone'])
  assert.deepEqual(C.consistFor(9, C.rankCargo(rates)), ['loco', 'coach', 'wood', 'iron', 'food', 'clay'])
  // Égalité : l'ordre du catalogue départage, la rame ne change pas au hasard.
  assert.deepEqual(C.rankCargo({ stone: 2, wood: 2 }), ['wood', 'stone'])
})

test('moins de ressources produites que de wagons : wagons couverts en queue', () => {
  assert.deepEqual(C.consistFor(10, ['wood', 'food']), ['loco', 'coach', 'wood', 'food', 'empty', 'empty', 'empty'])
  assert.deepEqual(C.consistFor(7, []), ['loco', 'empty', 'empty'])
})

test('une voie trop courte dételle par la queue, jamais la loco', () => {
  const r = ['wood', 'stone', 'food', 'iron', 'clay']
  assert.deepEqual(C.consistFor(10, r, 6), ['loco', 'coach', 'wood'])
  assert.deepEqual(C.consistFor(10, r, 1), ['loco'])
})

// ── Les fichiers ────────────────────────────────────────────────────────────

for (const [kind, model] of Object.entries(C.CAR_MODEL)) {
  test(`${model}.glb : attelages à ±longueur/2, roues sur le rail, fusionnable`, async () => {
    const geo = asPart(await load(model))
    assert.ok(geo)
    geo.computeBoundingBox()
    const b = geo.boundingBox
    const len = C.CAR_LENGTH[kind]
    assert.ok(Math.abs(b.max.z - b.min.z - len) < 2e-3, `longueur ${b.max.z - b.min.z}`)
    assert.ok(Math.abs(b.max.z + b.min.z) < 2e-3, 'centré en z')
    assert.ok(Math.abs(b.min.y) < 1e-3, 'roues à y = 0 (dessus du rail)')
    assert.ok(b.max.x - b.min.x < 0.84, 'tient dans le gabarit')
    assert.ok(mergeGeometries([geo, geo.clone()]))
  })
}

// ── La pose sur la voie ─────────────────────────────────────────────────────

/** Une voie en S serrée (rayon ≈ 3 u), échantillonnée comme celle du jeu. */
function sTrack() {
  const pts = []
  for (let i = 0; i <= 12; i++) pts.push({ x: 0, z: i * 1.6 })
  const c = pts.at(-1)
  for (let k = 1; k <= 10; k++) {
    const a = (k / 10) * Math.PI
    pts.push({ x: 3 - 3 * Math.cos(a), z: c.z + 3 * Math.sin(a) })
  }
  for (let i = 1; i <= 12; i++) pts.push({ x: 6, z: c.z - i * 1.6 })
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z))
  return { pts, cum }
}

/** Distance d'un point à la polyligne de la voie. */
function offTrack(t, p) {
  let best = Infinity
  for (let i = 1; i < t.pts.length; i++) {
    const a = t.pts[i - 1]
    const b = t.pts[i]
    const vx = b.x - a.x
    const vz = b.z - a.z
    const u = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / (vx * vx + vz * vz)))
    best = Math.min(best, Math.hypot(a.x + vx * u - p.x, a.z + vz * u - p.z))
  }
  return best
}

/** Les bouts réels d'un véhicule rigide posé (centre, cap, longueur). */
function ends(c) {
  const h = C.CAR_LENGTH[c.kind] / 2
  return {
    f: { x: c.x + Math.sin(c.yaw) * h, z: c.z + Math.cos(c.yaw) * h },
    b: { x: c.x - Math.sin(c.yaw) * h, z: c.z - Math.cos(c.yaw) * h },
  }
}

test('en courbe serrée, les attelages se touchent et chaque véhicule garde sa longueur', () => {
  const t = sTrack()
  const cars = C.consistFor(10, ['wood', 'stone', 'food', 'iron', 'clay'])
  let gap = 0
  let off = 0
  for (let s = 12; s < t.cum.at(-1); s += 0.07) {
    const poses = C.layConsist(t, s, 1, cars)
    for (let i = 0; i < poses.length; i++) {
      const e = ends(poses[i])
      off = Math.max(off, offTrack(t, e.f), offTrack(t, e.b))
      if (i > 0) {
        const prev = ends(poses[i - 1])
        gap = Math.max(gap, Math.hypot(prev.b.x - e.f.x, prev.b.z - e.f.z))
      }
    }
    // Dans l'autre sens (la rame refoulée au retour), même exigence.
    const back = C.layConsist(t, t.cum.at(-1) - s, -1, cars)
    for (let i = 1; i < back.length; i++) {
      const a = ends(back[i - 1])
      const b = ends(back[i])
      gap = Math.max(gap, Math.hypot(a.b.x - b.f.x, a.b.z - b.f.z))
    }
  }
  assert.ok(gap < 1e-6, `écart d'attelage max ${gap}`)
  assert.ok(off < 1e-6, `attelage hors de l'axe ${off}`)
})

test('chordFrom tombe à la bonne distance, y compris au-delà du bout de voie', () => {
  const t = sTrack()
  for (const s of [0.3, 5, 21, 30]) {
    for (const d of [1.34, 1.72, 2.43]) {
      const s2 = C.chordFrom(t, s, -1, d)
      const p = C.pointAt(t, s)
      const q = C.pointAt(t, s2)
      assert.ok(Math.abs(Math.hypot(p.x - q.x, p.z - q.z) - d) < 1e-9, `s ${s}, d ${d}`)
      assert.ok(s2 < s)
    }
  }
})

// ── Dans le village : la boucle (incrément 2) ───────────────────────────────

/** Les bâtiments des savoirs d'un âge et des précédents : un bourg qui existe. */
const atAge = (age) =>
  new Set(TECHS.filter((t) => t.age <= age).flatMap((t) => t.effects.filter((e) => e.kind === 'building').map((e) => e.building)))
const K = C.TRAIN_SCALE

async function adoptAll() {
  for (const model of Object.values(C.CAR_MODEL)) assert.ok(adoptModel(model, await load(model)))
}

function village(seed, age, rates) {
  const island = new Island(seed, age, [])
  const v = new Village(island, age, true, false)
  if (rates) v.setCargo(rates)
  v.setWonder(age, 4)
  v.sync(livingBuildings(atAge(age), age))
  return v
}

/** Un tour complet et l'arrêt en gare, image par image (60 i/s), et un peu
 *  plus : la rame repart de la gare et y revient. */
function* lap(v) {
  const period = v.beltLength / 2.2 + 5 + 12
  for (let t = 0; t < period; t += 1 / 60) {
    v.tickTrain(1 / 60)
    yield t
  }
}

/** Les bouts réels d'un véhicule posé (centre, cap, longueur posée). */
function endsOf(c) {
  const h = c.len / 2
  return {
    f: { x: c.x + Math.sin(c.yaw) * h, z: c.z + Math.cos(c.yaw) * h },
    b: { x: c.x - Math.sin(c.yaw) * h, z: c.z - Math.cos(c.yaw) * h },
  }
}

test('la voie est une boucle fermée, sans bout ni heurtoir', () => {
  const v = village(42, 7)
  const t = v.railTrack
  assert.ok(t.closed)
  const a = t.pts[0]
  const b = t.pts.at(-1)
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 1e-9)
  // L'abscisse se lit modulo la longueur, et la pose ne connaît plus de bout.
  const L = t.cum.at(-1)
  const p = C.pointAt(t, 3.3)
  const q = C.pointAt(t, 3.3 + 2 * L)
  assert.ok(Math.hypot(p.x - q.x, p.z - q.z) < 1e-9)
  const poses = C.layConsist(t, 0.5, 1, C.consistFor(10, ['wood', 'stone', 'food', 'iron', 'clay']), K)
  for (let i = 1; i < poses.length; i++) {
    const e = endsOf(poses[i - 1])
    const f = endsOf(poses[i])
    assert.ok(Math.hypot(e.b.x - f.f.x, e.b.z - f.f.z) < 1e-6, 'attelage à cheval sur le point de départ')
  }
})

test('dans le jeu, sur un tour complet : attelages, essieux, cap, roues, arrêt en gare seulement', async () => {
  await adoptAll()
  const report = []
  for (const seed of [1_337_042, 7, 42]) {
    for (const age of [7, 8, 10]) {
      const v = village(seed, age, { iron: 5, wood: 4, stone: 3, copper: 2, food: 1, clay: 0.5 })
      assert.ok(v.train, `graine ${seed}, âge ${age} : une rame`)
      const t = v.railTrack
      const L = t.cum.at(-1)
      assert.equal(v.trainCars.length, age === 7 ? 3 : age === 8 ? 5 : 7, `graine ${seed}, âge ${age}`)
      let gap = 0
      let yawErr = 0
      let off = 0
      let yMin = Infinity
      let prevHead = null
      let stops = 0
      let badStop = 0
      let covered = 0
      for (const _ of lap(v)) {
        const poses = v.trainPoses
        for (let i = 0; i < poses.length; i++) {
          const c = poses[i]
          const e = endsOf(c)
          if (i > 0) {
            const prev = endsOf(poses[i - 1])
            gap = Math.max(gap, Math.hypot(prev.b.x - e.f.x, prev.b.z - e.f.z))
          }
          // Les essieux extrêmes (loco ±0,6/−0,7, voiture ±0,52, wagon ±0,4
          // au modèle), à l'échelle de la rame : à combien de l'axe de la
          // voie ? Le rail fait 8 cm, la roue 6.
          const ax = c.kind === 'loco' ? [0.6, -0.7] : c.kind === 'coach' ? [0.52, -0.52] : [0.4, -0.4]
          for (const k of ax)
            off = Math.max(off, offTrack(t, { x: c.x + Math.sin(c.yaw) * k * K, z: c.z + Math.cos(c.yaw) * k * K }))
          // Le cap comparé à la tangente de la voie au centre du véhicule.
          const sc = (c.sFront + c.sBack) / 2
          const a = C.pointAt(t, sc - 0.05)
          const b = C.pointAt(t, sc + 0.05)
          yawErr = Math.max(yawErr, angle(c.yaw, Math.atan2(b.x - a.x, b.z - a.z)))
        }
        const y = v.train.geometry.attributes.position.array
        for (let i = 1; i < y.length; i += 3 * 37) yMin = Math.min(yMin, y[i])
        // Arrêt = la tête n'avance plus d'une image à l'autre. Il n'a lieu
        // qu'à l'abscisse de la gare.
        const head = poses[0].sFront
        if (prevHead !== null) {
          const d = (((head - prevHead) % L) + L) % L
          covered += d < L / 2 ? d : 0
          if (d < 1e-9) {
            stops++
            const at = Math.min((((head - v.trainStop) % L) + L) % L, (((v.trainStop - head) % L) + L) % L)
            if (at > 1e-6) badStop++
          }
        }
        prevHead = head
      }
      report.push({ seed, age, gap, yawErr: deg(yawErr), off, yMin, stops, covered, L })
      assert.ok(gap < 1e-6, `graine ${seed}, âge ${age} : écart d'attelage ${gap}`)
      assert.ok(off < 0.1, `graine ${seed}, âge ${age} : essieu à ${off} de l'axe`)
      assert.ok(deg(yawErr) < 12, `graine ${seed}, âge ${age} : cap à ${deg(yawErr)}° de la voie`)
      assert.ok(yMin >= GROUND_Y + 0.215 - 1e-4, `graine ${seed}, âge ${age} : roues sous le rail (${yMin})`)
      assert.equal(badStop, 0, `graine ${seed}, âge ${age} : ${badStop} images d'arrêt hors de la gare`)
      assert.ok(stops > 0, `graine ${seed}, âge ${age} : la rame ne s'arrête jamais en gare`)
      assert.ok(covered >= L - 1e-6, `graine ${seed}, âge ${age} : la rame n'a pas fait le tour (${covered.toFixed(1)} / ${L.toFixed(1)})`)
    }
  }
  if (process.env.TRAIN_REPORT) console.log(JSON.stringify(report))
})

test('à l’arrêt en gare, la voiture de voyageurs est devant l’abri du quai', async () => {
  await adoptAll()
  const v = village(1_337_042, 10, { wood: 1 })
  const t = v.railTrack
  const poses = C.layConsist(t, v.trainStop, 1, v.trainCars, K)
  const coach = poses[1]
  assert.equal(coach.kind, 'coach')
  const L = t.cum.at(-1)
  const mid = ((((coach.sFront + coach.sBack) / 2 - v.railStop) % L) + L) % L
  assert.ok(Math.min(mid, L - mid) < 0.05)
})

test('la composition ne change qu’en gare, et seulement les cargaisons', async () => {
  await adoptAll()
  const v = village(42, 9, { wood: 5, stone: 4, food: 3, iron: 2 })
  assert.deepEqual(v.trainCars, ['loco', 'coach', 'wood', 'stone', 'food', 'iron'])
  v.setCargo({ iron: 9, clay: 8, wood: 1 })
  let changedAt = null
  let before = v.trainCars.join()
  for (const _ of lap(v)) {
    if (v.trainCars.join() !== before) {
      // Changement : la rame est à l'arrêt en gare (sa tête au point d'arrêt).
      changedAt = v.trainHead
      before = v.trainCars.join()
    }
  }
  assert.ok(changedAt !== null, 'rechargée au premier passage en gare')
  assert.ok(Math.abs(changedAt - v.trainStop) < 1e-6, `changée à ${changedAt}, gare à ${v.trainStop}`)
  assert.deepEqual(v.trainCars, ['loco', 'coach', 'iron', 'clay', 'wood', 'empty'])
})
