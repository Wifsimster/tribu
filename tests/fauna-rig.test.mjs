// Squelette procédural de la faune (v3.60.0). La copie TS du shader (`rigPose`)
// sert de banc : ce qu'elle calcule, le vertex shader le dessine.
//   corepack pnpm test
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { rigPose, gaitUniform, DEER_GAIT, PART } = await import('../src/render/fauna-rig.ts')
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
