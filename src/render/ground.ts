import type { BufferGeometry, InstancedMesh } from 'three'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { DECOR_GAP, type Island } from './island'

export interface Footprint {
  geo?: BufferGeometry
  tris?: readonly number[]
  minY: number
  scale?: number
  ox?: number
  oy?: number
  oz?: number
}

export interface GroundSource {
  readonly revision: number
  groundFootprints(): Footprint[]
}

export interface Pt {
  x: number
  z: number
}

export interface Route {
  pts: Pt[]
  reached: boolean
  length: number
}

const RES = 0.1
const STRIDE = 2
const NODE = RES * STRIDE
const SLACK = 0.17
const SQRT2 = Math.SQRT2

function dt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  const INF = 1e20
  let k = 0
  v[0] = 0
  z[0] = -INF
  z[1] = INF
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!)
    while (s <= z[k]!) {
      k--
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!)
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = INF
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++
    d[q] = (q - v[k]!) * (q - v[k]!) + f[v[k]!]!
  }
}

export class Ground {
  readonly x0: number
  readonly z0: number
  readonly nx: number
  readonly nz: number
  revision = 0
  lastBuildMs = 0

  private readonly island: Island
  private readonly sources: readonly GroundSource[]
  private seen = ''
  private readonly occ: Uint8Array
  private readonly water: Uint8Array
  private readonly clr: Float32Array

  private readonly mx: number
  private readonly mz: number
  private readonly gScore: Float32Array
  private readonly parent: Int32Array
  private readonly stamp: Uint32Array
  private readonly closed: Uint32Array
  private gen = 0
  private heap: Int32Array
  private heapF: Float32Array
  private heapN = 0
  private readonly comps = new Map<number, { label: Int32Array; main: number; rev: number }>()
  private stack: Int32Array

  constructor(island: Island, sources: readonly GroundSource[]) {
    this.island = island
    this.sources = sources
    let minx = Infinity
    let minz = Infinity
    let maxx = -Infinity
    let maxz = -Infinity
    for (const c of island.cells) {
      minx = Math.min(minx, c.x)
      maxx = Math.max(maxx, c.x)
      minz = Math.min(minz, c.z)
      maxz = Math.max(maxz, c.z)
    }
    if (!Number.isFinite(minx)) minx = minz = maxx = maxz = 0
    this.x0 = minx - 2
    this.z0 = minz - 2
    this.nx = Math.ceil((maxx - minx + 4) / RES)
    this.nz = Math.ceil((maxz - minz + 4) / RES)
    this.occ = new Uint8Array(this.nx * this.nz)
    this.water = this.waterMask()
    this.clr = new Float32Array(this.nx * this.nz)
    this.mx = Math.ceil(this.nx / STRIDE)
    this.mz = Math.ceil(this.nz / STRIDE)
    const n = this.mx * this.mz
    this.gScore = new Float32Array(n)
    this.parent = new Int32Array(n)
    this.stamp = new Uint32Array(n)
    this.closed = new Uint32Array(n)
    this.heap = new Int32Array(1024)
    this.heapF = new Float32Array(1024)
    this.stack = new Int32Array(n)
    this.rebuild()
  }

  refresh(): boolean {
    const key = this.sources.map((s) => s.revision).join(',')
    if (key === this.seen) return false
    this.rebuild()
    return true
  }

  private rebuild(): void {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
    this.seen = this.sources.map((s) => s.revision).join(',')
    this.occ.fill(0)
    for (const s of this.sources) for (const f of s.groundFootprints()) this.stampFootprint(f)
    this.distance()
    this.island.clearUnder((x, z, r) => this.clearAt(x, z) < r + DECOR_GAP)
    const { occ, water } = this
    for (let i = 0; i < occ.length; i++) occ[i] = occ[i]! | water[i]!
    this.stampTrunksAndRocks()
    this.distance()
    this.revision++
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now()
    this.lastBuildMs = t1 - t0
  }

  private waterMask(): Uint8Array {
    const { nx, nz } = this
    const out = new Uint8Array(nx * nz)
    const w = nx + 1
    const wet = new Uint8Array(w * (nz + 1))
    for (let j = 0; j <= nz; j++)
      for (let i = 0; i <= nx; i++) wet[j * w + i] = this.island.isLand(this.x0 + i * RES, this.z0 + j * RES) ? 0 : 1
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++)
        if (
          wet[j * w + i] ||
          wet[j * w + i + 1] ||
          wet[(j + 1) * w + i] ||
          wet[(j + 1) * w + i + 1] ||
          !this.island.isLand(this.x0 + (i + 0.5) * RES, this.z0 + (j + 0.5) * RES)
        )
          out[j * nx + i] = 1
    return out
  }

  private stampTrunksAndRocks(): void {
    const m = new Matrix4()
    const p = new Vector3()
    const q = new Quaternion()
    const s = new Vector3()
    for (const mesh of this.island.pickables as InstancedMesh[]) {
      const kind = this.island.kindFor(mesh)
      const k = kind === 'wood' ? 0.16 : kind === 'stone' ? 0.42 : 0
      if (k === 0) continue
      for (let i = 0; i < mesh.count; i++) {
        if (this.island.isFelled(mesh, i)) continue
        mesh.getMatrixAt(i, m)
        m.decompose(p, q, s)
        this.stampDisc(p.x, p.z, k * s.x)
      }
    }
  }

  private stampDisc(cx: number, cz: number, r: number): void {
    const { nx, nz, occ } = this
    const rr = r + RES * 0.71
    const i0 = Math.max(0, Math.floor((cx - rr - this.x0) / RES))
    const i1 = Math.min(nx - 1, Math.floor((cx + rr - this.x0) / RES))
    const j0 = Math.max(0, Math.floor((cz - rr - this.z0) / RES))
    const j1 = Math.min(nz - 1, Math.floor((cz + rr - this.z0) / RES))
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = this.x0 + (i + 0.5) * RES - cx
        const z = this.z0 + (j + 0.5) * RES - cz
        if (x * x + z * z <= rr * rr) occ[j * nx + i] = 1
      }
  }

  private mark(x: number, z: number): void {
    const i = Math.floor((x - this.x0) / RES)
    const j = Math.floor((z - this.z0) / RES)
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return
    this.occ[j * this.nx + i] = 1
  }

  private stampFootprint(f: Footprint): void {
    const k = f.scale ?? 1
    const ox = f.ox ?? 0
    const oy = f.oy ?? 0
    const oz = f.oz ?? 0
    let P: ArrayLike<number>
    let I: ArrayLike<number> | null = null
    if (f.geo) {
      P = f.geo.getAttribute('position').array as ArrayLike<number>
      I = f.geo.index ? (f.geo.index.array as ArrayLike<number>) : null
    } else if (f.tris) P = f.tris
    else return
    const nT = I ? I.length / 3 : P.length / 9
    const v = new Float64Array(9)
    for (let t = 0; t < nT; t++) {
      for (let c = 0; c < 3; c++) {
        const idx = I ? I[t * 3 + c]! : t * 3 + c
        v[c * 3] = ox + P[idx * 3]! * k
        v[c * 3 + 1] = oy + P[idx * 3 + 1]! * k
        v[c * 3 + 2] = oz + P[idx * 3 + 2]! * k
      }
      if (Math.max(v[1]!, v[4]!, v[7]!) < f.minY) continue
      this.stampTriangle(v)
    }
  }

  private stampTriangle(v: Float64Array): void {
    const ax = v[0]!, az = v[2]!, bx = v[3]!, bz = v[5]!, cx = v[6]!, cz = v[8]!
    for (const [px, pz, qx, qz] of [
      [ax, az, bx, bz],
      [bx, bz, cx, cz],
      [cx, cz, ax, az],
    ] as const) {
      const L = Math.hypot(qx - px, qz - pz)
      const n = Math.max(1, Math.ceil(L / (RES * 0.5)))
      for (let s = 0; s <= n; s++) this.mark(px + ((qx - px) * s) / n, pz + ((qz - pz) * s) / n)
    }
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
    if (Math.abs(d) < 1e-12) return
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - this.x0) / RES))
    const i1 = Math.min(this.nx - 1, Math.floor((Math.max(ax, bx, cx) - this.x0) / RES))
    const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - this.z0) / RES))
    const j1 = Math.min(this.nz - 1, Math.floor((Math.max(az, bz, cz) - this.z0) / RES))
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const px = this.x0 + (i + 0.5) * RES
        const pz = this.z0 + (j + 0.5) * RES
        const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d
        const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d
        if (l1 >= 0 && l2 >= 0 && 1 - l1 - l2 >= 0) this.occ[j * this.nx + i] = 1
      }
  }

  private distance(): void {
    const { nx, nz, occ, clr } = this
    const INF = 1e20
    const m = Math.max(nx, nz)
    const f = new Float64Array(m)
    const d = new Float64Array(m)
    const v = new Int32Array(m)
    const z = new Float64Array(m + 1)
    const tmp = new Float64Array(nx * nz)
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) f[j] = occ[j * nx + i] ? 0 : INF
      dt1d(f, nz, d, v, z)
      for (let j = 0; j < nz; j++) tmp[j * nx + i] = d[j]!
    }
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) f[i] = tmp[j * nx + i]!
      dt1d(f, nx, d, v, z)
      for (let i = 0; i < nx; i++) clr[j * nx + i] = occ[j * nx + i] ? -1 : Math.sqrt(d[i]!) * RES - SLACK
    }
  }

  clearAt(x: number, z: number): number {
    const i = Math.floor((x - this.x0) / RES)
    const j = Math.floor((z - this.z0) / RES)
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -1
    return this.clr[j * this.nx + i]!
  }

  free(x: number, z: number, r: number): boolean {
    return this.clearAt(x, z) >= r
  }

  lineClear(ax: number, az: number, bx: number, bz: number, r: number): boolean {
    const L = Math.hypot(bx - ax, bz - az)
    const n = Math.max(1, Math.ceil(L / (RES * 0.5)))
    for (let s = 0; s <= n; s++) if (this.clearAt(ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n) < r) return false
    return true
  }

  private nodeClear(n: number): number {
    const i = (n % this.mx) * STRIDE
    const j = ((n / this.mx) | 0) * STRIDE
    if (i >= this.nx || j >= this.nz) return -1
    return this.clr[j * this.nx + i]!
  }
  private nodeX(n: number): number {
    return this.x0 + ((n % this.mx) * STRIDE + 0.5) * RES
  }
  private nodeZ(n: number): number {
    return this.z0 + (((n / this.mx) | 0) * STRIDE + 0.5) * RES
  }
  private nodeAt(x: number, z: number): number {
    const i = Math.min(this.mx - 1, Math.max(0, Math.round((x - this.x0) / RES / STRIDE - 0.25)))
    const j = Math.min(this.mz - 1, Math.max(0, Math.round((z - this.z0) / RES / STRIDE - 0.25)))
    return j * this.mx + i
  }

  private nearestNode(x: number, z: number, r: number, maxDist: number): number {
    const need = r
    const c = this.nodeAt(x, z)
    const ci = c % this.mx
    const cj = (c / this.mx) | 0
    const R = Math.ceil(maxDist / NODE)
    let best = -1
    let bd = Infinity
    for (let ring = 0; ring <= R; ring++) {
      if (best >= 0 && (ring - 1) * NODE > bd) break
      for (let dj = -ring; dj <= ring; dj++)
        for (let di = -ring; di <= ring; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue
          const i = ci + di
          const j = cj + dj
          if (i < 0 || j < 0 || i >= this.mx || j >= this.mz) continue
          const n = j * this.mx + i
          if (this.nodeClear(n) < need) continue
          const d = Math.hypot(this.nodeX(n) - x, this.nodeZ(n) - z)
          if (d < bd) {
            bd = d
            best = n
          }
        }
    }
    return best
  }

  nearestFree(x: number, z: number, r: number, maxDist = 6): Pt | null {
    if (this.clearAt(x, z) >= r) return { x, z }
    const n = this.nearestNode(x, z, r, maxDist)
    return n < 0 ? null : { x: this.nodeX(n), z: this.nodeZ(n) }
  }

  private components(r: number): { label: Int32Array; main: number } {
    let c = this.comps.get(r)
    if (c && c.rev === this.revision) return c
    const { mx, mz } = this
    const n = mx * mz
    const label = c ? c.label : new Int32Array(n)
    label.fill(-1)
    const st = this.stack
    let next = 0
    let main = -1
    let mainSize = 0
    for (let s = 0; s < n; s++) {
      if (label[s]! >= 0 || this.nodeClear(s) < r) continue
      const id = next++
      let size = 0
      let top = 0
      st[top++] = s
      label[s] = id
      while (top > 0) {
        const a = st[--top]!
        size++
        const i = a % mx
        const j = (a / mx) | 0
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            if (di === 0 && dj === 0) continue
            const ii = i + di
            const jj = j + dj
            if (ii < 0 || jj < 0 || ii >= mx || jj >= mz) continue
            const m = jj * mx + ii
            if (label[m]! >= 0 || this.nodeClear(m) < r) continue
            if (di !== 0 && dj !== 0 && (this.nodeClear(j * mx + ii) < r || this.nodeClear(jj * mx + i) < r)) continue
            if (this.clearAt((this.nodeX(a) + this.nodeX(m)) / 2, (this.nodeZ(a) + this.nodeZ(m)) / 2) < r) continue
            label[m] = id
            st[top++] = m
          }
      }
      if (size > mainSize) {
        mainSize = size
        main = id
      }
    }
    c = { label, main, rev: this.revision }
    this.comps.set(r, c)
    return c
  }

  mainComponent(r: number): number {
    return this.components(r).main
  }

  componentAt(x: number, z: number, r: number): number {
    const n = this.nearestNode(x, z, r, 1)
    return n < 0 ? -1 : this.components(r).label[n]!
  }

  nearestIn(x: number, z: number, r: number, comp: number, maxDist = 6): Pt | null {
    if (comp < 0) return null
    const { label } = this.components(r)
    if (this.clearAt(x, z) >= r) {
      const n = this.nearestNode(x, z, r, 1)
      if (n >= 0 && label[n] === comp) return { x, z }
    }
    const c = this.nodeAt(x, z)
    const ci = c % this.mx
    const cj = (c / this.mx) | 0
    const R = Math.ceil(maxDist / NODE)
    let best = -1
    let bd = Infinity
    for (let ring = 0; ring <= R; ring++) {
      if (best >= 0 && (ring - 1) * NODE > bd) break
      for (let dj = -ring; dj <= ring; dj++)
        for (let di = -ring; di <= ring; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue
          const i = ci + di
          const j = cj + dj
          if (i < 0 || j < 0 || i >= this.mx || j >= this.mz) continue
          const n = j * this.mx + i
          if (label[n] !== comp) continue
          const d = Math.hypot(this.nodeX(n) - x, this.nodeZ(n) - z)
          if (d < bd) {
            bd = d
            best = n
          }
        }
    }
    return best < 0 ? null : { x: this.nodeX(best), z: this.nodeZ(best) }
  }

  private push(n: number, f: number): void {
    if (this.heapN >= this.heap.length) {
      const h = new Int32Array(this.heap.length * 2)
      h.set(this.heap)
      const hf = new Float32Array(this.heap.length * 2)
      hf.set(this.heapF)
      this.heap = h
      this.heapF = hf
    }
    let k = this.heapN++
    while (k > 0) {
      const p = (k - 1) >> 1
      if (this.heapF[p]! <= f) break
      this.heap[k] = this.heap[p]!
      this.heapF[k] = this.heapF[p]!
      k = p
    }
    this.heap[k] = n
    this.heapF[k] = f
  }
  private pop(): number {
    const top = this.heap[0]!
    const n = this.heap[--this.heapN]!
    const f = this.heapF[this.heapN]!
    let k = 0
    for (;;) {
      let c = 2 * k + 1
      if (c >= this.heapN) break
      if (c + 1 < this.heapN && this.heapF[c + 1]! < this.heapF[c]!) c++
      if (this.heapF[c]! >= f) break
      this.heap[k] = this.heap[c]!
      this.heapF[k] = this.heapF[c]!
      k = c
    }
    this.heap[k] = n
    this.heapF[k] = f
    return top
  }

  route(x0: number, z0: number, x1: number, z1: number, r: number, maxExpand = 24000): Route {
    const need = r
    if (this.clearAt(x0, z0) >= r && this.clearAt(x1, z1) >= r && this.lineClear(x0, z0, x1, z1, r)) {
      return { pts: [{ x: x1, z: z1 }], reached: true, length: Math.hypot(x1 - x0, z1 - z0) }
    }
    const start = this.nearestNode(x0, z0, r, 4)
    if (start < 0) return { pts: [], reached: false, length: 0 }
    const goalFree = this.clearAt(x1, z1) >= r
    let goal = this.nodeAt(x1, z1)
    if (this.nodeClear(goal) < need) goal = this.nearestNode(x1, z1, r, 3)
    const gx = x1
    const gz = z1
    this.gen++
    if (this.gen >= 0xffffffff) {
      this.gen = 1
      this.stamp.fill(0)
      this.closed.fill(0)
    }
    const gen = this.gen
    const mx = this.mx
    this.heapN = 0
    this.gScore[start] = 0
    this.parent[start] = -1
    this.stamp[start] = gen
    const h = (n: number): number => {
      const dx = Math.abs(this.nodeX(n) - gx) / NODE
      const dz = Math.abs(this.nodeZ(n) - gz) / NODE
      return (Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz)) * NODE
    }
    this.push(start, h(start))
    let best = start
    let bestH = h(start)
    let found = false
    let expanded = 0
    while (this.heapN > 0 && expanded < maxExpand) {
      const n = this.pop()
      if (this.closed[n] === gen) continue
      this.closed[n] = gen
      expanded++
      const hn = h(n)
      if (hn < bestH) {
        bestH = hn
        best = n
      }
      if (n === goal) {
        found = true
        best = n
        break
      }
      const i = n % mx
      const j = (n / mx) | 0
      const g = this.gScore[n]!
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue
          const ii = i + di
          const jj = j + dj
          if (ii < 0 || jj < 0 || ii >= mx || jj >= this.mz) continue
          const m = jj * mx + ii
          if (this.closed[m] === gen) continue
          if (this.nodeClear(m) < need) continue
          if (di !== 0 && dj !== 0 && (this.nodeClear(j * mx + ii) < need || this.nodeClear(jj * mx + i) < need)) continue
          if (this.clearAt((this.nodeX(n) + this.nodeX(m)) / 2, (this.nodeZ(n) + this.nodeZ(m)) / 2) < r) continue
          const ng = g + (di !== 0 && dj !== 0 ? SQRT2 : 1) * NODE
          if (this.stamp[m] === gen && ng >= this.gScore[m]!) continue
          this.stamp[m] = gen
          this.gScore[m] = ng
          this.parent[m] = n
          this.push(m, ng + h(m))
        }
    }
    const chain: Pt[] = []
    for (let n = best; n >= 0; n = this.parent[n]!) chain.push({ x: this.nodeX(n), z: this.nodeZ(n) })
    chain.reverse()
    const reached = found && goal >= 0
    if (reached && goalFree) {
      const last = chain[chain.length - 1]!
      if (this.lineClear(last.x, last.z, gx, gz, r)) chain.push({ x: gx, z: gz })
    }
    const pts: Pt[] = []
    let ax = x0
    let az = z0
    let k = 0
    if (this.clearAt(x0, z0) < r) {
      pts.push(chain[0]!)
      ax = chain[0]!.x
      az = chain[0]!.z
      k = 1
    }
    while (k < chain.length) {
      let far = k
      for (let t = Math.min(chain.length - 1, k + 60); t > k; t--) {
        if (this.lineClear(ax, az, chain[t]!.x, chain[t]!.z, r)) {
          far = t
          break
        }
      }
      pts.push(chain[far]!)
      ax = chain[far]!.x
      az = chain[far]!.z
      k = far + 1
    }
    let length = 0
    let px = x0
    let pz = z0
    for (const p of pts) {
      length += Math.hypot(p.x - px, p.z - pz)
      px = p.x
      pz = p.z
    }
    return { pts, reached: reached && (goalFree || Math.hypot(px - gx, pz - gz) < 0.6), length }
  }
}

export function follow(pos: { x: number; z: number }, path: Pt[], step: number): { dx: number; dz: number } | null {
  let left = step
  let dir: { dx: number; dz: number } | null = null
  while (left > 1e-6 && path.length > 0) {
    const p = path[0]!
    const dx = p.x - pos.x
    const dz = p.z - pos.z
    const d = Math.hypot(dx, dz)
    if (d > 1e-6) dir = { dx: dx / d, dz: dz / d }
    if (d <= left) {
      pos.x = p.x
      pos.z = p.z
      left -= d
      path.shift()
    } else {
      pos.x += (dx / d) * left
      pos.z += (dz / d) * left
      left = 0
    }
  }
  return dir
}
