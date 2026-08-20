import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
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

type State = 'away' | 'sailingIn' | 'docked' | 'sailingOut'

const APPROACH = 2.35 // azimut d'arrivée, choisi pour croiser la caméra par défaut
const SPAWN_R = 46
const DOCK_R = 19
const TRAVEL = 7 // secondes de trajet, dans un sens comme dans l'autre

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

/** La barque marchande : coque et cargaison fondues en un seul mesh, la voile à
 *  part parce qu'elle apparaît avec la techno « voile » et gonfle en route. */
export class Caravan {
  readonly group = new Group()
  private readonly sail: Mesh
  private state: State = 'away'
  private t = 0
  private readonly spawn: Vector3
  private readonly dock: Vector3
  private readonly exit: Vector3

  constructor() {
    const wood = PALETTE.trunk
    const woodLight = new Color('#a5794f')
    const clay = new Color('#b3603f')
    const cream = new Color('#efe2c4')

    const hullParts: BufferGeometry[] = [
      // Coque évasée : une boîte écrasée + deux extrémités relevées.
      tinted(new BoxGeometry(2.0, 0.34, 0.78), wood, 0, 0.22, 0),
      tinted(new BoxGeometry(0.5, 0.3, 0.62).rotateZ(0.5), woodLight, 1.05, 0.38, 0),
      tinted(new BoxGeometry(0.5, 0.3, 0.62).rotateZ(-0.5), woodLight, -1.05, 0.38, 0),
      tinted(new BoxGeometry(1.9, 0.08, 0.9), woodLight, 0, 0.42, 0),
      // Cargaison : jarres et ballots, la silhouette du commerce.
      tinted(new CylinderGeometry(0.1, 0.13, 0.3, 7), clay, -0.45, 0.6, 0.16),
      tinted(new SphereGeometry(0.09, 7, 5), clay, -0.45, 0.79, 0.16),
      tinted(new CylinderGeometry(0.1, 0.13, 0.3, 7), clay, -0.62, 0.6, -0.14),
      tinted(new SphereGeometry(0.09, 7, 5), clay, -0.62, 0.79, -0.14),
      tinted(new BoxGeometry(0.42, 0.26, 0.42), cream, 0.32, 0.58, -0.08),
      tinted(new BoxGeometry(0.34, 0.2, 0.34).rotateY(0.4), woodLight, 0.6, 0.55, 0.18),
      // Mât et vergue.
      tinted(new CylinderGeometry(0.045, 0.055, 1.7, 6), wood, 0, 1.25, 0),
      tinted(new CylinderGeometry(0.035, 0.035, 1.15, 5).rotateX(Math.PI / 2), wood, 0, 1.95, 0),
    ]

    const hull = new Mesh(
      mergeGeometries(hullParts) ?? new BufferGeometry(),
      new MeshToonMaterial({ vertexColors: true }),
    )
    hull.castShadow = true

    // Voile carrée rayée, gonflée par déplacement de sommets à l'update.
    const sailGeo = new PlaneGeometry(1.05, 1.0, 1, 6)
    const stripes = new Float32Array(sailGeo.attributes.position!.count * 3)
    const a = new Color('#f2e8d0')
    const b = new Color('#c96f4e')
    for (let i = 0; i < sailGeo.attributes.position!.count; i++) {
      const y = sailGeo.attributes.position!.getY(i)
      const band = Math.floor((y + 0.5) * 6)
      const c = band % 2 === 0 ? a : b
      stripes[i * 3] = c.r
      stripes[i * 3 + 1] = c.g
      stripes[i * 3 + 2] = c.b
    }
    sailGeo.setAttribute('color', new BufferAttribute(stripes, 3))
    this.sail = new Mesh(
      sailGeo,
      new MeshToonMaterial({ vertexColors: true, side: DoubleSide }),
    )
    this.sail.position.set(0, 1.42, 0)
    this.sail.castShadow = true

    this.group.add(hull, this.sail)
    // ×1.5 : un cargo côtier, même modeste, dépasse les 2.7 u — la barque
    // marchande faisait la taille de la barque d'expédition du colon. L'échelle
    // vit sur le groupe : la houle (position) et la voile animée n'y touchent pas.
    this.group.scale.setScalar(1.5)
    this.group.visible = false

    this.spawn = new Vector3(Math.sin(APPROACH) * SPAWN_R, 0, Math.cos(APPROACH) * SPAWN_R)
    this.dock = new Vector3(Math.sin(APPROACH) * DOCK_R, 0, Math.cos(APPROACH) * DOCK_R)
    const exitA = APPROACH + 0.7
    this.exit = new Vector3(Math.sin(exitA) * SPAWN_R, 0, Math.cos(exitA) * SPAWN_R)
  }

  get docked(): boolean {
    return this.state === 'docked'
  }

  arrive(): void {
    this.state = 'sailingIn'
    this.t = 0
    this.group.visible = true
    this.group.position.copy(this.spawn)
  }

  depart(): void {
    if (this.state === 'away') return
    this.state = 'sailingOut'
    this.t = 0
  }

  update(dt: number, time: number, hasSail: boolean): void {
    if (this.state === 'away') return
    this.sail.visible = hasSail

    if (this.state === 'sailingIn' || this.state === 'sailingOut') {
      this.t += dt
      const k = Math.min(1, this.t / TRAVEL)
      // Départ et arrivée amortis : une barque n'a pas de frein à main.
      const e = k * k * (3 - 2 * k)
      const from = this.state === 'sailingIn' ? this.spawn : this.dock
      const to = this.state === 'sailingIn' ? this.dock : this.exit
      this.group.position.lerpVectors(from, to, e)
      const dx = to.x - from.x
      const dz = to.z - from.z
      this.group.rotation.y = Math.atan2(dx, dz) + Math.PI / 2
      if (k >= 1) {
        if (this.state === 'sailingIn') this.state = 'docked'
        else {
          this.state = 'away'
          this.group.visible = false
        }
      }
    }

    // Houle : tangage et roulis légers, plus francs en route qu'à quai.
    const drive = this.state === 'docked' ? 0.5 : 1
    this.group.position.y = Math.sin(time * 1.7) * 0.05 * drive
    this.group.rotation.z = Math.sin(time * 1.3) * 0.035 * drive
    this.group.rotation.x = Math.sin(time * 2.1) * 0.02 * drive

    // La voile gonfle en route, pend à quai.
    const pos = this.sail.geometry.attributes.position!
    const belly = this.state === 'docked' ? 0.04 : 0.16
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i)
      const arc = Math.cos(y * Math.PI) * belly
      pos.setZ(i, arc + Math.sin(time * 2.4 + y * 3) * 0.012 * drive)
    }
    pos.needsUpdate = true
  }
}
