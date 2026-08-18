import {
  CapsuleGeometry,
  Group,
  Mesh,
  MeshToonMaterial,
  SphereGeometry,
  Vector3,
} from 'three'
import { PALETTE } from './palette'
import type { Island } from './island'

type Phase = 'walkOut' | 'work' | 'walkHome' | 'deposit'

/** The settler is a mime: the economy is rate-based, and he acts it out. What he
 *  is doing always matches the current focus, so the world explains the numbers. */
export class Settler {
  readonly group = new Group()
  private readonly body: Mesh
  private readonly head: Mesh
  private readonly armL: Mesh
  private readonly armR: Mesh
  private readonly legL: Mesh
  private readonly legR: Mesh

  private phase: Phase = 'walkOut'
  private timer = 0
  private walkCycle = 0
  private readonly home = new Vector3(0, 0, 0)
  private destination = new Vector3(3, 0, 3)
  private speed = 2.4

  constructor(private island: Island) {
    const skin = new MeshToonMaterial({ color: PALETTE.skin })
    const cloth = new MeshToonMaterial({ color: PALETTE.cloth })
    const hide = new MeshToonMaterial({ color: PALETTE.hide })

    this.body = new Mesh(new CapsuleGeometry(0.17, 0.26, 3, 8), hide)
    this.body.position.y = 0.52
    this.body.castShadow = true

    this.head = new Mesh(new SphereGeometry(0.16, 12, 10), skin)
    this.head.position.y = 0.88
    this.head.castShadow = true

    const armGeo = new CapsuleGeometry(0.055, 0.22, 2, 6)
    this.armL = new Mesh(armGeo, skin)
    this.armR = new Mesh(armGeo, skin)
    this.armL.position.set(-0.21, 0.58, 0)
    this.armR.position.set(0.21, 0.58, 0)

    const legGeo = new CapsuleGeometry(0.065, 0.2, 2, 6)
    this.legL = new Mesh(legGeo, cloth)
    this.legR = new Mesh(legGeo, cloth)
    this.legL.position.set(-0.09, 0.2, 0)
    this.legR.position.set(0.09, 0.2, 0)

    this.group.add(this.body, this.head, this.armL, this.armR, this.legL, this.legR)
    this.group.position.set(2.5, island.heightAt(2.5, 2.5), 2.5)
    this.home.set(0, 0, 0)
  }

  setHome(p: Vector3): void {
    this.home.copy(p)
  }

  /** Sent by a tap on a resource node, or by the focus buttons. */
  sendTo(p: Vector3): void {
    this.destination.set(p.x, 0, p.z)
    this.phase = 'walkOut'
  }

  celebrate(): void {
    this.timer = Math.min(this.timer, 0.2)
    this.walkCycle += 3
  }

  update(dt: number, boost: number): void {
    const speed = this.speed * boost
    switch (this.phase) {
      case 'walkOut':
      case 'walkHome': {
        const goal = this.phase === 'walkOut' ? this.destination : this.home
        const dx = goal.x - this.group.position.x
        const dz = goal.z - this.group.position.z
        const dist = Math.hypot(dx, dz)
        if (dist < 0.35) {
          this.phase = this.phase === 'walkOut' ? 'work' : 'deposit'
          this.timer = this.phase === 'work' ? 2.6 : 0.7
          break
        }
        const step = Math.min(speed * dt, dist)
        this.group.position.x += (dx / dist) * step
        this.group.position.z += (dz / dist) * step
        this.group.rotation.y = Math.atan2(dx, dz)
        this.walkCycle += dt * speed * 3.4
        this.animateWalk()
        break
      }
      case 'work': {
        this.timer -= dt * boost
        this.animateWork()
        if (this.timer <= 0) this.phase = 'walkHome'
        break
      }
      case 'deposit': {
        this.timer -= dt * boost
        this.animateDeposit()
        if (this.timer <= 0) this.phase = 'walkOut'
        break
      }
    }

    const ground = this.island.heightAt(this.group.position.x, this.group.position.z)
    this.group.position.y += (ground - this.group.position.y) * Math.min(1, dt * 8)
  }

  private animateWalk(): void {
    const s = Math.sin(this.walkCycle)
    const c = Math.cos(this.walkCycle)
    this.legL.rotation.x = s * 0.7
    this.legR.rotation.x = -s * 0.7
    this.armL.rotation.x = -s * 0.55
    this.armR.rotation.x = s * 0.55
    this.body.position.y = 0.52 + Math.abs(c) * 0.03
    this.head.position.y = 0.88 + Math.abs(c) * 0.03
    this.body.rotation.z = s * 0.04
  }

  private animateWork(): void {
    const t = (2.6 - this.timer) * 7
    const swing = Math.max(0, Math.sin(t))
    this.armL.rotation.x = -1.5 + swing * 1.4
    this.armR.rotation.x = -1.5 + swing * 1.4
    this.legL.rotation.x = 0.15
    this.legR.rotation.x = -0.15
    this.body.rotation.x = 0.18 - swing * 0.22
    this.head.position.y = 0.86
  }

  private animateDeposit(): void {
    const t = (0.7 - this.timer) * 9
    const hop = Math.max(0, Math.sin(t)) * 0.12
    this.body.position.y = 0.52 + hop
    this.head.position.y = 0.88 + hop
    this.armL.rotation.x = -2.2
    this.armR.rotation.x = -2.2
    this.body.rotation.x = 0
  }
}
