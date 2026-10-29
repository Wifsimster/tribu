import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileGlsl } from './glsl-subset.mjs'

const RIG = await import('../src/render/fauna-rig.ts')
const { faunaGeometry } = await import('../src/render/fauna-glb.ts')

const TOL = 1e-3
const GAITS = { deer: RIG.DEER_GAIT, sheep: RIG.SHEEP_GAIT, hen: RIG.HEN_GAIT, horse: RIG.HORSE_GAIT }
const SPECIES = ['deer', 'sheep', 'hen', 'horse', 'gull']

const shader = compileGlsl(RIG.RIG_PARS)

function geometry(sp) {
  const b = readFileSync(new URL(`../src/assets/models/${sp}.glb`, import.meta.url))
  return faunaGeometry(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
}

function poses() {
  let s = 12345
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296
  const out = [
    { anim: [0, 0, 0, 0], rest: [0, 0, 0, 0] },
    { anim: [1.3, 1, 0, 0], rest: [0, 0, 0, 0] },
    { anim: [4.4, 1, 0, 1], rest: [0, 0, 0, 0] },
    { anim: [2.2, 0, 1, 0], rest: [1, 3.1, 1, 0] },
  ]
  for (let k = 0; k < 20; k++)
    out.push({
      anim: [rnd() * 6.283, rnd(), rnd() * 1.2, rnd() > 0.5 ? 1 : rnd()],
      rest: [rnd() > 0.5 ? rnd() : 0, rnd() * 6.283, rnd(), 0],
    })
  return out
}

for (const sp of SPECIES) {
  test(`${sp} : le shader et rigPose posent chaque sommet au même millième`, () => {
    const geo = geometry(sp)
    const pos = geo.getAttribute('position')
    const piv = geo.getAttribute('aPivot')
    const u = Array.from(sp === 'gull' ? RIG.wingUniform(RIG.GULL_WING) : RIG.gaitUniform(GAITS[sp]))
    const uRig = [0, 1, 2, 3, 4, 5].map((i) => u.slice(i * 4, i * 4 + 4))
    const ts = []
    let worst = { d: 0 }
    let moved = 0
    const parts = new Set()
    for (const { anim, rest } of poses())
      for (let i = 0; i < pos.count; i++) {
        const p = [pos.getX(i), pos.getY(i), pos.getZ(i)]
        const pv = [piv.getX(i), piv.getY(i), piv.getZ(i), piv.getW(i)]
        parts.add(Math.round(pv[3]))
        const n = { v: [0, 0, 1] }
        const gl = shader.call('rigPose', [p, n], { aPivot: pv, aAnim: anim, aRest: rest, uRig, defines: { PI: Math.PI } })
        RIG.rigPose(ts, p, pv, anim, u, rest)
        const d = Math.hypot(gl[0] - ts[0], gl[1] - ts[1], gl[2] - ts[2])
        if (!(d <= worst.d)) worst = { d, i, part: Math.round(pv[3]), anim, rest }
        moved = Math.max(moved, Math.hypot(ts[0] - p[0], ts[1] - p[1], ts[2] - p[2]))
      }
    assert.ok(worst.d <= TOL, `${sp} : écart ${worst.d} u au sommet ${worst.i} (pièce ${worst.part}, aAnim ${worst.anim}, aRest ${worst.rest})`)
    assert.ok(parts.size >= 3, `${sp} : pièces ${[...parts]}`)
    assert.ok(moved > 0.2, `${sp} : le plus grand déplacement ne fait que ${moved} u`)
  })
}

test('le traducteur refuse ce qu’il ne sait pas traduire', () => {
  assert.throws(() => compileGlsl('float f(float a) { for (float i = 0.0; i < 1.0; i += 1.0) {} return a; }'), /for non traduit/)
  assert.throws(() => compileGlsl('float f(float a) { if (a > 0.0) return 1.0; else return 2.0; }'), /else non traduit/)
  assert.throws(() => compileGlsl('float f(float a) { return a * 2; }'), /entier 2/)
  assert.throws(() => compileGlsl('float f(vec3 v) { return length(v); }'), /fonction length inconnue/)
})
