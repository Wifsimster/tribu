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
  IcosahedronGeometry,
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
import type { Island } from './island'

/** Une pièce teintée puis posée — même recette que le village : tout un animal
 *  finit fondu en une seule géométrie, une espèce entière en un seul call. */
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

// ── Silhouettes ────────────────────────────────────────────────────────────
// Toutes construites face à +z. À quarante pixels, seul le profil compte : un
// cerf, c'est un cou dressé et des bois ; un mouton, une boule sur pattes.

function deerGeo(): BufferGeometry {
  const coat = new Color('#a97a4e')
  const dark = new Color('#6e4d2e')
  const bone = new Color('#e8dfc8')
  const p: BufferGeometry[] = []
  // Corps fuselé, un peu plus haut que large.
  p.push(part(new CapsuleGeometry(0.15, 0.46, 2, 8).rotateX(Math.PI / 2).scale(1, 1.14, 1), coat, 0, 0.64, -0.04))
  p.push(part(new SphereGeometry(0.05, 5, 4), bone, 0, 0.72, -0.4))
  // Cou dressé — c'est lui qui distingue le cerf du mouton à distance.
  p.push(part(new CylinderGeometry(0.05, 0.085, 0.42, 6).rotateX(0.38), coat, 0, 0.9, 0.28))
  p.push(part(new CapsuleGeometry(0.06, 0.12, 1, 6).rotateX(Math.PI / 2 - 0.25), coat, 0, 1.09, 0.38))
  p.push(part(new ConeGeometry(0.042, 0.12, 5).rotateX(Math.PI / 2), dark, 0, 1.07, 0.52))
  for (const s of [-1, 1]) {
    p.push(part(new ConeGeometry(0.032, 0.1, 4).rotateZ(s * 1.1), coat, s * 0.08, 1.16, 0.3))
    // Bois simples : un merrain incliné + un andouiller, en quads.
    p.push(part(new CylinderGeometry(0.014, 0.018, 0.24, 4).rotateZ(s * 0.55).rotateX(-0.35), bone, s * 0.06, 1.26, 0.32))
    p.push(part(new CylinderGeometry(0.01, 0.014, 0.14, 4).rotateZ(s * 1.25), bone, s * 0.12, 1.3, 0.36))
  }
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      p.push(part(new CylinderGeometry(0.026, 0.034, 0.52, 5), dark, sx * 0.1, 0.26, sz * 0.26))
  return weld(p)
}

function sheepGeo(): BufferGeometry {
  const fleece = new Color('#e9e2cf')
  const dark = new Color('#4c4238')
  const p: BufferGeometry[] = []
  // Toison : un icosaèdre bosselé, c'est déjà de la laine à cette taille.
  p.push(part(new IcosahedronGeometry(0.24, 1).scale(1.28, 0.95, 1), fleece, 0, 0.4, -0.02))
  p.push(part(new CapsuleGeometry(0.055, 0.09, 1, 6).rotateX(Math.PI / 2 - 0.35), dark, 0, 0.46, 0.3))
  p.push(part(new IcosahedronGeometry(0.075, 0), fleece, 0, 0.56, 0.24))
  for (const s of [-1, 1]) p.push(part(new BoxGeometry(0.08, 0.03, 0.05), dark, s * 0.08, 0.48, 0.28))
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      p.push(part(new CylinderGeometry(0.024, 0.028, 0.28, 4), dark, sx * 0.1, 0.14, sz * 0.15))
  // Round 2 : à 0,63 u la toison arrivait à la taille du colon — un mouton
  // s'arrête au genou. ×0.62 → ~0,39 u, et le troupeau redevient du bétail.
  return weld(p).scale(0.62, 0.62, 0.62)
}

function henGeo(): BufferGeometry {
  const body = new Color('#f2efe4')
  const red = new Color('#c8402f')
  const beak = new Color('#d99a3c')
  const p: BufferGeometry[] = []
  p.push(part(new SphereGeometry(0.085, 7, 5).scale(1, 0.95, 1.25), body, 0, 0.13, 0))
  // Queue relevée : le triangle qui fait « poule » de profil.
  p.push(part(new ConeGeometry(0.05, 0.12, 4).rotateX(-1.15), body, 0, 0.2, -0.12))
  p.push(part(new SphereGeometry(0.045, 6, 4), body, 0, 0.24, 0.08))
  p.push(part(new BoxGeometry(0.014, 0.05, 0.055), red, 0, 0.29, 0.075))
  p.push(part(new SphereGeometry(0.016, 4, 3), red, 0, 0.21, 0.11))
  p.push(part(new ConeGeometry(0.015, 0.05, 4).rotateX(Math.PI / 2), beak, 0, 0.24, 0.13))
  for (const s of [-1, 1]) p.push(part(new CylinderGeometry(0.008, 0.008, 0.09, 3), beak, s * 0.03, 0.045, 0.01))
  return weld(p)
}

function horseGeo(): BufferGeometry {
  const coat = new Color('#6f4a2d')
  const mane = new Color('#33241a')
  const p: BufferGeometry[] = []
  p.push(part(new CapsuleGeometry(0.2, 0.6, 2, 8).rotateX(Math.PI / 2).scale(1, 1.1, 1), coat, 0, 0.84, -0.04))
  // Encolure massive et tête tombante : l'inverse du port de tête du cerf.
  p.push(part(new CylinderGeometry(0.07, 0.13, 0.52, 6).rotateX(0.55), coat, 0, 1.1, 0.36))
  p.push(part(new CapsuleGeometry(0.068, 0.2, 1, 6).rotateX(Math.PI / 2 + 0.5), coat, 0, 1.3, 0.56))
  // Crinière sombre plaquée sur l'arrière de l'encolure.
  p.push(part(new BoxGeometry(0.045, 0.5, 0.09).rotateX(0.55), mane, 0, 1.18, 0.24))
  p.push(part(new BoxGeometry(0.07, 0.42, 0.07).rotateX(-0.25), mane, 0, 0.66, -0.44))
  for (const s of [-1, 1]) p.push(part(new ConeGeometry(0.035, 0.1, 4), mane, s * 0.07, 1.44, 0.42))
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      p.push(part(new CylinderGeometry(0.032, 0.042, 0.68, 5), coat, sx * 0.13, 0.34, sz * 0.32))
  return weld(p)
}

function gullGeo(): BufferGeometry {
  const body = new Color('#f4f6f4')
  const wing = new Color('#d9dfe0')
  const tip = new Color('#4a5054')
  const beak = new Color('#d9a13c')
  const p: BufferGeometry[] = []
  p.push(part(new CapsuleGeometry(0.05, 0.16, 1, 6).rotateX(Math.PI / 2), body, 0, 0, 0))
  p.push(part(new SphereGeometry(0.04, 5, 4), body, 0, 0.03, 0.14))
  p.push(part(new ConeGeometry(0.013, 0.06, 4).rotateX(Math.PI / 2), beak, 0, 0.03, 0.2))
  p.push(part(new BoxGeometry(0.1, 0.01, 0.12), wing, 0, 0, -0.16))
  // Ailes en dièdre, bouts sombres : la signature de la mouette vue de loin.
  for (const s of [-1, 1]) {
    p.push(part(new BoxGeometry(0.4, 0.012, 0.14).rotateZ(s * 0.14), wing, s * 0.24, 0.02, -0.02))
    p.push(part(new BoxGeometry(0.12, 0.013, 0.11).rotateZ(s * 0.24), tip, s * 0.48, 0.06, -0.03))
  }
  return weld(p)
}

// ── Comportement ───────────────────────────────────────────────────────────

interface Beast {
  x: number
  z: number
  heading: number
  tx: number
  tz: number
  /** 0 marche, 1 pause, 2 broute/picore, 3 fuite. */
  state: number
  timer: number
  phase: number
  pitch: number
  sleep: number
  gait: number
}

interface LandCfg {
  speed: number
  turn: number
  /** Portée max d'une étape : courte = piétinement, longue = grande errance. */
  step: number
  grazeBias: number
  grazePitch: number
  pauseMin: number
  pauseMax: number
  bobAmp: number
  bobFreq: number
}

interface Gull {
  cx: number
  cz: number
  r: number
  a: number
  w: number
  alt: number
  phase: number
}

interface Spot {
  x: number
  z: number
}

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
  // Quelques tirages pour trouver une cible proche ET d'accès dégagé : les
  // animaux font des étapes courtes et contournent le bâti au lieu de le
  // traverser en ligne droite.
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
    // Aucun trajet propre : la bête reste brouter et retentera dans un instant,
    // plutôt que de foncer dans un mur.
    b.state = 2
    b.timer = 0.8 + Math.random() * 1.2
    return
  }
  b.tx = s.x + (Math.random() - 0.5) * 0.4
  b.tz = s.z + (Math.random() - 0.5) * 0.4
  b.state = 0
}

function makeHerd(n: number, spots: Spot[]): Beast[] {
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
    })
  }
  return herd
}

/** La faune ambiante : cinq espèces, une InstancedMesh chacune, cinq draw calls
 *  en tout. Elle ne produit rien — elle est là pour que l'île ait l'air de
 *  vivre sans le joueur, et pour dater chaque époque (gibier, puis troupeaux,
 *  puis basse-cour, chevaux, mouettes des ports). */
export class Fauna {
  readonly group = new Group()
  private readonly skin = new MeshToonMaterial({ vertexColors: true })

  private readonly deerMesh: InstancedMesh
  private readonly sheepMesh: InstancedMesh
  private readonly henMesh: InstancedMesh
  private readonly horseMesh: InstancedMesh
  private readonly gullMesh: InstancedMesh

  private readonly deer: Beast[]
  private readonly sheep: Beast[]
  private readonly hens: Beast[]
  private readonly horses: Beast[]
  private readonly gulls: Gull[] = []

  private readonly deerSpots: Spot[]
  private readonly sheepSpots: Spot[]
  private readonly henSpots: Spot[]
  private readonly horseSpots: Spot[]

  // Les allures sont figées ici plutôt qu'en littéraux dans update : zéro objet
  // construit par frame.
  private readonly deerCfg: LandCfg = { speed: 0.55, turn: 2.4, step: 3.4, grazeBias: 0.6, grazePitch: 0.3, pauseMin: 2, pauseMax: 5, bobAmp: 0.03, bobFreq: 6.5 }
  private readonly sheepCfg: LandCfg = { speed: 0.32, turn: 1.8, step: 1.7, grazeBias: 0.8, grazePitch: 0.26, pauseMin: 2.5, pauseMax: 6, bobAmp: 0.02, bobFreq: 5 }
  private readonly henCfg: LandCfg = { speed: 0.85, turn: 9, step: 1.5, grazeBias: 0.75, grazePitch: 0.5, pauseMin: 0.6, pauseMax: 1.8, bobAmp: 0.014, bobFreq: 16 }
  private readonly horseCfg: LandCfg = { speed: 0.48, turn: 1.3, step: 4.5, grazeBias: 0.7, grazePitch: 0.24, pauseMin: 3, pauseMax: 7, bobAmp: 0.035, bobFreq: 3.8 }

  /** Un trajet est-il dégagé ? Vrai si le segment ne coupe l'emprise d'aucun
   *  bâtiment ni du camp : les bêtes contournent, elles ne traversent plus. */
  private readonly segClear: (x0: number, z0: number, x1: number, z1: number) => boolean

  constructor(
    private readonly island: Island,
    private readonly obstacles: { x: number; z: number; r: number }[] = [],
  ) {
    this.group.name = 'fauna'
    // Positions des sapins : la « lisière » se mesure contre eux, pas contre
    // une carte de forêt qui n'existe pas.
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
    // Le village entier est un obstacle : le verdict du jury était unanime —
    // moutons contre le tipi, cerf à une tuile du feu, clipping d'atelier.
    // Distance au BORD de l'emprise, pas au centre : une hutte et un aqueduc
    // n'ont pas le même rayon.
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
      for (const o of this.obstacles) if (hits(o.x, o.z, o.r + 0.25)) return false
      for (const b of CAMP_BLOCKERS) if (hits(b.x, b.z, b.r + 0.2)) return false
      return true
    }

    const land = island.cells.filter((c) => !c.beach && !inCamp(c.x, c.z, 0.3))
    /** Rayon de l'île : les habitats se raisonnent en PART du rayon, pas en
     *  unités monde — l'île double de taille entre l'âge 0 et l'âge 9. */
    const R = Math.max(6, island.radius)

    /** Une zone d'habitat, par NOTATION et non par filtre. L'ancien code
     *  filtrait dur (« entre 9,5 et 14 unités du feu ») puis, faute de
     *  candidats, retombait sur TOUTE l'île : sur une île jeune, moutons,
     *  poules et chevreuils finissaient mélangés n'importe où. Ici chaque
     *  cellule est notée et l'espèce prend les meilleures : il y a toujours
     *  une zone cohérente, même quand l'île est minuscule. */
    const zone = (score: (c: (typeof land)[number]) => number, frac = 0.16): Spot[] => {
      const scored = land
        .map((c) => ({ c, k: score(c) }))
        .sort((a, b) => b.k - a.k)
      const n = Math.max(4, Math.round(scored.length * frac))
      return scored.slice(0, n).map((e) => ({ x: e.c.x, z: e.c.z }))
    }
    /** Pénalité commune : ni sur un chemin battu, ni collé au bâti. */
    const room = (c: (typeof land)[number], need: number): number =>
      (c.trod ? -6 : 0) + (objDist(c.x, c.z) > need ? 0.5 : -6)

    // Le chevreuil vit EN LISIÈRE : sous le couvert, jamais en plein pré, et
    // le plus loin possible du feu.
    this.deerSpots = zone(
      (c) =>
        room(c, 1.0) -
        Math.abs(treeDist(c.x, c.z) - 1.3) * 1.8 +
        Math.min(fireDist(c.x, c.z) / R, 1.2) * 2.4 +
        Math.min(c.inland, 3) * 0.3,
      0.14,
    )
    // Le mouton veut de la PLAINE : loin des arbres, à mi-distance du village
    // — assez près pour être gardé, assez loin pour ne pas piétiner le camp.
    this.sheepSpots = zone(
      (c) =>
        room(c, 1.0) +
        Math.min(treeDist(c.x, c.z), 4) * 1.3 -
        Math.abs(fireDist(c.x, c.z) / R - 0.6) * 4.5,
      0.14,
    )
    // La poule ne quitte pas la basse-cour : quelques pas du foyer, dehors.
    this.henSpots = zone(
      (c) => room(c, 0.6) - Math.abs(fireDist(c.x, c.z) - 3.4) * 2.2,
      0.08,
    )
    // Le cheval : les grands prés du bout de l'île.
    this.horseSpots = zone(
      (c) =>
        room(c, 1.2) +
        Math.min(treeDist(c.x, c.z), 5) * 0.9 +
        Math.min(fireDist(c.x, c.z) / R, 1.2) * 2.8,
      0.12,
    )

    // Le troupeau de moutons reste groupé : ses cibles se limitent au voisinage
    // d'une ancre, tirée là où les prés sont les plus denses.
    const anchor = this.sheepSpots[(Math.random() * this.sheepSpots.length) | 0]!
    const nearAnchor = this.sheepSpots.filter((s) => Math.hypot(s.x - anchor.x, s.z - anchor.z) < 2.6)
    if (nearAnchor.length >= 3) this.sheepSpots = nearAnchor

    const build = (geo: BufferGeometry, n: number, spread: number): InstancedMesh => {
      const mesh = new InstancedMesh(geo, this.skin, n)
      mesh.instanceMatrix.setUsage(DynamicDrawUsage)
      // Les instances vivent loin de la géométrie d'origine : le culling par
      // boîte de la géométrie les ferait clignoter.
      mesh.frustumCulled = false
      for (let i = 0; i < n; i++) mesh.setColorAt(i, tint(new Color('#ffffff'), i * 17 + n, spread))
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      this.group.add(mesh)
      return mesh
    }
    this.deerMesh = build(deerGeo(), 3, 0.07)
    this.sheepMesh = build(sheepGeo(), 4, 0.05)
    this.henMesh = build(henGeo(), 3, 0.04)
    this.horseMesh = build(horseGeo(), 2, 0.09)
    this.gullMesh = build(gullGeo(), 3, 0.03)
    this.sheepMesh.visible = false
    this.henMesh.visible = false
    this.horseMesh.visible = false
    this.gullMesh.visible = false

    this.deer = makeHerd(3, this.deerSpots)
    this.sheep = makeHerd(4, this.sheepSpots)
    this.hens = makeHerd(3, this.henSpots)
    this.horses = makeHerd(2, this.horseSpots)

    // Mouettes : centres AU LARGE de l'enveloppe de l'île — l'orbite entière
    // reste au-dessus de l'eau, près du rivage.
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
      })
    }
  }

  /** Chaque espèce apparaît avec le savoir qui la fait entrer dans la vie de la
   *  tribu. Appelé chaque frame depuis main — quatre booléens, rien de plus. */
  setKnown(agriculture: boolean, granary: boolean, horsecollar: boolean, sail: boolean): void {
    this.sheepMesh.visible = agriculture
    this.henMesh.visible = granary
    this.horseMesh.visible = horsecollar
    this.gullMesh.visible = sail
  }

  // ── Les poissons de la baie ───────────────────────────────────────────────
  // Un poisson saute de temps en temps près du rivage ; quand le colon pêche,
  // la baie s'anime autour de lui. Un seul petit mesh, invisible entre deux
  // sauts.
  private fishMesh: Mesh | null = null
  private fish = { t: 0, dur: 0.8, x: 0, z: 0, dx: 0, dz: 0 }
  private fishTimer = 6
  private fishingSpot: { x: number; z: number } | null = null
  /** La boucle écoute : un plop au moment du saut si le son est activé. */
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
      // Le museau suit la parabole : il monte, bascule, replonge.
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
      // Dans la baie du pêcheur : à quelques mètres au large de son rivage.
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

  /** Migration : tout le troupeau de cerfs traverse l'île au galop dans une
   *  même direction, puis reprend sa vie de lisière. */
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
    }
  }

  update(dt: number, time: number, settler: Vector3, night: boolean): void {
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
    for (let i = 0; i < herd.length; i++) {
      const b = herd[i]!
      b.sleep += ((night ? 1 : 0) - b.sleep) * Math.min(1, dt * 1.4)
      const awake = b.sleep < 0.4

      if (awake) {
        // Le gibier fuit : dès que le colon approche, cap sur le point
        // d'habitat le plus à l'écart de lui.
        if (threat && b.state !== 3) {
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
            // Sursaut : il se retourne d'un coup — sinon il traverse le colon
            // pendant que son cap tourne.
            b.heading = Math.atan2(b.tx - b.x, b.tz - b.z)
          }
        }

        if (b.state === 0 || b.state === 3) {
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
            // Il avance là où il regarde, pas vers la cible brute : le virage
            // se lit au lieu d'un glissement latéral.
            b.x += Math.sin(b.heading) * sp * dt
            b.z += Math.cos(b.heading) * sp * dt
            b.phase += dt * cfg.bobFreq * (flee ? 1.8 : 1)
          }
          if (flee) {
            b.timer -= dt
            if (b.timer < 0) b.state = 0
          }
        } else {
          b.timer -= dt
          if (b.timer < 0) pickTarget(b, spots, cfg, this.segClear)
        }
      }

      // Jamais dans le bâti : poussée radiale hors de l'emprise RÉELLE de
      // chaque bâtiment — le rayon uniforme laissait entrer dans les grands.
      for (const o of this.obstacles) {
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
      for (let k = 0; k < CAMP_BLOCKERS.length; k++) {
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
      // Brouter = tout le corps qui bascule, museau vers l'herbe, avec une
      // petite houle : à cette échelle c'est plus lisible qu'un cou articulé.
      const wantPitch = grazing ? cfg.grazePitch * (0.82 + 0.18 * Math.sin(time * 2.2 + b.phase)) : 0
      b.pitch += (wantPitch - b.pitch) * Math.min(1, dt * 3)

      const bob = moving ? Math.abs(Math.sin(b.phase)) * cfg.bobAmp : 0
      dummy.position.set(b.x, this.island.heightAt(b.x, b.z) + bob - b.pitch * 0.1 - b.sleep * 0.1, b.z)
      dummy.rotation.set(b.pitch, b.heading, moving ? Math.sin(b.phase) * 0.05 : 0)
      // La nuit : couché sur place — tassé, immobile, un peu élargi.
      dummy.scale.set(1 + b.sleep * 0.12, 1 - b.sleep * 0.55, 1 + b.sleep * 0.06)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }

  private stepGulls(dt: number, time: number): void {
    for (let i = 0; i < this.gulls.length; i++) {
      const g = this.gulls[i]!
      g.a += g.w * dt
      const x = g.cx + Math.cos(g.a) * g.r
      const z = g.cz + Math.sin(g.a) * g.r
      // Cap tangent au cercle, dans le sens de rotation.
      const heading = Math.atan2(-Math.sin(g.a) * g.w, Math.cos(g.a) * g.w)
      // Battement accepté en bascule du corps : roulis rapide + inclinaison
      // vers l'intérieur du virage.
      const flap = Math.sin(time * 6.2 + g.phase)
      dummy.position.set(x, g.alt + Math.sin(time * 0.8 + g.phase) * 0.2 + flap * 0.03, z)
      dummy.rotation.set(0.08, heading, (g.w > 0 ? -0.2 : 0.2) + flap * 0.3)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      this.gullMesh.setMatrixAt(i, dummy.matrix)
    }
    this.gullMesh.instanceMatrix.needsUpdate = true
  }
}
