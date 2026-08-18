import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  Object3D,
  PointLight,
  TorusGeometry,
  Vector3,
} from 'three'
import { PALETTE } from './palette'
import type { Island } from './island'

interface Pending {
  object: Object3D
  age: number
}

/** Everything the tribe builds. Buildings pop in when their technology lands, so
 *  research has an immediate, physical consequence on screen. */
export class Village {
  readonly group = new Group()
  private readonly placed = new Set<string>()
  private readonly growing: Pending[] = []
  private flame!: Mesh
  private fireLight!: PointLight
  private slotIndex = 0

  constructor(private island: Island) {
    this.buildCampfire()
  }

  private buildCampfire(): void {
    const fire = new Group()
    const ring = new Mesh(
      new TorusGeometry(0.5, 0.12, 5, 10),
      new MeshToonMaterial({ color: PALETTE.rock }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.06
    ring.castShadow = true

    const logGeo = new CylinderGeometry(0.07, 0.07, 0.7, 5)
    const logMat = new MeshToonMaterial({ color: PALETTE.trunk })
    for (let i = 0; i < 3; i++) {
      const log = new Mesh(logGeo, logMat)
      log.rotation.set(Math.PI / 2.6, (i * Math.PI * 2) / 3, 0)
      log.position.y = 0.18
      fire.add(log)
    }

    this.flame = new Mesh(
      new ConeGeometry(0.22, 0.55, 6),
      new MeshBasicMaterial({ color: 0xffa24a }),
    )
    this.flame.position.y = 0.5

    this.fireLight = new PointLight(0xffa14a, 3.5, 6, 2)
    this.fireLight.position.y = 0.6

    fire.add(ring, this.flame, this.fireLight)
    fire.position.set(0, this.island.heightAt(0, 0), 0)
    this.group.add(fire)
  }

  private nextSlot(): Vector3 {
    const slot = this.island.buildSlots[this.slotIndex % this.island.buildSlots.length]
    this.slotIndex += 3 // spread buildings out instead of stacking them side by side
    return slot ? slot.clone() : new Vector3(3, this.island.heightAt(3, 0), 0)
  }

  sync(buildings: Set<string>): void {
    for (const b of buildings) {
      if (this.placed.has(b)) continue
      const obj = this.make(b)
      if (!obj) continue
      const slot = this.nextSlot()
      obj.position.set(slot.x, slot.y, slot.z)
      obj.rotation.y = Math.atan2(-slot.x, -slot.z)
      obj.scale.setScalar(0.001)
      this.group.add(obj)
      this.growing.push({ object: obj, age: 0 })
      this.placed.add(b)
    }
  }

  private make(kind: string): Object3D | null {
    switch (kind) {
      case 'hut':
        return this.makeHut()
      case 'field':
        return this.makeField()
      case 'granary':
        return this.makeGranary()
      case 'aqueduct':
        return this.makeAqueduct()
      default:
        return null
    }
  }

  private makeHut(): Object3D {
    const g = new Group()
    const walls = new Mesh(
      new CylinderGeometry(0.75, 0.85, 0.6, 8),
      new MeshToonMaterial({ color: PALETTE.hide }),
    )
    walls.position.y = 0.3
    const roof = new Mesh(
      new ConeGeometry(1.0, 0.85, 8),
      new MeshToonMaterial({ color: PALETTE.thatch }),
    )
    roof.position.y = 1.0
    const door = new Mesh(
      new BoxGeometry(0.3, 0.4, 0.06),
      new MeshToonMaterial({ color: 0x5b422f }),
    )
    door.position.set(0, 0.2, 0.83)
    walls.castShadow = roof.castShadow = true
    g.add(walls, roof, door)
    return g
  }

  private makeField(): Object3D {
    const g = new Group()
    const soil = new Mesh(
      new BoxGeometry(2.2, 0.12, 1.8),
      new MeshToonMaterial({ color: PALETTE.dirt }),
    )
    soil.position.y = 0.06
    soil.receiveShadow = true
    g.add(soil)
    const rowGeo = new BoxGeometry(2.0, 0.28, 0.14)
    const rowMat = new MeshToonMaterial({ color: PALETTE.wheat })
    for (let i = 0; i < 5; i++) {
      const row = new Mesh(rowGeo, rowMat)
      row.position.set(0, 0.24, -0.7 + i * 0.35)
      row.castShadow = true
      g.add(row)
    }
    return g
  }

  private makeGranary(): Object3D {
    const g = new Group()
    const legGeo = new CylinderGeometry(0.07, 0.07, 0.5, 5)
    const legMat = new MeshToonMaterial({ color: PALETTE.trunk })
    for (const [x, z] of [
      [-0.4, -0.4],
      [0.4, -0.4],
      [-0.4, 0.4],
      [0.4, 0.4],
    ] as const) {
      const leg = new Mesh(legGeo, legMat)
      leg.position.set(x, 0.25, z)
      g.add(leg)
    }
    const box = new Mesh(
      new BoxGeometry(1.1, 0.8, 1.1),
      new MeshToonMaterial({ color: PALETTE.stoneWall }),
    )
    box.position.y = 0.9
    const roof = new Mesh(
      new ConeGeometry(0.95, 0.6, 4),
      new MeshToonMaterial({ color: PALETTE.thatch }),
    )
    roof.position.y = 1.6
    roof.rotation.y = Math.PI / 4
    box.castShadow = roof.castShadow = true
    g.add(box, roof)
    return g
  }

  private makeAqueduct(): Object3D {
    const g = new Group()
    const stone = new MeshToonMaterial({ color: PALETTE.stoneWall })
    for (let i = 0; i < 3; i++) {
      const pier = new Mesh(new BoxGeometry(0.3, 1.2, 0.4), stone)
      pier.position.set(-1.1 + i * 1.1, 0.6, 0)
      pier.castShadow = true
      g.add(pier)
      const arch = new Mesh(new TorusGeometry(0.4, 0.1, 4, 8, Math.PI), stone)
      arch.position.set(-0.55 + i * 1.1, 1.2, 0)
      if (i < 2) g.add(arch)
    }
    const channel = new Mesh(new BoxGeometry(2.8, 0.22, 0.5), stone)
    channel.position.y = 1.35
    channel.castShadow = true
    const water = new Mesh(
      new BoxGeometry(2.6, 0.06, 0.28),
      new MeshToonMaterial({ color: PALETTE.water }),
    )
    water.position.y = 1.46
    g.add(channel, water)
    return g
  }

  update(dt: number, t: number): void {
    // Flame flicker — cheap, and the only thing moving when the settler is away.
    const f = 1 + Math.sin(t * 11) * 0.12 + Math.sin(t * 6.3) * 0.08
    this.flame.scale.set(1, f, 1)
    this.flame.rotation.y = t * 1.6
    this.fireLight.intensity = 3.2 + Math.sin(t * 9) * 0.6

    for (let i = this.growing.length - 1; i >= 0; i--) {
      const p = this.growing[i]!
      p.age += dt * 1.6
      // Overshoot then settle: the building lands with a bit of weight.
      const k = Math.min(1, p.age)
      const scale = k < 1 ? 1.12 * (1 - Math.pow(1 - k, 3)) - 0.12 * Math.pow(1 - k, 2) : 1
      p.object.scale.setScalar(Math.max(0.001, scale))
      if (k >= 1) {
        p.object.scale.setScalar(1)
        this.growing.splice(i, 1)
      }
    }
  }
}
