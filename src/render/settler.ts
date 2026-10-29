import {
  BackSide,
  BoxGeometry,
  DodecahedronGeometry,
  TorusGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  Object3D,
  Quaternion,
  Euler,
  SphereGeometry,
  Vector3,
} from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PALETTE } from './palette'
import { CAMP_BLOCKERS, CAMP_FIRE, CAMP_HOME } from './village'
import { GROUND_Y, type Island } from './island'
import { follow, type Ground, type Pt } from './ground'
import RIG from './settler-rig.json'
import {
  NODES,
  carryGeometry,
  clipTime,
  eventsBetween,
  newPose,
  sampleClip,
  settlerClip,
  settlerTool,
  tintedTool,
  type Clip,
  type ClipName,
  type NodeName,
  type Pose,
} from './settler-clips'

type Phase = 'walkOut' | 'work' | 'walkHome' | 'deposit'
type Trip = 'none' | 'leaving' | 'away' | 'returning'

const TAU = Math.PI * 2

const C = {
  tunic: PALETTE.cloth,
  tunicDark: new Color('#a1543a'),
  fur: new Color('#f0e3cb'),
  bone: new Color('#efe6d2'),
  leather: new Color('#6f4c35'),
  leatherDark: new Color('#4c3425'),
  hair: new Color('#3d2a1e'),
  skin: PALETTE.skin,
  skinDark: new Color('#c88b5c'),
  flint: new Color('#cdd2d6'),
  shaft: PALETTE.trunk,
} as const

const OUTLINE = new MeshBasicMaterial({ color: 0x33261c, side: BackSide })
const SPARK = new MeshBasicMaterial({ color: 0xffffff })
const CHIP = { flint: new Color(0xfff0cf), leaf: new Color('#79b04a'), straw: new Color('#ecd170') } as const
const EMPTY = new BufferGeometry()

const FIRE_WARM = new Color('#ff8a34')
const FIRE_REACH = 5.4

const DEPOSIT = 2.1

const BODY_R = 0.3

const PIVOT = Object.fromEntries(Object.entries(RIG.nodes).map(([k, v]) => [k, v.pivot])) as Record<NodeName, number[]>
const REST = Object.fromEntries(
  NODES.map((n) => {
    const r = (RIG.nodes[n] as { rest?: number[] }).rest ?? [0, 0, 0]
    return [n, new Quaternion().setFromEuler(new Euler(r[0], r[1], r[2]))]
  }),
) as Record<NodeName, Quaternion>
const HIP_Y = PIVOT.body[1]!
const SHOULDER_Y = PIVOT.armR[1]!
const HEAD_Y = PIVOT.head[1]!
const FINGERS = new Vector3().fromArray(RIG.points.fingers.at)

const FADE_MIN = 0.15
const FADE_RATE = 1.6
const CLIP_REACH = 0.6

const smooth = (x: number) => x * x * (3 - 2 * x)
const MIX_Q = new Quaternion()

function part(source: BufferGeometry, color: Color, x = 0, y = 0, z = 0): BufferGeometry {
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
  return geo
}

function weld(parts: BufferGeometry[]): BufferGeometry {
  return mergeGeometries(parts) ?? new BufferGeometry()
}

interface Pair {
  detail: BufferGeometry[]
  hull: BufferGeometry[]
}

function outlineOf(g: BufferGeometry, thickness: number): Mesh {
  const pos = g.attributes.position!
  const nor = g.attributes.normal!
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) + nor.getX(i) * thickness,
      pos.getY(i) + nor.getY(i) * thickness,
      pos.getZ(i) + nor.getZ(i) * thickness,
    )
  }
  g.deleteAttribute('color')
  const mesh = new Mesh(g, OUTLINE)
  mesh.renderOrder = -1
  return mesh
}

export class Settler {
  readonly group = new Group()
  private readonly rig = new Group()
  private readonly skin = new MeshToonMaterial({ vertexColors: true })
  private readonly body: Mesh
  private readonly head: Mesh
  private readonly armL: Mesh
  private readonly armR: Mesh
  private readonly legL: Mesh
  private readonly legR: Mesh
  private readonly chips: InstancedMesh
  private readonly chipPos = new Float32Array(8 * 3)
  private readonly chipVel = new Float32Array(8 * 3)
  private readonly chipLife = new Float32Array(8)
  private readonly dummy = new Object3D()

  private phase: Phase = 'walkOut'
  private trip: Trip = 'none'
  private readonly board = new Vector3()
  private wantSleep = false
  private sleeping = false
  private lieDown = 0
  private timer = 0
  private walkCycle = 0
  private swing = 0
  private cheer = 0
  private yaw = 0
  private clock = 0
  private readonly home = new Vector3(0, 0, 0)
  private readonly shore = new Vector3(0, 0, 0)
  private destination = new Vector3(3, 0, 3)
  private speed = 2.9
  private ground: Ground | null = null
  private path: Pt[] = []
  private readonly pathGoal = new Vector3(Number.NaN, 0, Number.NaN)
  private pathRev = -1
  private readonly pathEnd = new Vector3()
  private pack!: Mesh
  private tool: Mesh | null = null

  private readonly toolR = new Object3D()
  private readonly toolL = new Object3D()
  private readonly prop = new Object3D()
  private readonly cast = new Object3D()
  private readonly leftMesh: Mesh
  private readonly propMesh: Mesh
  private readonly node: Record<NodeName, Object3D>
  private clipName: ClipName | null = null
  private play: { clip: Clip; e: number; from: Pose; fade: number } | null = null
  private out: { from: Pose; t: number; dur: number } | null = null
  private carryLevel = 0
  private carryMesh: Mesh | null = null
  private readonly scratch = newPose()

  constructor(island: Island) {
    this.body = this.limb(this.torsoGeometry(), 'body')
    this.head = this.limb(this.headGeometry(), 'head')
    this.armL = this.limb(this.armGeometry(false), 'armL')
    this.armR = this.limb(this.armGeometry(true), 'armR')
    this.legL = this.limb(this.legGeometry(), 'legL')
    this.legR = this.limb(this.legGeometry(), 'legR')

    this.body.castShadow = true
    this.head.castShadow = true
    this.legL.castShadow = this.legR.castShadow = true

    this.armR.add(this.toolR)
    this.armL.add(this.toolL)
    this.body.add(this.prop)
    this.rig.add(this.cast)
    this.leftMesh = new Mesh(EMPTY, this.skin)
    this.propMesh = new Mesh(EMPTY, this.skin)
    this.leftMesh.visible = this.propMesh.visible = false
    this.toolL.add(this.leftMesh)
    this.prop.add(this.propMesh)
    this.node = {
      body: this.body, head: this.head, armL: this.armL, armR: this.armR, legL: this.legL, legR: this.legR,
      toolR: this.toolR, toolL: this.toolL, prop: this.prop, cast: this.cast,
    }
    this.restPose()

    this.chips = new InstancedMesh(new IcosahedronGeometry(0.05, 0), SPARK, 8)
    this.chips.visible = false
    this.chips.frustumCulled = false
    for (let i = 0; i < 8; i++) this.chips.setColorAt(i, CHIP.flint)

    this.rig.scale.setScalar(1.32)
    this.group.add(this.rig, this.chips)
    this.group.position.set(2.5, GROUND_Y, 2.5)
    this.home.set(CAMP_HOME.x, GROUND_Y, CAMP_HOME.z)

    this.pack = this.buildPack()
    this.body.add(this.pack)

    let best = Infinity
    for (const c of island.cells) {
      if (!c.beach) continue
      const d = (c.x - CAMP_HOME.x) ** 2 + (c.z - CAMP_HOME.z) ** 2
      if (d < best) {
        best = d
        this.shore.set(c.x, GROUND_Y, c.z)
      }
    }
  }

  private buildPack(): Mesh {
    const basket = new Mesh(
      weld([
        part(new ConeGeometry(0.19, 0.42, 7).rotateX(Math.PI), C.leather, 0, 0.1, -0.3),
        part(new CylinderGeometry(0.2, 0.16, 0.09, 7), C.bone, 0, 0.3, -0.3),
        part(new SphereGeometry(0.07, 6, 5), C.tunicDark, -0.07, 0.4, -0.3),
        part(new SphereGeometry(0.06, 6, 5), C.flint, 0.08, 0.38, -0.28),
        part(new BoxGeometry(0.05, 0.4, 0.03).rotateZ(0.5), C.leatherDark, 0.08, 0.22, -0.12),
        part(new BoxGeometry(0.05, 0.4, 0.03).rotateZ(-0.5), C.leatherDark, -0.08, 0.22, -0.12),
      ]),
      this.skin,
    )
    basket.visible = false
    return basket
  }

  departExpedition(hasPack: boolean, target?: { x: number; z: number }): void {
    this.pack.visible = hasPack
    const from = this.capture(newPose())
    this.wake()
    this.out = { from, t: 0, dur: -1 }
    this.board.set(target?.x ?? this.shore.x, this.shore.y, target?.z ?? this.shore.z)
    this.trip = 'leaving'
    this.refreshCarry()
  }

  wake(): void {
    this.wantSleep = false
    this.sleeping = false
    this.lieDown = 0
    this.rig.rotation.z = 0
    this.rig.position.y = 0
    this.rig.scale.setScalar(RIG.scale)
    this.play = null
    this.out = null
    this.restPose()
    this.phase = 'walkOut'
  }

  private restPose(): void {
    for (const n of NODES) {
      this.node[n].position.fromArray(PIVOT[n])
      this.node[n].quaternion.copy(REST[n])
    }
  }

  private capture(into: Pose): Pose {
    for (const n of NODES) {
      into[n].p.copy(this.node[n].position)
      into[n].q.copy(this.node[n].quaternion)
    }
    return into
  }

  private applyPose(pose: Pose): void {
    for (const n of NODES) {
      this.node[n].position.copy(pose[n].p)
      this.node[n].quaternion.copy(pose[n].q)
    }
  }

  private static mix(from: Pose, to: Pose, w: number): void {
    for (const n of NODES) {
      to[n].p.lerpVectors(from[n].p, to[n].p, w)
      MIX_Q.slerpQuaternions(from[n].q, to[n].q, w)
      to[n].q.copy(MIX_Q)
    }
  }

  private static gap(a: Pose, b: Pose): number {
    let g = 0
    for (const n of NODES) g = Math.max(g, a[n].q.angleTo(b[n].q))
    return g
  }

  setClip(name: ClipName | null): void {
    if (name === this.clipName) return
    this.clipName = name
    if (this.play && this.play.clip.name !== name) this.stopClip()
    this.carryLevel = 0
    this.refreshCarry()
  }

  useModels(): void {
    this.toolKey = ''
    this.refreshCarry()
  }

  poseClip(name: ClipName, t: number): boolean {
    const clip = settlerClip(name)
    if (!clip) return false
    this.applyPose(sampleClip(clip, t, this.scratch))
    return true
  }

  get carry(): { level: number; visible: boolean } {
    return { level: this.carryLevel, visible: this.leftMesh.visible || this.propMesh.visible }
  }

  private startClip(): boolean {
    const clip = this.clipName ? settlerClip(this.clipName) : null
    if (!clip) return false
    const from = this.capture(newPose())
    const fade = Math.max(FADE_MIN, Settler.gap(from, sampleClip(clip, 0, this.scratch)) / FADE_RATE)
    this.play = { clip, e: 0, from, fade }
    this.out = null
    this.timer = clip.length
    const dx = this.destination.x - this.group.position.x
    const dz = this.destination.z - this.group.position.z
    if (Math.hypot(dx, dz) > 0.05) this.yaw = Math.atan2(dx, dz)
    return true
  }

  private stopClip(): void {
    if (!this.play) return
    const from = this.capture(newPose())
    this.play = null
    this.restPose()
    this.out = { from, t: 0, dur: -1 }
  }

  private playClip(dt: number): void {
    const p = this.play!
    const e0 = p.e
    p.e += dt
    const pose = sampleClip(p.clip, clipTime(p.clip, p.e), this.scratch)
    if (p.e < p.fade) Settler.mix(p.from, pose, smooth(p.e / p.fade))
    this.applyPose(pose)
    for (const ev of eventsBetween(p.clip, e0, p.e)) {
      if (ev.name === 'strike') this.strike(p.clip.tool === 'hand' ? CHIP.leaf : CHIP.straw, this.tipPoint(p.clip.tool))
      else if (ev.name === 'fill') {
        this.carryLevel = Math.min(3, this.carryLevel + 1)
        this.refreshCarry()
      }
    }
  }

  private blendOut(dt: number): void {
    const o = this.out
    if (!o) return
    const now = this.capture(this.scratch)
    if (o.dur < 0) o.dur = Math.max(FADE_MIN, Settler.gap(o.from, now) / FADE_RATE)
    o.t += dt
    const w = Math.min(1, o.t / o.dur)
    if (w >= 1) {
      this.out = null
      return
    }
    Settler.mix(o.from, now, smooth(w))
    this.applyPose(now)
  }

  private tipPoint(tool: string): Vector3 {
    const tip = settlerTool(tool)?.tip ?? FINGERS
    this.group.updateMatrixWorld(true)
    return this.group.worldToLocal(this.toolR.localToWorld(tip.clone()))
  }

  private refreshCarry(): void {
    this.leftMesh.visible = this.propMesh.visible = false
    this.carryMesh = null
    const clip = this.clipName ? settlerClip(this.clipName) : null
    if (!clip || this.trip !== 'none') return
    const geo = carryGeometry(clip.carry.kind, this.carryLevel)
    if (!geo) return
    const mesh = clip.carry.node === 'toolL' ? this.leftMesh : this.propMesh
    mesh.geometry = geo
    this.carryMesh = mesh
    this.showCarry()
  }

  private showCarry(): void {
    if (this.carryMesh) this.carryMesh.visible = !this.sleeping && this.lieDown === 0
  }

  setNight(night: boolean): void {
    this.wantSleep = night
  }

  get isSleeping(): boolean {
    return this.sleeping
  }

  get isAway(): boolean {
    return this.trip === 'away'
  }

  get shorePoint(): Vector3 {
    return this.shore
  }

  returnFromExpedition(): void {
    if (this.trip === 'leaving' || this.trip === 'away') {
      this.group.visible = true
      this.group.position.set(this.board.x, this.board.y, this.board.z)
      this.trip = 'returning'
    }
  }

  private limb(pair: Pair, name: NodeName): Mesh {
    const mesh = new Mesh(weld(pair.detail), this.skin)
    mesh.position.fromArray(PIVOT[name])
    mesh.add(outlineOf(weld(pair.hull), 0.038))
    this.rig.add(mesh)
    return mesh
  }

  private torsoGeometry(): Pair {
    const shell = part(new CylinderGeometry(0.28, 0.21, 0.5, 9).scale(1.14, 1, 0.82), C.tunic, 0, 0.25, 0)
    const collar = part(new CylinderGeometry(0.33, 0.28, 0.14, 11).scale(1.08, 1, 0.86), C.fur, 0, 0.49, 0)
    return {
      detail: [
        shell,
        collar,
        part(new SphereGeometry(0.19, 9, 7).scale(1.14, 0.7, 0.82), C.tunic, 0, 0.46, 0),
        part(new CylinderGeometry(0.25, 0.25, 0.08, 9).scale(1.14, 1, 0.86), C.leatherDark, 0, 0.06, 0),
        part(new BoxGeometry(0.09, 0.62, 0.05).rotateZ(0.42), C.bone, 0.01, 0.28, 0.21),
        part(new BoxGeometry(0.17, 0.15, 0.11), C.leather, -0.27, 0.1, 0.06),
        part(new CylinderGeometry(0.1, 0.12, 0.12, 7), C.skinDark, 0, 0.55, 0),
      ],
      hull: [shell, collar],
    }
  }

  private headGeometry(): Pair {
    const skull = part(new SphereGeometry(0.235, 12, 10).scale(1, 0.98, 0.94), C.skin)
    const hair = part(
      new SphereGeometry(0.247, 12, 8, 0, TAU, 0, Math.PI * 0.52).rotateX(-0.2),
      C.hair,
      0,
      0.01,
      0,
    )
    const feather = part(
      new ConeGeometry(0.042, 0.4, 5).rotateX(0.7).rotateZ(-0.24),
      C.fur,
      -0.11,
      0.3,
      -0.15,
    )
    return {
      detail: [
        skull,
        hair,
        feather,
        part(new CylinderGeometry(0.248, 0.248, 0.06, 12, 1, true), C.tunicDark, 0, 0.07, 0),
        part(new SphereGeometry(0.135, 9, 7).scale(1, 0.85, 0.75), C.hair, 0, -0.13, 0.11),
        part(new SphereGeometry(0.036, 6, 5), C.hair, -0.085, 0.035, 0.215),
        part(new SphereGeometry(0.036, 6, 5), C.hair, 0.085, 0.035, 0.215),
        part(new SphereGeometry(0.045, 6, 5), C.skinDark, 0, -0.025, 0.232),
      ],
      hull: [skull, hair, feather],
    }
  }

  private armGeometry(spear: boolean): Pair {
    const limb = part(new CapsuleGeometry(0.073, 0.3, 3, 7), C.skin, 0, -0.21, 0)
    const hand = part(new SphereGeometry(0.088, 8, 6), C.skinDark, 0, -0.42, 0)
    const detail = [
      limb,
      hand,
      part(new CylinderGeometry(0.098, 0.088, 0.17, 8), C.tunic, 0, -0.07, 0),
      part(new CylinderGeometry(0.092, 0.092, 0.06, 8), C.bone, 0, -0.32, 0),
    ]
    const hull = [limb, hand]
    void spear
    return { detail, hull }
  }

  private toolKey = ''

  setTool(kind: 'hand' | 'spear' | 'sickle' | 'scythe' | 'axe' | 'pick' | 'rod', tier: number): void {
    const model = kind === 'sickle' || kind === 'scythe' ? settlerTool(kind) : null
    const key = kind + tier + (model ? '+' : '')
    if (key === this.toolKey) return
    this.toolKey = key
    if (this.tool) {
      this.toolR.remove(this.tool)
      this.tool.geometry.dispose()
      this.tool = null
    }
    if (kind === 'hand') return
    const edge =
      tier >= 3 ? new Color('#c3cedd') : tier >= 2 ? new Color('#8f959e') : tier >= 1 ? new Color('#c98a4b') : C.flint
    if (model) {
      this.tool = new Mesh(tintedTool(model, edge), this.skin)
      this.tool.castShadow = true
      this.toolR.add(this.tool)
      return
    }
    const parts: BufferGeometry[] = []
    switch (kind) {
      case 'spear': {
        parts.push(part(new CylinderGeometry(0.026, 0.031, 1.32, 6).rotateX(-0.24), C.shaft, 0, 0.12, 0.03))
        parts.push(part(new ConeGeometry(0.068, 0.26, 5).rotateX(Math.PI - 0.24), edge, 0, -0.63, 0.18))
        parts.push(part(new CylinderGeometry(0.036, 0.036, 0.05, 6).rotateX(-0.24), C.bone, 0, -0.48, 0.14))
        break
      }
      case 'sickle': {
        parts.push(part(new CylinderGeometry(0.024, 0.028, 0.34, 6), C.shaft, 0, 0.05, 0))
        parts.push(part(new TorusGeometry(0.12, 0.028, 5, 8, Math.PI * 1.2).rotateZ(0.5), edge, 0.02, 0.28, 0))
        break
      }
      case 'scythe': {
        parts.push(part(new CylinderGeometry(0.026, 0.03, 1.35, 6).rotateX(-0.28), C.shaft, 0, 0.62, -0.19))
        parts.push(part(new BoxGeometry(0.6, 0.03, 0.09).rotateY(0.3), edge, -0.28, 1.28, -0.38))
        break
      }
      case 'axe': {
        parts.push(part(new CylinderGeometry(0.028, 0.034, 0.52, 6), C.shaft, 0, 0.1, 0))
        parts.push(part(new BoxGeometry(0.2, 0.11, 0.05).rotateZ(0.08), edge, 0.1, 0.32, 0))
        parts.push(part(new CylinderGeometry(0.04, 0.04, 0.06, 6), C.bone, 0, 0.26, 0))
        break
      }
      case 'rod': {
        parts.push(part(new CylinderGeometry(0.016, 0.026, 1.5, 5).rotateX(-0.85), C.shaft, 0, 0.32, 0.42))
        parts.push(part(new CylinderGeometry(0.006, 0.006, 0.72, 3), C.bone, 0, 0.32, 1.0))
        break
      }
      case 'pick': {
        if (tier === 0) {
          parts.push(part(new DodecahedronGeometry(0.09, 0), PALETTE.rock, 0, 0.02, 0))
        } else {
          parts.push(part(new CylinderGeometry(0.028, 0.034, 0.5, 6), C.shaft, 0, 0.1, 0))
          parts.push(part(new ConeGeometry(0.05, 0.22, 5).rotateZ(-Math.PI / 2), edge, 0.16, 0.32, 0))
          parts.push(part(new ConeGeometry(0.05, 0.16, 5).rotateZ(Math.PI / 2), edge, -0.12, 0.32, 0))
        }
        break
      }
    }
    this.tool = new Mesh(weld(parts), this.skin)
    this.tool.castShadow = true
    this.toolR.add(this.tool)
  }

  private legGeometry(): Pair {
    const limb = part(new CapsuleGeometry(0.087, 0.22, 3, 7), C.leather, 0, -0.2, 0)
    const foot = part(new BoxGeometry(0.17, 0.1, 0.25), C.leatherDark, 0, -0.39, 0.04)
    return {
      detail: [
        limb,
        foot,
        part(new CylinderGeometry(0.096, 0.096, 0.055, 8), C.bone, 0, -0.29, 0),
      ],
      hull: [limb, foot],
    }
  }

  setHome(_p: Vector3): void {
    this.home.set(CAMP_HOME.x, GROUND_Y, CAMP_HOME.z)
  }

  goalGone(nodes: ReadonlyMap<string, readonly { x: number; z: number }[]>): boolean {
    if (this.trip !== 'none') return false
    for (const spots of nodes.values())
      for (const s of spots) if (Math.hypot(s.x - this.destination.x, s.z - this.destination.z) < 0.01) return false
    return true
  }

  sendTo(p: Vector3): void {
    this.destination.set(p.x, 0, p.z)
    for (const b of this.extra) {
      const dx = this.destination.x - b.x
      const dz = this.destination.z - b.z
      const d = Math.hypot(dx, dz)
      if (d >= b.r + 0.3) continue
      const k = (b.r + 0.3) / Math.max(d, 1e-3)
      this.destination.set(b.x + (d > 1e-3 ? dx * k : b.r + 0.3), 0, b.z + (d > 1e-3 ? dz * k : 0))
    }
    this.stopClip()
    this.phase = 'walkOut'
  }

  private extra: readonly { x: number; z: number; r: number }[] = []
  setBlockers(extra: readonly { x: number; z: number; r: number }[]): void {
    this.extra = extra
  }

  setGround(ground: Ground | null): void {
    this.ground = ground
    this.pathRev = -1
  }

  private walkToward(goal: Vector3, step: number, arrive: number): number {
    const pos = this.group.position
    const g = this.ground
    if (!g) {
      const dx = goal.x - pos.x
      const dz = goal.z - pos.z
      const dist = Math.hypot(dx, dz)
      if (dist < arrive) return 0
      const k = Math.min(step, dist) / dist
      pos.x += dx * k
      pos.z += dz * k
      this.yaw = Math.atan2(dx, dz)
      return dist
    }
    if (g.clearAt(pos.x, pos.z) < 0) {
      const out = g.nearestFree(pos.x, pos.z, BODY_R, 8)
      if (out) {
        pos.x = out.x
        pos.z = out.z
        this.pathRev = -1
      }
    }
    if (this.pathRev !== g.revision) {
      const main = g.mainComponent(BODY_R)
      if (g.componentAt(pos.x, pos.z, BODY_R) !== main) {
        const out = g.nearestIn(pos.x, pos.z, BODY_R, main, 6) ?? g.nearestIn(pos.x, pos.z, BODY_R, main, 20)
        if (out) {
          pos.x = out.x
          pos.z = out.z
        }
      }
    }
    const stale =
      this.pathRev !== g.revision ||
      goal.x !== this.pathGoal.x ||
      goal.z !== this.pathGoal.z ||
      (this.path.length === 0 && Math.hypot(this.pathEnd.x - pos.x, this.pathEnd.z - pos.z) > 0.6)
    if (stale) {
      const at = g.nearestFree(goal.x, goal.z, BODY_R, 8) ?? { x: goal.x, z: goal.z }
      const r = g.route(pos.x, pos.z, at.x, at.z, BODY_R)
      this.path = r.pts
      const end = r.pts[r.pts.length - 1]
      this.pathEnd.set(end ? end.x : pos.x, 0, end ? end.z : pos.z)
      this.pathGoal.set(goal.x, 0, goal.z)
      this.pathRev = g.revision
    }
    const left = this.path.length === 0 ? 0 : Math.hypot(this.path[this.path.length - 1]!.x - pos.x, this.path[this.path.length - 1]!.z - pos.z)
    if (this.path.length === 0 || (this.path.length === 1 && left < arrive)) {
      this.path.length = 0
      return 0
    }
    const dir = follow(pos, this.path, step)
    if (dir) this.yaw = Math.atan2(dir.dx, dir.dz)
    return Math.max(1e-3, left)
  }

  celebrate(): void {
    this.timer = Math.min(this.timer, 0.2)
    this.walkCycle += 3
    this.cheer = 1
  }

  update(dt: number, boost: number): void {
    if (this.out) this.restPose()
    this.advance(dt, boost)
    this.blendOut(dt)
    this.showCarry()
  }

  private advance(dt: number, boost: number): void {
    if (this.trip !== 'none') {
      this.stopClip()
      this.updateTrip(dt, boost)
      return
    }
    if (this.wantSleep || this.sleeping || this.lieDown > 0) {
      this.stopClip()
      if (this.updateSleep(dt)) return
    }
    const g = this.ground
    if (g && g.clearAt(this.group.position.x, this.group.position.z) < 0) {
      const out = g.nearestFree(this.group.position.x, this.group.position.z, BODY_R, 8)
      if (out) {
        this.group.position.x = out.x
        this.group.position.z = out.z
        this.pathRev = -1
      }
    }
    const speed = this.speed * boost
    switch (this.phase) {
      case 'walkOut':
      case 'walkHome': {
        const goal = this.phase === 'walkOut' ? this.destination : this.home
        const reach = this.phase === 'walkOut' && this.clipName && settlerClip(this.clipName) ? CLIP_REACH : 0.35
        if (this.walkToward(goal, speed * dt, reach) === 0) {
          this.phase = this.phase === 'walkOut' ? 'work' : 'deposit'
          this.timer = this.phase === 'work' ? 2.6 : DEPOSIT
          if (this.phase === 'work') this.startClip()
          else {
            this.carryLevel = 0
            this.refreshCarry()
            this.onDeposit?.()
          }
          break
        }
        this.walkCycle += dt * speed * 2.6
        this.animateWalk()
        break
      }
      case 'work': {
        this.timer -= dt * boost
        if (this.play) this.playClip(dt * boost)
        else this.animateWork(dt * boost)
        if (this.timer <= 0) {
          this.phase = 'walkHome'
          this.stopClip()
        }
        break
      }
      case 'deposit': {
        this.timer -= dt * boost
        this.animateDeposit()
        this.yaw = Math.atan2(
          CAMP_FIRE.x - this.group.position.x,
          CAMP_FIRE.z - this.group.position.z,
        )
        if (this.timer <= 0) this.phase = 'walkOut'
        break
      }
    }

    let d = this.yaw - this.group.rotation.y
    while (d > Math.PI) d -= TAU
    while (d < -Math.PI) d += TAU
    this.group.rotation.y += d * Math.min(1, dt * 9)

    if (this.cheer > 0) {
      this.cheer = Math.max(0, this.cheer - dt * 1.3)
      const k = 1 - this.cheer
      this.rig.position.y = Math.sin(k * Math.PI) * 0.3
      this.rig.rotation.y = this.cheer * this.cheer * TAU
    } else {
      this.rig.position.y = 0
      this.rig.rotation.y = 0
    }

    this.updateChips(dt)
    this.skirtCamp()
    this.takeFirelight(dt)

    this.group.position.y += (GROUND_Y - this.group.position.y) * Math.min(1, dt * 8)
  }

  private takeFirelight(dt: number): void {
    this.clock += dt
    const d = Math.hypot(
      this.group.position.x - CAMP_FIRE.x,
      this.group.position.z - CAMP_FIRE.z,
    )
    const k = Math.max(0, 1 - d / FIRE_REACH) ** 1.6
    const flicker = 0.88 + Math.sin(this.clock * 9) * 0.08 + Math.sin(this.clock * 5.1) * 0.04
    this.skin.emissive.copy(FIRE_WARM).multiplyScalar(k * 0.15 * flicker)
  }

  private updateSleep(dt: number): boolean {
    this.clock += dt

    if (this.wantSleep && !this.sleeping) {
      if (this.walkToward(this.home, this.speed * dt, 0.45) > 0) {
        this.walkCycle += dt * this.speed * 2.6
        this.animateWalk()
        let d = this.yaw - this.group.rotation.y
        while (d > Math.PI) d -= TAU
        while (d < -Math.PI) d += TAU
        this.group.rotation.y += d * Math.min(1, dt * 9)
        this.skirtCamp()
        this.group.position.y += (GROUND_Y - this.group.position.y) * Math.min(1, dt * 8)
        return true
      }
      this.sleeping = true
    }

    const target = this.sleeping ? 1 : 0
    this.lieDown += (target - this.lieDown) * Math.min(1, dt * 3)
    if (!this.sleeping && this.lieDown < 0.02) {
      this.lieDown = 0
      this.rig.rotation.z = 0
      this.rig.position.y = 0
      this.phase = 'walkOut'
      return false
    }

    const k = this.lieDown
    this.rig.rotation.z = (Math.PI / 2 - 0.12) * k
    this.rig.position.y = 0.1 * k
    const breath = 1 + Math.sin(this.clock * 1.4) * 0.02 * k
    this.rig.scale.set(1.32, 1.32 * breath, 1.32)
    this.legL.rotation.x = 0.5 * k
    this.legR.rotation.x = 0.62 * k
    this.armL.rotation.set(-0.55 * k, 0, 0.12)
    this.armR.rotation.set(-0.4 * k, 0, -0.07)
    this.body.rotation.set(0.12 * k, 0, 0)
    this.head.rotation.set(0.3 * k, 0, 0)

    if (this.sleeping && !this.wantSleep) this.sleeping = false

    this.takeFirelight(0)
    this.group.position.y += (GROUND_Y - this.group.position.y) * Math.min(1, dt * 8)
    return true
  }

  private updateTrip(dt: number, boost: number): void {
    if (this.trip === 'away') return
    const goal = this.trip === 'leaving' ? this.board : this.home
    const speed = this.speed * boost

    if (this.walkToward(goal, speed * dt, 0.4) === 0) {
      if (this.trip === 'leaving') {
        this.trip = 'away'
        this.group.visible = false
      } else {
        this.trip = 'none'
        this.pack.visible = false
        this.phase = 'walkOut'
        this.refreshCarry()
      }
      return
    }

    this.walkCycle += dt * speed * 2.6
    this.animateWalk()

    let d = this.yaw - this.group.rotation.y
    while (d > Math.PI) d -= TAU
    while (d < -Math.PI) d += TAU
    this.group.rotation.y += d * Math.min(1, dt * 9)

    this.skirtCamp()
    this.group.position.y += (GROUND_Y - this.group.position.y) * Math.min(1, dt * 8)
  }

  private skirtCamp(): void {
    if (this.ground) return
    for (const b of this.extra.length ? [...CAMP_BLOCKERS, ...this.extra] : CAMP_BLOCKERS) {
      const dx = this.group.position.x - b.x
      const dz = this.group.position.z - b.z
      const d = Math.hypot(dx, dz)
      if (d > b.r || d < 1e-3) continue
      this.group.position.x = b.x + (dx / d) * b.r
      this.group.position.z = b.z + (dz / d) * b.r
    }
  }

  private animateWalk(): void {
    const s = Math.sin(this.walkCycle)
    const c = Math.cos(this.walkCycle)
    const bob = Math.abs(c) * 0.035
    this.legL.rotation.x = s * 0.72
    this.legR.rotation.x = -s * 0.72
    this.armL.rotation.set(-s * 0.55, 0, 0.12)
    this.armR.rotation.set(-0.14 + s * 0.13, 0, -0.07)
    this.body.rotation.set(0.07, 0, s * 0.05)
    this.head.rotation.set(0.02, s * 0.09, -s * 0.06)
    this.body.position.y = HIP_Y + bob
    this.head.position.y = HEAD_Y + bob
    this.armL.position.y = SHOULDER_Y + bob
    this.armR.position.y = SHOULDER_Y + bob
  }

  private animateWork(dt: number): void {
    const before = (this.swing / TAU) % 1
    this.swing += dt * 4.4
    const u = (this.swing / TAU) % 1
    const k = u < 0.62 ? 1 - (1 - u / 0.62) ** 2 : 1 - ((u - 0.62) / 0.38) ** 2.4
    this.armR.rotation.set(-0.15 - 2.15 * k, 0, -0.05)
    this.armL.rotation.set(-0.12 - 0.85 * k, 0, 0.22)
    this.body.rotation.set(0.24 - 0.32 * k, 0, 0)
    this.head.rotation.set(0.16 - 0.24 * k, 0, 0)
    this.legL.rotation.x = -0.24
    this.legR.rotation.x = 0.2
    const bob = k * 0.03
    this.body.position.y = HIP_Y + bob
    this.head.position.y = HEAD_Y + bob
    this.armL.position.y = SHOULDER_Y + bob
    this.armR.position.y = SHOULDER_Y + bob
    if (u < before) this.strike()
  }

  private animateDeposit(): void {
    const t = (DEPOSIT - this.timer) * 9
    const drop = Math.min(1, t / 6)
    const hop = Math.max(0, Math.sin(t)) * 0.16 * (1 - drop)
    const sway = Math.sin(t * 0.22) * 0.09
    this.body.position.y = HIP_Y + hop
    this.head.position.y = HEAD_Y + hop
    this.armL.position.y = SHOULDER_Y + hop
    this.armR.position.y = SHOULDER_Y + hop
    this.armL.rotation.set(-2.5 + drop * 1.35, 0, 0.35 - drop * 0.14)
    this.armR.rotation.set(-2.5 + drop * 1.35, 0, -0.35 + drop * 0.14)
    this.body.rotation.set(-0.08 + drop * 0.16, 0, sway * 0.4)
    this.head.rotation.set(-0.12 + drop * 0.24, Math.sin(t * 0.7) * 0.2 * (1 - drop) + sway, 0)
    this.legL.rotation.x = -0.1
    this.legR.rotation.x = 0.1
  }

  onStrike: (() => void) | null = null
  onDeposit: (() => void) | null = null

  private strike(color: Color = CHIP.flint, at: Vector3 | null = null): void {
    this.onStrike?.()
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.random()
      this.chips.setColorAt(i, color)
      this.chipPos[i * 3] = (at?.x ?? 0) + Math.sin(a) * 0.08
      this.chipPos[i * 3 + 1] = at?.y ?? 0.12
      this.chipPos[i * 3 + 2] = (at?.z ?? 0.62) + Math.cos(a) * 0.08
      this.chipVel[i * 3] = Math.sin(a) * 1.1
      this.chipVel[i * 3 + 1] = 1.8 + Math.random() * 1.4
      this.chipVel[i * 3 + 2] = Math.cos(a) * 1.1
      this.chipLife[i] = 1
    }
    if (this.chips.instanceColor) this.chips.instanceColor.needsUpdate = true
    this.chips.visible = true
  }

  private updateChips(dt: number): void {
    if (!this.chips.visible) return
    let alive = 0
    for (let i = 0; i < 8; i++) {
      let life = this.chipLife[i]!
      if (life <= 0) {
        this.dummy.scale.setScalar(0.0001)
        this.dummy.position.set(0, -1, 0)
      } else {
        life -= dt * 1.7
        this.chipLife[i] = life
        this.chipVel[i * 3 + 1] = this.chipVel[i * 3 + 1]! - 9 * dt
        for (let k = 0; k < 3; k++) {
          this.chipPos[i * 3 + k] = this.chipPos[i * 3 + k]! + this.chipVel[i * 3 + k]! * dt
        }
        this.dummy.position.set(
          this.chipPos[i * 3]!,
          Math.max(0.03, this.chipPos[i * 3 + 1]!),
          this.chipPos[i * 3 + 2]!,
        )
        this.dummy.rotation.set(life * 6, life * 4, 0)
        this.dummy.scale.setScalar(Math.max(0.0001, life))
        if (life > 0) alive++
      }
      this.dummy.updateMatrix()
      this.chips.setMatrixAt(i, this.dummy.matrix)
    }
    this.chips.instanceMatrix.needsUpdate = true
    if (alive === 0) this.chips.visible = false
  }
}
