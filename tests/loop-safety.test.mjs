// La boucle ferrée et ses voisins (incrément 2) : la rame ne touche jamais le
// campement (critère repris du correctif A, PR #14 : 0,3 u de jour au moins),
// et l'auto ne se trouve jamais sur la voie avec elle — elle attend avant la
// barrière du passage à niveau, la rame ne s'arrête qu'en gare.
//   corepack pnpm test
import { test } from 'node:test'
import assert from 'node:assert/strict'

const warn = console.warn
console.warn = (...a) => {
  if (!String(a[0]).includes('indisponible')) warn(...a)
}

const { Island } = await import('../src/render/island.ts')
const { Village } = await import('../src/render/village.ts')
const { TRAIN_SCALE } = await import('../src/render/consist.ts')
const { TECHS, livingBuildings } = await import('../src/game/content.ts')

const atAge = (age) =>
  new Set(TECHS.filter((t) => t.age <= age).flatMap((t) => t.effects.filter((e) => e.kind === 'building').map((e) => e.building)))
const KINDS = ['foret', 'carriere', 'prairie', 'roseliere', 'crique', 'affleurement']
const HEARTH = { x: -1.15, z: 1.15 }
/** Demi-largeur d'une caisse au modèle (loco.glb : 0,83 u), à l'échelle. */
const HALF_W = 0.42 * TRAIN_SCALE

/** `n` parcelles posées à l'ancre par défaut, comme « Pose-la pour moi ». */
function plots(seed, n) {
  const land = []
  for (let i = 0; i < n; i++) {
    const at = new Island(seed, 0, land, undefined, true).defaultAnchor()
    if (!at) break
    land.push({ kind: KINDS[i % 6], q: at.q, r: at.r })
  }
  return land
}

function village(seed, age, nPlots) {
  const v = new Village(new Island(seed, age, plots(seed, nPlots)), age, age >= 8, false)
  v.setCargo({ wood: 3, stone: 2, food: 1 })
  v.setWonder(age, 4)
  v.sync(livingBuildings(atAge(age), age))
  return v
}

/** La matière du campement, lue sur le mesh du foyer (arêtes des triangles
 *  qui dépassent le dallage, tous les 5 cm) : distance au point le plus
 *  proche. */
function campMatter(v) {
  const fire = v.group.children.find((c) => c.isGroup && c.children.length >= 5)
  const g = fire.children[0].geometry
  const P = g.attributes.position.array
  const I = g.index?.array
  const n = I ? I.length : P.length / 3
  const at = (k) => (I ? I[k] : k) * 3
  const pts = []
  for (let t = 0; t + 2 < n; t += 3) {
    const tri = [at(t), at(t + 1), at(t + 2)]
    if (Math.max(...tri.map((a) => P[a + 1])) <= 0.12) continue
    for (const [a, b] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]]) {
      const m = Math.max(1, Math.ceil(Math.hypot(P[b] - P[a], P[b + 2] - P[a + 2]) / 0.05))
      for (let s = 0; s <= m; s++)
        pts.push(HEARTH.x + (P[a] + ((P[b] - P[a]) * s) / m) * 1.2, HEARTH.z + (P[a + 2] + ((P[b + 2] - P[a + 2]) * s) / m) * 1.2)
    }
  }
  // Le campement tient dans un disque : un point loin de son centre est loin
  // de sa matière (borne inférieure), on ne mesure finement que près de lui.
  let reach = 0
  for (let i = 0; i < pts.length; i += 2) reach = Math.max(reach, Math.hypot(pts[i] - HEARTH.x, pts[i + 1] - HEARTH.z))
  return (x, z) => {
    const far = Math.hypot(x - HEARTH.x, z - HEARTH.z) - reach
    if (far > 1) return far
    let best = Infinity
    for (let i = 0; i < pts.length; i += 2) best = Math.min(best, Math.hypot(pts[i] - x, pts[i + 1] - z))
    return best
  }
}

/** Les quatre coins d'un rectangle orienté (avant = (sin, cos) du cap). */
function corners(c, yaw, hl, hw) {
  const s = Math.sin(yaw)
  const co = Math.cos(yaw)
  return [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]].map(([l, w]) => ({ x: c.x + s * l + co * w, z: c.z + co * l - s * w }))
}

/** Deux rectangles convexes se recouvrent-ils (axes séparateurs) ? */
function overlap(A, B) {
  for (const P of [A, B])
    for (let i = 0; i < 4; i++) {
      const a = P[i]
      const b = P[(i + 1) % 4]
      const nx = -(b.z - a.z)
      const nz = b.x - a.x
      const span = (Q) => Q.map((q) => q.x * nx + q.z * nz)
      const sa = span(A)
      const sb = span(B)
      if (Math.max(...sa) < Math.min(...sb) || Math.max(...sb) < Math.min(...sa)) return false
    }
  return true
}

test('la rame longe le campement à 0,3 u au moins, sur tout le tour (âges 7 et 10)', () => {
  for (const seed of [1_337_042, 7, 42, 99, 2024]) {
    for (const age of [7, 10]) {
      const v = village(seed, age, 0)
      assert.ok(v.train, `graine ${seed}, âge ${age} : pas de train`)
      const dist = campMatter(v)
      let worst = Infinity
      const period = v.beltLength / 2.2 + 6
      for (let t = 0; t < period; t += 0.25) {
        v.tickTrain(0.25)
        for (const c of v.trainPoses) {
          const h = c.len / 2
          const co = Math.cos(c.yaw)
          const si = Math.sin(c.yaw)
          for (let u = -HALF_W; u <= HALF_W + 1e-9; u += HALF_W / 2)
            for (let s = -h; s <= h + 1e-9; s += 0.25) worst = Math.min(worst, dist(c.x + co * u + si * s, c.z - si * u + co * s))
        }
      }
      assert.ok(worst >= 0.3, `graine ${seed}, âge ${age} : la rame passe à ${worst.toFixed(2)} u du campement`)
    }
  }
})

test('l’auto et la rame ne se recouvrent jamais : l’auto attend à la barrière', () => {
  // Graines et parcelles où la 1re version de la zone d'attente laissait
  // l'auto sur la voie (route en biais), et une graine ordinaire.
  for (const [seed, nPlots] of [[5, 6], [99, 6], [5, 12], [42, 0]]) {
    const v = village(seed, 8, nPlots)
    assert.ok(v.train && v.car, `graine ${seed} : rame et auto`)
    assert.equal(v.crossings, 1, `graine ${seed} : ${v.crossings} traversées`)
    const mesh = v.car.children[0]
    mesh.geometry.computeBoundingBox()
    const box = mesh.geometry.boundingBox
    const hl = (box.max.x - box.min.x) / 2
    const hw = (box.max.z - box.min.z) / 2
    let hits = 0
    let waits = 0
    let prev = null
    // Trois tours de rame et autant d'allers-retours de l'auto.
    for (let f = 0; f < 3 * 60 * (v.beltLength / 2.2 + 5); f++) {
      v.tickTrain(1 / 60)
      v.tickCar(1 / 60)
      const p = v.car.position
      const yaw = v.car.rotation.y
      // Le capot est l'axe +X local de l'auto (headingYaw).
      const co = Math.cos(yaw)
      const si = Math.sin(yaw)
      const car = [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]].map(([lx, lz]) => ({ x: p.x + co * lx + si * lz, z: p.z - si * lx + co * lz }))
      if (v.trainPoses.some((c) => overlap(car, corners(c, c.yaw, c.len / 2, HALF_W)))) hits++
      if (prev && prev.x === p.x && prev.z === p.z && v.carWait <= 0) waits++
      prev = { x: p.x, z: p.z }
    }
    assert.equal(hits, 0, `graine ${seed}, ${nPlots} parcelles : ${hits} images où l’auto touche la rame`)
    assert.ok(waits > 0, `graine ${seed} : l’auto n’a jamais attendu à la barrière`)
  }
})
