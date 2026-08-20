/** Les autres membres de la tribu. Purement visuels — la simulation ne les
 *  connaît pas — mais c'est leur présence qui transforme un camp habité par un
 *  homme seul en village. Une cueilleuse dès le Néolithique, un enfant dès
 *  l'Antiquité. Un seul mesh instancié pour tout le monde : les silhouettes
 *  vivent par la démarche (bob, roulis), pas par l'articulation. */
import {
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  InstancedMesh,
  MeshToonMaterial,
  Object3D,
  SphereGeometry,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Island } from './island'
import { CAMP_HOME } from './village'

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

/** Une silhouette debout, jambes en léger pas : c'est la même recette que la
 *  faune — à quarante pixels, la démarche fait le personnage. */
function villagerGeo(): BufferGeometry {
  const skin = new Color('#d8a077')
  const hair = new Color('#3d2c1e')
  const cloth = new Color('#a8583e')
  const clothLight = new Color('#c9a06b')
  const p: BufferGeometry[] = []
  for (const s of [-1, 1])
    p.push(part(new CylinderGeometry(0.055, 0.07, 0.42, 5).rotateX(s * 0.14), skin, s * 0.09, 0.21, 0))
  p.push(part(new ConeGeometry(0.24, 0.52, 7), cloth, 0, 0.62, 0))
  p.push(part(new CapsuleGeometry(0.14, 0.3, 2, 7), clothLight, 0, 0.98, 0))
  for (const s of [-1, 1])
    p.push(part(new CylinderGeometry(0.045, 0.055, 0.36, 5).rotateZ(s * 0.22), skin, s * 0.21, 0.95, 0))
  p.push(part(new SphereGeometry(0.13, 8, 6), skin, 0, 1.33, 0))
  p.push(part(new SphereGeometry(0.135, 8, 6).scale(1, 0.72, 1), hair, 0, 1.39, -0.02))
  // Le panier de la cueilleuse, calé sur la hanche.
  p.push(part(new CylinderGeometry(0.1, 0.075, 0.12, 6), new Color('#8a6a42'), 0.24, 0.72, 0.05))
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
}

export class Villagers {
  readonly mesh: InstancedMesh
  private readonly souls: Soul[] = []
  private readonly dummy = new Object3D()
  private count = 0

  constructor(
    private readonly island: Island,
    private readonly obstacles: { x: number; z: number; r: number }[],
  ) {
    this.mesh = new InstancedMesh(villagerGeo(), new MeshToonMaterial({ vertexColors: true }), 2)
    this.mesh.castShadow = true
    this.mesh.frustumCulled = false
    // Deux teintes : la cueilleuse en ocre rouge, l'enfant en bleu guède.
    this.mesh.setColorAt(0, new Color('#ffffff'))
    this.mesh.setColorAt(1, new Color('#8fa4c8'))
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
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
        scale: i === 0 ? 0.92 : 0.6,
        home: false,
      })
    this.setPopulation(0)
  }

  /** Combien d'âmes en plus du colon — le monde le décide selon l'âge. */
  setPopulation(n: number): void {
    this.count = Math.min(2, Math.max(0, n))
  }

  /** Une destination de flânerie : au voisinage d'un bâtiment, ou du foyer. */
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
  }

  update(dt: number, time: number, night: boolean): void {
    for (let i = 0; i < 2; i++) {
      const s = this.souls[i]!
      const active = i < this.count
      if (!active) {
        this.dummy.position.set(0, -30, 0)
        this.dummy.scale.setScalar(0.001)
        this.dummy.rotation.set(0, 0, 0)
        this.dummy.updateMatrix()
        this.mesh.setMatrixAt(i, this.dummy.matrix)
        continue
      }

      // La nuit, chacun rentre au camp et s'efface ; l'aube les rend.
      if (night && !s.home) {
        s.tx = CAMP_HOME.x + (i === 0 ? 1.2 : -0.8)
        s.tz = CAMP_HOME.z + 1.4
        s.walking = true
        if (Math.hypot(s.x - s.tx, s.z - s.tz) < 0.4) s.home = true
      } else if (!night && s.home) {
        s.home = false
        s.timer = 1 + Math.random() * 3
        s.walking = false
      }

      if (!s.home) {
        if (s.walking) {
          const dx = s.tx - s.x
          const dz = s.tz - s.z
          const d = Math.hypot(dx, dz)
          if (d < 0.18) {
            s.walking = false
            s.timer = 2.5 + Math.random() * 6
          } else {
            s.heading = Math.atan2(dx, dz)
            const sp = (i === 0 ? 0.62 : 0.95) * (night ? 1.4 : 1)
            s.x += Math.sin(s.heading) * sp * dt
            s.z += Math.cos(s.heading) * sp * dt
            s.phase += dt * (i === 0 ? 7 : 11)
          }
        } else if (!night) {
          s.timer -= dt
          if (s.timer <= 0) this.pickTarget(s)
        }
        // Jamais dans les murs : même poussée radiale que la faune.
        for (const o of this.obstacles) {
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
      this.dummy.position.set(s.x, this.island.heightAt(s.x, s.z) + bob, s.z)
      this.dummy.rotation.set(0, s.heading, s.walking ? Math.sin(s.phase) * 0.06 : 0)
      this.dummy.scale.setScalar(hidden ? 0.001 : s.scale)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }
}
