import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Object3D, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const { headingYaw, vehicleGeometry, BOAT_MODELS } = await import('../src/render/vehicles.ts')
const { adoptModel } = await import('../src/render/models.ts')
const { asPart } = await import('../src/render/model-geo.ts')

const VEHICLES = [
  ['raft', 276, [1.296, 1.39, 1.57]],
  ['canoe', 218, [2.4, 1.121, 0.74]],
  ['sailboat', 280, [2.938, 2.155, 0.86]],
  ['caravel', 450, [5.014, 3.61, 1.44]],
  ['steamer', 626, [4.45, 3.18, 2.2]],
  ['motorboat', 226, [3.6, 0.852, 0.96]],
  ['merchant', 778, [4.286, 3.11, 1.336]],
  ['car', 644, [2.47, 1.1, 1.286]],
  ['plane', 408, [1.76, 0.78, 2.24]],
]

async function load(name) {
  const b = readFileSync(new URL(`../src/assets/models/${name}.glb`, import.meta.url))
  const gltf = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '')
  let geo = null
  gltf.scene.traverse((o) => {
    if (!geo && o.isMesh) geo = o.geometry
  })
  return geo
}

function nose(yaw) {
  const o = new Object3D()
  o.rotation.y = yaw
  o.updateMatrixWorld()
  return new Vector3(1, 0, 0).transformDirection(o.matrixWorld)
}

test('headingYaw met le nez (+X local) dans le sens de la route, dans toutes les directions', () => {
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2
    const dx = Math.sin(a) * 3
    const dz = Math.cos(a) * 3
    const n = nose(headingYaw(dx, dz))
    const cos = (n.x * dx + n.z * dz) / Math.hypot(dx, dz)
    assert.ok(cos > 0.9999, `route ${a.toFixed(2)} rad : nez à ${((Math.acos(Math.min(1, cos)) * 180) / Math.PI).toFixed(1)}°`)
  }
})

test("l'ancienne règle (atan2 + π/2) envoyait bien la proue à reculons", () => {
  const n = nose(Math.atan2(1, 0) + Math.PI / 2)
  assert.ok(n.x < -0.9999, 'route +X, proue vers −X')
})

for (const [name, tris, size] of VEHICLES) {
  test(`${name}.glb : un maillage, à sa taille de jeu, prêt pour le matériau du village`, async () => {
    const src = await load(name)
    assert.ok(src)
    const geo = asPart(src)
    assert.ok(geo)
    assert.equal(geo.index.count / 3, tris)
    geo.computeBoundingBox()
    const b = geo.boundingBox
    const got = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z]
    got.forEach((v, i) => assert.ok(Math.abs(v - size[i]) < 0.01, `${name} axe ${i} : ${v.toFixed(3)}`))
    assert.ok(Math.abs(b.min.y) < 1e-3, 'base à y = 0')
    assert.ok(mergeGeometries([geo, geo.clone()]), 'attributs homogènes')
  })
}

test('sans modèle, vehicleGeometry rend null : la primitive reste', () => {
  assert.equal(vehicleGeometry('plane'), null)
})

test('la barque marchande ne prend pas deux fois son ×1,5', async () => {
  assert.ok(adoptModel('merchant', await load('merchant')))
  const g = vehicleGeometry('merchant', 1.5)
  g.computeBoundingBox()
  assert.ok(Math.abs((g.boundingBox.max.x - g.boundingBox.min.x) * 1.5 - 4.286) < 0.01)
  assert.ok(Math.abs(g.boundingBox.min.y * 1.5 - 0.04) < 1e-3)
})

test('les six paliers de la barque ont leur fichier', () => {
  assert.deepEqual([...BOAT_MODELS], ['raft', 'canoe', 'sailboat', 'caravel', 'steamer', 'motorboat'])
})
