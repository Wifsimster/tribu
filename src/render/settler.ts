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
  SphereGeometry,
  Vector3,
} from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PALETTE } from './palette'
import { CAMP_BLOCKERS, CAMP_FIRE, CAMP_HOME } from './village'
import type { Island } from './island'

type Phase = 'walkOut' | 'work' | 'walkHome' | 'deposit'
type Trip = 'none' | 'leaving' | 'away' | 'returning'

const TAU = Math.PI * 2

/** Rouge brique, crème et brun sombre: trois valeurs franches, parce qu'un
 *  personnage haut de cinquante pixels ne se lit que par ses contrastes. */
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
const SPARK = new MeshBasicMaterial({ color: 0xfff0cf })

/** Le colon est le seul objet mobile du campement: sa chaleur ne peut pas être
 *  cuite dans les sommets comme celle des abris. Elle passe donc par l'émissif
 *  de son matériau, remonté quand il approche du foyer et battu au rythme de la
 *  flamme — sinon il traverse la nappe de lumière sans jamais la recevoir. */
const FIRE_WARM = new Color('#ff8a34')
const FIRE_REACH = 5.4

/** Il s'attarde au foyer au lieu d'y faire demi-tour: sur un arrêt sur image,
 *  c'est ce qui donne une chance au colon d'être vu chez lui plutôt qu'en train
 *  de traverser un bois. */
const DEPOSIT = 2.1

const HIP_Y = 0.44
const SHOULDER_Y = 0.86
const HEAD_Y = 1.15

/** Une pièce teintée puis posée. Tout un membre finit fondu en une seule
 *  géométrie: le détail devient gratuit, seul le nombre de mesh coûte. */
function part(source: BufferGeometry, color: Color, x = 0, y = 0, z = 0): BufferGeometry {
  // Les polyèdres de three sortent sans index et la fusion refuse alors le lot
  // entier: un bâtiment disparaissait en silence.
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

/** Coque inversée, gonflée le long des normales. C'est le seul trait graphique
 *  du jeu: il n'appartient qu'au colon, pour qu'aucun arbre ne l'avale. */
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

/** The settler is a mime: the economy is rate-based, and he acts it out. What he
 *  is doing always matches the current focus, so the world explains the numbers. */
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
  private pack!: Mesh
  private tool: Mesh | null = null

  constructor(private island: Island) {
    this.body = this.limb(this.torsoGeometry(), 0, HIP_Y, 0)
    this.head = this.limb(this.headGeometry(), 0, HEAD_Y, 0)
    this.armL = this.limb(this.armGeometry(false), -0.4, SHOULDER_Y, 0)
    this.armR = this.limb(this.armGeometry(true), 0.4, SHOULDER_Y, 0)
    this.legL = this.limb(this.legGeometry(), -0.13, HIP_Y, 0)
    this.legR = this.limb(this.legGeometry(), 0.13, HIP_Y, 0)

    this.body.castShadow = true
    this.head.castShadow = true
    this.legL.castShadow = this.legR.castShadow = true

    this.chips = new InstancedMesh(new IcosahedronGeometry(0.05, 0), SPARK, 8)
    this.chips.visible = false
    this.chips.frustumCulled = false

    // Le colon est joué un tiers plus grand que l'échelle du village: à la
    // taille d'un téléphone, la justesse d'échelle perd contre la lisibilité.
    this.rig.scale.setScalar(1.32)
    this.group.add(this.rig, this.chips)
    this.group.position.set(2.5, island.heightAt(2.5, 2.5), 2.5)
    this.home.set(CAMP_HOME.x, island.heightAt(CAMP_HOME.x, CAMP_HOME.z), CAMP_HOME.z)

    // La hotte d'expédition, accrochée au dos : un cône tressé et deux jarres
    // débordantes. Invisible au camp — c'est l'attribut du voyage.
    this.pack = this.buildPack()
    this.body.add(this.pack)

    // La plage la plus proche du camp : là où le colon quitte le monde et y revient.
    let best = Infinity
    for (const c of island.cells) {
      if (!c.beach) continue
      const d = (c.x - CAMP_HOME.x) ** 2 + (c.z - CAMP_HOME.z) ** 2
      if (d < best) {
        best = d
        this.shore.set(c.x, c.height, c.z)
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
        // Sangles en travers du torse.
        part(new BoxGeometry(0.05, 0.4, 0.03).rotateZ(0.5), C.leatherDark, 0.08, 0.22, -0.12),
        part(new BoxGeometry(0.05, 0.4, 0.03).rotateZ(-0.5), C.leatherDark, -0.08, 0.22, -0.12),
      ]),
      this.skin,
    )
    basket.visible = false
    return basket
  }

  /** Départ en expédition : il charge la hotte, marche jusqu'à la plage la plus
   *  proche et quitte l'île. hasPack = techno « cordage » connue. */
  departExpedition(hasPack: boolean): void {
    this.pack.visible = hasPack
    this.wake()
    this.trip = 'leaving'
  }

  /** Réveil net. `update` court-circuite le sommeil dès qu'un voyage commence,
   *  mais personne ne remettait le squelette DEBOUT : un colon endormi envoyé
   *  en expédition marchait jusqu'à la barque couché sur le flanc. On remet
   *  donc la pose de repos à zéro au moment où on le tire du lit. */
  wake(): void {
    this.wantSleep = false
    this.sleeping = false
    this.lieDown = 0
    this.rig.rotation.z = 0
    this.rig.position.y = 0
    this.rig.scale.setScalar(1.32)
    this.legL.rotation.x = 0
    this.legR.rotation.x = 0
    this.armL.rotation.set(0, 0, 0.12)
    this.armR.rotation.set(0, 0, -0.07)
    this.body.rotation.set(0, 0, 0)
    this.head.rotation.set(0, 0, 0)
    this.phase = 'walkOut'
  }

  /** La nuit sans lampe, la tribu dort : le colon rentre se coucher près du feu.
   *  Piloté par main.ts, qui sait s'il reste de la lumière découverte. */
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
      this.group.position.set(this.shore.x, this.shore.y, this.shore.z)
      this.trip = 'returning'
    }
  }

  /** Chaque membre porte sa propre coque en enfant: l'animation la suit sans
   *  une ligne de code de plus. La coque est tirée d'une version grossière du
   *  membre, sinon chaque œil et chaque lanière gagnerait son propre liseré. */
  private limb(pair: Pair, x: number, y: number, z: number): Mesh {
    const mesh = new Mesh(weld(pair.detail), this.skin)
    mesh.position.set(x, y, z)
    mesh.add(outlineOf(weld(pair.hull), 0.038))
    this.rig.add(mesh)
    return mesh
  }

  private torsoGeometry(): Pair {
    // Torse large d'épaules et étroit de taille: la silhouette doit dire "humain"
    // avant que le moindre détail ne soit lisible.
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
    // Calotte de cheveux + bandeau: la bande claire sous la masse sombre est ce
    // qui sépare la tête du corps à distance.
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
    void spear // l'outil n'est plus soudé au bras : il se change (setTool)
    return { detail, hull }
  }

  // ── Outils ────────────────────────────────────────────────────────────────
  // L'outil vit dans la main droite et se change selon la ressource travaillée
  // et les savoirs : épieu ou faucille pour la nourriture, hache pour le bois,
  // percuteur puis pic pour la pierre. La matière du tranchant suit les âges —
  // silex, cuivre ou bronze, fer.
  private toolKey = ''

  setTool(kind: 'hand' | 'spear' | 'sickle' | 'axe' | 'pick' | 'rod', tier: number): void {
    const key = kind + tier
    if (key === this.toolKey) return
    this.toolKey = key
    if (this.tool) {
      this.armR.remove(this.tool)
      this.tool.geometry.dispose()
      this.tool = null
    }
    if (kind === 'hand') return
    const edge =
      tier >= 3 ? new Color('#c3cedd') : tier >= 2 ? new Color('#8f959e') : tier >= 1 ? new Color('#c98a4b') : C.flint
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
      case 'axe': {
        parts.push(part(new CylinderGeometry(0.028, 0.034, 0.52, 6), C.shaft, 0, 0.1, 0))
        parts.push(part(new BoxGeometry(0.2, 0.11, 0.05).rotateZ(0.08), edge, 0.1, 0.32, 0))
        parts.push(part(new CylinderGeometry(0.04, 0.04, 0.06, 6), C.bone, 0, 0.26, 0))
        break
      }
      case 'rod': {
        // Canne à pêche : une gaule inclinée vers l'avant, le fil qui plonge.
        parts.push(part(new CylinderGeometry(0.016, 0.026, 1.5, 5).rotateX(-0.85), C.shaft, 0, 0.32, 0.42))
        parts.push(part(new CylinderGeometry(0.006, 0.006, 0.72, 3), C.bone, 0, 0.32, 1.0))
        break
      }
      case 'pick': {
        if (tier === 0) {
          // Simple percuteur : un galet en main.
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
    this.tool.position.set(0, -0.42, 0)
    this.tool.castShadow = true
    this.armR.add(this.tool)
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

  /** Le point que propose la boucle est le centre géométrique de l'île. Le colon,
   *  lui, rentre au campement: c'est sa marche qui doit désigner le foyer comme
   *  le lieu où l'on vit, pas une case vide au milieu du terrain. */
  setHome(_p: Vector3): void {
    this.home.set(CAMP_HOME.x, this.island.heightAt(CAMP_HOME.x, CAMP_HOME.z), CAMP_HOME.z)
  }

  /** Sent by a tap on a resource node, or by the focus buttons. */
  sendTo(p: Vector3): void {
    this.destination.set(p.x, 0, p.z)
    this.phase = 'walkOut'
  }

  celebrate(): void {
    this.timer = Math.min(this.timer, 0.2)
    this.walkCycle += 3
    this.cheer = 1
  }

  update(dt: number, boost: number): void {
    if (this.trip !== 'none') {
      this.updateTrip(dt, boost)
      return
    }
    if (this.wantSleep || this.sleeping || this.lieDown > 0) {
      if (this.updateSleep(dt)) return
    }
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
          this.timer = this.phase === 'work' ? 2.6 : DEPOSIT
          break
        }
        const step = Math.min(speed * dt, dist)
        this.group.position.x += (dx / dist) * step
        this.group.position.z += (dz / dist) * step
        this.yaw = Math.atan2(dx, dz)
        this.walkCycle += dt * speed * 2.6
        this.animateWalk()
        break
      }
      case 'work': {
        this.timer -= dt * boost
        this.animateWork(dt * boost)
        if (this.timer <= 0) this.phase = 'walkHome'
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

    // Virage amorti: un demi-tour instantané fait clignoter la silhouette.
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

    const ground = this.island.heightAt(this.group.position.x, this.group.position.z)
    this.group.position.y += (ground - this.group.position.y) * Math.min(1, dt * 8)
  }

  /** Un seul uniforme par image, pas une lumière de plus: la scène en compte
   *  déjà trois et une quatrième coûterait un programme par matériau. */
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

  /** Sommeil : marche jusqu'au foyer, puis il s'allonge sur le côté, et la cage
   *  thoracique respire lentement. Retourne true tant qu'il gère l'image. */
  private updateSleep(dt: number): boolean {
    this.clock += dt

    if (this.wantSleep && !this.sleeping) {
      const dx = this.home.x - this.group.position.x
      const dz = this.home.z - this.group.position.z
      const dist = Math.hypot(dx, dz)
      if (dist > 0.45) {
        const step = Math.min(this.speed * dt, dist)
        this.group.position.x += (dx / dist) * step
        this.group.position.z += (dz / dist) * step
        this.yaw = Math.atan2(dx, dz)
        this.walkCycle += dt * this.speed * 2.6
        this.animateWalk()
        let d = this.yaw - this.group.rotation.y
        while (d > Math.PI) d -= TAU
        while (d < -Math.PI) d += TAU
        this.group.rotation.y += d * Math.min(1, dt * 9)
        this.skirtCamp()
        const ground = this.island.heightAt(this.group.position.x, this.group.position.z)
        this.group.position.y += (ground - this.group.position.y) * Math.min(1, dt * 8)
        return true
      }
      this.sleeping = true
    }

    // S'allonger (et se relever) en douceur plutôt que basculer d'un coup.
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
    // Respiration lente ; membres repliés.
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
    const ground = this.island.heightAt(this.group.position.x, this.group.position.z)
    this.group.position.y += (ground - this.group.position.y) * Math.min(1, dt * 8)
    return true
  }

  /** Aller-retour d'expédition : même marche que d'habitude, mais vers la plage,
   *  et le monde ne le voit plus une fois embarqué. */
  private updateTrip(dt: number, boost: number): void {
    if (this.trip === 'away') return
    const goal = this.trip === 'leaving' ? this.shore : this.home
    const dx = goal.x - this.group.position.x
    const dz = goal.z - this.group.position.z
    const dist = Math.hypot(dx, dz)
    const speed = this.speed * boost

    if (dist < 0.4) {
      if (this.trip === 'leaving') {
        this.trip = 'away'
        this.group.visible = false
      } else {
        this.trip = 'none'
        this.pack.visible = false
        this.phase = 'walkOut'
      }
      return
    }

    const step = Math.min(speed * dt, dist)
    this.group.position.x += (dx / dist) * step
    this.group.position.z += (dz / dist) * step
    this.yaw = Math.atan2(dx, dz)
    this.walkCycle += dt * speed * 2.6
    this.animateWalk()

    let d = this.yaw - this.group.rotation.y
    while (d > Math.PI) d -= TAU
    while (d < -Math.PI) d += TAU
    this.group.rotation.y += d * Math.min(1, dt * 9)

    this.skirtCamp()
    const ground = this.island.heightAt(this.group.position.x, this.group.position.z)
    this.group.position.y += (ground - this.group.position.y) * Math.min(1, dt * 8)
  }

  /** Repoussé hors des abris à chaque pas plutôt que guidé par un chemin: il
   *  glisse le long des peaux et les contourne, pour cinq comparaisons par
   *  image. */
  private skirtCamp(): void {
    for (const b of CAMP_BLOCKERS) {
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
    // Le bras à l'épieu reste calme: une hampe qui bat au rythme des jambes
    // devient une bouillie de pixels à cette taille.
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
    // Lever lent, frappe sèche: la brutalité de la fin est ce qui se voit de loin.
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

  /** Il pose sa charge, puis reste au feu: mains tendues vers la flamme, un
   *  balancement lent. Un colon qui repart aussitôt ne fait pas du foyer un
   *  chez-soi. */
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

  /** Éclats de silex à l'impact: la seule chose qui prouve que le colon frappe
   *  quelque chose plutôt que de mimer dans le vide. */
  /** Branché par main.ts : chaque coup porté doit s'entendre. Le son est
   *  ainsi lié au GESTE, pas à une boucle de fond qui tournerait sans fin. */
  onStrike: (() => void) | null = null

  private strike(): void {
    this.onStrike?.()
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.random()
      this.chipPos[i * 3] = Math.sin(a) * 0.08
      this.chipPos[i * 3 + 1] = 0.12
      this.chipPos[i * 3 + 2] = 0.62 + Math.cos(a) * 0.08
      this.chipVel[i * 3] = Math.sin(a) * 1.1
      this.chipVel[i * 3 + 1] = 1.8 + Math.random() * 1.4
      this.chipVel[i * 3 + 2] = Math.cos(a) * 1.1
      this.chipLife[i] = 1
    }
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
