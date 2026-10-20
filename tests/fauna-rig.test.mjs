// Squelette procédural de la faune (v3.61.0). La copie TS du shader (`rigPose`)
// sert de banc : ce qu'elle calcule, le vertex shader le dessine.
//   corepack pnpm test
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { rigPose, legCycle, gaitUniform, DEER_GAIT, PART } = await import('../src/render/fauna-rig.ts')
const { deerGeo, DEER_BODY } = await import('../src/render/fauna.ts')

/** Profondeur d'un point DANS la capsule du corps (positive dedans), mesurée
 *  dans l'espace non aplati : l'échelle y ≥ 1 ne fait qu'épaissir le corps,
 *  la valeur est donc une borne basse de la vraie profondeur. */
function depthInBody(x, y, z) {
  const B = DEER_BODY
  const cz = Math.max(B.z - B.half, Math.min(B.z + B.half, z))
  const dy = (y - B.y) / B.sy
  return B.r - Math.hypot(x, dy, z - cz)
}

test('pièce 0 : rigPose rend le point tel quel, quelle que soit la pose', () => {
  const u = gaitUniform(DEER_GAIT)
  const out = []
  for (const anim of [[0, 0, 0, 0], [1.3, 1, 1, 0.5], [5.9, 1, 0, 1]]) {
    rigPose(out, [0.12, 0.34, -0.5], [0.1, 0.6, 0.26, PART.RIGID], anim, u)
    assert.deepEqual(out, [0.12, 0.34, -0.5])
  }
})

test('pose de repos (allure 0, broutage 0) : identité pour toutes les pièces du cerf', () => {
  const geo = deerGeo()
  const pos = geo.getAttribute('position')
  const piv = geo.getAttribute('aPivot')
  const u = gaitUniform(DEER_GAIT)
  const out = []
  for (let i = 0; i < pos.count; i++) {
    const p = [pos.getX(i), pos.getY(i), pos.getZ(i)]
    rigPose(out, p, [piv.getX(i), piv.getY(i), piv.getZ(i), piv.getW(i)], [2.1, 0, 0, 0], u)
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(out[k] - p[k]) < 1e-6, `sommet ${i}`)
  }
})

test('cerf : pattes et cou pivotent DANS le corps, à 0,02 u au moins de sa surface', () => {
  const geo = deerGeo()
  const piv = geo.getAttribute('aPivot')
  const seen = new Map()
  for (let i = 0; i < piv.count; i++) {
    const id = Math.round(piv.getW(i))
    if (id === PART.RIGID) continue
    seen.set(id, [piv.getX(i), piv.getY(i), piv.getZ(i)])
  }
  assert.deepEqual([...seen.keys()].sort(), [PART.FL, PART.FR, PART.HL, PART.HR, PART.NECK])
  for (const [id, [x, y, z]] of seen) {
    const d = depthInBody(x, y, z)
    assert.ok(d >= 0.02, `pièce ${id} : pivot à ${d.toFixed(3)} u dans le corps`)
  }
})

// ── A1 : pas de patinage ───────────────────────────────────────────────────
// On rejoue le vrai `Fauna.update` (hors cadastre, loin de tout obstacle, cap
// déjà sur la cible : une ligne droite), puis on pose le dessous de chaque
// sabot comme le shader (`rigPose` + matrice d'instance). Pendant l'appui
// (cycle < β), sa position au SOL ne doit presque pas bouger.

const { Island } = await import('../src/render/island.ts')
const { Fauna } = await import('../src/render/fauna.ts')
const { Matrix4, Vector3 } = await import('three')

const FAR = new Vector3(1e4, 0, 1e4)
const TAU = Math.PI * 2

/** Le sommet le plus bas de chaque patte (centre du dessous du sabot). */
function hoofSoles(geo) {
  const pos = geo.getAttribute('position')
  const piv = geo.getAttribute('aPivot')
  const soles = new Map()
  for (let i = 0; i < pos.count; i++) {
    const id = Math.round(piv.getW(i))
    if (id < PART.FL || id > PART.HR) continue
    const y = pos.getY(i)
    const cur = soles.get(id)
    const centred = Math.hypot(pos.getX(i) - piv.getX(i), pos.getZ(i) - piv.getZ(i))
    if (!cur || y < cur.y - 1e-6 || (Math.abs(y - cur.y) < 1e-6 && centred < cur.c))
      soles.set(id, { y, c: centred, p: [pos.getX(i), y, pos.getZ(i)], pivot: [piv.getX(i), piv.getY(i), piv.getZ(i), id] })
  }
  return soles
}

/** Les quatre espèces à pattes : troupeau, mesh et allure, par leur nom
 *  dans `Fauna`. */
const LAND = {
  cerf: { herd: 'deer', mesh: 'deerMesh', gait: 'DEER_GAIT' },
  mouton: { herd: 'sheep', mesh: 'sheepMesh', gait: 'SHEEP_GAIT' },
  poule: { herd: 'hens', mesh: 'henMesh', gait: 'HEN_GAIT' },
  cheval: { herd: 'horses', mesh: 'horseMesh', gait: 'HORSE_GAIT' },
}
const RIG = await import('../src/render/fauna-rig.ts')

/** Une île, sa faune, et une bête de l'espèce lancée en ligne droite (vers
 *  +x, hors cadastre, loin de tout). */
function lone(species, fields) {
  const s = LAND[species]
  const island = new Island(7, 2, [])
  const f = new Fauna(island, [])
  f.setKnown(true, true, true, true)
  const b = f[s.herd][0]
  Object.assign(b, { x: 200, z: 200, tx: 400, tz: 200, heading: Math.PI / 2, timer: 99, path: [], fade: 1, warp: null, sleep: 0 }, fields)
  return { f, b, mesh: f[s.mesh], g: RIG[s.gait], u: gaitUniform(RIG[s.gait]) }
}

function runGait(gait, flee, species = 'cerf') {
  const { f, b, mesh, g, u } = lone(species, { state: flee ? 3 : 0, gait })
  const soles = hoofSoles(mesh.geometry)
  const anim = mesh.geometry.getAttribute('aAnim')
  const M = new Matrix4()
  const out = []
  const v = new Vector3()
  const DT = 1 / 60
  // Une seconde de mise en route : les poids lissés atteignent leur régime.
  for (let k = 0; k < 60; k++) f.update(DT, k * DT, FAR, false)
  const kRad = flee ? g.kTrot : g.kWalk
  const beta = flee ? { 1: u[3], 2: u[3], 3: u[5], 4: u[5] } : { 1: u[1], 2: u[1], 3: u[1], 4: u[1] }
  const stride = TAU / kRad
  const open = new Map()
  let worst = 0
  let stances = 0
  let dist = 0
  let turned = 0
  for (let k = 0; k < 600; k++) {
    const x0 = b.x
    const z0 = b.z
    const ph0 = b.phase
    f.update(DT, 1 + k * DT, FAR, false)
    dist += Math.hypot(b.x - x0, b.z - z0)
    turned += ((b.phase - ph0 + TAU) % TAU)
    mesh.getMatrixAt(0, M)
    const a = [anim.getX(0), anim.getY(0), anim.getZ(0), anim.getW(0)]
    for (const [id, s] of soles) {
      const c = legCycle(id, a[0], flee)
      if (c < beta[id]) {
        rigPose(out, s.p, s.pivot, a, u)
        v.set(out[0], out[1], out[2]).applyMatrix4(M)
        const o = open.get(id)
        if (!o) open.set(id, { x: v.x, z: v.z })
        else worst = Math.max(worst, Math.hypot(v.x - o.x, v.z - o.z))
      } else if (open.has(id)) {
        open.delete(id)
        stances++
      }
    }
  }
  if (process.env.A1_LOG) console.error(`A1 ${species} gait=${gait} fuite=${flee} glissement=${worst.toFixed(4)} foulée=${stride.toFixed(3)} (${((100 * worst) / stride).toFixed(1)} %) cadence=${(turned / dist).toFixed(3)} rad/u appuis=${stances}`)
  return { worst, stride, stances, cadence: turned / dist, kRad, state: b.state }
}

// Mouton, poule, cheval (v3.62.0). Le trot du mouton et du cheval n'a
// aujourd'hui aucun déclencheur en jeu (rien ne les fait fuir) : on le force
// ici par l'état 3, comme la fuite du cerf, pour qu'il soit juste le jour où
// il servira.
for (const [species, flee] of [['mouton', false], ['mouton', true], ['cheval', false], ['cheval', true], ['poule', false]])
  for (const gait of [0.85, 1.15])
    test(`A1 : ${species} ${flee ? 'au trot' : 'au pas'}, gait ${gait} — le pied en appui glisse ≤ 0,002 u, cadence liée à la distance`, () => {
      const r = runGait(gait, flee, species)
      assert.equal(r.state, flee ? 3 : 0, 'la bête a gardé son allure')
      assert.ok(r.stances >= 8, `${r.stances} appuis observés`)
      assert.ok(r.worst <= 0.002, `glissement ${r.worst.toFixed(4)} u pour une foulée de ${r.stride.toFixed(3)} u`)
      assert.ok(Math.abs(r.cadence / r.kRad - 1) <= 0.05, `cadence ${r.cadence.toFixed(2)} rad/u, attendu ${r.kRad}`)
    })

for (const [gait, flee] of [[0.85, false], [1.15, false], [0.85, true], [1.15, true]]) {
  test(`A1 : cerf ${flee ? 'en fuite' : 'au pas'}, gait ${gait} — le sabot en appui glisse ≤ 10 % de la foulée`, () => {
    const r = runGait(gait, flee)
    assert.equal(r.state, flee ? 3 : 0, 'la bête a gardé son allure')
    assert.ok(r.stances >= 8, `${r.stances} appuis observés`)
    assert.ok(r.worst <= 0.1 * r.stride, `glissement ${r.worst.toFixed(4)} u pour une foulée de ${r.stride.toFixed(3)} u`)
    assert.ok(r.worst <= 0.002, `glissement ${r.worst.toFixed(4)} u`)
    assert.ok(Math.abs(r.cadence / r.kRad - 1) <= 0.05, `cadence ${r.cadence.toFixed(2)} rad/u, attendu ${r.kRad}`)
  })
}

// ── A5 : pas de pièce détachée ─────────────────────────────────────────────
// Ce qui, au repos, est caché DANS le corps (le haut des pattes, la base du
// cou) doit y rester dans toutes les poses extrêmes : sinon un jour s'ouvre à
// la jonction. Tolérance 0,01 u, mesurée contre la seule capsule du corps
// (les calottes du dos, du ventre et de la croupe l'épaississent encore).

test('A5 : jonctions du cerf fermées au pas, au trot de fuite et au broutage', () => {
  const geo = deerGeo()
  const pos = geo.getAttribute('position')
  const piv = geo.getAttribute('aPivot')
  const u = gaitUniform(DEER_GAIT)
  const poses = []
  for (let s = 0; s < 64; s++) {
    const ph = (s / 64) * TAU
    poses.push([ph, 1, 0, 0], [ph, 1, 0, 1])
  }
  const swell = 1 + DEER_GAIT.neckSwell
  poses.push([0, 0, swell, 0], [0, 0, 1 - DEER_GAIT.neckSwell, 0], [1, 0.4, swell, 0])
  const out = []
  let roots = 0
  let worst = Infinity
  for (let i = 0; i < pos.count; i++) {
    const id = Math.round(piv.getW(i))
    if (id === PART.RIGID) continue
    const p = [pos.getX(i), pos.getY(i), pos.getZ(i)]
    if (depthInBody(...p) < 0) continue
    roots++
    const pv = [piv.getX(i), piv.getY(i), piv.getZ(i), piv.getW(i)]
    for (const a of poses) {
      rigPose(out, p, pv, a, u)
      worst = Math.min(worst, depthInBody(out[0], out[1], out[2]))
    }
  }
  assert.ok(roots >= 20, `${roots} sommets de jonction`)
  assert.ok(worst >= -0.01, `un sommet de jonction sort de ${(-worst).toFixed(3)} u`)
})

// ── A5 étendu : mouton, poule, cheval, et le sommeil ───────────────────────
// Le corps de référence est réduit à sa sphère inscrite par facette (`f`) :
// un icosaèdre ou une sphère à 7 côtés est plus maigre que l'ellipsoïde
// nominal. « Dedans » est donc sous-estimé, « dehors » surestimé (rayon max).

const { sheepGeo, henGeo, horseGeo, SHEEP_BODY, HEN_BODY, HORSE_BODY } = await import('../src/render/fauna.ts')

function ellipsoidDepth(E, f, x, y, z) {
  const rx = E.rx * f
  const ry = E.ry * f
  const rz = E.rz * f
  const rho = Math.hypot((x - E.x) / rx, (y - E.y) / ry, (z - E.z) / rz)
  return (1 - rho) * (rho < 1 ? Math.min(rx, ry, rz) : Math.max(rx, ry, rz))
}
function capsuleDepth(B, f, x, y, z) {
  const cz = Math.max(B.z - B.half, Math.min(B.z + B.half, z))
  return B.r * f - Math.hypot(x, (y - B.y) / B.sy, z - cz)
}
/** Le mouton : la toison et sa sous-couche grise. Le cheval : le tronc et la
 *  croupe (où naît la queue). La poule : son œuf. */
const S = SHEEP_BODY
const BODIES = {
  mouton: {
    geo: sheepGeo,
    depth: (x, y, z) =>
      Math.max(
        ellipsoidDepth(S, 0.92, x, y, z),
        ellipsoidDepth({ x: 0, y: 0.31 * 0.62, z: -0.02 * 0.62, rx: 0.2 * 1.2 * 0.62, ry: 0.2 * 0.6 * 0.62, rz: 0.2 * 0.95 * 0.62 }, 0.92, x, y, z),
      ),
    pivotMin: 0.01,
    tol: 0.006,
  },
  poule: { geo: henGeo, depth: (x, y, z) => ellipsoidDepth(HEN_BODY, 0.85, x, y, z), pivotMin: 0.01, tol: 0.004 },
  cheval: {
    geo: horseGeo,
    depth: (x, y, z) =>
      Math.max(
        capsuleDepth({ ...HORSE_BODY, x: 0 }, 0.92, x, y, z),
        ellipsoidDepth({ x: 0, y: 0.97, z: -0.34, rx: 0.22, ry: 0.22, rz: 0.22 * 0.85 }, 0.9, x, y, z),
      ),
    pivotMin: 0.02,
    tol: 0.01,
  },
}

/** Toutes les poses extrêmes d'une espèce : 64 phases au pas et au trot,
 *  broutage ± houle, couchée et à mi-chemin, battement d'ailes. */
function posesOf(g) {
  const poses = []
  for (let s = 0; s < 64; s++) {
    const ph = (s / 64) * TAU
    poses.push([[ph, 1, 0, 0]], [[ph, 1, 0, 1]], [[ph, 1, 0, 0], [0, (s / 64) * TAU, 1, 0]])
  }
  for (const z of [0.5, 1]) poses.push([[0, 0, 0, 0], [z, 0, 0, 0]], [[1.3, 0.3, 0, 0], [z, 0, 0, 0]])
  poses.push([[0, 0, 1 + g.neckSwell, 0]], [[0, 0, 1 - g.neckSwell, 0]], [[1, 0.4, 1 + g.neckSwell, 0]])
  return poses
}

for (const [species, B] of Object.entries(BODIES)) {
  const g = RIG[LAND[species].gait]
  const u = gaitUniform(g)

  test(`${species} : pose de repos et pivots dans le corps`, () => {
    const geo = B.geo()
    const pos = geo.getAttribute('position')
    const piv = geo.getAttribute('aPivot')
    const out = []
    const seen = new Map()
    for (let i = 0; i < pos.count; i++) {
      const p = [pos.getX(i), pos.getY(i), pos.getZ(i)]
      const pv = [piv.getX(i), piv.getY(i), piv.getZ(i), piv.getW(i)]
      rigPose(out, p, pv, [2.1, 0, 0, 0], u, [0, 0, 1, 0])
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(out[k] - p[k]) < 1e-6, `sommet ${i}`)
      if (Math.round(pv[3]) !== PART.RIGID) seen.set(Math.round(pv[3]), pv)
    }
    for (const [id, [x, y, z]] of seen) {
      const d = B.depth(x, y, z)
      assert.ok(d >= B.pivotMin, `pièce ${id} : pivot à ${d.toFixed(3)} u dans le corps`)
    }
  })

  test(`A5 : ${species} — jonctions fermées au pas, au trot, au broutage, couché, ailes ouvertes`, () => {
    const geo = B.geo()
    const pos = geo.getAttribute('position')
    const piv = geo.getAttribute('aPivot')
    const poses = posesOf(g)
    const out = []
    let roots = 0
    let worst = Infinity
    // Une pièce qui touche le corps au repos (plus petit écart ≤ 0) doit le
    // toucher dans toutes les poses : sinon elle se détache. L'aile de la
    // poule est un volet : en s'ouvrant, sa face interne sort du flanc (c'est
    // le geste), seule sa charnière doit rester collée.
    const gap0 = new Map()
    const gapMax = new Map()
    for (let i = 0; i < pos.count; i++) {
      const id = Math.round(piv.getW(i))
      if (id === PART.RIGID) continue
      const p = [pos.getX(i), pos.getY(i), pos.getZ(i)]
      const d0 = B.depth(...p)
      gap0.set(id, Math.max(gap0.get(id) ?? -Infinity, d0))
      const pv = [piv.getX(i), piv.getY(i), piv.getZ(i), piv.getW(i)]
      const root = d0 >= 0 && id !== PART.WING_L && id !== PART.WING_R
      if (root) roots++
      poses.forEach(([a, r], k) => {
        rigPose(out, p, pv, a, u, r)
        const d = B.depth(out[0], out[1], out[2])
        if (root) worst = Math.min(worst, d)
        const key = `${id}/${k}`
        gapMax.set(key, Math.max(gapMax.get(key) ?? -Infinity, d))
      })
    }
    assert.ok(roots >= 6, `${roots} sommets de jonction`)
    assert.ok(worst >= -B.tol, `un sommet de jonction sort de ${(-worst).toFixed(4)} u`)
    let detached = 0
    for (const [key, d] of gapMax) {
      const id = Number(key.split('/')[0])
      if (gap0.get(id) >= 0 && d < -B.tol) detached = Math.max(detached, -d)
    }
    assert.equal(detached, 0, `une pièce se détache du corps de ${detached.toFixed(4)} u`)
  })
}

test('A5 : cerf couché — jonctions fermées', () => {
  const geo = deerGeo()
  const pos = geo.getAttribute('position')
  const piv = geo.getAttribute('aPivot')
  const u = gaitUniform(DEER_GAIT)
  const out = []
  let worst = Infinity
  for (let i = 0; i < pos.count; i++) {
    const id = Math.round(piv.getW(i))
    const p = [pos.getX(i), pos.getY(i), pos.getZ(i)]
    if (id === PART.RIGID || depthInBody(...p) < 0) continue
    const pv = [piv.getX(i), piv.getY(i), piv.getZ(i), piv.getW(i)]
    for (const z of [0.25, 0.5, 1]) {
      rigPose(out, p, pv, [0, 0, 0, 0], u, [z, 0, 0, 0])
      worst = Math.min(worst, depthInBody(out[0], out[1], out[2]))
    }
  }
  assert.ok(worst >= -0.01, `un sommet de jonction sort de ${(-worst).toFixed(3)} u`)
})

// ── Sommeil ────────────────────────────────────────────────────────────────

/** Toute la bête `i` posée dans le monde, comme le GPU : `rigPose` puis la
 *  matrice d'instance. */
function worldPose(mesh, i, u, into) {
  const geo = mesh.geometry
  const pos = geo.getAttribute('position')
  const piv = geo.getAttribute('aPivot')
  const an = geo.getAttribute('aAnim')
  const re = geo.getAttribute('aRest')
  const a = [an.getX(i), an.getY(i), an.getZ(i), an.getW(i)]
  const r = [re.getX(i), re.getY(i), re.getZ(i), re.getW(i)]
  const M = new Matrix4()
  mesh.getMatrixAt(i, M)
  const out = []
  const v = new Vector3()
  for (let k = 0; k < pos.count; k++) {
    rigPose(out, [pos.getX(k), pos.getY(k), pos.getZ(k)], [piv.getX(k), piv.getY(k), piv.getZ(k), piv.getW(k)], a, u, r)
    v.set(out[0], out[1], out[2]).applyMatrix4(M)
    into[k * 3] = v.x
    into[k * 3 + 1] = v.y
    into[k * 3 + 2] = v.z
  }
  return into
}

for (const species of Object.keys(LAND))
  test(`sommeil : ${species} — se couche et se relève sans saut de pose, sans bouger, chacun à son heure`, () => {
    const { f, mesh, g, u } = lone(species, { state: 1 })
    const herd = f[LAND[species].herd]
    // Toutes les bêtes du troupeau à l'écart, en pause : seule la nuit agit.
    // (La poule ne bat pas des ailes ici : ce serait un geste vif.)
    herd.forEach((b, i) => Object.assign(b, { x: 200 + i * 5, z: 200, tx: 200 + i * 5, tz: 200, state: 1, timer: 1e9, path: [], fade: 1, warp: null, sleep: 0, flapIn: 1e9 }))
    const DT = 1 / 60
    const n = mesh.geometry.getAttribute('position').count
    let prev2 = null
    let prev = null
    let cur = new Float64Array(n * 3)
    let speed = 0
    let jerk = 0
    const bedAt = herd.map(() => -1)
    const upAt = herd.map(() => -1)
    let t = 0
    const step = (night) => {
      f.update(DT, t, FAR, night)
      t += DT
      herd.forEach((b, i) => {
        if (night && bedAt[i] < 0 && b.sleep > 0) bedAt[i] = t
        if (!night && t > 16 && upAt[i] < 0 && b.sleep < 1) upAt[i] = t
      })
      worldPose(mesh, 0, u, cur)
      if (prev)
        for (let k = 0; k < cur.length; k++) {
          speed = Math.max(speed, Math.abs(cur[k] - prev[k]))
          if (prev2) jerk = Math.max(jerk, Math.abs(cur[k] - 2 * prev[k] + prev2[k]))
        }
      ;[prev2, prev, cur] = [prev, cur, prev2 ?? new Float64Array(n * 3)]
    }
    for (let k = 0; k < 60; k++) step(false)
    const rest0 = Float64Array.from(prev)
    for (let k = 0; k < 15 * 60; k++) step(true)
    const b = herd[0]
    assert.equal(b.sleep, 1, 'couchée au bout de 15 s')
    assert.ok(b.x === 200 && b.z === 200, 'elle n’a pas bougé')
    // Couchée : le corps est descendu de `drop`, rien ne passe sous le sol.
    let low = Infinity
    for (let k = 1; k < prev.length; k += 3) low = Math.min(low, prev[k])
    assert.ok(low > -0.01, `un sommet passe ${(-low).toFixed(3)} u sous le sol`)
    let top0 = -Infinity
    let top1 = -Infinity
    for (let k = 1; k < prev.length; k += 3) {
      top0 = Math.max(top0, rest0[k])
      top1 = Math.max(top1, prev[k])
    }
    assert.ok(top0 - top1 > 0.6 * g.drop, `le dos descend de ${(top0 - top1).toFixed(3)} u (drop ${g.drop})`)
    for (let k = 0; k < 15 * 60; k++) step(false)
    assert.equal(b.sleep, 0, 'debout au bout de 15 s')
    let back = 0
    for (let k = 0; k < prev.length; k++) back = Math.max(back, Math.abs(prev[k] - rest0[k]))
    assert.ok(back < 1e-3, `de retour à la pose du jour (écart ${back.toFixed(4)} u)`)
    // Pas de saut : à 60 i/s, aucun sommet ne bouge de plus de 0,02 u d'une
    // image à l'autre (la descente du cheval, 0,6 u, prend 1,8 s), et sa
    // vitesse ne change jamais d'un coup (différence seconde ≤ 0,001 u) : un
    // saut de pose, même petit, y ferait un pic.
    if (process.env.A1_LOG) console.error(`sommeil ${species} vitesse=${speed.toFixed(4)} à-coup=${jerk.toFixed(5)} couchers=${bedAt.map((x) => (x - 1).toFixed(2))} levers=${upAt.map((x) => (x - 16).toFixed(2))} dos=${(top0 - top1).toFixed(3)}`)
    assert.ok(speed < 0.02, `un sommet parcourt ${speed.toFixed(4)} u en une image`)
    assert.ok(jerk < 0.001, `à-coup de ${jerk.toFixed(5)} u en une image`)
    // Déphasage : les bêtes ne se couchent ni ne se lèvent toutes ensemble.
    assert.ok(new Set(bedAt.map((x) => x.toFixed(2))).size === herd.length, `couchers : ${bedAt.map((x) => x.toFixed(2))}`)
    assert.ok(new Set(upAt.map((x) => x.toFixed(2))).size === herd.length, `levers : ${upAt.map((x) => x.toFixed(2))}`)
    for (const x of bedAt) assert.ok(x - 1 >= 0 && x - 1 <= RIG.SLEEP.fallMax + 0.05, `coucher à ${(x - 1).toFixed(2)} s de la nuit`)
  })

test('sommeil : le dormeur respire (le dos monte et descend lentement)', () => {
  const { f, mesh, u } = lone('mouton', { state: 1 })
  f.sheep.forEach((b, i) => Object.assign(b, { x: 200 + i * 5, z: 200, state: 1, timer: 1e9, path: [] }))
  const DT = 1 / 60
  const n = mesh.geometry.getAttribute('position').count
  const buf = new Float64Array(n * 3)
  for (let k = 0; k < 10 * 60; k++) f.update(DT, k * DT, FAR, true)
  let lo = Infinity
  let hi = -Infinity
  // Deux périodes de souffle.
  for (let k = 0; k < 8 * 60; k++) {
    f.update(DT, 10 + k * DT, FAR, true)
    worldPose(mesh, 0, u, buf)
    let top = -Infinity
    for (let j = 1; j < buf.length; j += 3) top = Math.max(top, buf[j])
    lo = Math.min(lo, top)
    hi = Math.max(hi, top)
  }
  assert.ok(hi - lo > 0.004, `souffle de ${(hi - lo).toFixed(4)} u`)
})

// ── Poule : la tête fixe pendant le pas, le battement d'ailes ──────────────

test('poule : pendant la tenue, la tête reste fixe dans l’espace (≤ 0,002 u), puis rattrape le corps', () => {
  const { f, b, mesh, g, u } = lone('poule', { state: 0, gait: 1 })
  const geo = mesh.geometry
  const pos = geo.getAttribute('position')
  const piv = geo.getAttribute('aPivot')
  // Le sommet le plus haut de la tête (sommet de la sphère, sous la crête) :
  // entièrement cisaillé.
  let head = -1
  for (let i = 0; i < pos.count; i++)
    if (Math.round(piv.getW(i)) === PART.NECK && Math.abs(pos.getZ(i) - 0.08) < 0.02 && (head < 0 || pos.getY(i) > pos.getY(head)) && pos.getY(i) < 0.29) head = i
  const p = [pos.getX(head), pos.getY(head), pos.getZ(head)]
  const pv = [piv.getX(head), piv.getY(head), piv.getZ(head), piv.getW(head)]
  const an = geo.getAttribute('aAnim')
  const M = new Matrix4()
  const out = []
  const v = new Vector3()
  const DT = 1 / 240
  for (let k = 0; k < 240; k++) f.update(DT, k * DT, FAR, false)
  let worst = 0
  let holds = 0
  let open = null
  for (let k = 0; k < 4 * 240; k++) {
    f.update(DT, 1 + k * DT, FAR, false)
    const a = [an.getX(0), an.getY(0), an.getZ(0), an.getW(0)]
    mesh.getMatrixAt(0, M)
    rigPose(out, p, pv, a, u)
    v.set(out[0], out[1], out[2]).applyMatrix4(M)
    const s = (((a[0] / Math.PI + 0.5) % 1) + 1) % 1
    if (s < g.bobHold - 0.01) {
      if (!open) open = { x: v.x }
      worst = Math.max(worst, Math.abs(v.x - open.x))
    } else if (open) {
      holds++
      open = null
    }
  }
  assert.ok(holds >= 10, `${holds} tenues`)
  assert.ok(worst <= 0.002, `la tête glisse de ${worst.toFixed(4)} u pendant la tenue`)
  assert.ok(RIG.headBobAmp(g) > 0.04, `hochement de ${RIG.headBobAmp(g).toFixed(3)} u`)
})

test('poule : quelques battements d’ailes, espacés, jamais endormie, ailes revenues au corps', () => {
  const { f, mesh } = lone('poule', { state: 1 })
  f.hens.forEach((b, i) => Object.assign(b, { x: 200 + i * 5, z: 200, state: 1, timer: 1e9, path: [] }))
  const re = mesh.geometry.getAttribute('aRest')
  const DT = 1 / 60
  const starts = f.hens.map(() => [])
  for (let k = 0; k < 60 * 60; k++) {
    const night = k >= 40 * 60
    const before = f.hens.map((b) => b.flaps)
    f.update(DT, k * DT, FAR, night)
    f.hens.forEach((b, i) => {
      if (b.flaps !== before[i]) {
        starts[i].push(k * DT)
        assert.ok(b.sleep === 0, 'pas de battement couchée')
      }
    })
  }
  for (const s of starts) {
    assert.ok(s.length >= 2, `${s.length} battements en 40 s de jour`)
    for (let j = 1; j < s.length; j++) assert.ok(s[j] - s[j - 1] >= RIG.HEN_FLAP.waitMin, `écart ${(s[j] - s[j - 1]).toFixed(1)} s`)
  }
  assert.notDeepEqual(starts[0], starts[1], 'les poules ne battent pas ensemble')
  // Au repos, la phase vaut un nombre entier de battements : aile au corps.
  for (let i = 0; i < 3; i++) assert.ok(0.5 - 0.5 * Math.cos(re.getY(i)) < 1e-4)
})

// ── Mouette : vol battu et plané ───────────────────────────────────────────

const { gullGeo } = await import('../src/render/fauna.ts')
const { GULL_WING, wingUniform } = await import('../src/render/fauna-rig.ts')

test('mouette : épaules dans le corps, coude commun au bras et à la main dans toutes les poses', () => {
  const geo = gullGeo()
  const piv = geo.getAttribute('aPivot')
  const ids = new Set()
  for (let i = 0; i < piv.count; i++) ids.add(Math.round(piv.getW(i)))
  assert.deepEqual([...ids].sort((a, b) => a - b), [PART.RIGID, PART.ARM_L, PART.ARM_R, PART.HAND_L, PART.HAND_R])
  // Corps : capsule de rayon 0,05 couchée sur z. L'épaule est à 0,025 de l'axe.
  const [sx, sy] = GULL_WING.shoulderAt
  assert.ok(0.05 - Math.hypot(sx, sy) >= 0.02, 'épaule à 0,02 u au moins dans le corps')
  const u = wingUniform(GULL_WING)
  const [ex, ey, ez] = GULL_WING.elbowAt
  const a = []
  const b = []
  let worst = 0
  for (const s of [1, -1]) {
    const arm = [s * sx, sy, GULL_WING.shoulderAt[2], s > 0 ? PART.ARM_L : PART.ARM_R]
    const hand = [s * ex, ey, ez, s > 0 ? PART.HAND_L : PART.HAND_R]
    for (let k = 0; k < 64; k++)
      for (const flap of [0, 0.5, 1]) {
        const anim = [(k / 64) * TAU, 0, 0, flap]
        const p = [s * ex, ey, ez]
        rigPose(a, p, arm, anim, u)
        rigPose(b, p, hand, anim, u)
        worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]))
      }
  }
  assert.ok(worst < 1e-9, `le coude se déboîte de ${worst} u`)
})

test('mouette : ailes en miroir ; le battu monte à +45° et descend à −45°, le plané tient le dièdre', () => {
  const u = wingUniform(GULL_WING)
  const tipL = [0.62, 0.11, -0.03]
  const tipR = [-0.62, 0.11, -0.03]
  const L = [PART.HAND_L, GULL_WING.elbowAt[0], GULL_WING.elbowAt[1], GULL_WING.elbowAt[2]]
  const R = [PART.HAND_R, -GULL_WING.elbowAt[0], GULL_WING.elbowAt[1], GULL_WING.elbowAt[2]]
  const pl = []
  const pr = []
  let lo = Infinity
  let hi = -Infinity
  for (let k = 0; k < 64; k++) {
    const anim = [(k / 64) * TAU, 0, 0, 1]
    rigPose(pl, tipL, [L[1], L[2], L[3], L[0]], anim, u)
    rigPose(pr, tipR, [R[1], R[2], R[3], R[0]], anim, u)
    assert.ok(Math.abs(pl[0] + pr[0]) < 1e-9 && Math.abs(pl[1] - pr[1]) < 1e-9, 'miroir gauche/droite')
    lo = Math.min(lo, pl[1])
    hi = Math.max(hi, pl[1])
  }
  // Une aile de 0,6 u qui balaie ±45° (+ la main) : le bout monte et descend
  // d'au moins 0,4 u de part et d'autre (0,25 u à ±30° en 3.61.0).
  assert.ok(hi > 0.11 + 0.4 && lo < 0.11 - 0.4, `bout d'aile de ${lo.toFixed(2)} à ${hi.toFixed(2)}`)
  rigPose(pl, tipL, [L[1], L[2], L[3], L[0]], [1.7, 0, 0, 0], u)
  const glide = pl[1]
  rigPose(pl, tipL, [L[1], L[2], L[3], L[0]], [4.2, 0, 0, 0], u)
  assert.ok(Math.abs(pl[1] - glide) < 1e-9, 'en plané, la phase ne bouge plus l\u2019aile')
  assert.ok(glide > 0.11 && glide < 0.11 + 0.12, `dièdre léger : bout à ${glide.toFixed(3)}`)
})

test('mouette : en 40 s de vol, des battus de 2–3 s et des planés de 3–5 s, fondus sans à-coup', () => {
  const island = new Island(7, 2, [])
  const f = new Fauna(island, [])
  f.setKnown(true, true, true, true)
  const anim = f.gullMesh.geometry.getAttribute('aAnim')
  const DT = 1 / 60
  const runs = [[], [], []]
  const cur = [null, null, null]
  let jump = 0
  // `aAnim` n'est rempli qu'à la première image : le saut se mesure ensuite.
  f.update(DT, 0, FAR, false)
  const prev = [anim.getW(0), anim.getW(1), anim.getW(2)]
  for (let k = 1; k < 40 * 60; k++) {
    f.update(DT, k * DT, FAR, false)
    for (let i = 0; i < 3; i++) {
      const g = f.gulls[i]
      const w = anim.getW(i)
      jump = Math.max(jump, Math.abs(w - prev[i]))
      prev[i] = w
      if (!cur[i] || cur[i].on !== g.flapping) {
        if (cur[i]) runs[i].push(cur[i])
        cur[i] = { on: g.flapping, t: 0 }
      }
      cur[i].t += DT
    }
  }
  for (let i = 0; i < 3; i++) {
    const full = runs[i].slice(1)
    assert.ok(full.some((r) => r.on) && full.some((r) => !r.on), `mouette ${i} : bat et plane`)
    for (const r of full) {
      const [lo, hi] = r.on ? [2, 3] : [3, 5]
      assert.ok(r.t >= lo - 0.05 && r.t <= hi + 0.05, `mouette ${i} : ${r.on ? 'battu' : 'plané'} de ${r.t.toFixed(2)} s`)
    }
    assert.ok(f.gulls[i].drop <= 0 && f.gulls[i].drop >= -GULL_WING.maxDrop)
  }
  assert.ok(jump < 0.1, `poids du battu : saut de ${jump.toFixed(3)} en une image`)
})
