import { BufferAttribute, BufferGeometry } from 'three'

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
  extras?: { rig_id?: number; head_rig_id?: number; head_pivot?: number[] }
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

export function readGlb<T>(glb: ArrayBuffer): { json: T; bin: number } {
  const view = new DataView(glb)
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('pas un glb')
  const jsonLen = view.getUint32(12, true)
  if (view.getUint32(16, true) !== 0x4e4f534a) throw new Error('bloc JSON absent')
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLen))) as T
  const binAt = 20 + jsonLen
  if (view.getUint32(binAt + 4, true) !== 0x004e4942) throw new Error('bloc binaire absent')
  return { json, bin: binAt + 8 }
}

export function faunaGeometry(glb: ArrayBuffer): BufferGeometry {
  const { json, bin } = readGlb<Gltf>(glb)

  const read = (i: number, ct: number, type: string): Float32Array | Uint16Array => {
    const a = json.accessors[i]!
    const bv = json.bufferViews[a.bufferView]!
    if (a.componentType !== ct || a.type !== type) throw new Error(`accesseur ${i} : ${a.componentType}/${a.type}`)
    const n = a.count * SIZE[type]!
    const bytes = ct === FLOAT ? 4 : 2
    if (bv.byteStride && bv.byteStride !== bytes * SIZE[type]!) throw new Error(`accesseur ${i} entrelacé`)
    const at = bin + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0)
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
    const id = n.extras?.head_rig_id ?? n.extras?.rig_id
    if (typeof id !== 'number') throw new Error(`${n.name} : rig_id absent`)
    const part = {
      pos: read(p.attributes.POSITION!, FLOAT, 'VEC3') as Float32Array,
      nor: read(p.attributes.NORMAL!, FLOAT, 'VEC3') as Float32Array,
      col: read(p.attributes.COLOR_0!, FLOAT, 'VEC3') as Float32Array,
      idx: read(p.indices!, USHORT, 'SCALAR') as Uint16Array,
      t: n.translation ?? [0, 0, 0],
      pv: n.extras?.head_pivot ?? n.translation ?? [0, 0, 0],
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
    const [px, py, pz] = p.pv as [number, number, number]
    const rigid = p.id === 0
    for (let i = 0; i < n; i++) {
      const o = (v + i) * 3
      pos[o] = p.pos[i * 3]! + tx
      pos[o + 1] = p.pos[i * 3 + 1]! + ty
      pos[o + 2] = p.pos[i * 3 + 2]! + tz
      const w = (v + i) * 4
      piv[w] = rigid ? 0 : px
      piv[w + 1] = rigid ? 0 : py
      piv[w + 2] = rigid ? 0 : pz
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
