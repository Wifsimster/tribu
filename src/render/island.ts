import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshToonMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PALETTE, SUN_DIR, ramp, rampTexture, smoothstep, tint } from './palette'

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash2(x: number, y: number, seed: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453
  return s - Math.floor(s)
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash2(xi, yi, seed)
  const b = hash2(xi + 1, yi, seed)
  const c = hash2(xi, yi + 1, seed)
  const d = hash2(xi + 1, yi + 1, seed)
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}

function fastAtan2(y: number, x: number): number {
  const ax = Math.abs(x)
  const ay = Math.abs(y)
  const a = Math.min(ax, ay) / (Math.max(ax, ay) + 1e-12)
  const s = a * a
  let r = ((-0.0464964749 * s + 0.15931422) * s - 0.327622764) * s * a + a
  if (ay > ax) r = 1.57079637 - r
  if (x < 0) r = 3.14159274 - r
  return y < 0 ? -r : r
}

function fbm(x: number, y: number, seed: number): number {
  return valueNoise(x, y, seed) * 0.64 + valueNoise(x * 2.3, y * 2.3, seed + 17) * 0.36
}

export const TILE = 1.35
export const GRID = 42

export const HEX_R = TILE / 1.5
const HEX_DX = 1.5 * HEX_R
const HEX_DZ = Math.sqrt(3) * HEX_R
const NB: readonly [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
]
function hexVertex(k: number, r = HEX_R): [number, number] {
  const a = (Math.PI / 3) * (k % 6)
  return [Math.cos(a) * r, Math.sin(a) * r]
}
function hexNormal(k: number): [number, number] {
  const a = (Math.PI / 3) * k + Math.PI / 6
  return [Math.cos(a), Math.sin(a)]
}
function seabedHex(
  vert: (x: number, y: number, z: number, nx: number, ny: number, nz: number, s: number) => number,
  x: number,
  z: number,
  s: number,
): number {
  const t0 = vert(x + HEX_R, -0.01, z, 0, 1, 0, s)
  for (let c = 1; c < 6; c++) {
    const [vx, vz] = hexVertex(c)
    vert(x + vx, -0.01, z + vz, 0, 1, 0, s)
  }
  return t0
}
function hexDistance(aq: number, ar: number, bq: number, br: number): number {
  const dq = aq - bq
  const dr = ar - br
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
}
function sectorHas(list: readonly { q: number; r: number }[], o: { q: number; r: number }): boolean {
  return list.some((a) => a.q === o.q && a.r === o.r)
}
export function hexCenter(q: number, r: number): [number, number] {
  return [HEX_DX * q, HEX_DZ * (r + q / 2)]
}

function key(q: number, r: number): number {
  return (q + 64) * 256 + (r + 64)
}

const tmpTint = new Color()

const CAP = 0.3
export const GROUND_Y = 0.88
const BED_Y = -0.02
const WET = 0.34
const ROW_H = 0.62
const ROWS_CLIFF = 6
const ROWS_BEACH = 4
const PLAZA_RADIUS = 5.1
const TROD = { x: -0.6, z: 0.6, r: 4.1 }
const CLEAR_RADIUS = 8.6

function clearRadius(x: number, z: number, growth = 1): number {
  const base = CLEAR_RADIUS * (0.94 + 0.42 * (growth - 1) * 2.4)
  const dx = x - TROD.x
  const dz = z - TROD.z
  const d = Math.hypot(dx, dz)
  if (d < 1e-3) return base
  const back = Math.max(0, -(dx + dz) / (Math.SQRT2 * d))
  return base + back * back * back * 3.2
}

const EDGE_BASE = 9.6
const DEFAULT_SEED = 1337

const SUN_H = 1 / Math.hypot(SUN_DIR.x, SUN_DIR.z)
const SUN_HX = SUN_DIR.x * SUN_H
const SUN_HZ = SUN_DIR.z * SUN_H
const HULL_BINS = 256

function shoreEdge(theta: number, seed: number, growth = 1): number {
  return (
    (EDGE_BASE +
      1.45 * Math.sin(3 * theta + 0.9) +
      0.75 * Math.sin(5 * theta - 1.7) +
      0.8 * valueNoise(Math.cos(theta) * 2.4 + 8, Math.sin(theta) * 2.4 + 8, seed)) * growth
  )
}

export function spreadForAge(age: number): number {
  return (
    1 +
    Math.min(age, 3) * 0.11 +
    Math.max(0, Math.min(age, 5) - 3) * 0.07 +
    Math.max(0, Math.min(age, 10) - 5) * 0.03
  )
}

export const BASE_GROWTH = 1.45

export const RAIL_AGE = 7
export const GROWN_GROWTH = 1.75

export function islandGrowth(age: number): number {
  return age >= RAIL_AGE ? GROWN_GROWTH : BASE_GROWTH
}

export interface LandPlot {
  kind: string
  q: number
  r: number
}

interface PlotLook {
  cove: boolean
  beach: boolean
  ground: Color
  core?: Color
}
const PLOT_LOOK: Record<string, PlotLook> = {
  foret: { cove: false, beach: false, ground: new Color('#4a8a3e') },
  prairie: { cove: false, beach: false, ground: new Color('#86c95a') },
  carriere: { cove: false, beach: false, ground: new Color('#a19a8c') },
  roseliere: {
    cove: false,
    beach: false,
    ground: new Color('#7d9a52'),
    core: new Color('#4d8f8c'),
  },
  crique: { cove: true, beach: true, ground: PALETTE.sand },
  affleurement: { cove: false, beach: false, ground: new Color('#b98a5a') },
}
const PLOT_SNOW = 0.4
function plotRandom(seed: number, p: LandPlot, salt: number): () => number {
  return mulberry32((seed ^ Math.imul(key(p.q, p.r) + 1, 0x9e3779b1) ^ salt) >>> 0)
}
function plotLook(kind: string): PlotLook {
  return PLOT_LOOK[kind] ?? PLOT_LOOK.foret!
}
export function plotTint(kind: string): Color {
  return plotLook(kind).ground
}

export const ISLAND_RADIUS = (() => {
  const half = GRID / 2
  const corner = TILE / 2
  let far = 0
  for (let gx = 0; gx < GRID; gx++) {
    for (let gz = 0; gz < GRID; gz++) {
      const dx = gx - half + 0.5
      const dz = gz - half + 0.5
      if (Math.hypot(dx, dz) > shoreEdge(Math.atan2(dz, dx), DEFAULT_SEED)) continue
      far = Math.max(far, Math.hypot(Math.abs(dx) * TILE + corner, Math.abs(dz) * TILE + corner))
    }
  }
  return far
})()

export interface Cell {
  gx: number
  gz: number
  x: number
  z: number
  beach: boolean
  inland: number
  relief: number
  rim: boolean
  outx: number
  outz: number
  trod: boolean
  plot?: string
  plotCenter?: boolean
  plotOf?: LandPlot
}

export type NodeKind = 'wood' | 'stone' | 'food'

interface Scatter {
  cells: Cell[]
  rnd: () => number
  scale?: number
  block?: boolean
  tones?: readonly Color[]
  src?: number
}

const DECOR_R: Record<NodeKind, number> = { wood: 0.16, stone: 0.42, food: 0.34 }
export const DECOR_GAP = 0.3

const TREE_MAX = 46
const ORE_TONES = [new Color('#b4733f'), new Color('#8e5a3a'), new Color('#c08a52')]

export class Island {
  readonly group = new Group()
  readonly cells: Cell[] = []
  private readonly unlit: MeshBasicMaterial[] = []
  private readonly nightTint = new Color('#48627c')

  setDaylight(k: number): void {
    const c = tmpTint.setRGB(1, 1, 1).lerp(this.nightTint, 1 - k)
    for (const m of this.unlit) m.color.copy(c)
    if (this.neighborFires && this.neighborFireMat) {
      const night = 1 - k
      this.neighborFires.visible = night > 0.2
      this.neighborFireMat.opacity = Math.min(1, (night - 0.2) * 1.8)
    }
  }

  registerUnlit(mat: MeshBasicMaterial): void {
    this.unlit.push(mat)
  }
  readonly pickables: InstancedMesh[] = []
  readonly buildSlots: Vector3[] = []
  private kindOf = new Map<InstancedMesh, NodeKind>()
  private byKey = new Map<number, Cell>()
  private hull = new Float32Array(HULL_BINS)
  private shadowProf = new Float32Array(HULL_BINS)

  readonly radius: number

  readonly land: readonly LandPlot[]
  private readonly growth: number

  private readonly seed: number
  private readonly age: number

  constructor(
    seed = DEFAULT_SEED,
    age = 0,
    land: readonly LandPlot[] = [],
    growth = islandGrowth(age),
    cellsOnly = false,
  ) {
    this.seed = seed
    this.age = age
    this.land = land
    this.growth = growth
    const rnd = mulberry32(seed)
    const half = GRID / 2

    const span = Math.ceil(half * 1.3)
    for (let gx = -span; gx <= span; gx++) {
      for (let gz = -span; gz <= span; gz++) {
        const [wx, wz] = hexCenter(gx, gz)
        const dx = wx / TILE
        const dz = wz / TILE
        const r = Math.hypot(dx, dz)
        const theta = Math.atan2(dz, dx)
        const edge = shoreEdge(theta, seed, this.growth)
        if (r > edge) continue
        const inland = edge - r
        const hill = fbm(dx * 0.23, dz * 0.23, seed)
        const shore = Math.min(inland / 2.4, 1)
        const relief = 0.3 + shore * (0.9 + hill * 1.1)
        const x = wx
        const z = wz
        const sandy = valueNoise(Math.cos(theta) * 3.1 + 20, Math.sin(theta) * 3.1 + 20, seed) > 0.44
        const beach = inland < 1.05 && sandy
        const trod =
          Math.hypot(x, z) < PLAZA_RADIUS &&
          Math.hypot(x - TROD.x, z - TROD.z) <
            TROD.r * (0.78 + valueNoise(x * 0.62, z * 0.62, seed + 31) * 0.42)
        const cell: Cell = {
          gx,
          gz,
          x,
          z,
          beach,
          inland,
          relief,
          rim: false,
          outx: 0,
          outz: 0,
          trod,
        }
        this.cells.push(cell)
        this.byKey.set(key(gx, gz), cell)
      }
    }
    for (const p of land) this.addPlot(p)
    this.fillPockets()
    if (cellsOnly) {
      this.radius = this.measureRadius()
      return
    }

    this.bakeRim()
    this.bakeFootprint()
    this.buildTerrain()
    this.buildFoundation()
    this.buildWater()
    this.buildRipple()
    this.buildWaterline()
    this.buildHorizons()
    this.scatter(rnd)

    this.radius = this.measureRadius()
  }

  private measureRadius(): number {
    let far = 0
    for (const c of this.cells) {
      far = Math.max(far, Math.hypot(Math.abs(c.x) + TILE / 2, Math.abs(c.z) + TILE / 2))
    }
    return far
  }

  get seedValue(): number {
    return this.seed
  }

  private bakeFootprint(): void {
    const step = (Math.PI * 2) / HULL_BINS
    for (let i = 0; i < HULL_BINS; i++) {
      this.hull[i] = (shoreEdge(i * step, this.seed, this.growth) - 0.7) * TILE
    }
    const h = TILE / 2
    const depth = new Float32Array(HULL_BINS)
    for (const c of this.cells) {
      if (!c.rim) continue
      const a0 = Math.atan2(c.z, c.x)
      let lo = 0
      let hi = 0
      let far = 0
      for (let k = 0; k < 4; k++) {
        const cx = c.x + (k & 1 ? h : -h)
        const cz = c.z + (k & 2 ? h : -h)
        far = Math.max(far, Math.hypot(cx, cz))
        let a = Math.atan2(cz, cx) - a0
        if (a > Math.PI) a -= Math.PI * 2
        else if (a < -Math.PI) a += Math.PI * 2
        lo = Math.min(lo, a)
        hi = Math.max(hi, a)
      }
      const i0 = Math.floor((a0 + lo) / step)
      const i1 = Math.ceil((a0 + hi) / step)
      const dv = c.beach ? 0.4 : 1
      for (let i = i0; i <= i1; i++) {
        const j = ((i % HULL_BINS) + HULL_BINS) % HULL_BINS
        if (far > this.hull[j]!) this.hull[j] = far
        if (dv > depth[j]!) depth[j] = dv
      }
    }
    const smooth = new Float32Array(HULL_BINS)
    for (let i = 0; i < HULL_BINS; i++) {
      smooth[i] =
        this.hull[(i + HULL_BINS - 1) % HULL_BINS]! * 0.25 +
        this.hull[i]! * 0.5 +
        this.hull[(i + 1) % HULL_BINS]! * 0.25
    }
    this.hull = smooth
    const W = 10
    const raw = new Float32Array(HULL_BINS)
    for (let i = 0; i < HULL_BINS; i++) {
      let mean = 0
      for (let k = -W; k <= W; k++) mean += this.hull[(i + k + HULL_BINS) % HULL_BINS]!
      mean /= 2 * W + 1
      const conc = Math.min(1, Math.max(0, (mean - this.hull[i]!) / (0.8 * TILE)))
      raw[i] = Math.min(1, 0.12 + 0.62 * depth[i]! + 0.55 * conc)
    }
    for (let i = 0; i < HULL_BINS; i++) {
      this.shadowProf[i] =
        raw[(i + HULL_BINS - 2) % HULL_BINS]! * 0.15 +
        raw[(i + HULL_BINS - 1) % HULL_BINS]! * 0.2 +
        raw[i]! * 0.3 +
        raw[(i + 1) % HULL_BINS]! * 0.2 +
        raw[(i + 2) % HULL_BINS]! * 0.15
    }
  }

  private shadowAt(theta: number): number {
    const f = (((theta / (Math.PI * 2)) % 1) + 1) * HULL_BINS
    const i = Math.floor(f)
    const k = f - i
    return this.shadowProf[i % HULL_BINS]! * (1 - k) + this.shadowProf[(i + 1) % HULL_BINS]! * k
  }

  private hullAt(theta: number): number {
    const f = (((theta / (Math.PI * 2)) % 1) + 1) * HULL_BINS
    const i = Math.floor(f)
    const k = f - i
    return this.hull[i % HULL_BINS]! * (1 - k) + this.hull[(i + 1) % HULL_BINS]! * k
  }

  private bakeRim(): void {
    for (const c of this.cells) {
      for (let k = 0; k < 6; k++) {
        if (this.byKey.has(key(c.gx + NB[k]![0], c.gz + NB[k]![1]))) continue
        c.rim = true
        const [nx, nz] = hexNormal(k)
        c.outx += nx
        c.outz += nz
      }
    }
  }

  private leavesMesh: InstancedMesh | null = null
  private readonly felledTrees = new Set<number>()
  private readonly clearedOf = new Map<InstancedMesh, Set<number>>()
  private readonly srcOf = new Map<InstancedMesh, Int16Array>()
  readonly decorRemoved: Record<NodeKind, number> = { wood: 0, stone: 0, food: 0 }
  private baseTrees = 0
  private leafBase: Float32Array | null = null
  private bushMesh: InstancedMesh | null = null
  private bushBase: Float32Array | null = null
  private terrainMat: MeshLambertMaterial | null = null
  private terrainMesh: Mesh | null = null
  private terrainBase: Float32Array | null = null
  private terrainSlots: Uint32Array | null = null
  private terrainDecorSnow: Float32Array | null = null
  private seasonId = -1
  private seasonRamp = -1

  setSeason(id: number, u = 1): void {
    const ramp = smoothstep(0, id === 3 ? 0.55 : 0.3, u)
    if (id === this.seasonId && Math.abs(ramp - this.seasonRamp) < 0.02) return
    this.seasonId = id
    this.seasonRamp = ramp
    const target = id === 2 ? new Color('#b96f35') : id === 3 ? new Color('#c2cfcc') : null
    const mixK = id === 2 ? 0.48 : id === 3 ? 0.55 : 0
    const mul: [number, number, number] =
      id === 0 ? [0.97, 1.06, 0.94] : id === 1 ? [1.06, 1.0, 0.85] : [1, 1, 1]
    const c = new Color()
    const repaint = (mesh: InstancedMesh | null, base: Float32Array | null, k: number): void => {
      if (!mesh?.instanceColor || !base) return
      const arr = mesh.instanceColor.array as Float32Array
      for (let i = 0; i < base.length; i += 3) {
        c.setRGB(base[i]!, base[i + 1]!, base[i + 2]!)
        if (target) c.lerp(target, mixK * k)
        arr[i] = c.r * mul[0]
        arr[i + 1] = c.g * mul[1]
        arr[i + 2] = c.b * mul[2]
      }
      mesh.instanceColor.needsUpdate = true
    }
    repaint(this.leavesMesh, this.leafBase, ramp)
    repaint(this.bushMesh, this.bushBase, 0.7 * ramp)
    this.paintGround(id, ramp)
    if (this.terrainMat) {
      const grade: [number, number, number] =
        id === 0
          ? [0.99, 1.01, 0.99]
          : id === 1
            ? [1.03, 1.0, 0.93]
            : id === 2
              ? [1.04, 0.965, 0.885]
              : [0.965, 0.99, 1.05]
      this.terrainMat.color.setRGB(
        1 + (grade[0] - 1) * ramp,
        1 + (grade[1] - 1) * ramp,
        1 + (grade[2] - 1) * ramp,
      )
    }
  }

  private paintGround(id: number, ramp: number): void {
    const mesh = this.terrainMesh
    const base = this.terrainBase
    const slots = this.terrainSlots
    if (!mesh || !base || !slots) return
    const target =
      id === 0
        ? new Color('#a9dc72')
        : id === 1
          ? new Color('#79a83e')
          : id === 2
            ? new Color('#c08a3c')
            : new Color('#eef5fa')
    const mix = (id === 0 ? 0.2 : id === 1 ? 0.16 : id === 2 ? 0.34 : 0.72) * ramp
    const paint = new Float32Array(base.length)
    const c = new Color()
    const put = (j: number, k: number): void => {
      c.setRGB(base[j]!, base[j + 1]!, base[j + 2]!)
      c.lerp(target, k)
      paint[j] = c.r
      paint[j + 1] = c.g
      paint[j + 2] = c.b
    }
    this.cells.forEach((cell, i) => {
      put((i * 2 + 1) * 3, mix * (cell.beach ? 0.35 : cell.plot && id === 3 ? PLOT_SNOW : 1))
      put(i * 2 * 3, mix * 0.22)
    })
    const snow = this.terrainDecorSnow
    for (let j = this.cells.length * 2 * 3, d = 0; j < base.length; j += 3, d++) put(j, mix * (snow?.[d] ?? 1))
    const col = mesh.geometry.getAttribute('color') as BufferAttribute
    const arr = col.array as Float32Array
    for (let v = 0; v < slots.length; v++) {
      const j = slots[v]! * 3
      arr[v * 3] = paint[j]!
      arr[v * 3 + 1] = paint[j + 1]!
      arr[v * 3 + 2] = paint[j + 2]!
    }
    col.needsUpdate = true
  }

  private buildTerrain(): void {
    const mat = new MeshLambertMaterial({ vertexColors: true })
    this.terrainMat = mat
    const rims = this.cells.filter((c) => c.rim)

    const pos: number[] = []
    const nor: number[] = []
    const slot: number[] = []
    const index: number[] = []
    const vert = (x: number, y: number, z: number, nx: number, ny: number, nz: number, s: number): number => {
      pos.push(x, y, z)
      nor.push(nx, ny, nz)
      slot.push(s)
      return slot.length - 1
    }
    const tri = (a: number, b: number, c: number, nx: number, ny: number, nz: number): void => {
      const ux = pos[b * 3]! - pos[a * 3]!
      const uy = pos[b * 3 + 1]! - pos[a * 3 + 1]!
      const uz = pos[b * 3 + 2]! - pos[a * 3 + 2]!
      const vx = pos[c * 3]! - pos[a * 3]!
      const vy = pos[c * 3 + 1]! - pos[a * 3 + 1]!
      const vz = pos[c * 3 + 2]! - pos[a * 3 + 2]!
      const d = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz
      if (d >= 0) index.push(a, b, c)
      else index.push(a, c, b)
    }
    const corners = Array.from({ length: 6 }, (_, k) => hexVertex(k))
    const capBottom = GROUND_Y - CAP
    const side = (c: Cell, k: number, y0: number, y1: number, s: number): void => {
      if (y1 - y0 < 1e-4) return
      const [ax, az] = corners[k]!
      const [bx, bz] = corners[(k + 1) % 6]!
      const a0 = vert(c.x + ax, y0, c.z + az, ax / HEX_R, 0, az / HEX_R, s)
      const a1 = vert(c.x + ax, y1, c.z + az, ax / HEX_R, 0, az / HEX_R, s)
      const b0 = vert(c.x + bx, y0, c.z + bz, bx / HEX_R, 0, bz / HEX_R, s)
      const b1 = vert(c.x + bx, y1, c.z + bz, bx / HEX_R, 0, bz / HEX_R, s)
      const [nx, nz] = hexNormal(k)
      tri(a0, b0, b1, nx, 0, nz)
      tri(a0, b1, a1, nx, 0, nz)
    }

    this.cells.forEach((c, i) => {
      const t0 = pos.length / 3
      for (const [vx, vz] of corners) vert(c.x + vx, GROUND_Y, c.z + vz, 0, 1, 0, i * 2 + 1)
      for (let k = 1; k < 5; k++) tri(t0, t0 + k, t0 + k + 1, 0, 1, 0)
      if (!c.rim) return
      for (let k = 0; k < 6; k++) {
        if (this.byKey.has(key(c.gx + NB[k]![0], c.gz + NB[k]![1]))) continue
        side(c, k, 0, capBottom, i * 2)
        side(c, k, capBottom, GROUND_Y, i * 2 + 1)
      }
    })
    const decor = this.plotGroundDecor(vert, tri)

    const base = new Float32Array((this.cells.length * 2 + decor.length) * 3)
    const capColor = new Color()
    const socleColor = new Color()
    const grassRamp = [
      [0, PALETTE.grassDark],
      [0.55, PALETTE.grass],
      [1, PALETTE.grassLight],
    ] as const
    this.cells.forEach((c, i) => {
      if (c.trod) {
        const packed = smoothstep(TROD.r, 0.6, Math.hypot(c.x - TROD.x, c.z - TROD.z))
        capColor.copy(PALETTE.dirt).lerp(PALETTE.dirtDark, packed * 0.75)
      } else if (c.plot) {
        const look = plotLook(c.plot)
        capColor.copy(c.plotCenter && look.core ? look.core : look.ground)
      } else if (c.beach) capColor.copy(PALETTE.sand)
      else ramp(grassRamp, smoothstep(0.5, 2.6, c.relief), capColor)
      const mottle = 0.93 + fbm((c.x / TILE) * 0.55, (c.z / TILE) * 0.55, 7) * 0.14
      capColor.copy(tint(capColor, c.gx * 31 + c.gz * 7 + 512, 0.06)).multiplyScalar(mottle)

      socleColor
        .copy(c.beach ? PALETTE.sand : PALETTE.earth)
        .lerp(PALETTE.earthDark, c.beach ? 0.3 : 0.5)
        .multiplyScalar(0.88)
      if (c.rim) socleColor.lerp(PALETTE.water, 0.14)
      socleColor.toArray(base, i * 2 * 3)
      capColor.toArray(base, (i * 2 + 1) * 3)
    })
    decor.forEach((d, j) => d.color.toArray(base, (this.cells.length * 2 + j) * 3))
    this.terrainDecorSnow = Float32Array.from(decor, (d) => d.snow)

    const slots = new Uint32Array(slot)
    const col = new Float32Array(slots.length * 3)
    for (let v = 0; v < slots.length; v++) {
      const j = slots[v]! * 3
      col[v * 3] = base[j]!
      col[v * 3 + 1] = base[j + 1]!
      col[v * 3 + 2] = base[j + 2]!
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
    geo.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3))
    geo.setAttribute('color', new BufferAttribute(col, 3))
    geo.setIndex(index)
    geo.computeBoundingSphere()
    const mesh = new Mesh(geo, mat)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.terrainMesh = mesh
    this.terrainBase = base
    this.terrainSlots = slots

    const contactMat = new MeshBasicMaterial()
    this.unlit.push(contactMat)
    const bandGeo = new CylinderGeometry(HEX_R, HEX_R, 1, 6, 1, true, Math.PI / 2)
    const contact = new InstancedMesh(bandGeo, contactMat, rims.length)
    const dummy = new Object3D()
    const wetColor = new Color()

    let ci = 0
    rims.forEach((c) => {
      const shore = c.beach ? PALETTE.sand : PALETTE.earth
      const len = Math.hypot(c.outx, c.outz)
      const nx = len > 0 ? c.outx / len : c.x / (Math.hypot(c.x, c.z) + 1e-6)
      const nz = len > 0 ? c.outz / len : c.z / (Math.hypot(c.x, c.z) + 1e-6)
      const facing = nx * SUN_HX + nz * SUN_HZ
      const shade = 0.5 - 0.5 * facing

      dummy.position.set(c.x, WET / 2, c.z)
      dummy.scale.set(1.008, WET, 1.008)
      dummy.updateMatrix()
      contact.setMatrixAt(ci, dummy.matrix)
      wetColor.copy(shore).multiplyScalar(0.26).lerp(PALETTE.waterDeep, 0.5 + shade * 0.22)
      contact.setColorAt(ci, wetColor)
      ci++
    })
    contact.count = ci

    contact.instanceMatrix.needsUpdate = true
    if (contact.instanceColor) contact.instanceColor.needsUpdate = true
    this.group.add(mesh, contact)
  }

  private plotGroundDecor(
    vert: (x: number, y: number, z: number, nx: number, ny: number, nz: number, s: number) => number,
    tri: (a: number, b: number, c: number, nx: number, ny: number, nz: number) => void,
  ): { color: Color; snow: number }[] {
    const colors: { color: Color; snow: number }[] = []
    const first = this.cells.length * 2
    const spike = (x: number, y: number, z: number, r: number, h: number, yaw: number, color: Color): void => {
      const s = first + colors.length
      colors.push({ color, snow: 1 })
      const apex: [number, number, number] = [x, y + h, z]
      for (let k = 0; k < 3; k++) {
        const a0 = yaw + (k * Math.PI * 2) / 3
        const a1 = yaw + ((k + 1) * Math.PI * 2) / 3
        const p0: [number, number, number] = [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r]
        const p1: [number, number, number] = [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r]
        const am = (a0 + a1) / 2
        const nl = Math.hypot(h, r * 0.5)
        const nx = (Math.cos(am) * h) / nl
        const ny = (r * 0.5) / nl
        const nz = (Math.sin(am) * h) / nl
        const i0 = vert(p0[0], p0[1], p0[2], nx, ny, nz, s)
        const i1 = vert(p1[0], p1[1], p1[2], nx, ny, nz, s)
        const i2 = vert(apex[0], apex[1], apex[2], nx, ny, nz, s)
        tri(i0, i1, i2, nx, ny, nz)
      }
    }
    const FLOWERS = [new Color('#fbf7ea'), new Color('#f7d54a'), new Color('#f29abb'), new Color('#b99cf0')]
    const REEDS = [new Color('#b8a25c'), new Color('#8f9a4b'), new Color('#a58a4e')]
    const floor = PALETTE.sand.clone().lerp(PALETTE.waterShallow, 0.3)
    for (const p of this.land) {
      if (!plotLook(p.kind).cove || this.byKey.has(key(p.q, p.r))) continue
      const s = first + colors.length
      colors.push({ color: floor, snow: 0.1 })
      const [x, z] = hexCenter(p.q, p.r)
      const t0 = seabedHex(vert, x, z, s)
      for (let c = 1; c < 5; c++) tri(t0, t0 + c, t0 + c + 1, 0, 1, 0)
    }
    for (const p of this.land) {
      if (p.kind !== 'prairie' && p.kind !== 'roseliere') continue
      const rnd = plotRandom(this.seed, p, 0x51ed)
      for (const c of this.cells) {
        if (c.plotOf !== p) continue
        if (p.kind === 'prairie') {
          for (let n = 0; n < 9; n++) {
            const a = rnd() * Math.PI * 2
            const d = Math.sqrt(rnd()) * HEX_R * 0.82
            const color = FLOWERS[Math.floor(rnd() * FLOWERS.length)]!
            const x = c.x + Math.cos(a) * d
            const z = c.z + Math.sin(a) * d
            const y = GROUND_Y + 0.03
            const yaw = rnd() * Math.PI
            const r = 0.1 + rnd() * 0.04
            const s = first + colors.length
            colors.push({ color, snow: 1 })
            const i0 = vert(x + Math.cos(yaw) * r, y, z + Math.sin(yaw) * r, 0, 1, 0, s)
            const i1 = vert(x + Math.cos(yaw + 2.09) * r, y, z + Math.sin(yaw + 2.09) * r, 0, 1, 0, s)
            const i2 = vert(x + Math.cos(yaw + 4.19) * r, y, z + Math.sin(yaw + 4.19) * r, 0, 1, 0, s)
            tri(i0, i1, i2, 0, 1, 0)
          }
        } else if (!c.plotCenter) {
          const [px, pz] = hexCenter(p.q, p.r)
          for (let n = 0; n < 7; n++) {
            const t = 0.15 + rnd() * 0.55
            const x = c.x + (px - c.x) * t + (rnd() - 0.5) * 0.7
            const z = c.z + (pz - c.z) * t + (rnd() - 0.5) * 0.7
            const color = REEDS[Math.floor(rnd() * REEDS.length)]!
            spike(x, GROUND_Y, z, 0.05, 0.75 + rnd() * 0.5, rnd() * 2, color)
          }
        }
      }
    }
    return colors
  }

  private buildFoundation(): void {
    const verts: number[] = []
    const colors: number[] = []
    const index: number[] = []
    const milk = PALETTE.water.clone().lerp(PALETTE.waterDeep, 0.25)
    const wall = new Color()
    const cj = new Color()
    const water = (gx: number, gz: number): boolean => !this.byKey.has(key(gx, gz))
    const aOf = (t: number): number => 0.95 * Math.pow(1 - t, 1.3)
    const fruit = (t: number): number => 0.28 * t * t + 0.04 * t

    const endCode = (c: Cell, ex: number, ez: number, nx: number, nz: number): number => {
      if (water(c.gx + ex, c.gz + ez)) return 1
      return water(c.gx + ex + nx, c.gz + ez + nz) ? 0 : -1
    }

    const curtain = (
      c: Cell,
      nx: number,
      nz: number,
      ax: number, az: number,
      bx: number, bz: number,
      codeA: number,
      codeB: number,
    ): void => {
      const rows = c.beach ? ROWS_BEACH : ROWS_CLIFF
      const shore = c.beach ? PALETTE.sand : PALETTE.earth
      const facing = nx * SUN_HX + nz * SUN_HZ
      const shade = 0.5 - 0.5 * facing
      wall.copy(shore).multiplyScalar(0.72 - shade * 0.12)
      const tx = (bx - ax) / HEX_R
      const tz = (bz - az) / HEX_R
      const b = verts.length / 3
      let y = 0
      for (let j = 0; j <= rows; j++) {
        const t = j / rows
        if (j > 0) y -= ROW_H * (1 + (j - 1) * 0.18)
        const f = fruit(t)
        cj.copy(wall).lerp(milk, 0.06 + 0.9 * Math.pow(t, 1.6))
        cj.multiplyScalar(1 + (j % 2 === 0 ? 0.05 : -0.05) * (1 - t))
        const a = aOf(t)
        verts.push(
          ax - nx * f + tx * codeA * f, y, az - nz * f + tz * codeA * f,
          bx - nx * f - tx * codeB * f, y, bz - nz * f - tz * codeB * f,
        )
        colors.push(cj.r, cj.g, cj.b, a, cj.r, cj.g, cj.b, a)
        if (j > 0) {
          const p = b + (j - 1) * 2
          index.push(p, p + 1, p + 3, p, p + 3, p + 2)
        }
      }
    }

    for (const c of this.cells) {
      if (!c.rim) continue
      for (let k = 0; k < 6; k++) {
        if (!water(c.gx + NB[k]![0], c.gz + NB[k]![1])) continue
        const [nx, nz] = hexNormal(k)
        const [ax, az] = hexVertex(k)
        const [bx, bz] = hexVertex(k + 1)
        curtain(
          c, nx, nz,
          c.x + ax, c.z + az, c.x + bx, c.z + bz,
          endCode(c, NB[(k + 5) % 6]![0], NB[(k + 5) % 6]![1], NB[k]![0], NB[k]![1]),
          endCode(c, NB[(k + 1) % 6]![0], NB[(k + 1) % 6]![1], NB[k]![0], NB[k]![1]),
        )
      }
    }

    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3))
    geo.setAttribute('color', new BufferAttribute(new Float32Array(colors), 4))
    geo.setIndex(index)
    const mat = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      forceSinglePass: true,
    })
    this.unlit.push(mat)
    const mesh = new Mesh(geo, mat)
    mesh.renderOrder = -2
    this.group.add(mesh)
  }

  private buildRipple(): void {
    const RINGS = [
      { off: -0.055, alpha: 0 },
      { off: 0, alpha: 1 },
      { off: 0.055, alpha: 0 },
    ] as const
    const verts = new Float32Array(HULL_BINS * RINGS.length * 3)
    const colors = new Float32Array(HULL_BINS * RINGS.length * 4)
    const foam = PALETTE.foam
    for (let i = 0; i < HULL_BINS; i++) {
      const a = (i / HULL_BINS) * Math.PI * 2
      const cx = Math.cos(a)
      const cz = Math.sin(a)
      const swell = valueNoise(cx * 2.2 + 30, cz * 2.2 + 30, this.seed + 7)
      const r = this.hull[i]! + (0.46 + 0.28 * swell) * TILE
      const lit = 0.5 + 0.5 * (cx * SUN_HX + cz * SUN_HZ)
      const brk = valueNoise(cx * 3.2 + 60, cz * 3.2 + 60, this.seed + 11)
      const amp = Math.min(1, (0.4 + 0.6 * lit) * (0.2 + 1.1 * brk)) * 0.34
      RINGS.forEach((ring, k) => {
        const v = (k * HULL_BINS + i) * 3
        const d = r + ring.off * TILE
        verts[v] = cx * d
        verts[v + 1] = 0.012
        verts[v + 2] = cz * d
        const q = (k * HULL_BINS + i) * 4
        colors[q] = foam.r
        colors[q + 1] = foam.g
        colors[q + 2] = foam.b
        colors[q + 3] = ring.alpha * amp
      })
    }
    const index = new Uint16Array((RINGS.length - 1) * HULL_BINS * 6)
    let t = 0
    for (let k = 0; k < RINGS.length - 1; k++) {
      for (let i = 0; i < HULL_BINS; i++) {
        const j = (i + 1) % HULL_BINS
        const a0 = k * HULL_BINS + i
        const a1 = k * HULL_BINS + j
        const b0 = a0 + HULL_BINS
        const b1 = a1 + HULL_BINS
        index[t++] = a0
        index[t++] = b1
        index[t++] = b0
        index[t++] = a0
        index[t++] = a1
        index[t++] = b1
      }
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(verts, 3))
    geo.setAttribute('color', new BufferAttribute(colors, 4))
    geo.setIndex(new BufferAttribute(index, 1))
    this.rippleGeo = geo
  }
  private rippleGeo: BufferGeometry | null = null

  private buildWaterline(): void {
    const W = 0.2
    const line = PALETTE.foamLine.clone().multiplyScalar(1.6)
    const verts: number[] = []
    const colors: number[] = []
    const index: number[] = []
    const water = (gx: number, gz: number): boolean => !this.byKey.has(key(gx, gz))

    const ampAt = (x: number, z: number, nx: number, nz: number): number => {
      const lit = 0.5 + 0.5 * (nx * SUN_HX + nz * SUN_HZ)
      const brk = valueNoise(x * 0.55 + 40, z * 0.55 + 40, this.seed + 23)
      return (0.9 + 0.1 * lit) * (0.88 + 0.12 * brk)
    }

    const strip = (
      ix0: number, iz0: number, ix1: number, iz1: number,
      nx: number, nz: number,
    ): void => {
      const b = verts.length / 3
      const pts = [
        [ix0, iz0], [ix1, iz1],
        [ix1 + nx * W, iz1 + nz * W], [ix0 + nx * W, iz0 + nz * W],
      ] as const
      pts.forEach(([x, z], k) => {
        verts.push(x, 0.02, z)
        const a = ampAt(x, z, nx, nz) * (k < 2 ? 1 : 0.45)
        colors.push(line.r, line.g, line.b, a)
      })
      index.push(b, b + 2, b + 1, b, b + 3, b + 2)
    }

    const JOIN = W * 0.6
    for (const c of this.cells) {
      if (!c.rim) continue
      for (let k = 0; k < 6; k++) {
        if (!water(c.gx + NB[k]![0], c.gz + NB[k]![1])) continue
        const [nx, nz] = hexNormal(k)
        const [ax, az] = hexVertex(k)
        const [bx, bz] = hexVertex(k + 1)
        const ex = bx - ax
        const ez = bz - az
        const el = Math.hypot(ex, ez) || 1
        strip(
          c.x + ax - (ex / el) * JOIN,
          c.z + az - (ez / el) * JOIN,
          c.x + bx + (ex / el) * JOIN,
          c.z + bz + (ez / el) * JOIN,
          nx,
          nz,
        )
      }
    }

    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3))
    geo.setAttribute('color', new BufferAttribute(new Float32Array(colors), 4))
    geo.setIndex(index)
    const mat = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      forceSinglePass: true,
    })
    this.unlit.push(mat)
    const both = this.rippleGeo ? mergeGeometries([this.rippleGeo, geo]) : null
    this.rippleGeo?.dispose()
    this.rippleGeo = null
    this.group.add(new Mesh(both ?? geo, mat))
  }

  private buildWater(): void {
    const SPAN = 1600
    let maxEdge = 0
    for (let i = 0; i < HULL_BINS; i++) maxEdge = Math.max(maxEdge, this.hull[i]!)
    const span = maxEdge + 3.2 * TILE
    const shoreDist = (x: number, z: number): number =>
      (Math.sqrt(x * x + z * z) - this.hullAt(fastAtan2(z, x))) / TILE
    const SHADE_H = 1.55
    const SHADE_X = (-SUN_DIR.x / SUN_DIR.y) * SHADE_H
    const SHADE_Z = (-SUN_DIR.z / SUN_DIR.y) * SHADE_H
    const tex = rampTexture(256, 256, (u, v, out) => {
      const x = (u - 0.5) * 2 * span
      const z = -(v - 0.5) * 2 * span
      const d = shoreDist(x, z)
      out.copy(PALETTE.water).lerp(PALETTE.waterDeep, smoothstep(1.2, 3.0, d) * 0.7)
      out.lerp(PALETTE.waterShallow, smoothstep(4.2, 0.1, d) ** 1.4 * 0.85)
      if (d < 2.2) {
        const rr = Math.sqrt(x * x + z * z) + 1e-6
        const away = 0.5 - 0.5 * ((x * SUN_HX + z * SUN_HZ) / rr)
        const prof = this.shadowAt(fastAtan2(z, x))
        const reach = 0.25 + 0.8 * prof
        out.multiplyScalar(1 - smoothstep(reach, -0.1, d) * (0.06 + 0.3 * away) * (0.3 + 0.7 * prof))
        const shade =
          smoothstep(0.4, -0.3, shoreDist(x - SHADE_X, z - SHADE_Z)) * smoothstep(2.2, 0.3, d)
        out.multiplyScalar(1 - shade * 0.2)
      }
      return 0.3 + smoothstep(0.7, 11, d) * 0.7
    })
    const k = SPAN / span
    tex.repeat.set(k, k)
    tex.offset.set((1 - k) / 2, (1 - k) / 2)

    const disc = new CircleGeometry(SPAN, 64)

    const bedMat = new MeshBasicMaterial({ map: tex, depthWrite: true })
    this.addCaustics(bedMat, span)
    this.unlit.push(bedMat)
    const bed = new Mesh(disc, bedMat)
    bed.rotation.x = -Math.PI / 2
    bed.position.y = BED_Y
    bed.renderOrder = -3

    const surfaceMat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    this.unlit.push(surfaceMat)
    const surface = new Mesh(disc, surfaceMat)
    surface.rotation.x = -Math.PI / 2
    surface.renderOrder = -1

    this.group.add(bed, surface)
  }

  private addCaustics(mat: MeshBasicMaterial, span: number): void {
    const uTime = { value: 0 }
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uCausticTime = uTime
      shader.uniforms.uCausticSpan = { value: span }
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uCausticTime;\nuniform float uCausticSpan;',
        )
        .replace(
          '#include <map_fragment>',
          [
            '#include <map_fragment>',
            'float causticMask = 1.0 - smoothstep(0.305, 0.335, sampledDiffuseColor.a);',
            'if (causticMask > 0.001) {',
            '  vec2 p = (vMapUv - 0.5) * uCausticSpan * 4.2;',
            '  float t = uCausticTime * 0.45;',
            '  vec2 q = p + 0.55 * vec2(sin(p.y * 0.9 + t), cos(p.x * 0.8 - t * 1.1));',
            '  float s = abs(sin(q.x * 1.6 + t) + sin(q.y * 1.8 - t * 0.8) + sin((q.x + q.y) * 1.2 + t * 0.6));',
            '  float c = pow(1.0 - clamp(s * 0.9, 0.0, 1.0), 6.0);',
            '  diffuseColor.rgb *= 1.0 + c * 0.2 * causticMask;',
            '}',
          ].join('\n'),
        )
    }
    this.causticTime = uTime
  }
  private causticTime: { value: number } | null = null

  tickWater(t: number): void {
    if (this.causticTime) this.causticTime.value = t % 1000
  }

  private buildHorizons(): void {
    const parts: BufferGeometry[] = []
    const put = (src: BufferGeometry, color: Color, x: number, y: number, z: number): void => {
      const g = src.index ? src.toNonIndexed() : src
      g.translate(x, y, z)
      const n = g.attributes.position!.count
      const rgb = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        rgb[i * 3] = color.r
        rgb[i * 3 + 1] = color.g
        rgb[i * 3 + 2] = color.b
      }
      g.setAttribute('color', new BufferAttribute(rgb, 3))
      parts.push(g)
    }
    const haze = new Color('#67818f')
    const hazeFar = new Color('#75909f')

    {
      const az = 3.95
      const R = 85
      const cx = Math.sin(az) * R
      const cz = Math.cos(az) * R
      put(new IcosahedronGeometry(3.1, 0).scale(1.7, 0.85, 1.25), haze, cx, 0.4, cz)
      put(new IcosahedronGeometry(1.9, 0).scale(1.3, 0.7, 1.1), haze, cx + 3.4, 0.2, cz + 1.2)
      put(new ConeGeometry(1.0, 3.0, 6), haze, cx - 1.2, 3.4, cz - 0.4)
      put(new ConeGeometry(0.8, 2.4, 6), haze, cx + 1.4, 3.2, cz + 0.6)
    }
    {
      const az = 4.7
      const R = 115
      const cx = Math.sin(az) * R
      const cz = Math.cos(az) * R
      const dirX = Math.cos(az)
      const dirZ = -Math.sin(az)
      for (let i = 0; i < 6; i++) {
        const t = (i - 2.5) * 7.5
        const h = 1.6 + Math.sin(i * 2.1) * 0.9 + (i % 2) * 0.7
        put(
          new BoxGeometry(9, h, 3.2).rotateY(az + Math.sin(i * 3.7) * 0.2),
          hazeFar,
          cx + dirX * t,
          h / 2 - 0.3,
          cz + dirZ * t,
        )
      }
    }

    const geo = mergeGeometries(parts)
    if (!geo) return
    const mat = new MeshBasicMaterial({ vertexColors: true, fog: false })
    this.unlit.push(mat)
    const mesh = new Mesh(geo, mat)
    mesh.renderOrder = 0
    this.group.add(mesh)
  }

  private neighborMesh: Mesh | null = null
  private neighborFires: Mesh | null = null
  private neighborFireMat: MeshBasicMaterial | null = null

  setNeighbors(list: { id: string; age: number; wonders: number }[]): void {
    for (const m of [this.neighborMesh, this.neighborFires]) {
      if (!m) continue
      this.group.remove(m)
      m.geometry.dispose()
    }
    this.neighborMesh = null
    this.neighborFires = null
    this.neighborFireMat = null
    if (list.length === 0) return

    const parts: BufferGeometry[] = []
    const fires: BufferGeometry[] = []
    const put = (
      into: BufferGeometry[],
      src: BufferGeometry,
      color: Color,
      x: number,
      y: number,
      z: number,
    ): void => {
      const g = src.index ? src.toNonIndexed() : src
      g.translate(x, y, z)
      const n = g.attributes.position!.count
      const rgb = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        rgb[i * 3] = color.r
        rgb[i * 3 + 1] = color.g
        rgb[i * 3 + 2] = color.b
      }
      g.setAttribute('color', new BufferAttribute(rgb, 3))
      into.push(g)
    }
    const haze = new Color('#6d8794')
    const hazeFar = new Color('#7a95a3')
    const ember = new Color('#ffb457')

    const SLOT_AZ = [3.72, 4.15, 3.42, 4.42, 3.15, 5.05, 2.9, 5.35]

    for (let i = 0; i < list.length && i < SLOT_AZ.length; i++) {
      const n = list[i]!
      const az = SLOT_AZ[i]!
      const R = i % 2 === 0 ? 92 : 100
      const far = R > 96
      const skin = far ? hazeFar : haze
      const cx = Math.sin(az) * R
      const cz = Math.cos(az) * R
      const tx = Math.cos(az)
      const tz = -Math.sin(az)
      const px = Math.sin(az)
      const pz = Math.cos(az)
      const at = (u: number, v: number): [number, number] => [
        cx + tx * u + px * v,
        cz + tz * u + pz * v,
      ]

      put(parts, new IcosahedronGeometry(3.9, 0).scale(1.9, 0.85, 1.3), skin, cx, 0.35, cz)
      const [sx, sz] = at(5.1, 0.8)
      put(parts, new IcosahedronGeometry(2.1, 0).scale(1.4, 0.75, 1.1), skin, sx, 0.15, sz)

      const age = Math.max(0, Math.min(9, n.age))
      if (age <= 1) {
        for (const [u, h] of [
          [-1.6, 2.8],
          [1.1, 2.3],
        ] as [number, number][]) {
          const [x, z] = at(u, 0)
          put(parts, new ConeGeometry(1.05, h, 6), skin, x, 0.9 + h / 2 - 0.6, z)
        }
      } else if (age <= 5) {
        for (const [u, w] of [
          [-2.0, 1.9],
          [0.5, 2.4],
          [2.8, 1.7],
        ] as [number, number][]) {
          const [x, z] = at(u, 0)
          put(parts, new BoxGeometry(w, 1.6, 1.8).rotateY(az), skin, x, 1.25, z)
          put(parts, new BoxGeometry(w + 0.6, 0.55, 2.3).rotateY(az), skin, x, 2.3, z)
        }
        const [tx2, tz2] = at(3.6, 0.4)
        put(parts, new ConeGeometry(0.7, 2.4, 6), skin, tx2, 2.0, tz2)
      } else {
        for (const [u, w, h] of [
          [-2.7, 2.2, 2.3],
          [-0.2, 2.7, 3.1],
          [2.4, 2.0, 2.0],
        ] as [number, number, number][]) {
          const [x, z] = at(u, 0)
          put(parts, new BoxGeometry(w, h, 2.0).rotateY(az), skin, x, 0.8 + h / 2, z)
        }
        const [bx, bz] = at(0.6, -0.6)
        put(parts, new BoxGeometry(1.3, 5.4, 1.3).rotateY(az), skin, bx, 3.6, bz)
        put(parts, new ConeGeometry(1.0, 2.0, 4).rotateY(az), skin, bx, 7.3, bz)
      }

      if (n.wonders > 0) {
        const [wx, wz] = at(-3.4, -1.2)
        const h = 6.8 + Math.min(3, n.wonders) * 1.6
        put(parts, new CylinderGeometry(0.45, 0.9, h, 6), skin, wx, 0.8 + h / 2, wz)
        put(parts, new ConeGeometry(0.95, 1.9, 6), skin, wx, 0.8 + h + 0.8, wz)
      }

      const fireCount = age <= 1 ? 1 : age <= 5 ? 2 : 3
      for (let i = 0; i < fireCount; i++) {
        const [fx, fz] = at(-2.1 + i * 2.2, -1.2)
        put(fires, new PlaneGeometry(2.3, 2.3).rotateY(az + Math.PI), ember, fx, 3.6, fz)
      }
    }

    const geo = mergeGeometries(parts)
    if (geo) {
      const mat = new MeshBasicMaterial({ vertexColors: true, fog: false })
      this.unlit.push(mat)
      this.neighborMesh = new Mesh(geo, mat)
      this.neighborMesh.renderOrder = 0
      this.group.add(this.neighborMesh)
    }
    const fireGeo = mergeGeometries(fires)
    if (fireGeo) {
      const mat = new MeshBasicMaterial({
        vertexColors: true,
        fog: false,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        map: rampTexture(32, 32, (u, v, out) => {
          const d = Math.hypot(u - 0.5, v - 0.5) * 2
          out.set('#ffab52')
          return Math.pow(Math.max(0, 1 - d), 2.4)
        }),
      })
      this.neighborFireMat = mat
      this.neighborFires = new Mesh(fireGeo, mat)
      this.neighborFires.visible = false
      this.group.add(this.neighborFires)
    }
  }

  private outpostMesh: Mesh | null = null

  setOutpost(on: boolean): void {
    if (!on || this.outpostMesh) {
      if (!on && this.outpostMesh) {
        this.group.remove(this.outpostMesh)
        this.outpostMesh.geometry.dispose()
        this.outpostMesh = null
      }
      return
    }
    const parts: BufferGeometry[] = []
    const put = (src: BufferGeometry, color: Color, x: number, y: number, z: number): void => {
      const g = src.index ? src.toNonIndexed() : src
      g.translate(x, y, z)
      const n = g.attributes.position!.count
      const rgb = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        rgb[i * 3] = color.r
        rgb[i * 3 + 1] = color.g
        rgb[i * 3 + 2] = color.b
      }
      g.setAttribute('color', new BufferAttribute(rgb, 3))
      parts.push(g)
    }
    const az = 3.95
    const R = 85
    const cx = Math.sin(az) * R
    const cz = Math.cos(az) * R
    const warm = new Color('#8a7563')
    const roof = new Color('#9c6a4c')
    put(new BoxGeometry(2.2, 1.4, 1.8), warm, cx + 3.6, 1.0, cz + 2.6)
    put(new BoxGeometry(2.7, 0.5, 2.2).rotateZ(0.08), roof, cx + 3.6, 1.9, cz + 2.6)
    put(new BoxGeometry(5.5, 0.3, 1.2).rotateY(0.5), warm, cx + 6.4, 0.25, cz + 4.6)
    put(new CylinderGeometry(0.09, 0.12, 3.4, 5), warm, cx + 4.8, 1.7, cz + 3.4)
    const geo = mergeGeometries(parts)
    if (!geo) return
    const mat = new MeshBasicMaterial({ vertexColors: true, fog: false })
    this.unlit.push(mat)
    this.outpostMesh = new Mesh(geo, mat)
    this.group.add(this.outpostMesh)
  }

  private scatter(rnd: () => number): void {
    const solid = this.cells.filter((c) => !c.beach && !c.plot)
    const near = solid
      .filter((c) => Math.hypot(c.x, c.z) <= PLAZA_RADIUS + 1.2)
      .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))
    for (const c of near) this.buildSlots.push(new Vector3(c.x, GROUND_Y, c.z))

    const open = solid.filter((c) => !c.trod && c.inland > 1.7)
    const free = open.filter((c) => Math.hypot(c.x - TROD.x, c.z - TROD.z) > PLAZA_RADIUS + 0.9)
    const wooded = open.filter(
      (c) => Math.hypot(c.x - TROD.x, c.z - TROD.z) > clearRadius(c.x, c.z, spreadForAge(this.age)),
    )

    const centers: Cell[] = []
    for (let i = 0; i < 7; i++) {
      const c = wooded[Math.floor(rnd() * wooded.length)]
      if (c) centers.push(c)
    }
    const clustered = (pool: Cell[], spread: number): Cell[] =>
      pool
        .map((c) => ({
          c,
          k:
            centers.reduce((m, o) => Math.min(m, Math.hypot(c.x - o.x, c.z - o.z)), 99) +
            rnd() * spread,
        }))
        .sort((a, b) => a.k - b.k)
        .map((e) => e.c)

    const picked = new Set<Cell>()
    const take = (n: number, order: Cell[], ok: (c: Cell) => boolean): Cell[] => {
      const out: Cell[] = []
      for (const c of order) {
        if (out.length >= n) break
        if (picked.has(c) || !ok(c)) continue
        picked.add(c)
        out.push(c)
      }
      return out
    }

    const wild = Math.max(0.45, 1 - this.age * 0.062)
    const wood = Math.max(0.6, 1 - this.age * 0.03)
    const decor = this.plotDecor()
    const pines = take(Math.min(TREE_MAX, Math.round(34 * wood * this.growth * this.growth)), clustered(wooded, 5.2), () => true)
    this.baseTrees = pines.length
    this.addTrees([{ cells: pines, rnd }, ...decor.trees])
    this.addRocks([
      {
        cells: take(
          Math.round(16 * wild * this.growth * this.growth),
          clustered(free, 9),
          (c) =>
            c.relief > 1.2 &&
            Math.hypot(c.x - TROD.x, c.z - TROD.z) > clearRadius(c.x, c.z, spreadForAge(this.age)) * 0.62,
        ),
        rnd,
      },
      ...decor.rocks,
    ])
    this.addBushes([
      {
        cells: take(
          Math.round(24 * wild * this.growth * this.growth),
          clustered(free, 6),
          (c) => Math.hypot(c.x - TROD.x, c.z - TROD.z) > clearRadius(c.x, c.z, spreadForAge(this.age)) * 0.5,
        ),
        rnd,
      },
      ...decor.bushes,
    ])
    this.separatePlotDecor()
  }

  private separatePlotDecor(): void {
    if (this.land.length === 0) return
    const m = new Matrix4()
    const p = new Vector3()
    const q = new Quaternion()
    const s = new Vector3()
    const all: { mesh: InstancedMesh; i: number; src: number; x: number; z: number; r: number }[] = []
    for (const mesh of this.pickables) {
      const src = this.srcOf.get(mesh)
      const kind = this.kindOf.get(mesh)
      if (!src || !kind) continue
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m)
        m.decompose(p, q, s)
        all.push({ mesh, i, src: src[i]!, x: p.x, z: p.z, r: DECOR_R[kind] * s.x })
      }
    }
    all.sort((a, b) => a.src - b.src)
    const kept: typeof all = []
    for (const d of all) {
      const clash =
        d.src >= 0 &&
        kept.some((k) => k.src !== d.src && Math.hypot(k.x - d.x, k.z - d.z) - k.r - d.r < DECOR_GAP)
      if (clash) this.hideDecor(d.mesh, d.i)
      else kept.push(d)
    }
  }

  private hideDecor(mesh: InstancedMesh, i: number): void {
    if (this.isFelled(mesh, i)) return
    const m = new Matrix4()
    const p = new Vector3()
    const q = new Quaternion()
    const s = new Vector3()
    mesh.getMatrixAt(i, m)
    m.decompose(p, q, s)
    mesh.setMatrixAt(i, m.compose(p, q, s.setScalar(1e-3)))
    mesh.instanceMatrix.needsUpdate = true
    if (mesh === this.leavesMesh) this.felledTrees.add(i)
    else {
      let set = this.clearedOf.get(mesh)
      if (!set) this.clearedOf.set(mesh, (set = new Set()))
      set.add(i)
    }
    const kind = this.kindOf.get(mesh)
    if (kind) this.decorRemoved[kind]++
  }

  clearUnder(blocked: (x: number, z: number, r: number) => boolean): number {
    const m = new Matrix4()
    const p = new Vector3()
    const q = new Quaternion()
    const s = new Vector3()
    let n = 0
    for (const mesh of this.pickables) {
      const kind = this.kindOf.get(mesh)
      if (!kind) continue
      for (let i = 0; i < mesh.count; i++) {
        if (this.isFelled(mesh, i)) continue
        mesh.getMatrixAt(i, m)
        m.decompose(p, q, s)
        if (!blocked(p.x, p.z, DECOR_R[kind] * s.x)) continue
        this.hideDecor(mesh, i)
        n++
      }
    }
    return n
  }

  private plotDecor(): { trees: Scatter[]; rocks: Scatter[]; bushes: Scatter[] } {
    const out = { trees: [] as Scatter[], rocks: [] as Scatter[], bushes: [] as Scatter[] }
    for (const [src, p] of this.land.entries()) {
      const rnd = plotRandom(this.seed, p, 0x7ee5)
      const mine = this.cells.filter((c) => c.plotOf === p)
      const ring = mine.filter((c) => !c.plotCenter)
      const center = mine.filter((c) => c.plotCenter)
      const some = (cells: Cell[], n: number): Cell[] =>
        cells
          .map((c) => ({ c, k: rnd() }))
          .sort((a, b) => a.k - b.k)
          .slice(0, n)
          .map((e) => e.c)
      if (p.kind === 'foret') out.trees.push({ cells: some(mine, 6), rnd, src })
      else if (p.kind === 'carriere')
        out.rocks.push({ cells: some(ring, 4), rnd, scale: 1.25, block: true, tones: [PALETTE.rock, PALETTE.rockDark], src })
      else if (p.kind === 'affleurement')
        out.rocks.push({ cells: [...center, ...center, ...some(ring, 3)], rnd, scale: 1.2, tones: ORE_TONES, src })
      else if (p.kind === 'prairie') out.bushes.push({ cells: some(ring, 2), rnd, src })
      else if (p.kind === 'crique') out.rocks.push({ cells: some(ring, 2), rnd, scale: 0.6, tones: [PALETTE.rock], src })
    }
    return out
  }

  private static readonly TREE_H = 4.0
  private static readonly TREE_R = 1.55

  private addTrees(groups: Scatter[]): void {
    const cells = groups.flatMap((g) => g.cells)

    const tier = (
      r: number,
      h: number,
      seg: number,
      x: number,
      y: number,
      z: number,
      shade: number,
    ): BufferGeometry => {
      const g = new ConeGeometry(r, h, seg)
      g.translate(x, y, z)
      const n = g.attributes.position!.count
      const col = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        const k = shade * (0.9 + 0.1 * smoothstep(-h / 2, h / 2, g.attributes.position!.getY(i) - y))
        col[i * 3] = k
        col[i * 3 + 1] = k
        col[i * 3 + 2] = k
      }
      g.setAttribute('color', new BufferAttribute(col, 3))
      g.setAttribute('leafMask', new BufferAttribute(new Float32Array(n).fill(1), 1))
      return g
    }
    const trunk = new CylinderGeometry(0.11, 0.16, 0.9, 6).translate(0, -1.2, 0)
    const tn = trunk.attributes.position!.count
    const bark = new Float32Array(tn * 3)
    for (let k = 0; k < tn; k++) PALETTE.trunk.toArray(bark, k * 3)
    trunk.setAttribute('color', new BufferAttribute(bark, 3))
    trunk.setAttribute('leafMask', new BufferAttribute(new Float32Array(tn), 1))
    const leafGeo =
      mergeGeometries([
        trunk,
        tier(0.52, 0.85, 7, 0.025, -0.33, -0.015, 0.78),
        tier(0.4, 0.78, 7, -0.02, 0.1, 0.015, 0.9),
        tier(0.27, 0.72, 6, 0.01, 0.53, 0.02, 1.0),
      ]) ?? new ConeGeometry(0.52, 1.5, 7)
    const leafMat = new MeshToonMaterial({ vertexColors: true })
    leafMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float leafMask;')
        .replace(
          '#include <color_vertex>',
          ['#include <color_vertex>', '#ifdef USE_INSTANCING_COLOR', 'vColor.rgb = color.rgb * mix(vec3(1.0), instanceColor.rgb, leafMask);', '#endif'].join('\n'),
        )
    }
    const leaves = new InstancedMesh(leafGeo, leafMat, cells.length)
    leaves.castShadow = true

    const d = new Object3D()
    const leafColors = [PALETTE.leafA, PALETTE.leafB, PALETTE.leafC]
    const { TREE_H, TREE_R } = Island
    let i = 0
    const srcs = new Int16Array(cells.length)
    for (const { cells: list, rnd, src = -1 } of groups) for (const c of list) {
      srcs[i] = src
      const s = 0.72 + rnd() * 0.4
      const jx = (rnd() - 0.5) * 0.5
      const jz = (rnd() - 0.5) * 0.5
      d.position.set(c.x + jx, GROUND_Y + 1.65 * s * TREE_H, c.z + jz)
      d.rotation.set(0, rnd() * Math.PI, 0)
      d.scale.set(s * TREE_R, s * TREE_H, s * TREE_R)
      d.updateMatrix()
      leaves.setMatrixAt(i, d.matrix)
      const leaf = tint(leafColors[i % 3]!, i, 0.08)
      leaves.setColorAt(i, leaf.clone())
      i++
    }
    leaves.instanceMatrix.needsUpdate = true
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true
    this.group.add(leaves)
    this.registerPickable(leaves, 'wood')
    this.srcOf.set(leaves, srcs)
    this.leavesMesh = leaves
    this.leafBase = leaves.instanceColor ? new Float32Array(leaves.instanceColor.array) : null
  }

  private addRocks(groups: Scatter[]): void {
    const geo = new DodecahedronGeometry(0.42, 0)
    const mat = new MeshToonMaterial()
    const mesh = new InstancedMesh(geo, mat, groups.reduce((n, g) => n + g.cells.length, 0))
    mesh.castShadow = true
    mesh.receiveShadow = true

    const d = new Object3D()
    let i = 0
    const srcs = new Int16Array(mesh.count)
    for (const { cells, rnd, scale = 1, block = false, tones, src = -1 } of groups) for (const c of cells) {
      srcs[i] = src
      const s = (0.5 + rnd() * 0.45) * scale
      d.position.set(c.x + (rnd() - 0.5) * 0.6, GROUND_Y + 0.2 * s, c.z + (rnd() - 0.5) * 0.6)
      d.rotation.set(rnd() * 0.5, rnd() * Math.PI, rnd() * 0.5)
      if (block) d.rotation.set(0, d.rotation.y, 0)
      d.scale.set(s, s * (block ? 0.6 : 0.75), s)
      d.updateMatrix()
      mesh.setMatrixAt(i, d.matrix)
      const tone = tones ? tones[i % tones.length]! : i % 3 === 0 ? PALETTE.rockDark : PALETTE.rock
      mesh.setColorAt(i, tint(tone, i, 0.07))
      i++
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    this.group.add(mesh)
    this.bushMesh = mesh
    this.bushBase = mesh.instanceColor ? new Float32Array(mesh.instanceColor.array) : null
    this.registerPickable(mesh, 'stone')
    this.srcOf.set(mesh, srcs)
  }

  private addBushes(groups: Scatter[]): void {
    const geo = new IcosahedronGeometry(0.34, 0)
    const mat = new MeshToonMaterial()
    const mesh = new InstancedMesh(geo, mat, groups.reduce((n, g) => n + g.cells.length, 0))
    mesh.castShadow = true

    const d = new Object3D()
    const berry = new Color('#4a7340')
    let i = 0
    const srcs = new Int16Array(mesh.count)
    for (const { cells, rnd, src = -1 } of groups) for (const c of cells) {
      srcs[i] = src
      const s = (0.7 + rnd() * 0.35) * 1.5
      d.position.set(c.x + (rnd() - 0.5) * 0.7, GROUND_Y + 0.22 * s, c.z + (rnd() - 0.5) * 0.7)
      d.rotation.set(0, rnd() * Math.PI, 0)
      d.scale.set(s, s * 0.8, s)
      d.updateMatrix()
      mesh.setMatrixAt(i, d.matrix)
      mesh.setColorAt(i, tint(berry, i * 7, 0.1))
      i++
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    this.group.add(mesh)
    this.bushMesh = mesh
    this.bushBase = mesh.instanceColor ? new Float32Array(mesh.instanceColor.array) : null
    this.registerPickable(mesh, 'food')
    this.srcOf.set(mesh, srcs)
  }

  clearCorridor(pts: { x: number; z: number }[], radius: number, upTo = Infinity): void {
    const leaves = this.leavesMesh
    if (!leaves || pts.length === 0) return
    const m = new Matrix4()
    const p = new Vector3()
    const q = new Quaternion()
    const s = new Vector3()
    const r2 = radius * radius
    let cut = 0
    for (let i = 0; i < Math.min(leaves.count, upTo); i++) {
      if (this.felledTrees.has(i)) continue
      leaves.getMatrixAt(i, m)
      m.decompose(p, q, s)
      let hit = false
      for (const c of pts) {
        if ((c.x - p.x) ** 2 + (c.z - p.z) ** 2 < r2) {
          hit = true
          break
        }
      }
      if (!hit) continue
      this.felledTrees.add(i)
      cut++
      leaves.setMatrixAt(i, m.compose(p, q, s.setScalar(1e-3)))
    }
    if (cut === 0) return
    leaves.instanceMatrix.needsUpdate = true
  }

  thinWedge(azimuth: number, halfAngle: number, fraction: number, rMin: number): void {
    const leaves = this.leavesMesh
    if (!leaves) return
    const ax = Math.sin(azimuth)
    const az = Math.cos(azimuth)
    const cosMax = Math.cos(halfAngle)
    const m = new Matrix4()
    const p = new Vector3()
    const q = new Quaternion()
    const sc = new Vector3()
    const doomed: { x: number; z: number }[] = []
    for (let i = 0; i < this.baseTrees; i++) {
      if (this.felledTrees.has(i)) continue
      leaves.getMatrixAt(i, m)
      m.decompose(p, q, sc)
      const r = Math.hypot(p.x, p.z)
      if (r < rMin) continue
      if ((p.x * ax + p.z * az) / (r + 1e-6) < cosMax) continue
      const h = Math.sin(p.x * 12.9898 + p.z * 78.233) * 43758.5453
      if (h - Math.floor(h) > fraction) continue
      doomed.push({ x: p.x, z: p.z })
    }
    if (doomed.length > 0) this.clearCorridor(doomed, 0.4, this.baseTrees)
  }

  isFelled(mesh: InstancedMesh, index: number): boolean {
    if (mesh === this.leavesMesh) return this.felledTrees.has(index)
    return this.clearedOf.get(mesh)?.has(index) ?? false
  }

  private registerPickable(mesh: InstancedMesh, kind: NodeKind): void {
    this.pickables.push(mesh)
    this.kindOf.set(mesh, kind)
  }

  kindFor(mesh: InstancedMesh): NodeKind | undefined {
    return this.kindOf.get(mesh)
  }

  instancePosition(mesh: InstancedMesh, index: number): Vector3 {
    const m = new Matrix4()
    mesh.getMatrixAt(index, m)
    const p = new Vector3()
    const q = new Quaternion()
    const s = new Vector3()
    m.decompose(p, q, s)
    return p
  }

  cellAt(x: number, z: number): Cell | null {
    const q = x / HEX_DX
    const r = z / HEX_DZ - q / 2
    const sAx = -q - r
    let rq = Math.round(q)
    let rr = Math.round(r)
    const rs = Math.round(sAx)
    const dq = Math.abs(rq - q)
    const dr = Math.abs(rr - r)
    const ds = Math.abs(rs - sAx)
    if (dq > dr && dq > ds) rq = -rr - rs
    else if (dr > ds) rr = -rq - rs
    return this.byKey.get(key(rq, rr)) ?? null
  }

  private readonly reserved = new Set<number>()

  private addPlot(p: LandPlot): void {
    const look = plotLook(p.kind)
    let mouth: number | null = null
    if (look.cove) {
      let far = -1
      let m = 0
      for (let k = 0; k < 6; k++) {
        const [x, z] = hexCenter(p.q + NB[k]![0], p.r + NB[k]![1])
        if (Math.hypot(x, z) > far) {
          far = Math.hypot(x, z)
          m = k
        }
      }
      mouth = m
      this.reserved.add(key(p.q, p.r))
      this.reserved.add(key(p.q + NB[m]![0], p.r + NB[m]![1]))
    }
    for (let k = -1; k < 6; k++) {
      if (k === mouth || (k < 0 && look.cove)) continue
      const gx = p.q + (k < 0 ? 0 : NB[k]![0])
      const gz = p.r + (k < 0 ? 0 : NB[k]![1])
      if (this.byKey.has(key(gx, gz))) continue
      const [x, z] = hexCenter(gx, gz)
      const cell: Cell = {
        gx,
        gz,
        x,
        z,
        beach: look.beach,
        inland: k < 0 ? 2 : 1,
        relief: 1,
        rim: false,
        outx: 0,
        outz: 0,
        trod: false,
        plot: p.kind,
        plotCenter: k < 0,
        plotOf: p,
      }
      this.cells.push(cell)
      this.byKey.set(key(gx, gz), cell)
    }
  }

  private fillPockets(): void {
    if (this.land.length === 0) return
    let q0 = Infinity
    let q1 = -Infinity
    let r0 = Infinity
    let r1 = -Infinity
    for (const c of this.cells) {
      q0 = Math.min(q0, c.gx - 1)
      q1 = Math.max(q1, c.gx + 1)
      r0 = Math.min(r0, c.gz - 1)
      r1 = Math.max(r1, c.gz + 1)
    }
    const sea = new Set<number>()
    const stack: [number, number][] = []
    for (let q = q0; q <= q1; q++)
      for (let r = r0; r <= r1; r++) if (q === q0 || q === q1 || r === r0 || r === r1) stack.push([q, r])
    while (stack.length > 0) {
      const [q, r] = stack.pop()!
      if (q < q0 || q > q1 || r < r0 || r > r1) continue
      const k = key(q, r)
      if (sea.has(k) || this.byKey.has(k)) continue
      sea.add(k)
      for (const [dq, dr] of NB) stack.push([q + dq, r + dr])
    }
    for (let q = q0; q <= q1; q++) {
      for (let r = r0; r <= r1; r++) {
        const k = key(q, r)
        if (sea.has(k) || this.byKey.has(k) || this.reserved.has(k)) continue
        const from = NB.map(([dq, dr]) => this.byKey.get(key(q + dq, r + dr))).find((n) => n?.plot)
        if (!from?.plot) continue
        const [x, z] = hexCenter(q, r)
        const cell: Cell = {
          gx: q,
          gz: r,
          x,
          z,
          beach: from.beach,
          inland: 1,
          relief: 1,
          rim: false,
          outx: 0,
          outz: 0,
          trod: false,
          plot: from.plot,
          plotOf: from.plotOf,
        }
        this.cells.push(cell)
        this.byKey.set(k, cell)
      }
    }
  }

  get plotCells(): number {
    return this.cells.reduce((n, c) => n + (c.plot ? 1 : 0), 0)
  }

  canAnchor(q: number, r: number): boolean {
    const [x, z] = hexCenter(q, r)
    if (Math.hypot(x, z) > this.radius + TILE * 4) return false
    let touching = 0
    for (let k = -1; k < 6; k++) {
      const gx = q + (k < 0 ? 0 : NB[k]![0])
      const gz = r + (k < 0 ? 0 : NB[k]![1])
      if (this.byKey.has(key(gx, gz)) || this.reserved.has(key(gx, gz))) return false
      if (NB.some(([dq, dr]) => this.byKey.has(key(gx + dq, gz + dr)))) touching++
    }
    return touching >= 2
  }

  private anchorsBySector(): { sectors: { q: number; r: number; d: number }[][]; used: number[] } {
    const back = Math.atan2(-1, -1)
    const sectorOf = (x: number, z: number): number => {
      let a = Math.atan2(z, x) - back + Math.PI / 6
      a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
      return Math.floor(a / (Math.PI / 3)) % 6
    }
    const used = [0, 0, 0, 0, 0, 0]
    for (const p of this.land) {
      const [x, z] = hexCenter(p.q, p.r)
      used[sectorOf(x, z)]!++
    }
    const sectors: { q: number; r: number; d: number }[][] = [[], [], [], [], [], []]
    const span = 48
    for (let q = -span; q <= span; q++) {
      for (let r = -span; r <= span; r++) {
        if (!this.canAnchor(q, r)) continue
        const [x, z] = hexCenter(q, r)
        sectors[sectorOf(x, z)]!.push({ q, r, d: Math.hypot(x, z) })
      }
    }
    for (const list of sectors) list.sort((a, b) => a.d - b.d)
    return { sectors, used }
  }

  private static readonly SECTOR_ORDER = [0, 1, 5, 2, 4, 3]

  defaultAnchor(): { q: number; r: number } | null {
    const { sectors, used } = this.anchorsBySector()
    let pick: { q: number; r: number } | null = null
    let pickUsed = Infinity
    for (const s of Island.SECTOR_ORDER) {
      const b = sectors[s]![0]
      if (b && used[s]! < pickUsed) {
        pick = { q: b.q, r: b.r }
        pickUsed = used[s]!
      }
    }
    return pick
  }

  anchorCandidates(kind: string, n = 3): { q: number; r: number; bond: boolean }[] {
    const { sectors, used } = this.anchorsBySector()
    const bondAt = (q: number, r: number): boolean =>
      this.land.some((p) => p.kind === kind && hexDistance(p.q, p.r, q, r) <= 3)
    const order = [...Island.SECTOR_ORDER].sort((a, b) => used[a]! - used[b]!)
    const out: { q: number; r: number; bond: boolean }[] = []
    const apart = (q: number, r: number): boolean => out.every((o) => hexDistance(o.q, o.r, q, r) >= 4)
    const def = this.defaultAnchor()
    if (def) out.push({ ...def, bond: bondAt(def.q, def.r) })
    if (!out.some((o) => o.bond)) {
      for (const s of order) {
        const b = sectors[s]!.find((a) => bondAt(a.q, a.r) && apart(a.q, a.r))
        if (b) {
          out.push({ q: b.q, r: b.r, bond: true })
          break
        }
      }
    }
    for (let pass = 0; pass < 2 && out.length < n; pass++) {
      for (const s of order) {
        if (out.length >= n) break
        if (pass === 0 && out.some((o) => sectorHas(sectors[s]!, o))) continue
        const b = sectors[s]!.find((a) => apart(a.q, a.r))
        if (b) out.push({ q: b.q, r: b.r, bond: bondAt(b.q, b.r) })
      }
    }
    return out.slice(0, n)
  }

  static anchorCells(q: number, r: number): [number, number][] {
    const out: [number, number][] = [hexCenter(q, r)]
    for (const [dq, dr] of NB) out.push(hexCenter(q + dq, r + dr))
    return out
  }

  isLand(x: number, z: number): boolean {
    return this.cellAt(x, z) !== null
  }
}
