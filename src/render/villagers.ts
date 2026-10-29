import {
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  MeshToonMaterial,
  Object3D,
  SphereGeometry,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { GROUND_Y, type Island } from './island'
import { PALETTE } from './palette'
import { CAMP_HOME } from './village'
import { follow, type Ground, type Pt } from './ground'

const BODY_R = 0.25

function part(src: BufferGeometry, c: Color, x = 0, y = 0, z = 0): BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src
  g.translate(x, y, z)
  const n = g.attributes.position!.count
  const rgb = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = c.r
    rgb[i * 3 + 1] = c.g
    rgb[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new BufferAttribute(rgb, 3))
  return g
}

const C = {
  skin: PALETTE.skin,
  skinDark: new Color('#c88b5c'),
  hair: new Color('#3d2a1e'),
  fur: new Color('#f0e3cb'),
  leatherDark: new Color('#4c3425'),
  robe: new Color('#b06a3f'),
  robeChild: new Color('#c98f5b'),
  basket: new Color('#8a6a42'),
} as const

function bodyGeo(child: boolean): BufferGeometry {
  const p: BufferGeometry[] = []
  const robe = child ? C.robeChild : C.robe
  const hipY = child ? 0.24 : 0.34
  const tunicH = child ? 0.3 : 0.46
  const rTop = child ? 0.15 : 0.2
  const rBot = child ? 0.19 : 0.26
  const headR = child ? 0.155 : 0.145
  const headY = child ? 0.68 : 1.0

  for (const s of [-1, 1]) {
    p.push(part(new CapsuleGeometry(child ? 0.05 : 0.055, hipY * 0.8, 3, 6).rotateX(s * 0.1), C.skin, s * (child ? 0.06 : 0.08), hipY * 0.55, 0))
    p.push(part(new SphereGeometry(child ? 0.055 : 0.062, 7, 5).scale(1, 0.7, 1.3), C.leatherDark, s * (child ? 0.06 : 0.08), hipY * 0.12, 0.02))
  }
  p.push(part(new CylinderGeometry(rTop, rBot, tunicH, 9).scale(1.14, 1, 0.82), robe, 0, hipY + tunicH / 2, 0))
  p.push(part(new CylinderGeometry(rBot * 0.97, rBot * 0.97, 0.06, 9).scale(1.14, 1, 0.86), C.leatherDark, 0, hipY + 0.05, 0))
  p.push(part(new CylinderGeometry(rTop * 1.22, rTop * 1.05, child ? 0.09 : 0.12, 11).scale(1.08, 1, 0.86), C.fur, 0, hipY + tunicH, 0))
  p.push(part(new SphereGeometry(rTop * 0.95, 9, 7).scale(1.14, 0.7, 0.82), robe, 0, hipY + tunicH - 0.02, 0))
  for (const s of [-1, 1]) {
    const armY = hipY + tunicH - (child ? 0.1 : 0.14)
    p.push(part(new CapsuleGeometry(child ? 0.042 : 0.05, child ? 0.16 : 0.24, 3, 6).rotateZ(s * 0.2), C.skin, s * (rTop + 0.05), armY - (child ? 0.08 : 0.12), 0))
    p.push(part(new SphereGeometry(child ? 0.05 : 0.058, 7, 5), C.skinDark, s * (rTop + 0.09), armY - (child ? 0.18 : 0.27), 0))
  }
  p.push(part(new CylinderGeometry(0.06, 0.07, 0.07, 7), C.skinDark, 0, headY - headR - 0.03, 0))
  p.push(part(new SphereGeometry(headR, 11, 9).scale(1, 0.98, 0.94), C.skin, 0, headY, 0))
  p.push(part(new SphereGeometry(headR * 1.05, 11, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).rotateX(-0.18), C.hair, 0, headY, 0))
  p.push(part(new SphereGeometry(headR * 0.19, 6, 5), C.skinDark, 0, headY - headR * 0.1, headR * 0.98))
  if (child) {
    for (const s of [-1, 1])
      p.push(part(new SphereGeometry(0.05, 7, 5), C.hair, s * headR * 0.95, headY + 0.02, -0.02))
  } else {
    p.push(part(new SphereGeometry(0.075, 8, 6), C.hair, 0, headY + 0.04, -headR * 0.85))
    p.push(part(new CylinderGeometry(0.1, 0.075, 0.12, 6), C.basket, 0.27, hipY + 0.16, 0.05))
  }
  return mergeGeometries(p) ?? new BufferGeometry()
}

interface Soul {
  x: number
  z: number
  tx: number
  tz: number
  walking: boolean
  timer: number
  heading: number
  phase: number
  scale: number
  home: boolean
  path: Pt[]
  misses: number
  fade: number
  warp: Pt | null
}

const FADE = 4

export class Villagers {
  readonly group = new Group()
  private readonly bodies: InstancedMesh[] = []
  private readonly souls: Soul[] = []
  private readonly dummy = new Object3D()
  private count = 0

  private obstacles: { x: number; z: number; r: number }[]
  private readonly built: { x: number; z: number; r: number }[]
  private readonly island: Island
  private ground: Ground | null = null
  private groundRev = -1

  constructor(island: Island, obstacles: { x: number; z: number; r: number }[]) {
    this.island = island
    this.built = obstacles
    this.obstacles = obstacles
    const skin = new MeshToonMaterial({ vertexColors: true })
    for (const child of [false, true]) {
      const m = new InstancedMesh(bodyGeo(child), skin, 1)
      m.castShadow = true
      m.frustumCulled = false
      m.visible = false
      this.bodies.push(m)
      this.group.add(m)
    }
    for (let i = 0; i < 2; i++)
      this.souls.push({
        x: CAMP_HOME.x + 2 + i,
        z: CAMP_HOME.z + 2 - i,
        tx: 0,
        tz: 0,
        walking: false,
        timer: 1 + i,
        heading: 0,
        phase: i * 2,
        scale: 1,
        home: false,
        path: [],
        misses: 0,
        fade: 1,
        warp: null,
      })
    this.setPopulation(0)
  }

  setBlockers(zones: readonly { x: number; z: number; r: number }[]): void {
    this.obstacles = this.built.concat(zones)
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
    for (const s of this.souls) {
      this.rehome(s, first)
      if (s.walking && !this.plan(s)) {
        s.path = []
        s.walking = false
        s.timer = 0.4
      }
    }
  }

  private rehome(s: Soul, instant: boolean): void {
    const g = this.ground
    if (!g) return
    const main = g.mainComponent(BODY_R)
    const free = g.free(s.x, s.z, BODY_R)
    if (free && g.componentAt(s.x, s.z, BODY_R) === main) return
    const p = g.nearestIn(s.x, s.z, BODY_R, main, 6) ?? g.nearestIn(s.x, s.z, BODY_R, main, 20) ?? (free ? null : g.nearestFree(s.x, s.z, BODY_R, 8))
    if (!p) return
    s.path = []
    s.walking = false
    s.timer = 0.6
    if (instant || !free) {
      s.x = p.x
      s.z = p.z
      s.warp = null
      s.fade = instant ? 1 : 0
    } else s.warp = p
  }

  private plan(s: Soul): boolean {
    const g = this.ground
    if (!g) return true
    const at = g.nearestIn(s.tx, s.tz, BODY_R, g.mainComponent(BODY_R), 3)
    if (!at) return false
    const r = g.route(s.x, s.z, at.x, at.z, BODY_R, 12000)
    if (!r.reached) return false
    s.tx = at.x
    s.tz = at.z
    s.path = r.pts
    return true
  }

  setPopulation(n: number): void {
    this.count = Math.min(2, Math.max(0, n))
    this.bodies.forEach((m, i) => (m.visible = i < this.count))
  }

  private pickTarget(s: Soul): void {
    const o =
      this.obstacles.length > 0 && Math.random() < 0.75
        ? this.obstacles[Math.floor(Math.random() * this.obstacles.length)]!
        : { x: CAMP_HOME.x, z: CAMP_HOME.z, r: 1.6 }
    const a = Math.random() * Math.PI * 2
    const d = o.r + 0.8 + Math.random() * 1.8
    const tx = o.x + Math.sin(a) * d
    const tz = o.z + Math.cos(a) * d
    const rr = Math.hypot(tx, tz)
    const cap = this.island.radius * 0.72
    const k = rr > cap ? cap / rr : 1
    s.tx = tx * k
    s.tz = tz * k
    s.walking = true
    if (this.plan(s) && Math.hypot(s.tx - s.x, s.tz - s.z) >= 0.5) {
      s.misses = 0
      return
    }
    s.misses++
    if (s.misses >= 3) {
      s.misses = 0
      s.tx = CAMP_HOME.x + 1.2
      s.tz = CAMP_HOME.z + 1.4
      if (this.plan(s)) return
      s.walking = false
      this.rehome(s, false)
      if (s.warp) return
    }
    s.walking = false
    s.timer = 0.4
  }

  update(dt: number, time: number, night: boolean, childNight = night): void {
    this.settle()
    for (let i = 0; i < 2; i++) {
      const s = this.souls[i]!
      const active = i < this.count
      if (!active) continue
      const asleep = i === 1 ? childNight : night

      if (asleep && !s.home) {
        const hx = CAMP_HOME.x + (i === 0 ? 1.2 : -0.8)
        const hz = CAMP_HOME.z + 1.4
        if (!s.walking || s.path.length === 0 || s.tx !== hx || s.tz !== hz) {
          s.tx = hx
          s.tz = hz
          s.walking = true
          if (!this.plan(s)) s.path = []
          s.tx = hx
          s.tz = hz
        }
        if (Math.hypot(s.x - s.tx, s.z - s.tz) < 0.4 || (this.ground && s.path.length === 0)) s.home = true
      } else if (!asleep && s.home) {
        s.home = false
        s.timer = 1 + Math.random() * 3
        s.walking = false
      }

      if (s.warp) {
        s.fade -= dt * FADE
        s.walking = false
        s.timer = Math.max(s.timer, 0.3)
        if (s.fade <= 0) {
          s.fade = 0
          s.x = s.warp.x
          s.z = s.warp.z
          s.warp = null
        }
      } else if (s.fade < 1) s.fade = Math.min(1, s.fade + dt * FADE)

      if (!s.home && !s.warp) {
        if (s.walking && this.ground) {
          if (s.path.length === 0) {
            s.walking = false
            s.timer = 2.5 + Math.random() * 6
          } else {
            const sp = (i === 0 ? 0.62 : 0.95) * (asleep ? 1.4 : 1)
            const dir = follow(s, s.path, sp * dt)
            if (dir) s.heading = Math.atan2(dir.dx, dir.dz)
            s.phase += dt * (i === 0 ? 7 : 11)
          }
        } else if (s.walking) {
          const dx = s.tx - s.x
          const dz = s.tz - s.z
          const d = Math.hypot(dx, dz)
          if (d < 0.18) {
            s.walking = false
            s.timer = 2.5 + Math.random() * 6
          } else {
            s.heading = Math.atan2(dx, dz)
            const sp = (i === 0 ? 0.62 : 0.95) * (asleep ? 1.4 : 1)
            s.x += Math.sin(s.heading) * sp * dt
            s.z += Math.cos(s.heading) * sp * dt
            s.phase += dt * (i === 0 ? 7 : 11)
          }
        } else if (!asleep) {
          s.timer -= dt
          if (s.timer <= 0) this.pickTarget(s)
        }
        if (!this.ground) for (const o of this.obstacles) {
          const rr = o.r + 0.25
          const dx = s.x - o.x
          const dz = s.z - o.z
          const d2 = dx * dx + dz * dz
          if (d2 > 1e-4 && d2 < rr * rr) {
            const d = Math.sqrt(d2)
            s.x = o.x + (dx / d) * rr
            s.z = o.z + (dz / d) * rr
          }
        }
      }

      const bob = s.walking ? Math.abs(Math.sin(s.phase)) * 0.045 : Math.sin(time * 1.7 + i * 3) * 0.012
      const hidden = s.home
      this.dummy.position.set(s.x, GROUND_Y + bob, s.z)
      this.dummy.rotation.set(0, s.heading, s.walking ? Math.sin(s.phase) * 0.06 : 0)
      this.dummy.scale.setScalar(hidden ? 0.001 : Math.max(0.001, s.scale * s.fade))
      this.dummy.updateMatrix()
      this.bodies[i]!.setMatrixAt(0, this.dummy.matrix)
      this.bodies[i]!.instanceMatrix.needsUpdate = true
    }
  }
}
