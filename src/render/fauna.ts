import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  type Material,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  MeshToonMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
} from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { tint } from './palette'
import { CAMP_BLOCKERS, CAMP_FIRE } from './village'
import { GROUND_Y, type Island } from './island'
import { follow, type Footprint, type Ground, type GroundSource, type Pt } from './ground'
import { DEER_GAIT, GULL_WING, HEN_FLAP, HEN_GAIT, HORSE_GAIT, PART, SHEEP_GAIT, SLEEP, gaitUniform, rigMaterial, wingUniform, type Gait } from './fauna-rig'
import { faunaGeometry } from './fauna-glb'
import deerUrl from '../assets/models/deer.glb?url'
import sheepUrl from '../assets/models/sheep.glb?url'
import henUrl from '../assets/models/hen.glb?url'
import horseUrl from '../assets/models/horse.glb?url'
import gullUrl from '../assets/models/gull.glb?url'

type Rig = readonly [number, number, number, number]

function part(source: BufferGeometry, color: Color, x = 0, y = 0, z = 0, rig?: Rig): BufferGeometry {
  const geo = source.index ? source : mergeVertices(source)
  geo.translate(x, y, z)
  const n = geo.attributes.position!.count
  const rgb = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = color.r
    rgb[i * 3 + 1] = color.g
    rgb[i * 3 + 2] = color.b
  }
  geo.setAttribute('color', new BufferAttribute(rgb, 3))
  if (rig) geo.setAttribute('aPivot', new BufferAttribute(pivots(n, rig), 4))
  return geo
}

function pivots(n: number, rig: Rig): Float32Array {
  const out = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    out[i * 4] = rig[1]
    out[i * 4 + 1] = rig[2]
    out[i * 4 + 2] = rig[3]
    out[i * 4 + 3] = rig[0]
  }
  return out
}

const RIGID: Rig = [PART.RIGID, 0, 0, 0]

function weld(parts: BufferGeometry[]): BufferGeometry {
  if (parts.some((g) => g.getAttribute('aPivot')))
    for (const g of parts)
      if (!g.getAttribute('aPivot')) g.setAttribute('aPivot', new BufferAttribute(pivots(g.attributes.position!.count, RIGID), 4))
  return mergeGeometries(parts) ?? new BufferGeometry()
}

const DEER_BODY = { y: 0.64, z: -0.04, r: 0.15, half: 0.23, sy: 1.14 } as const

export function deerGeo(): BufferGeometry {
  const coat = new Color('#a97a4e')
  const back = new Color('#8a6238')
  const belly = new Color('#d8bd96')
  const dark = new Color('#6e4d2e')
  const hoof = new Color('#3b2b1d')
  const bone = new Color('#e8dfc8')
  const eye = new Color('#241a12')
  const p: BufferGeometry[] = []

  const B = DEER_BODY
  p.push(part(new CapsuleGeometry(B.r, B.half * 2, 2, 8).rotateX(Math.PI / 2).scale(1, B.sy, 1), coat, 0, B.y, B.z))
  p.push(part(new CapsuleGeometry(0.128, 0.4, 2, 7).rotateX(Math.PI / 2).scale(1, 0.66, 1), back, 0, 0.75, -0.03))
  p.push(part(new CapsuleGeometry(0.118, 0.34, 2, 7).rotateX(Math.PI / 2).scale(1, 0.5, 1), belly, 0, 0.53, -0.02))
  p.push(part(new SphereGeometry(0.115, 8, 6).scale(1, 1.1, 0.5), bone, 0, 0.68, -0.42))
  p.push(part(new SphereGeometry(0.05, 5, 4), bone, 0, 0.78, -0.44))

  p.push(part(new CylinderGeometry(0.05, 0.085, 0.42, 6).rotateX(0.38), coat, 0, 0.9, 0.28, DEER_NECK))
  p.push(part(new CylinderGeometry(0.035, 0.05, 0.2, 6).rotateX(0.38), belly, 0, 0.86, 0.33, DEER_NECK))
  p.push(part(new CapsuleGeometry(0.06, 0.12, 1, 6).rotateX(Math.PI / 2 - 0.25), coat, 0, 1.09, 0.38, DEER_NECK))
  p.push(part(new ConeGeometry(0.042, 0.12, 5).rotateX(Math.PI / 2), dark, 0, 1.07, 0.52, DEER_NECK))
  p.push(part(new SphereGeometry(0.028, 6, 5), eye.clone(), 0, 1.07, 0.57, DEER_NECK))
  p.push(part(new SphereGeometry(0.035, 6, 5).scale(1.2, 0.7, 1), bone, 0, 1.02, 0.5, DEER_NECK))
  for (const s of [-1, 1]) {
    p.push(part(new SphereGeometry(0.019, 5, 4), eye, s * 0.05, 1.11, 0.44, DEER_NECK))
    p.push(part(new ConeGeometry(0.045, 0.14, 5).rotateZ(s * 1.05).rotateX(-0.2), coat, s * 0.085, 1.17, 0.3, DEER_NECK))
    p.push(part(new ConeGeometry(0.028, 0.1, 4).rotateZ(s * 1.05).rotateX(-0.2), belly, s * 0.095, 1.17, 0.315, DEER_NECK))
    p.push(part(new CylinderGeometry(0.014, 0.018, 0.24, 4).rotateZ(s * 0.55).rotateX(-0.35), bone, s * 0.06, 1.26, 0.32, DEER_NECK))
    p.push(part(new CylinderGeometry(0.01, 0.014, 0.14, 4).rotateZ(s * 1.25), bone, s * 0.12, 1.3, 0.36, DEER_NECK))
    p.push(part(new SphereGeometry(0.016, 5, 4), bone, s * 0.16, 1.34, 0.36, DEER_NECK))
  }

  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const rig: Rig = [sz > 0 ? (sx > 0 ? PART.FL : PART.FR) : sx > 0 ? PART.HL : PART.HR, sx * 0.1, DEER_HIP_Y, sz * 0.26]
      p.push(part(new CylinderGeometry(0.026, 0.034, 0.5, 5), coat, sx * 0.1, 0.35, sz * 0.26, rig))
      p.push(part(new CylinderGeometry(0.022, 0.026, 0.12, 5), dark, sx * 0.1, 0.11, sz * 0.26, rig))
      p.push(part(new CylinderGeometry(0.026, 0.022, 0.05, 5), hoof, sx * 0.1, 0.035, sz * 0.26, rig))
    }
  return weld(p)
}

export const DEER_HIP_Y = 0.6
export const DEER_NECK: Rig = [PART.NECK, 0, 0.7, 0.18]

function shrink(geo: BufferGeometry, k: number): BufferGeometry {
  geo.scale(k, k, k)
  const pv = geo.getAttribute('aPivot')
  if (pv) for (let i = 0; i < pv.count; i++) pv.setXYZ(i, pv.getX(i) * k, pv.getY(i) * k, pv.getZ(i) * k)
  return geo
}

export const SHEEP_SCALE = 0.62
const SHEEP_HIP_Y = 0.36
const SHEEP_NECK: Rig = [PART.NECK, 0, 0.38, 0.14]

export function sheepGeo(): BufferGeometry {
  const fleece = new Color('#e9e2cf')
  const fleeceShade = new Color('#cfc6b0')
  const dark = new Color('#3a332c')
  const face = new Color('#4c4238')
  const hoof = new Color('#241f1a')
  const eye = new Color('#15110d')
  const p: BufferGeometry[] = []

  p.push(part(new IcosahedronGeometry(0.24, 1).scale(1.28, 0.95, 1), fleece, 0, 0.4, -0.02))
  p.push(part(new IcosahedronGeometry(0.2, 1).scale(1.2, 0.6, 0.95), fleeceShade, 0, 0.31, -0.02))
  const flock: [number, number, number, number][] = [
    [0.2, 0.52, 0.08, 0.1],
    [-0.22, 0.47, -0.12, 0.095],
    [0.16, 0.36, -0.26, 0.105],
    [-0.14, 0.5, 0.2, 0.085],
    [0.26, 0.4, -0.06, 0.08],
    [-0.24, 0.36, 0.06, 0.09],
  ]
  for (const [x, y, z, r] of flock) p.push(part(new IcosahedronGeometry(r, 0), fleece, x, y, z))
  p.push(part(new IcosahedronGeometry(0.07, 0), fleece, 0, 0.4, -0.34))

  const N = SHEEP_NECK
  p.push(part(new CapsuleGeometry(0.055, 0.09, 1, 6).rotateX(Math.PI / 2 - 0.35), face, 0, 0.46, 0.3, N))
  p.push(part(new SphereGeometry(0.042, 6, 5).scale(1, 0.9, 1.1), dark, 0, 0.44, 0.37, N))
  p.push(part(new IcosahedronGeometry(0.075, 0), fleece, 0, 0.56, 0.24, N))
  p.push(part(new IcosahedronGeometry(0.05, 0), fleece, 0, 0.56, 0.31, N))
  for (const s of [-1, 1]) {
    p.push(part(new BoxGeometry(0.09, 0.03, 0.055).rotateZ(s * -0.35), face, s * 0.085, 0.475, 0.28, N))
    p.push(part(new SphereGeometry(0.014, 5, 4), eye, s * 0.04, 0.485, 0.35, N))
  }

  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const rig: Rig = [sz > 0 ? (sx > 0 ? PART.FL : PART.FR) : sx > 0 ? PART.HL : PART.HR, sx * 0.1, SHEEP_HIP_Y, sz * 0.15]
      p.push(part(new CylinderGeometry(0.024, 0.028, 0.33, 5), face, sx * 0.1, 0.205, sz * 0.15, rig))
      p.push(part(new CylinderGeometry(0.028, 0.024, 0.05, 5), hoof, sx * 0.1, 0.03, sz * 0.15, rig))
    }
  return shrink(weld(p), SHEEP_SCALE)
}

const HEN_HIP_Y = 0.1
const HEN_NECK: Rig = [PART.NECK, 0, 0.18, 0.04]

export function henGeo(): BufferGeometry {
  const body = new Color('#f2efe4')
  const backWarm = new Color('#e2d6bd')
  const wing = new Color('#cfc4ae')
  const tail = new Color('#9c8f7c')
  const red = new Color('#c8402f')
  const redDark = new Color('#9c2f22')
  const beak = new Color('#d99a3c')
  const leg = new Color('#c8862f')
  const eye = new Color('#211a13')
  const p: BufferGeometry[] = []

  p.push(part(new SphereGeometry(0.085, 7, 5).scale(1, 0.95, 1.25), body, 0, 0.13, 0))
  p.push(part(new SphereGeometry(0.07, 7, 5).scale(1, 0.6, 1.1), backWarm, 0, 0.18, -0.01))
  for (const s of [-1, 1])
    p.push(part(new SphereGeometry(0.055, 6, 5).scale(0.45, 0.85, 1.35).rotateY(s * 0.18), wing, s * 0.07, 0.14, -0.01, [s > 0 ? PART.WING_L : PART.WING_R, s * 0.035, 0.165, -0.01]))

  p.push(part(new ConeGeometry(0.05, 0.12, 4).rotateX(-1.15), tail, 0, 0.2, -0.12))
  for (const s of [-1, 1])
    p.push(part(new BoxGeometry(0.012, 0.075, 0.035).rotateX(-1.0).rotateZ(s * 0.25), tail, s * 0.022, 0.235, -0.155))

  const N = HEN_NECK
  p.push(part(new SphereGeometry(0.045, 6, 4), body, 0, 0.24, 0.08, N))
  p.push(part(new CylinderGeometry(0.028, 0.032, 0.05, 6), body, 0, 0.205, 0.06, N))
  for (let i = 0; i < 3; i++)
    p.push(part(new BoxGeometry(0.013, 0.03 + i * 0.012, 0.016), red, 0, 0.295 + i * 0.004, 0.095 - i * 0.028, N))
  p.push(part(new SphereGeometry(0.016, 4, 3), redDark, 0, 0.21, 0.11, N))
  p.push(part(new ConeGeometry(0.015, 0.05, 4).rotateX(Math.PI / 2), beak, 0, 0.24, 0.13, N))
  for (const s of [-1, 1]) p.push(part(new SphereGeometry(0.009, 4, 3), eye, s * 0.03, 0.253, 0.105, N))

  for (const s of [-1, 1]) {
    const rig: Rig = [s > 0 ? PART.FL : PART.FR, s * 0.03, HEN_HIP_Y, 0.01]
    p.push(part(new CylinderGeometry(0.008, 0.008, 0.11, 4), leg, s * 0.03, 0.055, 0.01, rig))
    for (const [tx, tz] of [[0, 0.035], [0.022, 0.018], [-0.022, 0.018]] as [number, number][])
      p.push(part(new BoxGeometry(0.009, 0.007, 0.03).rotateY(tx * 8), leg, s * 0.03 + tx, 0.006, 0.01 + tz, rig))
  }
  return weld(p)
}

const HORSE_HIP_Y = 0.85
const HORSE_NECK: Rig = [PART.NECK, 0, 1.0, 0.2]
const HORSE_TAIL: Rig = [PART.TAIL, 0, 1.0, -0.42]

export function horseGeo(): BufferGeometry {
  const coat = new Color('#6b4630')
  const coatLight = new Color('#8a5d40')
  const belly = new Color('#a67a56')
  const mane = new Color('#241811')
  const hoof = new Color('#17110c')
  const sock = new Color('#e6dccb')
  const eye = new Color('#120d09')
  const p: BufferGeometry[] = []

  p.push(part(new CapsuleGeometry(0.22, 0.62, 2, 8).rotateX(Math.PI / 2).scale(1, 1.05, 1), coat, 0, 0.95, -0.02))
  p.push(part(new CapsuleGeometry(0.19, 0.5, 2, 7).rotateX(Math.PI / 2).scale(1, 0.55, 1), coatLight, 0, 1.08, -0.02))
  p.push(part(new CapsuleGeometry(0.17, 0.44, 2, 7).rotateX(Math.PI / 2).scale(1, 0.45, 1), belly, 0, 0.8, -0.02))
  p.push(part(new SphereGeometry(0.22, 8, 6).scale(1, 1, 0.85), coat, 0, 0.97, -0.34))
  p.push(part(new CapsuleGeometry(0.045, 0.36, 1, 5).rotateX(0.25), mane, 0, 0.82, -0.5, HORSE_TAIL))

  const N = HORSE_NECK
  p.push(part(new CylinderGeometry(0.1, 0.16, 0.5, 7).rotateX(0.42), coat, 0, 1.24, 0.3, N))
  p.push(part(new CapsuleGeometry(0.085, 0.2, 1, 6).rotateX(Math.PI / 2 - 0.5), coat, 0, 1.5, 0.46, N))
  p.push(part(new CapsuleGeometry(0.06, 0.14, 1, 6).rotateX(Math.PI / 2 - 0.6), coatLight, 0, 1.44, 0.56, N))
  p.push(part(new SphereGeometry(0.055, 6, 5).scale(1.1, 0.9, 1), mane, 0, 1.38, 0.64, N))
  p.push(part(new BoxGeometry(0.045, 0.02, 0.2).rotateX(-0.55), sock, 0, 1.47, 0.55, N))
  for (let i = 0; i < 5; i++)
    p.push(part(new BoxGeometry(0.045, 0.12 - i * 0.012, 0.09), mane, 0, 1.28 + i * 0.06, 0.2 + i * 0.075, N))
  for (const s of [-1, 1]) {
    p.push(part(new ConeGeometry(0.032, 0.11, 5).rotateZ(s * 0.3), coat, s * 0.055, 1.58, 0.42, N))
    p.push(part(new SphereGeometry(0.02, 5, 4), eye, s * 0.065, 1.5, 0.5, N))
  }

  const legs: [number, number][] = [[-0.13, 0.26], [0.13, 0.26], [-0.13, -0.24], [0.13, -0.24]]
  legs.forEach(([lx, lz], i) => {
    const rig: Rig = [lz > 0 ? (lx > 0 ? PART.FL : PART.FR) : lx > 0 ? PART.HL : PART.HR, lx, HORSE_HIP_Y, lz]
    p.push(part(new CylinderGeometry(0.055, 0.04, 0.46, 6), coat, lx, 0.64, lz, rig))
    p.push(part(new CylinderGeometry(0.035, 0.032, 0.34, 5), coat, lx, 0.27, lz, rig))
    if (i % 3 === 0) p.push(part(new CylinderGeometry(0.037, 0.037, 0.1, 5), sock, lx, 0.14, lz, rig))
    p.push(part(new CylinderGeometry(0.042, 0.036, 0.08, 6), hoof, lx, 0.05, lz, rig))
  })
  return weld(p)
}

export function gullGeo(): BufferGeometry {
  const body = new Color('#f4f6f4')
  const wing = new Color('#d9dfe0')
  const wingDark = new Color('#b9c2c6')
  const tip = new Color('#4a5054')
  const beak = new Color('#d9a13c')
  const eye = new Color('#1a1d20')
  const p: BufferGeometry[] = []

  p.push(part(new CapsuleGeometry(0.05, 0.16, 1, 6).rotateX(Math.PI / 2), body, 0, 0, 0))
  p.push(part(new SphereGeometry(0.04, 5, 4), body, 0, 0.03, 0.14))
  p.push(part(new ConeGeometry(0.013, 0.06, 4).rotateX(Math.PI / 2), beak, 0, 0.03, 0.2))
  p.push(part(new SphereGeometry(0.008, 4, 3), new Color('#c2412c'), 0, 0.022, 0.215))
  for (const s of [-1, 1]) p.push(part(new SphereGeometry(0.008, 4, 3), eye, s * 0.022, 0.045, 0.155))

  p.push(part(new BoxGeometry(0.1, 0.01, 0.12), wing, 0, 0, -0.16))
  for (const s of [-1, 1])
    p.push(part(new BoxGeometry(0.045, 0.009, 0.09).rotateY(s * 0.22), wing, s * 0.035, 0, -0.2))

  const [shx, shy, shz] = GULL_WING.shoulderAt
  const [elx, ely, elz] = GULL_WING.elbowAt
  for (const s of [-1, 1]) {
    const arm: Rig = [s > 0 ? PART.ARM_L : PART.ARM_R, s * shx, shy, shz]
    const hand: Rig = [s > 0 ? PART.HAND_L : PART.HAND_R, s * elx, ely, elz]
    p.push(part(new BoxGeometry(0.2, 0.014, 0.15).rotateZ(s * 0.1), wing, s * 0.12, 0.01, -0.01, arm))
    p.push(part(new BoxGeometry(0.24, 0.012, 0.13).rotateZ(s * 0.2), wingDark, s * 0.33, 0.045, -0.02, hand))
    p.push(part(new BoxGeometry(0.14, 0.011, 0.1).rotateZ(s * 0.32), tip, s * 0.51, 0.09, -0.03, hand))
    for (let k = 0; k < 3; k++)
      p.push(part(new BoxGeometry(0.07, 0.009, 0.022).rotateZ(s * 0.34).rotateY(s * (0.1 + k * 0.12)), tip, s * 0.6, 0.11, -0.05 + k * 0.03, hand))
  }
  return weld(p)
}

export type Species = 'deer' | 'sheep' | 'hen' | 'horse' | 'gull'

const MODEL_URLS: Record<Species, string> = { deer: deerUrl, sheep: sheepUrl, hen: henUrl, horse: horseUrl, gull: gullUrl }
const PROCEDURAL: Record<Species, () => BufferGeometry> = { deer: deerGeo, sheep: sheepGeo, hen: henGeo, horse: horseGeo, gull: gullGeo }
const models = new Map<Species, BufferGeometry>()
let loading: Promise<boolean> | null = null

export function adoptFaunaModel(species: Species, glb: ArrayBuffer): void {
  models.set(species, faunaGeometry(glb))
}

export function faunaModel(species: Species): BufferGeometry | null {
  return models.get(species)?.clone() ?? null
}

export function loadFaunaModels(): Promise<boolean> {
  loading ??= Promise.all(
    (Object.keys(MODEL_URLS) as Species[]).map(async (sp) => {
      try {
        const res = await fetch(MODEL_URLS[sp])
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        adoptFaunaModel(sp, await res.arrayBuffer())
        return true
      } catch (err) {
        console.warn(`[tribu] modèle de faune « ${sp} » indisponible, silhouette conservée :`, err)
        return false
      }
    }),
  ).then((ok) => ok.some(Boolean))
  return loading
}

function speciesGeo(species: Species): BufferGeometry {
  return faunaModel(species) ?? PROCEDURAL[species]()
}

interface Beast {
  x: number
  z: number
  heading: number
  tx: number
  tz: number
  state: number
  timer: number
  phase: number
  pitch: number
  sleep: number
  gait: number
  path: Pt[]
  fade: number
  warp: Pt | null
  miss: number
  amp: number
  graze: number
  trot: number
  seed: number
  dark: boolean
  lull: number
  beat: number
  flapIn: number
  flaps: number
}

function hash(a: number, b: number): number {
  return Math.abs(Math.sin(a * 12.9898 + b * 78.233) * 43758.5453) % 1
}

const FADE = 4

interface LandCfg {
  speed: number
  turn: number
  step: number
  grazeBias: number
  grazePitch: number
  pauseMin: number
  pauseMax: number
  bobAmp: number
  sink: number
  body: number
  gait: Gait
}

function ease(v: number, want: number, dt: number, tau: number): number {
  return v + (want - v) * Math.min(1, dt / tau)
}

const TAU = Math.PI * 2
const FLAP_END = TAU * HEN_FLAP.hz * HEN_FLAP.dur

function stride(b: Beast, cfg: LandCfg, d: number): void {
  const g = cfg.gait
  b.phase += d * (g.kWalk + (g.kTrot - g.kWalk) * b.trot)
  if (b.phase >= TAU) b.phase -= TAU * Math.floor(b.phase / TAU)
}

interface Gull {
  cx: number
  cz: number
  r: number
  a: number
  w: number
  alt: number
  phase: number
  wing: number
  flap: number
  flapping: boolean
  left: number
  laps: number
  drop: number
}

function gullSpell(g: Gull): number {
  const r = Math.abs(Math.sin(g.phase * 12.9898 + g.laps * 78.233) * 43758.5453) % 1
  return g.flapping ? 2 + r : 3 + 2 * r
}

interface Spot {
  x: number
  z: number
}

type Zone = { x: number; z: number; r: number }

const BLOCKER_SPOT = 1.2
const PEN_R = 3.3
const PEN_WALL = 3.1 + 0.2 - 0.45
const COOP_R = 1.0

const dummy = new Object3D()
dummy.rotation.order = 'YXZ'

function turnToward(heading: number, want: number, max: number): number {
  let d = want - heading
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return heading + Math.max(-max, Math.min(max, d))
}

function pickTarget(
  b: Beast,
  spots: Spot[],
  cfg: LandCfg,
  clear?: (x0: number, z0: number, x1: number, z1: number) => boolean,
): void {
  let s: Spot | null = null
  for (let k = 0; k < 10; k++) {
    const c = spots[(Math.random() * spots.length) | 0]!
    const dx = c.x - b.x
    const dz = c.z - b.z
    if (dx * dx + dz * dz <= cfg.step * cfg.step && (!clear || clear(b.x, b.z, c.x, c.z))) {
      s = c
      break
    }
  }
  if (!s) {
    b.state = 2
    b.timer = 0.8 + Math.random() * 1.2
    return
  }
  b.tx = s.x + (Math.random() - 0.5) * 0.4
  b.tz = s.z + (Math.random() - 0.5) * 0.4
  b.state = 0
}

function makeHerd(n: number, spots: Spot[], salt: number): Beast[] {
  const herd: Beast[] = []
  for (let i = 0; i < n; i++) {
    const s = spots[(Math.random() * spots.length) | 0]!
    herd.push({
      x: s.x,
      z: s.z,
      heading: Math.random() * Math.PI * 2,
      tx: s.x,
      tz: s.z,
      state: 1,
      timer: Math.random() * 2,
      phase: Math.random() * Math.PI * 2,
      pitch: 0,
      sleep: 0,
      gait: 0.85 + Math.random() * 0.3,
      path: [],
      fade: 1,
      warp: null,
      miss: 0,
      amp: 0,
      graze: 0,
      trot: 0,
      seed: hash(i + 1, salt),
      dark: false,
      lull: Infinity,
      beat: FLAP_END,
      flapIn: 0,
      flaps: 0,
    })
    const b = herd[i]!
    b.flapIn = HEN_FLAP.waitMin * 0.5 + HEN_FLAP.waitSpan * b.seed
  }
  return herd
}

export class Fauna implements GroundSource {
  readonly group = new Group()
  private readonly skin = new MeshToonMaterial({ vertexColors: true })

  private readonly deerMesh: InstancedMesh
  private readonly sheepMesh: InstancedMesh
  private readonly henMesh: InstancedMesh
  private readonly horseMesh: InstancedMesh
  private readonly gullMesh: InstancedMesh
  private penCenter: { x: number; z: number } | null = null
  get pen(): { x: number; z: number; r: number } | null {
    return this.penCenter ? { ...this.penCenter, r: PEN_R } : null
  }
  private coopAt: { x: number; z: number } | null = null
  private pens: Mesh | null = null

  private readonly deer: Beast[]
  private readonly sheep: Beast[]
  private readonly hens: Beast[]
  private readonly horses: Beast[]
  private readonly gulls: Gull[] = []

  private deerSpots: Spot[]
  private sheepSpots: Spot[]
  private henSpots: Spot[]
  private horseSpots: Spot[]
  private readonly home: { deer: Spot[]; sheep: Spot[]; hen: Spot[]; horse: Spot[] }
  private solid: Zone[]

  private readonly deerCfg: LandCfg = { speed: 0.55, turn: 2.4, step: 3.4, grazeBias: 0.6, grazePitch: 0.3, pauseMin: 2, pauseMax: 5, bobAmp: 0.03, sink: 0.05, body: 0.3, gait: DEER_GAIT }
  private readonly sheepCfg: LandCfg = { speed: 0.32, turn: 1.8, step: 1.7, grazeBias: 0.8, grazePitch: 0.26, pauseMin: 2.5, pauseMax: 6, bobAmp: 0.02, sink: 0.02, body: 0.28, gait: SHEEP_GAIT }
  private readonly henCfg: LandCfg = { speed: 0.85, turn: 9, step: 1.5, grazeBias: 0.75, grazePitch: 0.5, pauseMin: 0.6, pauseMax: 1.8, bobAmp: 0.014, sink: 0.008, body: 0.12, gait: HEN_GAIT }
  private readonly horseCfg: LandCfg = { speed: 0.48, turn: 1.3, step: 4.5, grazeBias: 0.7, grazePitch: 0.24, pauseMin: 3, pauseMax: 7, bobAmp: 0.035, sink: 0.07, body: 0.35, gait: HORSE_GAIT }

  private readonly segClear: (x0: number, z0: number, x1: number, z1: number) => boolean

  private readonly island: Island
  private ground: Ground | null = null
  private groundRev = -1
  revision = 0
  private readonly obstacles: Zone[]

  constructor(island: Island, obstacles: Zone[] = []) {
    this.island = island
    this.obstacles = obstacles
    this.group.name = 'fauna'
    const trees: number[] = []
    for (const m of island.pickables) {
      if (island.kindFor(m) !== 'wood') continue
      for (let i = 0; i < m.count; i++) {
        const p = island.instancePosition(m, i)
        trees.push(p.x, p.z)
      }
    }
    const treeDist = (x: number, z: number): number => {
      let best = Infinity
      for (let i = 0; i < trees.length; i += 2) {
        const d = (trees[i]! - x) ** 2 + (trees[i + 1]! - z) ** 2
        if (d < best) best = d
      }
      return Math.sqrt(best)
    }
    const inCamp = (x: number, z: number, margin: number): boolean => {
      for (const b of CAMP_BLOCKERS) {
        const r = b.r + margin
        if ((x - b.x) ** 2 + (z - b.z) ** 2 < r * r) return true
      }
      return false
    }
    const fireDist = (x: number, z: number): number => Math.hypot(x - CAMP_FIRE.x, z - CAMP_FIRE.z)
    const objDist = (x: number, z: number): number => {
      let best = Infinity
      for (const o of this.obstacles) {
        const d = Math.hypot(o.x - x, o.z - z) - o.r
        if (d < best) best = d
      }
      return best
    }
    this.segClear = (x0, z0, x1, z1) => {
      const hits = (cx: number, cz: number, r: number): boolean => {
        const dx = x1 - x0
        const dz = z1 - z0
        const l2 = dx * dx + dz * dz
        let t = l2 > 0 ? ((cx - x0) * dx + (cz - z0) * dz) / l2 : 0
        t = Math.max(0, Math.min(1, t))
        const px = x0 + dx * t - cx
        const pz = z0 + dz * t - cz
        return px * px + pz * pz < r * r
      }
      for (const o of this.solid) if (hits(o.x, o.z, o.r + 0.25)) return false
      for (const b of CAMP_BLOCKERS) if (hits(b.x, b.z, b.r + 0.2)) return false
      return true
    }

    const land = island.cells.filter((c) => !c.beach && !inCamp(c.x, c.z, 0.3))
    const R = Math.max(6, island.radius)

    const zone = (score: (c: (typeof land)[number]) => number, frac = 0.16): Spot[] => {
      const scored = land
        .map((c) => ({ c, k: score(c) }))
        .sort((a, b) => b.k - a.k)
      const n = Math.max(4, Math.round(scored.length * frac))
      return scored.slice(0, n).map((e) => ({ x: e.c.x, z: e.c.z }))
    }
    const room = (c: (typeof land)[number], need: number): number =>
      (c.trod ? -6 : 0) + (objDist(c.x, c.z) > need ? 0.5 : -6)

    this.deerSpots = zone(
      (c) =>
        room(c, 1.0) -
        Math.abs(treeDist(c.x, c.z) - 1.3) * 1.8 +
        Math.min(fireDist(c.x, c.z) / R, 1.2) * 2.4 +
        Math.min(c.inland, 3) * 0.3,
      0.14,
    )
    this.sheepSpots = zone(
      (c) =>
        room(c, 1.0) +
        Math.min(treeDist(c.x, c.z), 4) * 1.3 -
        Math.abs(fireDist(c.x, c.z) / R - 0.6) * 4.5,
      0.14,
    )
    this.henSpots = zone(
      (c) => room(c, 0.6) - Math.abs(fireDist(c.x, c.z) - 3.4) * 2.2,
      0.08,
    )
    this.horseSpots = zone(
      (c) =>
        room(c, 1.2) +
        Math.min(treeDist(c.x, c.z), 5) * 0.9 +
        Math.min(fireDist(c.x, c.z) / R, 1.2) * 2.8,
      0.12,
    )

    this.home = { deer: this.deerSpots, sheep: this.sheepSpots, hen: this.henSpots, horse: this.horseSpots }
    this.solid = this.obstacles

    const drawn = this.sheepSpots[(Math.random() * this.sheepSpots.length) | 0]!
    const anchor = this.penSite(drawn, this.sheepSpots, [])
    if (anchor) {
      this.sheepSpots = this.flock(anchor, this.sheepSpots)
      this.penCenter = { x: anchor.x, z: anchor.z }
    }
    const coop = this.henSpots.reduce(
      (a, s) => ({ x: a.x + s.x / this.henSpots.length, z: a.z + s.z / this.henSpots.length }),
      { x: 0, z: 0 },
    )
    this.coopAt = { x: coop.x, z: coop.z }

    const build = (geo: BufferGeometry, n: number, spread: number, skin: Material = this.skin): InstancedMesh => {
      if (geo.getAttribute('aPivot')) {
        geo.setAttribute('aAnim', new InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(DynamicDrawUsage))
        geo.setAttribute('aRest', new InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(DynamicDrawUsage))
      }
      const mesh = new InstancedMesh(geo, skin, n)
      mesh.instanceMatrix.setUsage(DynamicDrawUsage)
      mesh.frustumCulled = false
      for (let i = 0; i < n; i++) mesh.setColorAt(i, tint(new Color('#ffffff'), i * 17 + n, spread))
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      this.group.add(mesh)
      return mesh
    }
    this.deerMesh = build(speciesGeo('deer'), 3, 0.07, rigMaterial(gaitUniform(DEER_GAIT)))
    this.sheepMesh = build(speciesGeo('sheep'), 4, 0.05, rigMaterial(gaitUniform(SHEEP_GAIT)))
    this.henMesh = build(speciesGeo('hen'), 3, 0.04, rigMaterial(gaitUniform(HEN_GAIT)))
    this.horseMesh = build(speciesGeo('horse'), 2, 0.09, rigMaterial(gaitUniform(HORSE_GAIT)))
    this.gullMesh = build(speciesGeo('gull'), 3, 0.03, rigMaterial(wingUniform(GULL_WING)))
    this.deerMesh.userData.model = models.has('deer')
    this.sheepMesh.userData.model = models.has('sheep')
    this.henMesh.userData.model = models.has('hen')
    this.horseMesh.userData.model = models.has('horse')
    this.gullMesh.userData.model = models.has('gull')
    this.sheepMesh.visible = false
    this.henMesh.visible = false
    this.horseMesh.visible = false
    this.gullMesh.visible = false

    this.buildPens()

    this.deer = makeHerd(3, this.deerSpots, 1)
    this.sheep = makeHerd(4, this.sheepSpots, 2)
    this.hens = makeHerd(3, this.henSpots, 3)
    this.horses = makeHerd(2, this.horseSpots, 4)

    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + Math.random() * 0.8
      const cd = island.radius + 2.4 + Math.random() * 0.8
      this.gulls.push({
        cx: Math.cos(a) * cd,
        cz: Math.sin(a) * cd,
        r: 1.4 + Math.random() * 0.5,
        a: Math.random() * Math.PI * 2,
        w: (i % 2 === 0 ? 1 : -1) * (0.3 + Math.random() * 0.12),
        alt: 2.6 + Math.random() * 0.7,
        phase: Math.random() * Math.PI * 2,
        wing: Math.PI / 2,
        flap: i === 1 ? 0 : 1,
        flapping: i !== 1,
        left: 0,
        laps: i,
        drop: 0,
      })
      const g = this.gulls[i]!
      g.left = gullSpell(g) * (0.3 + 0.7 * (g.phase / TAU))
    }
  }

  useModels(): void {
    const meshes: [Species, InstancedMesh][] = [['deer', this.deerMesh], ['sheep', this.sheepMesh], ['hen', this.henMesh], ['horse', this.horseMesh], ['gull', this.gullMesh]]
    for (const [sp, mesh] of meshes) {
      if (mesh.userData.model) continue
      const geo = faunaModel(sp)
      if (!geo) continue
      const old = mesh.geometry
      geo.setAttribute('aAnim', old.getAttribute('aAnim'))
      geo.setAttribute('aRest', old.getAttribute('aRest'))
      mesh.geometry = geo
      mesh.userData.model = true
      old.dispose()
    }
  }

  private penFits(p: Spot, zones: readonly Zone[]): boolean {
    for (const o of this.obstacles) if (Math.hypot(p.x - o.x, p.z - o.z) < o.r + PEN_WALL) return false
    for (const b of zones) if (Math.hypot(p.x - b.x, p.z - b.z) < b.r + PEN_R) return false
    return true
  }

  private penSite(at: Spot, meadow: Spot[], zones: readonly Zone[]): Spot | null {
    if (this.penFits(at, zones)) return at
    let best: Spot | null = null
    let bd = Infinity
    for (const s of meadow) {
      if (!this.penFits(s, zones)) continue
      const d = Math.hypot(s.x - at.x, s.z - at.z)
      if (d < bd) {
        bd = d
        best = s
      }
    }
    return best
  }

  private flock(anchor: Spot, meadow: Spot[]): Spot[] {
    const near = meadow.filter((s) => Math.hypot(s.x - anchor.x, s.z - anchor.z) < 2.6)
    return near.length >= 3 ? near : meadow
  }

  setBlockers(zones: readonly Zone[]): void {
    this.solid = this.obstacles.concat(zones.map((b) => ({ ...b, r: b.r + 0.6 })))
    const clear = (s: Spot, m: number): boolean =>
      zones.every((b) => Math.hypot(s.x - b.x, s.z - b.z) >= b.r + m)
    const keep = (spots: Spot[]): Spot[] => {
      const k = spots.filter((s) => clear(s, BLOCKER_SPOT))
      if (k.length > 0 || spots.length === 0) return k
      const gap = (s: Spot): number => Math.min(...zones.map((b) => Math.hypot(s.x - b.x, s.z - b.z) - b.r))
      return [...spots].sort((a, b) => gap(b) - gap(a)).slice(0, 4)
    }
    const nearest = (spots: Spot[], p: Spot): Spot | null => {
      let best: Spot | null = null
      let bd = Infinity
      for (const s of spots) {
        const d = Math.hypot(s.x - p.x, s.z - p.z)
        if (d < bd) {
          bd = d
          best = s
        }
      }
      return best
    }

    const meadow = keep(this.home.sheep)
    const penMoved = !!this.penCenter && !this.penFits(this.penCenter, zones)
    if (penMoved) {
      const a = this.penSite(this.penCenter!, meadow, zones)
      this.penCenter = a ? { x: a.x, z: a.z } : null
    }
    this.sheepSpots = this.penCenter ? this.flock(this.penCenter, meadow) : meadow
    this.deerSpots = keep(this.home.deer)
    this.henSpots = keep(this.home.hen)
    this.horseSpots = keep(this.home.horse)
    const coopMoved = !!this.coopAt && !clear(this.coopAt, COOP_R)
    if (coopMoved) {
      const c = nearest(this.henSpots.filter((s) => clear(s, COOP_R)), this.coopAt!)
      this.coopAt = c ? { x: c.x, z: c.z } : null
    }
    if (penMoved || coopMoved) this.buildPens()
    if (penMoved)
      this.sheep.forEach((b, i) => {
        const s = this.sheepSpots[i % this.sheepSpots.length]!
        b.x = b.tx = s.x
        b.z = b.tz = s.z
      })

    const herds: [Beast[], Spot[]][] = [
      [this.deer, this.deerSpots],
      [this.sheep, this.sheepSpots],
      [this.hens, this.henSpots],
      [this.horses, this.horseSpots],
    ]
    for (const [herd, spots] of herds)
      for (const b of herd) {
        if (!clear(b, 0.3)) {
          const s = nearest(spots, b)
          if (s) {
            b.x = s.x
            b.z = s.z
          }
        }
        if (!clear({ x: b.tx, z: b.tz }, BLOCKER_SPOT)) {
          b.tx = b.x
          b.tz = b.z
          b.path = []
          b.state = 2
          b.timer = 0.5
        }
      }
  }

  private buildPens(): void {
    this.revision++
    const p: BufferGeometry[] = []
    const wood = new Color('#9a7248')
    const woodDark = new Color('#6d4f31')
    const roof = new Color('#4260c4')
    const plaster = new Color('#efe3cc')

    if (this.penCenter) {
      const { x, z } = this.penCenter
      const h = GROUND_Y
      const R = 3.1
      const N = 12
      const gate = 3
      for (let i = 0; i < N; i++) {
        if (i === gate || i === gate + 1) continue
        const a = (i / N) * Math.PI * 2
        const px = x + Math.cos(a) * R
        const pz = z + Math.sin(a) * R
        p.push(part(new CylinderGeometry(0.055, 0.07, 0.72, 5), woodDark, px, h + 0.34, pz))
        if (i === gate - 1 || i === gate + 1) continue
        const b = ((i + 1) / N) * Math.PI * 2
        const qx = x + Math.cos(b) * R
        const qz = z + Math.sin(b) * R
        const len = Math.hypot(qx - px, qz - pz)
        for (const y of [0.28, 0.52]) {
          p.push(
            part(
              new BoxGeometry(len, 0.05, 0.05).rotateY(-Math.atan2(qz - pz, qx - px)),
              wood,
              (px + qx) / 2,
              h + y,
              (pz + qz) / 2,
            ),
          )
        }
      }
    }

    if (this.coopAt) {
      const { x, z } = this.coopAt
      const h = GROUND_Y
      p.push(part(new BoxGeometry(0.95, 0.6, 0.8), plaster, x, h + 0.3, z))
      p.push(part(new BoxGeometry(1.15, 0.16, 1.0).rotateZ(0.13), roof, x, h + 0.68, z))
      p.push(part(new BoxGeometry(0.5, 0.05, 0.24).rotateZ(-0.22), wood, x + 0.66, h + 0.16, z))
      p.push(part(new CylinderGeometry(0.035, 0.035, 0.5, 5), woodDark, x - 0.62, h + 0.25, z + 0.3))
    }

    const geo = mergeGeometries(p)
    if (!geo) {
      if (this.pens) {
        this.group.remove(this.pens)
        this.pens.geometry.dispose()
      }
      this.pens = null
      return
    }
    if (this.pens) {
      this.pens.geometry.dispose()
      this.pens.geometry = geo
      return
    }
    this.pens = new Mesh(geo, this.skin)
    this.pens.visible = false
    this.group.add(this.pens)
  }

  groundFootprints(): Footprint[] {
    return this.pens && this.pens.visible ? [{ geo: this.pens.geometry, minY: -Infinity }] : []
  }

  setGround(ground: Ground | null): void {
    this.ground = ground
    this.groundRev = -1
  }

  private settle(): void {
    const g = this.ground
    if (!g || g.revision === this.groundRev) return
    const first = this.groundRev === -1
    this.groundRev = g.revision
    const herds: [Beast[], LandCfg][] = [
      [this.deer, this.deerCfg],
      [this.sheep, this.sheepCfg],
      [this.hens, this.henCfg],
      [this.horses, this.horseCfg],
    ]
    for (const [herd, cfg] of herds)
      for (const b of herd) {
        this.rehome(b, cfg, first)
        b.path = []
        if (b.state === 0 || b.state === 3) {
          b.state = 2
          b.timer = 0.3
        }
      }
  }

  private homeComp(b: Beast, cfg: LandCfg): number {
    const g = this.ground!
    if (cfg === this.sheepCfg && this.penCenter && this.pens?.visible) {
      const pen = g.componentAt(this.penCenter.x, this.penCenter.z, cfg.body)
      if (pen >= 0 && g.componentAt(b.x, b.z, cfg.body) === pen) return pen
    }
    return g.mainComponent(cfg.body)
  }

  private rehome(b: Beast, cfg: LandCfg, instant: boolean): void {
    const g = this.ground!
    const home = this.homeComp(b, cfg)
    const free = g.free(b.x, b.z, cfg.body)
    if (free && g.componentAt(b.x, b.z, cfg.body) === home) return
    const p =
      g.nearestIn(b.x, b.z, cfg.body, home, 6) ??
      g.nearestIn(b.x, b.z, cfg.body, home, 20) ??
      (free ? null : g.nearestFree(b.x, b.z, cfg.body, 10))
    if (!p) return
    b.path = []
    b.state = 1
    b.timer = 0.8
    if (instant || !free) {
      b.x = b.tx = p.x
      b.z = b.tz = p.z
      b.warp = null
      b.fade = instant ? 1 : 0
    } else b.warp = p
  }

  private routeTo(b: Beast, x: number, z: number, cfg: LandCfg, maxLen: number): { x: number; z: number; pts: Pt[] } | null {
    const g = this.ground!
    const at = g.nearestIn(x, z, cfg.body, this.homeComp(b, cfg), 1.5)
    if (!at) return null
    const r = g.route(b.x, b.z, at.x, at.z, cfg.body, 6000)
    if (!r.reached || r.length > maxLen) return null
    return { x: at.x, z: at.z, pts: r.pts }
  }

  private pickOnGround(b: Beast, spots: Spot[], cfg: LandCfg): void {
    for (let k = 0; k < 16; k++) {
      const c = spots[(Math.random() * spots.length) | 0]!
      const far = k >= 10
      if (!far && (c.x - b.x) ** 2 + (c.z - b.z) ** 2 > cfg.step * cfg.step) continue
      const r = this.routeTo(b, c.x + (Math.random() - 0.5) * 0.4, c.z + (Math.random() - 0.5) * 0.4, cfg, far ? 40 : cfg.step * 1.8)
      if (!r || Math.hypot(r.x - b.x, r.z - b.z) < 0.3) continue
      b.tx = r.x
      b.tz = r.z
      b.path = r.pts
      b.state = 0
      b.miss = 0
      return
    }
    for (let k = 0; k < 8; k++) {
      const a = Math.random() * Math.PI * 2
      const d = cfg.step * (0.4 + Math.random() * 0.6)
      const r = this.routeTo(b, b.x + Math.sin(a) * d, b.z + Math.cos(a) * d, cfg, cfg.step * 2)
      if (!r || Math.hypot(r.x - b.x, r.z - b.z) < 0.3) continue
      b.tx = r.x
      b.tz = r.z
      b.path = r.pts
      b.state = 0
      b.miss = 0
      return
    }
    b.state = 2
    b.timer = 0.8 + Math.random() * 1.2
    if (++b.miss >= 3) {
      b.miss = 0
      this.rehome(b, cfg, false)
    }
  }

  setKnown(agriculture: boolean, granary: boolean, horsecollar: boolean, sail: boolean): void {
    if (this.pens && this.pens.visible !== (agriculture || granary)) {
      this.pens.visible = agriculture || granary
      this.revision++
    }
    this.sheepMesh.visible = agriculture
    this.henMesh.visible = granary
    this.horseMesh.visible = horsecollar
    this.gullMesh.visible = sail
  }

  private fishMesh: Mesh | null = null
  private fish = { t: 0, dur: 0.8, x: 0, z: 0, dx: 0, dz: 0 }
  private fishTimer = 6
  private fishingSpot: { x: number; z: number } | null = null
  onFishJump: (() => void) | null = null

  setFishing(x: number | null, z = 0): void {
    this.fishingSpot = x === null ? null : { x, z }
  }

  private ensureFish(): Mesh {
    if (this.fishMesh) return this.fishMesh
    const geo = weld([
      part(new CapsuleGeometry(0.05, 0.14, 1, 6).rotateX(Math.PI / 2).scale(1, 1.25, 1), new Color('#5a7d8f'), 0, 0, 0),
      part(new ConeGeometry(0.05, 0.1, 4).rotateX(-Math.PI / 2).scale(1, 1.4, 0.3), new Color('#4a6b7d'), 0, 0, -0.14),
    ])
    this.fishMesh = new Mesh(geo, new MeshToonMaterial({ vertexColors: true }))
    this.fishMesh.visible = false
    this.group.add(this.fishMesh)
    return this.fishMesh
  }

  private tickFish(dt: number, night: boolean): void {
    const mesh = this.ensureFish()
    if (mesh.visible) {
      const f = this.fish
      f.t += dt
      const u = Math.min(1, f.t / f.dur)
      const y = Math.sin(Math.PI * u) * 0.55 - 0.12
      mesh.position.set(f.x + f.dx * u, y, f.z + f.dz * u)
      mesh.rotation.x = -Math.cos(Math.PI * u) * 0.9
      mesh.rotation.y = Math.atan2(f.dx, f.dz)
      if (u >= 1) mesh.visible = false
      return
    }
    this.fishTimer -= dt * (this.fishingSpot ? 2.6 : 1) * (night ? 0.45 : 1)
    if (this.fishTimer > 0) return
    this.fishTimer = 5 + Math.random() * 9
    const R = this.island.radius
    let x: number
    let z: number
    if (this.fishingSpot) {
      const out = Math.hypot(this.fishingSpot.x, this.fishingSpot.z) || 1
      const k = (out + 2 + Math.random() * 2.5) / out
      const swing = (Math.random() - 0.5) * 0.35
      const c = Math.cos(swing)
      const sn = Math.sin(swing)
      x = (this.fishingSpot.x * c - this.fishingSpot.z * sn) * k
      z = (this.fishingSpot.x * sn + this.fishingSpot.z * c) * k
    } else {
      const a = Math.random() * Math.PI * 2
      const r = R * (1.04 + Math.random() * 0.14)
      x = Math.sin(a) * r
      z = Math.cos(a) * r
    }
    const dir = Math.random() * Math.PI * 2
    this.fish = { t: 0, dur: 0.7 + Math.random() * 0.35, x, z, dx: Math.sin(dir) * 0.8, dz: Math.cos(dir) * 0.8 }
    mesh.visible = true
    this.onFishJump?.()
  }

  stampede(angle: number, dur = 24): void {
    const cap = this.island.radius * 0.85
    for (const b of this.deer) {
      b.state = 3
      b.timer = dur
      const tx = b.x + Math.sin(angle) * 60
      const tz = b.z + Math.cos(angle) * 60
      const d = Math.hypot(tx, tz)
      const k = d > cap ? cap / d : 1
      b.tx = tx * k
      b.tz = tz * k
      if (this.ground) {
        const at = this.ground.nearestFree(b.tx, b.tz, this.deerCfg.body, 12)
        const r = at ? this.ground.route(b.x, b.z, at.x, at.z, this.deerCfg.body, 12000) : null
        b.path = r ? r.pts : []
        const end = b.path[b.path.length - 1]
        if (end) {
          b.tx = end.x
          b.tz = end.z
        }
      }
    }
  }

  update(dt: number, time: number, settler: Vector3, night: boolean): void {
    this.settle()
    this.tickFish(dt, night)
    if (this.deerMesh.visible) this.stepLand(this.deerMesh, this.deer, this.deerSpots, this.deerCfg, dt, time, night, settler)
    if (this.sheepMesh.visible) this.stepLand(this.sheepMesh, this.sheep, this.sheepSpots, this.sheepCfg, dt, time, night, null)
    if (this.henMesh.visible) this.stepLand(this.henMesh, this.hens, this.henSpots, this.henCfg, dt, time, night, null)
    if (this.horseMesh.visible) this.stepLand(this.horseMesh, this.horses, this.horseSpots, this.horseCfg, dt, time, night, null)
    if (this.gullMesh.visible) this.stepGulls(dt, time)
  }

  private stepLand(
    mesh: InstancedMesh,
    herd: Beast[],
    spots: Spot[],
    cfg: LandCfg,
    dt: number,
    time: number,
    night: boolean,
    threat: Vector3 | null,
  ): void {
    const anim = mesh.geometry.getAttribute('aAnim') as InstancedBufferAttribute
    const rest = mesh.geometry.getAttribute('aRest') as InstancedBufferAttribute
    const g = cfg.gait
    for (let i = 0; i < herd.length; i++) {
      const b = herd[i]!
      if (b.dark !== night) {
        b.dark = night
        b.lull = 0
      }
      b.lull += dt
      const bed = night ? b.lull >= b.seed * SLEEP.fallMax : b.lull < hash(b.seed, 7) * SLEEP.wakeMax
      b.sleep = Math.max(0, Math.min(1, b.sleep + (bed ? dt : -dt) * SLEEP.rate))
      const awake = !bed && b.sleep === 0
      if (b.warp) {
        b.fade -= dt * FADE
        b.state = 1
        b.timer = Math.max(b.timer, 0.3)
        if (b.fade <= 0) {
          b.fade = 0
          b.x = b.tx = b.warp.x
          b.z = b.tz = b.warp.z
          b.warp = null
        }
      } else if (b.fade < 1) b.fade = Math.min(1, b.fade + dt * FADE)

      if (awake) {
        if (threat && b.state !== 3 && !b.warp) {
          const dx = b.x - threat.x
          const dz = b.z - threat.z
          if (dx * dx + dz * dz < 16) {
            let best = -Infinity
            for (const s of spots) {
              const score =
                Math.hypot(s.x - threat.x, s.z - threat.z) - 0.45 * Math.hypot(s.x - b.x, s.z - b.z)
              if (score > best) {
                best = score
                b.tx = s.x
                b.tz = s.z
              }
            }
            b.state = 3
            b.timer = 5
            b.pitch = 0
            if (this.ground) {
              const r = this.routeTo(b, b.tx, b.tz, cfg, 60)
              b.path = r ? r.pts : []
              if (r) {
                b.tx = r.x
                b.tz = r.z
              } else {
                b.state = 2
                b.timer = 1
              }
            }
            b.heading = Math.atan2(b.tx - b.x, b.tz - b.z)
          }
        }

        if ((b.state === 0 || b.state === 3) && this.ground) {
          const flee = b.state === 3
          if (b.path.length === 0) {
            b.state = Math.random() < cfg.grazeBias ? 2 : 1
            b.timer = cfg.pauseMin + Math.random() * (cfg.pauseMax - cfg.pauseMin)
          } else {
            const sp = cfg.speed * b.gait * (flee ? 2.7 : 1)
            const nx = b.path[0]!
            b.heading = turnToward(b.heading, Math.atan2(nx.x - b.x, nx.z - b.z), cfg.turn * (flee ? 2.4 : 1) * dt * 2)
            const x0 = b.x
            const z0 = b.z
            follow(b, b.path, sp * dt)
            stride(b, cfg, Math.hypot(b.x - x0, b.z - z0))
          }
          if (flee) {
            b.timer -= dt
            if (b.timer < 0) b.state = 0
          }
        } else if (b.state === 0 || b.state === 3) {
          const flee = b.state === 3
          const dx = b.tx - b.x
          const dz = b.tz - b.z
          const d = Math.hypot(dx, dz)
          b.heading = turnToward(b.heading, Math.atan2(dx, dz), cfg.turn * (flee ? 2.4 : 1) * dt)
          if (d < 0.14) {
            b.state = Math.random() < cfg.grazeBias ? 2 : 1
            b.timer = cfg.pauseMin + Math.random() * (cfg.pauseMax - cfg.pauseMin)
          } else {
            const sp = cfg.speed * b.gait * (flee ? 2.7 : 1)
            b.x += Math.sin(b.heading) * sp * dt
            b.z += Math.cos(b.heading) * sp * dt
            stride(b, cfg, sp * dt)
          }
          if (flee) {
            b.timer -= dt
            if (b.timer < 0) b.state = 0
          }
        } else {
          b.timer -= dt
          if (b.timer < 0) {
            if (this.ground) this.pickOnGround(b, spots, cfg)
            else pickTarget(b, spots, cfg, this.segClear)
          }
        }
      }

      if (!this.ground) for (const o of this.solid) {
        const rr = o.r + 0.3
        const dx = b.x - o.x
        const dz = b.z - o.z
        const d2 = dx * dx + dz * dz
        if (d2 > 0.0001 && d2 < rr * rr) {
          const d = Math.sqrt(d2)
          b.x = o.x + (dx / d) * rr
          b.z = o.z + (dz / d) * rr
        }
      }
      if (!this.ground) for (let k = 0; k < CAMP_BLOCKERS.length; k++) {
        const bl = CAMP_BLOCKERS[k]!
        const dx = b.x - bl.x
        const dz = b.z - bl.z
        const d2 = dx * dx + dz * dz
        if (d2 < bl.r * bl.r && d2 > 1e-4) {
          const d = Math.sqrt(d2)
          b.x = bl.x + (dx / d) * bl.r
          b.z = bl.z + (dz / d) * bl.r
        }
      }

      const moving = awake && (b.state === 0 || b.state === 3)
      const grazing = awake && b.state === 2
      const wantPitch = grazing ? cfg.grazePitch * g.bodyPitch * (0.82 + 0.18 * Math.sin(time * 2.2 + b.phase)) : 0
      b.pitch += (wantPitch - b.pitch) * Math.min(1, dt * 3)
      b.amp = ease(b.amp, moving ? 1 : 0, dt, 0.15)
      const flee = moving && b.state === 3
      b.trot = ease(b.trot, flee ? 1 : 0, dt, flee ? 0.08 : 0.4)
      b.graze = ease(b.graze, grazing ? 1 : 0, dt, grazing ? 0.35 : 0.25)
      if (g.wingLift > 0) {
        if (b.beat < FLAP_END) b.beat = Math.min(FLAP_END, b.beat + dt * TAU * HEN_FLAP.hz)
        else if (awake && (b.flapIn -= dt) <= 0) {
          b.flaps++
          b.flapIn = HEN_FLAP.waitMin + HEN_FLAP.waitSpan * hash(b.seed, b.flaps)
          b.beat = 0
        }
      }
      const z = b.sleep * b.sleep * (3 - 2 * b.sleep)
      const a = anim.array as Float32Array
      a[i * 4] = b.phase
      a[i * 4 + 1] = b.amp
      a[i * 4 + 2] = b.graze * (1 + g.neckSwell * Math.sin(time * TAU * g.swellHz + b.phase))
      a[i * 4 + 3] = b.trot
      const r = rest.array as Float32Array
      r[i * 4] = z
      r[i * 4 + 1] = b.beat
      r[i * 4 + 2] = g.wingLift > 0 ? 1 : 0

      const bob = Math.abs(Math.sin(b.phase)) * cfg.bobAmp * b.amp * (1 + (g.trotBob - 1) * b.trot)
      const sy = 1 + z * SLEEP.breath * Math.sin(time * TAU * SLEEP.breathHz + b.seed * TAU)
      dummy.position.set(b.x, GROUND_Y + bob - b.pitch * cfg.sink - z * g.drop * sy, b.z)
      dummy.rotation.set(b.pitch, b.heading, Math.sin(b.phase) * g.roll * b.amp)
      const k = Math.max(0.001, b.fade)
      dummy.scale.set((1 + (sy - 1) * 0.5) * k, sy * k, k)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    anim.needsUpdate = true
    rest.needsUpdate = true
  }

  private stepGulls(dt: number, time: number): void {
    const anim = this.gullMesh.geometry.getAttribute('aAnim') as InstancedBufferAttribute
    const a = anim.array as Float32Array
    const W = GULL_WING
    for (let i = 0; i < this.gulls.length; i++) {
      const g = this.gulls[i]!
      g.a += g.w * dt
      g.left -= dt
      if (g.left <= 0) {
        g.flapping = !g.flapping
        g.laps++
        g.left = gullSpell(g)
        if (g.flapping) g.wing = Math.PI / 2
      }
      g.flap = ease(g.flap, g.flapping ? 1 : 0, dt, W.blend)
      g.wing += dt * TAU * W.hz
      if (g.wing >= TAU) g.wing -= TAU
      g.drop = g.flapping ? Math.min(0, g.drop + W.climb * dt) : Math.max(-W.maxDrop, g.drop - W.sink * dt)
      const x = g.cx + Math.cos(g.a) * g.r
      const z = g.cz + Math.sin(g.a) * g.r
      const heading = Math.atan2(-Math.sin(g.a) * g.w, Math.cos(g.a) * g.w)
      const beat = Math.sin(g.wing) * g.flap
      dummy.position.set(x, g.alt + g.drop + Math.sin(time * 0.8 + g.phase) * 0.2 - beat * W.bodyBob, z)
      dummy.rotation.set(0.08, heading, (g.w > 0 ? -0.2 : 0.2) + beat * W.bodyRoll)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      this.gullMesh.setMatrixAt(i, dummy.matrix)
      a[i * 4] = g.wing
      a[i * 4 + 1] = 0
      a[i * 4 + 2] = 0
      a[i * 4 + 3] = g.flap
    }
    this.gullMesh.instanceMatrix.needsUpdate = true
    anim.needsUpdate = true
  }
}
