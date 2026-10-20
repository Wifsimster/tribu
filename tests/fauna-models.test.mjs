// Les bêtes modelées dans Blender (v3.66.0) : ce que promet chaque glb au
// squelette, la bascule silhouette → modèle, et le museau dans l'herbe.
//   corepack pnpm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SPECIES, adoptAll, model } from './fauna-body.mjs'

const RIG = await import('../src/render/fauna-rig.ts')
const { PART, gaitUniform, rigPose } = RIG
const FAUNA = await import('../src/render/fauna.ts')
const { Fauna, faunaModel } = FAUNA
const { faunaGeometry } = await import('../src/render/fauna-glb.ts')
const { Island, GROUND_Y } = await import('../src/render/island.ts')
const { Matrix4, Vector3 } = await import('three')

const FAR = new Vector3(1e4, 0, 1e4)
const MESH = { deer: 'deerMesh', sheep: 'sheepMesh', hen: 'henMesh', horse: 'horseMesh', gull: 'gullMesh' }
const HERD = { deer: 'deer', sheep: 'sheep', hen: 'hens', horse: 'horses' }
const GAIT = { deer: RIG.DEER_GAIT, sheep: RIG.SHEEP_GAIT, hen: RIG.HEN_GAIT, horse: RIG.HORSE_GAIT }
/** Triangles livrés (contrat de rig de l'artiste, faune-blender-20261020). */
const TRIS = { deer: 776, sheep: 1252, hen: 688, horse: 1046, gull: 392 }

const tris = (g) => g.index.count / 3

/** Pièce → pivot, tel que le porte `aPivot`. */
function pivotsOf(geo) {
  const piv = geo.getAttribute('aPivot')
  const out = new Map()
  for (let i = 0; i < piv.count; i++) {
    const id = Math.round(piv.getW(i))
    const p = [piv.getX(i), piv.getY(i), piv.getZ(i)]
    if (id === PART.RIGID) {
      assert.deepEqual(p, [0, 0, 0], 'corps : pivot nul')
      continue
    }
    const seen = out.get(id)
    if (seen) assert.ok(p.every((v, k) => Math.abs(v - seen[k]) < 1e-6), `pièce ${id} : un seul pivot`)
    else out.set(id, p)
  }
  return out
}

// Ce premier test tourne AVANT l'adoption des modèles : la faune naît avec
// ses silhouettes, puis passe aux modèles sans changer de mesh ni d'état.
test('bascule : la faune née en silhouettes passe à ses modèles, même mesh, même état des bêtes', () => {
  assert.equal(faunaModel('deer'), null, 'aucun modèle avant adoption')
  const f = new Fauna(new Island(7, 2, []), [])
  f.setKnown(true, true, true, true)
  f.update(1 / 60, 0, FAR, false)
  const before = {}
  for (const sp of SPECIES) {
    const m = f[MESH[sp]]
    before[sp] = { mesh: m, geo: m.geometry, mat: m.material, count: m.count, anim: m.geometry.getAttribute('aAnim'), rest: m.geometry.getAttribute('aRest') }
  }
  const children = f.group.children.length
  f.useModels()
  for (const sp of SPECIES) assert.equal(f[MESH[sp]].geometry, before[sp].geo, `${sp} : rien à prendre sans modèle`)
  adoptAll()
  let disposed = 0
  for (const sp of SPECIES) before[sp].geo.addEventListener('dispose', () => disposed++)
  f.useModels()
  for (const sp of SPECIES) {
    const m = f[MESH[sp]]
    const b = before[sp]
    assert.equal(m, b.mesh, `${sp} : même mesh`)
    assert.equal(m.material, b.mat, `${sp} : même matériau`)
    assert.equal(m.count, b.count, `${sp} : mêmes instances`)
    assert.notEqual(m.geometry, b.geo, `${sp} : géométrie remplacée`)
    assert.equal(tris(m.geometry), TRIS[sp], `${sp} : triangles du modèle`)
    // L'état des bêtes est repris tel quel, pas recopié.
    assert.equal(m.geometry.getAttribute('aAnim'), b.anim)
    assert.equal(m.geometry.getAttribute('aRest'), b.rest)
  }
  assert.equal(disposed, SPECIES.length, 'les silhouettes sont libérées')
  assert.equal(f.group.children.length, children, 'aucun mesh de plus : un appel de dessin par espèce')
  // Un second passage ne refait rien.
  const geos = SPECIES.map((sp) => f[MESH[sp]].geometry)
  f.useModels()
  assert.deepEqual(SPECIES.map((sp) => f[MESH[sp]].geometry), geos)
  // Et la faune d'une île suivante naît modelée.
  const g = new Fauna(new Island(7, 2, []), [])
  for (const sp of SPECIES) assert.equal(tris(g[MESH[sp]].geometry), TRIS[sp], `${sp} : modelé dès la construction`)
})

test('contrat : chaque glb a les pièces et les pivots de la silhouette qu’il remplace', () => {
  for (const sp of SPECIES) {
    const geo = model(sp)
    assert.equal(tris(geo), TRIS[sp], `${sp} : triangles`)
    assert.deepEqual(Object.keys(geo.attributes).sort(), ['aPivot', 'color', 'normal', 'position'], `${sp} : attributs`)
    const c = geo.getAttribute('color').array
    assert.ok(c.every((v) => v >= 0 && v <= 1) && c.some((v) => v > 0.05), `${sp} : couleurs en 0–1`)
    const want = pivotsOf(FAUNA[`${sp}Geo`]())
    const got = pivotsOf(geo)
    assert.deepEqual([...got.keys()].sort((a, b) => a - b), [...want.keys()].sort((a, b) => a - b), `${sp} : pièces`)
    for (const [id, p] of want) assert.ok(p.every((v, k) => Math.abs(v - got.get(id)[k]) < 1e-4), `${sp} : pivot de la pièce ${id} ${got.get(id)} ≠ ${p}`)
  }
})

test('contrat : la patte va de la hanche au sol — exactement `leg`, la longueur dont l’allure déduit la foulée', () => {
  for (const sp of ['deer', 'sheep', 'hen', 'horse']) {
    const geo = model(sp)
    const pos = geo.getAttribute('position')
    const piv = geo.getAttribute('aPivot')
    const low = new Map()
    for (let i = 0; i < pos.count; i++) {
      const id = Math.round(piv.getW(i))
      if (id < PART.FL || id > PART.HR) continue
      low.set(id, Math.min(low.get(id) ?? Infinity, pos.getY(i)))
    }
    assert.equal(low.size, sp === 'hen' ? 2 : 4)
    for (const [id, y] of low) {
      const leg = pivotsOf(geo).get(id)[1] - y
      assert.ok(Math.abs(leg - GAIT[sp].leg) < 1e-3, `${sp} patte ${id} : ${leg.toFixed(4)} u, allure ${GAIT[sp].leg}`)
    }
  }
})

test('mouton : livré à l’échelle du jeu — pas de seconde réduction', () => {
  const geo = model('sheep')
  geo.computeBoundingBox()
  const h = geo.boundingBox.max.y
  // La silhouette réduite (×0,62) culmine à ~0,39 u ; le modèle à 0,433. Une
  // seconde réduction le ramènerait à 0,27.
  assert.ok(h > 0.4 && h < 0.45, `hauteur ${h.toFixed(3)} u`)
})

test('un fichier qui n’est pas une bête est refusé, pas dessiné de travers', () => {
  assert.throws(() => faunaGeometry(new ArrayBuffer(32)), /glb/)
  const b = readFileSync(new URL('../src/assets/models/amphore.glb', import.meta.url))
  // Un glb du village : ni pièces nommées, ni `rig_id`.
  assert.throws(() => faunaGeometry(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)))
})

// ── Le museau dans l'herbe ─────────────────────────────────────────────────
// Le vrai `Fauna.update`, une bête qui broute (état 2) sans fin ; on pose sa
// tête comme le GPU et on relève le point le plus bas au-dessus du sol. Le
// chevreuil plongeait de 75° : avec son modèle, ce banc trouvait son museau
// entre 29 et 40 cm de l'herbe. 105° depuis la v3.66.0.

function grazeLow(sp) {
  const f = new Fauna(new Island(7, 2, []), [])
  f.setKnown(true, true, true, true)
  const herd = f[HERD[sp]]
  herd.forEach((b, i) => Object.assign(b, { x: 200 + i * 5, z: 200, tx: 200 + i * 5, tz: 200, state: 2, timer: 1e9, path: [], fade: 1, warp: null, sleep: 0, flapIn: 1e9 }))
  const mesh = f[MESH[sp]]
  const geo = mesh.geometry
  const pos = geo.getAttribute('position')
  const piv = geo.getAttribute('aPivot')
  const an = geo.getAttribute('aAnim')
  const re = geo.getAttribute('aRest')
  const head = []
  for (let i = 0; i < pos.count; i++)
    if (Math.round(piv.getW(i)) === PART.NECK) head.push([[pos.getX(i), pos.getY(i), pos.getZ(i)], [piv.getX(i), piv.getY(i), piv.getZ(i), piv.getW(i)]])
  const u = gaitUniform(GAIT[sp])
  const M = new Matrix4()
  const v = new Vector3()
  const out = []
  const DT = 1 / 30
  for (let k = 0; k < 90; k++) f.update(DT, k * DT, FAR, false)
  let lowest = Infinity
  let highest = -Infinity
  // Plusieurs houles complètes (la plus lente : 0,3 Hz).
  for (let k = 0; k < 12 * 30; k++) {
    f.update(DT, 3 + k * DT, FAR, false)
    mesh.getMatrixAt(0, M)
    const a = [an.getX(0), an.getY(0), an.getZ(0), an.getW(0)]
    const r = [re.getX(0), re.getY(0), re.getZ(0), re.getW(0)]
    let low = Infinity
    for (const [p, pv] of head) {
      rigPose(out, p, pv, a, u, r)
      low = Math.min(low, v.set(out[0], out[1], out[2]).applyMatrix4(M).y - GROUND_Y)
    }
    lowest = Math.min(lowest, low)
    highest = Math.max(highest, low)
  }
  return { lowest, highest, graze: herd[0].graze }
}

for (const sp of ['deer', 'sheep', 'hen', 'horse'])
  test(`broutage : ${sp} — le museau va à l’herbe et y reste, sans s’y enfoncer`, () => {
    const r = grazeLow(sp)
    if (process.env.A1_LOG) console.error(`museau ${sp} bas=${r.lowest.toFixed(4)} haut=${r.highest.toFixed(4)}`)
    assert.ok(r.graze > 0.99, 'broute à plein')
    // Le museau va jusqu'à l'herbe (≤ 1 cm)…
    assert.ok(r.lowest <= 0.01, `museau au plus bas à ${r.lowest.toFixed(3)} u du sol`)
    // …n'y plonge pas de plus de 2 cm…
    assert.ok(r.lowest >= -0.02, `museau à ${(-r.lowest).toFixed(3)} u sous le sol`)
    // …et reste au ras de l'herbe tout le long de la houle.
    assert.ok(r.highest <= 0.05, `au plus haut de la houle, museau à ${r.highest.toFixed(3)} u du sol`)
  })
