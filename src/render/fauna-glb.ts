import { BufferAttribute, BufferGeometry } from 'three'

// ── Les bêtes modelées dans Blender (v3.66.0) ──────────────────────────────
// Un glb par espèce : un nœud racine, et dessous une pièce par nœud
// (`horse_neck`, `horse_leg_FL`…). La translation du nœud est le pivot de la
// pièce, ses extras disent laquelle c'est (`rig_id`, même numéro que `PART`).
// Le fichier est fait pour le jeu (tools : compact.py de l'artiste) : float32
// serrés, indices uint16, ni matériau, ni rotation, ni échelle. On le lit
// donc à la main, sans GLTFLoader — rien de plus à télécharger, et les tests
// le lisent sous Node comme le jeu dans le navigateur.

interface Accessor {
  bufferView: number
  byteOffset?: number
  componentType: number
  count: number
  type: string
}
interface Node {
  name?: string
  mesh?: number
  translation?: number[]
  children?: number[]
  extras?: { rig_id?: number }
}
interface Gltf {
  accessors: Accessor[]
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[]
  meshes: { primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[] }[]
  nodes: Node[]
}

const FLOAT = 5126
const USHORT = 5123
const SIZE: Record<string, number> = { SCALAR: 1, VEC3: 3 }

/** Une bête entière, soudée comme celles de fauna.ts : position, normale,
 *  couleur, et `aPivot` = (pivot, pièce) — (0, 0, 0, 0) pour le corps. Lève
 *  une erreur sur tout ce qui sort du format attendu plutôt que de dessiner
 *  une bête de travers. */
export function faunaGeometry(glb: ArrayBuffer): BufferGeometry {
  const view = new DataView(glb)
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('pas un glb')
  const jsonLen = view.getUint32(12, true)
  if (view.getUint32(16, true) !== 0x4e4f534a) throw new Error('bloc JSON absent')
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLen))) as Gltf
  const binAt = 20 + jsonLen
  if (view.getUint32(binAt + 4, true) !== 0x004e4942) throw new Error('bloc binaire absent')
  const bin = binAt + 8

  const read = (i: number, ct: number, type: string): Float32Array | Uint16Array => {
    const a = json.accessors[i]!
    const bv = json.bufferViews[a.bufferView]!
    if (a.componentType !== ct || a.type !== type) throw new Error(`accesseur ${i} : ${a.componentType}/${a.type}`)
    const n = a.count * SIZE[type]!
    const bytes = ct === FLOAT ? 4 : 2
    if (bv.byteStride && bv.byteStride !== bytes * SIZE[type]!) throw new Error(`accesseur ${i} entrelacé`)
    const at = bin + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0)
    // Copie : la géométrie ne retient pas tout le fichier, et l'alignement
    // de la vue d'origine n'a plus d'importance.
    return ct === FLOAT ? new Float32Array(glb.slice(at, at + n * 4)) : new Uint16Array(glb.slice(at, at + n * 2))
  }

  const pieces = json.nodes.filter((n) => n.mesh !== undefined)
  if (pieces.length === 0) throw new Error('aucune pièce')
  let verts = 0
  let tris = 0
  const parts = pieces.map((n) => {
    const prims = json.meshes[n.mesh!]!.primitives
    if (prims.length !== 1 || (prims[0]!.mode ?? 4) !== 4 || prims[0]!.indices === undefined) throw new Error(`${n.name} : une primitive de triangles indexée attendue`)
    const p = prims[0]!
    const id = n.extras?.rig_id
    if (typeof id !== 'number') throw new Error(`${n.name} : rig_id absent`)
    const part = {
      pos: read(p.attributes.POSITION!, FLOAT, 'VEC3') as Float32Array,
      nor: read(p.attributes.NORMAL!, FLOAT, 'VEC3') as Float32Array,
      col: read(p.attributes.COLOR_0!, FLOAT, 'VEC3') as Float32Array,
      idx: read(p.indices!, USHORT, 'SCALAR') as Uint16Array,
      t: n.translation ?? [0, 0, 0],
      id,
    }
    verts += part.pos.length / 3
    tris += part.idx.length
    return part
  })
  if (verts > 65535) throw new Error('trop de sommets pour des indices 16 bits')

  const pos = new Float32Array(verts * 3)
  const nor = new Float32Array(verts * 3)
  const col = new Float32Array(verts * 3)
  const piv = new Float32Array(verts * 4)
  const idx = new Uint16Array(tris)
  let v = 0
  let k = 0
  for (const p of parts) {
    const n = p.pos.length / 3
    const [tx, ty, tz] = p.t as [number, number, number]
    // Le corps (pièce 0) ne tourne autour de rien : pivot nul, comme `RIGID`.
    const rigid = p.id === 0
    for (let i = 0; i < n; i++) {
      const o = (v + i) * 3
      pos[o] = p.pos[i * 3]! + tx
      pos[o + 1] = p.pos[i * 3 + 1]! + ty
      pos[o + 2] = p.pos[i * 3 + 2]! + tz
      const w = (v + i) * 4
      piv[w] = rigid ? 0 : tx
      piv[w + 1] = rigid ? 0 : ty
      piv[w + 2] = rigid ? 0 : tz
      piv[w + 3] = p.id
    }
    nor.set(p.nor, v * 3)
    col.set(p.col, v * 3)
    for (let i = 0; i < p.idx.length; i++) idx[k + i] = p.idx[i]! + v
    v += n
    k += p.idx.length
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(pos, 3))
  geo.setAttribute('normal', new BufferAttribute(nor, 3))
  geo.setAttribute('color', new BufferAttribute(col, 3))
  geo.setAttribute('aPivot', new BufferAttribute(piv, 4))
  geo.setIndex(new BufferAttribute(idx, 1))
  return geo
}
