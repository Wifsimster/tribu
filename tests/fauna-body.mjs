import { readFileSync } from 'node:fs'

const { adoptFaunaModel, faunaModel } = await import('../src/render/fauna.ts')

export const SPECIES = ['deer', 'sheep', 'hen', 'horse', 'gull']

export function adoptAll() {
  for (const sp of SPECIES) {
    const b = readFileSync(new URL(`../src/assets/models/${sp}.glb`, import.meta.url))
    adoptFaunaModel(sp, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
  }
}

export function model(sp) {
  const g = faunaModel(sp)
  if (!g) throw new Error(`modèle ${sp} absent`)
  return g
}

export function bodyDepth(geo, skip = () => false) {
  const pos = geo.getAttribute('position')
  const piv = geo.getAttribute('aPivot')
  const idx = geo.index.array
  const key = (i) => `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`
  const ids = new Map()
  const parent = []
  const find = (a) => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]]
    return a
  }
  const tris = []
  for (let t = 0; t < idx.length; t += 3) {
    if (Math.round(piv.getW(idx[t])) !== 0) continue
    const v = [0, 1, 2].map((k) => {
      const kk = key(idx[t + k])
      if (!ids.has(kk)) {
        ids.set(kk, parent.length)
        parent.push(parent.length)
      }
      return ids.get(kk)
    })
    parent[find(v[1])] = find(v[0])
    parent[find(v[2])] = find(v[0])
    tris.push([t, v[0]])
  }
  const shells = new Map()
  for (const [t, v] of tris) {
    const r = find(v)
    if (!shells.has(r)) shells.set(r, [])
    const a = shells.get(r)
    for (let k = 0; k < 3; k++) a.push(pos.getX(idx[t + k]), pos.getY(idx[t + k]), pos.getZ(idx[t + k]))
  }
  const S = [...shells.values()].map((a) => {
    const T = Float64Array.from(a)
    let cx = 0, cy = 0, cz = 0
    for (let i = 0; i < T.length; i += 3) {
      cx += T[i]
      cy += T[i + 1]
      cz += T[i + 2]
    }
    const n = T.length / 3
    cx /= n
    cy /= n
    cz /= n
    let r = 0
    let top = -Infinity
    for (let i = 0; i < T.length; i += 3) {
      r = Math.max(r, Math.hypot(T[i] - cx, T[i + 1] - cy, T[i + 2] - cz))
      top = Math.max(top, T[i + 1])
    }
    return { T, cx, cy, cz, r, top }
  }).filter((s) => !skip(s))
  const fn = (px, py, pz) => {
    let out = -Infinity
    for (const s of S) {
      if (s.r - Math.hypot(px - s.cx, py - s.cy, pz - s.cz) <= out) continue
      out = Math.max(out, shellDepth(s.T, px, py, pz))
    }
    return out
  }
  fn.shells = S.length
  return fn
}

function shellDepth(T, px, py, pz) {
  const n = T.length / 9
  let best = Infinity
  let wind = 0
  for (let t = 0; t < n; t++) {
    const o = t * 9
    const ax = T[o], ay = T[o + 1], az = T[o + 2]
    const bx = T[o + 3], by = T[o + 4], bz = T[o + 5]
    const cx = T[o + 6], cy = T[o + 7], cz = T[o + 8]
    const rax = ax - px, ray = ay - py, raz = az - pz
    const rbx = bx - px, rby = by - py, rbz = bz - pz
    const rcx = cx - px, rcy = cy - py, rcz = cz - pz
    const la = Math.sqrt(rax * rax + ray * ray + raz * raz), lb = Math.sqrt(rbx * rbx + rby * rby + rbz * rbz), lc = Math.sqrt(rcx * rcx + rcy * rcy + rcz * rcz)
    const det = rax * (rby * rcz - rbz * rcy) - ray * (rbx * rcz - rbz * rcx) + raz * (rbx * rcy - rby * rcx)
    const den = la * lb * lc + (rax * rbx + ray * rby + raz * rbz) * lc + (rbx * rcx + rby * rcy + rbz * rcz) * la + (rcx * rax + rcy * ray + rcz * raz) * lb
    wind += 2 * Math.atan2(det, den)
    const d = pointTri(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz)
    if (d < best) best = d
  }
  return Math.abs(wind) / (4 * Math.PI) > 0.5 ? Math.sqrt(best) : -Math.sqrt(best)
}

function pointTri(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az
  const acx = cx - ax, acy = cy - ay, acz = cz - az
  const apx = px - ax, apy = py - ay, apz = pz - az
  const d1 = abx * apx + aby * apy + abz * apz
  const d2 = acx * apx + acy * apy + acz * apz
  const sq = (x, y, z) => x * x + y * y + z * z
  if (d1 <= 0 && d2 <= 0) return sq(apx, apy, apz)
  const bpx = px - bx, bpy = py - by, bpz = pz - bz
  const d3 = abx * bpx + aby * bpy + abz * bpz
  const d4 = acx * bpx + acy * bpy + acz * bpz
  if (d3 >= 0 && d4 <= d3) return sq(bpx, bpy, bpz)
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3)
    return sq(apx - v * abx, apy - v * aby, apz - v * abz)
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz
  const d5 = abx * cpx + aby * cpy + abz * cpz
  const d6 = acx * cpx + acy * cpy + acz * cpz
  if (d6 >= 0 && d5 <= d6) return sq(cpx, cpy, cpz)
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6)
    return sq(apx - w * acx, apy - w * acy, apz - w * acz)
  }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
    return sq(px - (bx + w * (cx - bx)), py - (by + w * (cy - by)), pz - (bz + w * (cz - bz)))
  }
  const den = 1 / (va + vb + vc)
  const v = vb * den
  const w = vc * den
  return sq(px - (ax + abx * v + acx * w), py - (ay + aby * v + acy * w), pz - (az + abz * v + acz * w))
}

export function uniqueVerts(geo) {
  const pos = geo.getAttribute('position')
  const piv = geo.getAttribute('aPivot')
  const seen = new Map()
  for (let i = 0; i < pos.count; i++) {
    const p = [pos.getX(i), pos.getY(i), pos.getZ(i)]
    const pv = [piv.getX(i), piv.getY(i), piv.getZ(i), piv.getW(i)]
    const k = [...p, ...pv].join(',')
    if (!seen.has(k)) seen.set(k, { p, pv, id: Math.round(pv[3]) })
  }
  return [...seen.values()]
}
