import { BufferAttribute, BufferGeometry } from 'three'

export function asPart(source: BufferGeometry, stage = Infinity): BufferGeometry | null {
  const pos = source.getAttribute('position')
  const nor = source.getAttribute('normal')
  if (!pos || !nor || pos.count === 0) return null
  const col = source.getAttribute('color')
  const st = source.getAttribute('_stage')
  const n = pos.count

  const all = source.index ? Array.from(source.index.array) : Array.from({ length: n }, (_, i) => i)
  let tris = all
  if (st && Number.isFinite(stage)) {
    tris = []
    for (let t = 0; t + 2 < all.length; t += 3) {
      const a = all[t]!
      const b = all[t + 1]!
      const c = all[t + 2]!
      if (Math.max(st.getX(a), st.getX(b), st.getX(c)) <= stage) tris.push(a, b, c)
    }
  }
  if (tris.length === 0) return null

  const remap = new Int32Array(n).fill(-1)
  const used: number[] = []
  const index = tris.map((v) => {
    if (remap[v]! < 0) {
      remap[v] = used.length
      used.push(v)
    }
    return remap[v]!
  })
  const m = used.length

  const p = new Float32Array(m * 3)
  const q = new Float32Array(m * 3)
  const rgb = new Float32Array(m * 3)
  for (let k = 0; k < m; k++) {
    const i = used[k]!
    p[k * 3] = pos.getX(i)
    p[k * 3 + 1] = pos.getY(i)
    p[k * 3 + 2] = pos.getZ(i)
    q[k * 3] = nor.getX(i)
    q[k * 3 + 1] = nor.getY(i)
    q[k * 3 + 2] = nor.getZ(i)
    rgb[k * 3] = col ? col.getX(i) : 0.8
    rgb[k * 3 + 1] = col ? col.getY(i) : 0.8
    rgb[k * 3 + 2] = col ? col.getZ(i) : 0.8
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(p, 3))
  geo.setAttribute('normal', new BufferAttribute(q, 3))
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(m * 2), 2))
  geo.setAttribute('color', new BufferAttribute(rgb, 3))
  geo.setIndex(index)
  return geo
}

export function heightOf(geo: BufferGeometry): number {
  geo.computeBoundingBox()
  const b = geo.boundingBox
  return b ? b.max.y - b.min.y : 0
}

export function halfSpanOf(geo: BufferGeometry): number {
  geo.computeBoundingBox()
  const b = geo.boundingBox
  if (!b) return 0
  return Math.max(-b.min.x, b.max.x, -b.min.z, b.max.z)
}
