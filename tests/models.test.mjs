// Les modèles Blender doivent pouvoir fondre dans la géométrie unique du
// village : un attribut qui diverge, et la fusion refuse le lot ENTIER — le
// musée disparaîtrait en silence. Tout se vérifie en Node, sans navigateur.
//   corepack pnpm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BoxGeometry, BufferAttribute } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const { asPart, heightOf } = await import('../src/render/model-geo.ts')

/** Ce que livre le jeu : nom de fichier, triangles et hauteur annoncés. */
const MODELS = [
  ['amphore', 632, 1.18],
  ['nebra', 868, 0.74],
  ['etain', 606, 0.12],
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

/** Une pièce comme celles du village : primitive indexée + couleur RGB. */
function villagePart() {
  const g = new BoxGeometry(1, 1, 1)
  g.setAttribute('color', new BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(0.5), 3))
  return g
}

for (const [name, tris, height] of MODELS) {
  test(`${name}.glb se fond dans la géométrie du village`, async () => {
    const src = await load(name)
    assert.ok(src, 'un maillage dans le fichier')
    const geo = asPart(src)
    assert.ok(geo)
    assert.deepEqual(Object.keys(geo.attributes).sort(), ['color', 'normal', 'position', 'uv'])
    assert.equal(geo.attributes.color.itemSize, 3)
    assert.equal(geo.index.count / 3, tris)
    assert.ok(Math.abs(heightOf(geo) - height) < 0.01, `hauteur ${heightOf(geo)}`)
    // Couleurs lues en 0–1, pas en octets bruts.
    const c = geo.attributes.color.array
    assert.ok(c.every((v) => v >= 0 && v <= 1))
    assert.ok(c.some((v) => v > 0.05), 'pas tout noir')
    const merged = mergeGeometries([villagePart(), geo])
    assert.ok(merged, 'fusion acceptée')
    assert.equal(merged.index.count / 3, 12 + tris)
  })
}

test('un maillage sans normales est refusé, pas fondu de travers', () => {
  const g = new BoxGeometry(1, 1, 1)
  g.deleteAttribute('normal')
  assert.equal(asPart(g), null)
})
