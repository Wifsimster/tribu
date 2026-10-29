import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshToonMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PALETTE } from './palette'
import { loadModels } from './models'
import { BOAT_MODELS, VEHICLE_SCALE, headingYaw, vehicleGeometry } from './vehicles'

function tinted(geo: BufferGeometry, color: Color, x = 0, y = 0, z = 0): BufferGeometry {
  geo.translate(x, y, z)
  const n = geo.attributes.position!.count
  const rgb = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = color.r
    rgb[i * 3 + 1] = color.g
    rgb[i * 3 + 2] = color.b
  }
  geo.setAttribute('color', new BufferAttribute(rgb, 3))
  return geo
}

type State = 'hidden' | 'out' | 'in'

const SPEED = 4.2
const RANGE = 26

const TIER_SCALE = BOAT_MODELS.map((id) => VEHICLE_SCALE[id])
const RIDER_K = 2.4
const MOOR_GAP = 0.3

export class ExpeditionBoat {
  readonly group = new Group()
  private readonly tiers: Mesh[] = []
  private readonly sail: Mesh
  private readonly rider: Mesh
  private state: State = 'hidden'
  private t = 0
  private from = new Vector3()
  private to = new Vector3()
  private dockedFlag = false
  private readonly modelled = [false, false, false, false, false, false]
  private tier = 0

  constructor() {
    const mat = new MeshToonMaterial({ vertexColors: true })
    const wood = PALETTE.trunk
    const woodDark = new Color('#5f4229')
    const skin = PALETTE.skin
    const cloth = PALETTE.cloth

    const raft: BufferGeometry[] = []
    for (let i = 0; i < 4; i++)
      raft.push(tinted(new CylinderGeometry(0.11, 0.11, 1.5, 6).rotateX(Math.PI / 2), i % 2 ? wood : woodDark, -0.34 + i * 0.23, 0.1, 0))
    raft.push(tinted(new CylinderGeometry(0.05, 0.05, 0.95, 5).rotateZ(Math.PI / 2), woodDark, 0, 0.22, 0.55))
    raft.push(tinted(new CylinderGeometry(0.05, 0.05, 0.95, 5).rotateZ(Math.PI / 2), woodDark, 0, 0.22, -0.55))
    raft.push(tinted(new CylinderGeometry(0.03, 0.04, 1.5, 5).rotateZ(0.5), wood, 0.4, 0.7, 0.1))

    const canoe: BufferGeometry[] = [
      tinted(new SphereGeometry(0.5, 9, 7).scale(2.0, 0.5, 0.62), woodDark, 0, 0.22, 0),
      tinted(new SphereGeometry(0.44, 9, 7).scale(1.9, 0.32, 0.5), new Color('#8a6242'), 0, 0.36, 0),
      tinted(new CylinderGeometry(0.03, 0.03, 1.0, 5).rotateZ(0.9), wood, 0.35, 0.55, 0.2),
      tinted(new BoxGeometry(0.06, 0.24, 0.14), woodDark, 0.75, 0.32, 0.38),
    ]
    for (const g of canoe) g.scale(1.2, 1.2, 1.2)

    const boat: BufferGeometry[] = [
      tinted(new BoxGeometry(1.6, 0.3, 0.66), wood, 0, 0.2, 0),
      tinted(new BoxGeometry(0.4, 0.26, 0.52).rotateZ(0.45), new Color('#a5794f'), 0.85, 0.33, 0),
      tinted(new BoxGeometry(0.4, 0.26, 0.52).rotateZ(-0.45), new Color('#a5794f'), -0.85, 0.33, 0),
      tinted(new CylinderGeometry(0.04, 0.05, 1.35, 6), wood, 0, 1.0, 0),
      tinted(new CylinderGeometry(0.03, 0.03, 0.9, 5).rotateX(Math.PI / 2), wood, 0, 1.55, 0),
    ]
    for (const g of boat) g.scale(1.3, 1.3, 1.3)

    const cream = new Color('#efe4c8')
    const caravel: BufferGeometry[] = [
      tinted(new BoxGeometry(2.1, 0.42, 0.8), woodDark, 0, 0.26, 0),
      tinted(new BoxGeometry(0.5, 0.36, 0.62).rotateZ(0.5), wood, 1.15, 0.44, 0),
      tinted(new BoxGeometry(0.6, 0.5, 0.7), wood, -0.85, 0.55, 0),
      tinted(new CylinderGeometry(0.05, 0.06, 1.7, 6), wood, 0.25, 1.2, 0),
      tinted(new CylinderGeometry(0.04, 0.05, 1.3, 6), wood, -0.7, 1.15, 0),
      tinted(new BoxGeometry(0.92, 0.7, 0.03), cream, 0.25, 1.35, 0),
      tinted(new BoxGeometry(0.7, 0.55, 0.03), cream, -0.7, 1.25, 0),
    ]
    for (const g of caravel) g.scale(1.8, 1.8, 1.8)
    const hullGrey = new Color('#5e6a72')
    const steam: BufferGeometry[] = [
      tinted(new BoxGeometry(2.2, 0.4, 0.85), hullGrey, 0, 0.26, 0),
      tinted(new BoxGeometry(1.1, 0.35, 0.6), new Color('#c9cdd2'), 0.1, 0.6, 0),
      tinted(new CylinderGeometry(0.09, 0.12, 0.6, 7), new Color('#33383e'), -0.45, 0.95, 0),
      tinted(new CylinderGeometry(0.3, 0.3, 0.08, 10).rotateX(Math.PI / 2), woodDark, 0.75, 0.4, 0.48),
      tinted(new CylinderGeometry(0.3, 0.3, 0.08, 10).rotateX(Math.PI / 2), woodDark, 0.75, 0.4, -0.48),
      tinted(new SphereGeometry(0.14, 6, 5), new Color('#b9c2c6'), -0.45, 1.35, 0),
      tinted(new SphereGeometry(0.1, 6, 5), new Color('#c9d0d3'), -0.6, 1.55, 0.05),
    ]
    for (const g of steam) g.scale(2, 2, 2)
    const motor: BufferGeometry[] = [
      tinted(new BoxGeometry(2.0, 0.3, 0.7), new Color('#f2f4f0'), 0, 0.24, 0),
      tinted(new BoxGeometry(0.55, 0.28, 0.55).rotateZ(0.35), new Color('#f2f4f0'), 1.1, 0.34, 0),
      tinted(new BoxGeometry(0.6, 0.3, 0.5), new Color('#3f6d8a'), 0.05, 0.52, 0),
      tinted(new BoxGeometry(0.06, 0.24, 0.4).rotateZ(-0.35), new Color('#cfe2ec'), 0.4, 0.6, 0),
      tinted(new BoxGeometry(0.2, 0.3, 0.18), new Color('#33383e'), -1.0, 0.35, 0),
      tinted(new BoxGeometry(0.5, 0.05, 0.6), new Color('#c96f4e'), -0.3, 0.42, 0),
    ]
    for (const g of motor) g.scale(1.4, 1.4, 1.4)

    for (const parts of [raft, canoe, boat, caravel, steam, motor]) {
      const m = new Mesh(mergeGeometries(parts) ?? new BufferGeometry(), mat)
      m.castShadow = true
      m.visible = false
      m.scale.setScalar(TIER_SCALE[this.tiers.length]!)
      this.tiers.push(m)
      this.group.add(m)
    }

    const sailGeo = new PlaneGeometry(0.8, 0.85, 1, 5)
    const stripes = new Float32Array(sailGeo.attributes.position!.count * 3)
    const a = new Color('#f2e8d0')
    const bC = new Color('#c96f4e')
    for (let i = 0; i < sailGeo.attributes.position!.count; i++) {
      const y = sailGeo.attributes.position!.getY(i)
      const c = Math.floor((y + 0.45) * 5) % 2 === 0 ? a : bC
      stripes[i * 3] = c.r
      stripes[i * 3 + 1] = c.g
      stripes[i * 3 + 2] = c.b
    }
    sailGeo.setAttribute('color', new BufferAttribute(stripes, 3))
    this.sail = new Mesh(sailGeo, new MeshToonMaterial({ vertexColors: true, side: DoubleSide }))
    this.sail.scale.setScalar(1.3 * TIER_SCALE[2]!)
    this.sail.position.set(0, 1.47 * TIER_SCALE[2]!, 0)
    this.sail.visible = false
    this.group.add(this.sail)

    const rider = new Mesh(
      mergeGeometries([
        tinted(new CapsuleGeometry(0.14, 0.2, 3, 7), cloth, 0, 0.5, 0),
        tinted(new SphereGeometry(0.12, 8, 6), skin, 0, 0.78, 0),
        tinted(new SphereGeometry(0.125, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5), new Color('#3d2a1e'), 0, 0.8, 0),
      ]) ?? new BufferGeometry(),
      mat,
    )
    rider.scale.setScalar(RIDER_K)
    rider.castShadow = true
    this.rider = rider
    this.group.add(rider)

    this.group.visible = false
  }

  private static readonly RIDER_Y = [0.1, 0.15, 0.2, 0.59, 0.66, 0.29]
  private static readonly RIDER_Y_MODEL = [0.1, 0.15, 0.2, 0.78, 0.7, 0.29]

  setTier(tier: number): void {
    const t = Math.min(tier, 5)
    this.tier = t
    this.tiers.forEach((m, i) => (m.visible = i === t))
    this.sail.visible = t === 2
    this.seat()
    if (this.state === 'hidden') this.dock()
    const id = BOAT_MODELS[t]!
    void loadModels([id]).then(() => this.adopt(t))
  }

  private seat(): void {
    const t = this.tier
    const k = TIER_SCALE[t]!
    const deck = (this.modelled[t] ? ExpeditionBoat.RIDER_Y_MODEL : ExpeditionBoat.RIDER_Y)[t]!
    this.rider.position.set(-0.2 * k, deck * k, 0)
  }

  private stern(): number {
    const mesh = this.tiers[this.tier]!
    mesh.geometry.computeBoundingBox()
    return -(mesh.geometry.boundingBox?.min.x ?? 0) * mesh.scale.x
  }

  private half(): { l: number; w: number } {
    const mesh = this.tiers[this.tier]!
    mesh.geometry.computeBoundingBox()
    const b = mesh.geometry.boundingBox!
    const k = mesh.scale.x
    return { l: Math.max(b.max.x, -b.min.x) * k, w: Math.max(b.max.z, -b.min.z) * k }
  }

  private adopt(t: number): void {
    if (this.modelled[t]) return
    const geo = vehicleGeometry(BOAT_MODELS[t]!)
    if (!geo) return
    const mesh = this.tiers[t]!
    mesh.geometry.dispose()
    mesh.geometry = geo
    this.modelled[t] = true
    if (t !== this.tier) return
    this.seat()
    if (this.state === 'hidden') this.dock()
  }

  private moor: { x: number; z: number; yaw: number } | null = null

  moorAt(spot: { x: number; z: number; yaw: number } | null): void {
    this.moor = spot
    if (this.state === 'hidden') this.dock()
  }

  private dock(): void {
    if (!this.moor) {
      this.group.visible = false
      return
    }
    const off = this.stern() + MOOR_GAP
    this.group.position.set(
      this.moor.x + Math.sin(this.moor.yaw) * off,
      0,
      this.moor.z + Math.cos(this.moor.yaw) * off,
    )
    this.group.rotation.y = headingYaw(Math.sin(this.moor.yaw), Math.cos(this.moor.yaw))
    this.group.visible = true
  }

  get active(): boolean {
    return this.state !== 'hidden'
  }

  consumeDocked(): boolean {
    const d = this.dockedFlag
    this.dockedFlag = false
    return d
  }

  private launchOffset(shore: Vector3, dir: Vector3, isLand?: (x: number, z: number) => boolean): number {
    const { l, w } = this.half()
    if (!isLand) return 1.6 + l
    const m = 0.3
    for (let o = 1.6; o < RANGE; o += 0.25) {
      const cx = shore.x + dir.x * o
      const cz = shore.z + dir.z * o
      let wet = true
      for (let u = -l - m; u <= l + m && wet; u += 0.5)
        for (let v = -w - m; v <= w + m; v += 0.5)
          if (isLand(cx + dir.x * u - dir.z * v, cz + dir.z * u + dir.x * v)) {
            wet = false
            break
          }
      if (wet) return o
    }
    return 1.6 + l
  }

  private course(shore: Vector3, outward: boolean, isLand?: (x: number, z: number) => boolean): void {
    const dir = new Vector3(shore.x, 0, shore.z).normalize()
    const o = this.launchOffset(shore, dir, isLand)
    const near = new Vector3(shore.x + dir.x * o, 0, shore.z + dir.z * o)
    const far = new Vector3(shore.x + dir.x * RANGE, 0, shore.z + dir.z * RANGE)
    this.from.copy(outward ? near : far)
    this.to.copy(outward ? far : near)
    this.state = outward ? 'out' : 'in'
    this.t = 0
    this.group.visible = true
    this.group.position.copy(this.from)
  }

  launchOut(shore: Vector3, isLand?: (x: number, z: number) => boolean): void {
    this.course(shore, true, isLand)
  }

  sailIn(shore: Vector3, isLand?: (x: number, z: number) => boolean): void {
    this.course(shore, false, isLand)
  }

  update(dt: number, time: number): void {
    if (this.state === 'hidden') {
      if (this.moor && this.group.visible) {
        this.group.position.y = Math.sin(time * 1.5) * 0.035
        this.group.rotation.z = Math.sin(time * 1.1) * 0.03
      }
      return
    }
    const dist = this.from.distanceTo(this.to)
    this.t += (SPEED * dt) / dist
    const k = Math.min(1, this.t)
    const e = k * k * (3 - 2 * k)
    this.group.position.lerpVectors(this.from, this.to, e)
    const dx = this.to.x - this.from.x
    const dz = this.to.z - this.from.z
    this.group.rotation.y = headingYaw(dx, dz)

    this.group.position.y = Math.sin(time * 1.8) * 0.05
    this.group.rotation.z = Math.sin(time * 1.4) * 0.04

    if (k >= 1) {
      if (this.state === 'in') this.dockedFlag = true
      this.state = 'hidden'
      this.dock()
    }
  }
}
