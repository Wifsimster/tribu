import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BoxGeometry, BufferAttribute } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const { asPart, heightOf } = await import('../src/render/model-geo.ts')

const MODELS = [
  ['amphore', 632, 1.18],
  ['nebra', 868, 0.74],
  ['etain', 606, 0.12],
]

async function load(name) {
  const b = readFileSync(new URL(`../src/assets/models/${name}.glb`, import.meta.url))
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '')
  let geo = null
  gltf.scene.traverse((o) => {
    if (!geo && o.isMesh) geo = o.geometry
  })
  return geo
}

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

const WONDER_TRIS = {
  dolmen: [102, 134, 166, 198, 290],
  ziggurat: [144, 420, 504, 528, 552],
  trophee: [72, 420, 672, 1176, 1414],
  phare: [232, 552, 964, 1020, 1418],
  cathedrale: [196, 284, 636, 706, 802],
  dome: [136, 328, 508, 1208, 1310],
  tour: [128, 456, 544, 632, 668],
  gratteciel: [136, 240, 432, 560, 620],
  fusee: [84, 578, 854, 1022, 1096],
  fusion: [120, 276, 1092, 1344, 1464],
}

const { WONDERS } = await import('../src/game/content.ts')

const DRAWN_IN_CODE = ['stalagmites']

test('chaque Merveille du jeu a son fichier, sauf celles dessinées dans le code', () => {
  assert.deepEqual(
    WONDERS.map((w) => w.id).filter((id) => !DRAWN_IN_CODE.includes(id)).sort(),
    Object.keys(WONDER_TRIS).sort(),
  )
})

for (const [name, tris] of Object.entries(WONDER_TRIS)) {
  test(`${name}.glb : le chantier grandit stade après stade, le stade 4 est tout`, async () => {
    const src = await load(name)
    assert.ok(src.getAttribute('_stage'), 'attribut _STAGE lu par le chargeur')
    const all = asPart(src)
    let before = 0
    for (let s = 0; s <= 4; s++) {
      const geo = asPart(src, s)
      assert.ok(geo, `stade ${s} dessinable`)
      const n = geo.index.count / 3
      assert.equal(n, tris[s], `stade ${s}`)
      assert.ok(n > before, `stade ${s} : ${n} triangles, pas plus que ${before}`)
      before = n
      const used = new Set(geo.index.array)
      assert.equal(used.size, geo.attributes.position.count)
      assert.ok(mergeGeometries([villagePart(), geo]), `stade ${s} fondu`)
    }
    assert.equal(asPart(src, 4).index.count, all.index.count, 'stade 4 = le modèle entier')
    assert.ok(heightOf(asPart(src, 0)) <= heightOf(asPart(src, 4)))
  })
}

test('un stade qui ne pose encore rien rend null, pas une géométrie vide', async () => {
  const src = await load('dolmen')
  assert.equal(asPart(src, -1), null)
})

test('dans le village, chaque Merveille tient sur son socle et garde sa silhouette', async () => {
  const warn = console.warn
  console.warn = () => {}
  const { Island } = await import('../src/render/island.ts')
  const { Village } = await import('../src/render/village.ts')
  const { adoptModel } = await import('../src/render/models.ts')
  console.warn = warn
  const measure = (v) => {
    const g = v.wonderGeo
    const p = v.wonderPos
    const pos = g.getAttribute('position')
    let top = 0
    let r = 0
    for (let i = 0; i < pos.count; i++) {
      top = Math.max(top, pos.getY(i) - p.y)
      r = Math.max(r, Math.hypot(pos.getX(i) - p.x, pos.getZ(i) - p.z))
    }
    return { top, r, tris: g.index.count / 3 }
  }
  const town = (age, stage) => {
    const v = new Village(new Island(1_337_042, age, []), age, true, false)
    v.setWonder(age, stage)
    return v
  }
  const modelled = WONDERS.filter((w) => !DRAWN_IN_CODE.includes(w.id))
  const prim = new Map(WONDERS.map((w) => [w.id, measure(town(w.age, 4))]))
  for (const w of modelled) assert.ok(adoptModel(w.id, await load(w.id)), w.id)
  for (const id of DRAWN_IN_CODE) {
    const w = WONDERS.find((x) => x.id === id)
    for (let s = 0; s <= 4; s++) {
      const m = measure(town(w.age, s))
      assert.ok(m.r <= Village.WONDER_R + 1e-6, `${id} stade ${s} : ${m.r.toFixed(2)} > ${Village.WONDER_R}`)
      if (s > 0) assert.notEqual(m.tris, measure(town(w.age, s - 1)).tris, `${id} : le stade ${s} change l'ouvrage`)
    }
  }
  for (const w of modelled) {
    const done = measure(town(w.age, 4))
    assert.notEqual(done.tris, prim.get(w.id).tris, `${w.id} : le modèle remplace la primitive`)
    for (let s = 0; s <= 4; s++) {
      const m = measure(town(w.age, s))
      assert.ok(m.r <= Village.WONDER_R + 1e-6, `${w.id} stade ${s} : ${m.r.toFixed(2)} > ${Village.WONDER_R}`)
    }
    assert.ok(done.top <= prim.get(w.id).top * 1.3 + 1e-6, `${w.id} : ${done.top.toFixed(2)} contre ${prim.get(w.id).top.toFixed(2)}`)
    assert.ok(done.top >= prim.get(w.id).top * 0.8, `${w.id} : ${done.top.toFixed(2)}, écrasée`)
  }
})
