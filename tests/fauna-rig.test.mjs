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

function runGait(gait, flee) {
  const island = new Island(7, 2, [])
  const f = new Fauna(island, [])
  const b = f.deer[0]
  Object.assign(b, { x: 200, z: 200, tx: 400, tz: 200, heading: Math.PI / 2, state: flee ? 3 : 0, timer: 99, gait, path: [], fade: 1, warp: null, sleep: 0 })
  const mesh = f.deerMesh
  const u = gaitUniform(DEER_GAIT)
  const soles = hoofSoles(mesh.geometry)
  const anim = mesh.geometry.getAttribute('aAnim')
  const M = new Matrix4()
  const out = []
  const v = new Vector3()
  const DT = 1 / 60
  // Une seconde de mise en route : les poids lissés atteignent leur régime.
  for (let k = 0; k < 60; k++) f.update(DT, k * DT, FAR, false)
  const g = DEER_GAIT
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
  if (process.env.A1_LOG) console.error(`A1 gait=${gait} fuite=${flee} glissement=${worst.toFixed(4)} foulée=${stride.toFixed(3)} (${((100 * worst) / stride).toFixed(1)} %) cadence=${(turned / dist).toFixed(3)} rad/u appuis=${stances}`)
  return { worst, stride, stances, cadence: turned / dist, kRad, state: b.state }
}

for (const [gait, flee] of [[0.85, false], [1.15, false], [0.85, true], [1.15, true]]) {
  test(`A1 : cerf ${flee ? 'en fuite' : 'au pas'}, gait ${gait} — le sabot en appui glisse ≤ 10 % de la foulée`, () => {
    const r = runGait(gait, flee)
    assert.equal(r.state, flee ? 3 : 0, 'la bête a gardé son allure')
    assert.ok(r.stances >= 8, `${r.stances} appuis observés`)
    assert.ok(r.worst <= 0.1 * r.stride, `glissement ${r.worst.toFixed(4)} u pour une foulée de ${r.stride.toFixed(3)} u`)
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

test('mouette : ailes en miroir ; le battu monte à +30° et descend à −30°, le plané tient le dièdre', () => {
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
  // Une aile de 0,6 u qui balaie ±30° (+ la main) : le bout monte et descend
  // d'au moins 0,25 u de part et d'autre.
  assert.ok(hi > 0.11 + 0.25 && lo < 0.11 - 0.25, `bout d'aile de ${lo.toFixed(2)} à ${hi.toFixed(2)}`)
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
