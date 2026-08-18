import {
  BoxGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshToonMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from 'three'
import { PALETTE, ramp, rampTexture, smoothstep, tint } from './palette'

/** Small deterministic PRNG — the island must look identical on every reload. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash2(x: number, y: number, seed: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453
  return s - Math.floor(s)
}

/** Bruit de valeur interpolé. La version en escalier d'avant donnait des
 *  plateaux aléatoires collés les uns aux autres : du bruit, pas du relief. */
function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash2(xi, yi, seed)
  const b = hash2(xi + 1, yi, seed)
  const c = hash2(xi, yi + 1, seed)
  const d = hash2(xi + 1, yi + 1, seed)
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}

/** `Math.atan2` est le poste dominant quand on peint la nappe d'eau : cent
 *  cinquante mille appels au chargement. Cette approximation en polynôme est
 *  deux fois plus rapide et juste à 1e-4 radian, soit cent fois mieux que le
 *  pas de la table de contour qu'elle sert à indexer. */
function fastAtan2(y: number, x: number): number {
  const ax = Math.abs(x)
  const ay = Math.abs(y)
  const a = Math.min(ax, ay) / (Math.max(ax, ay) + 1e-12)
  const s = a * a
  let r = ((-0.0464964749 * s + 0.15931422) * s - 0.327622764) * s * a + a
  if (ay > ax) r = 1.57079637 - r
  if (x < 0) r = 3.14159274 - r
  return y < 0 ? -r : r
}

function fbm(x: number, y: number, seed: number): number {
  return valueNoise(x, y, seed) * 0.64 + valueNoise(x * 2.3, y * 2.3, seed + 17) * 0.36
}

export const TILE = 1.35
export const GRID = 26

/** Épaisseur de la couche d'herbe : le reste de la colonne est de la terre,
 *  c'est elle qui dessine les contre-marches des terrasses. */
const CAP = 0.3
/** Les hauteurs sont quantifiées : des paliers nets se lisent de loin, une
 *  pente continue devient une bouillie. */
const STEP = 0.44
/** Le plan d'eau est y=0 et rien ne descend en dessous : la ligne d'eau est une
 *  arête de géométrie. Un socle qui plongeait jusqu'au fond se diluait dans la
 *  brume et l'île semblait flotter au-dessus de son reflet. */
const BED_Y = -0.02
/** Vrai miroir vertical, sans écrasement : c'est l'écrasement qui donnait à
 *  l'image du dessous l'air d'un tampon plutôt que d'un reflet. */
const MIRROR = 1
/** Bande mouillée retenue au-dessus de l'arête, sur tout le pourtour. */
const WET = 0.17
const PLAZA_RADIUS = 5.1
/** Clairière de terre battue. Centrée entre l'origine et le foyer que village.ts
 *  pose en (-1,15 ; 1,15), pour rester dans la place plate. */
const TROD = { x: -0.6, z: 0.6, r: 4.1 }
/** Rayon sans sapin autour du feu : la forêt doit encadrer le campement, pas
 *  le manger. */
const CLEAR_RADIUS = 8.2

const EDGE_BASE = 9.3
const EDGE_MAX = EDGE_BASE + 1.15 + 0.6 + 0.8
/** Rayon de cadrage : la caméra s'en sert pour tenir l'île entière à l'écran. */
export const ISLAND_RADIUS = EDGE_MAX * TILE + 0.6

/** Silhouette lobée plutôt qu'un disque : c'est le contour qui fait lire
 *  l'île comme un objet posé, pas comme un morceau de terrain. */
function shoreEdge(theta: number, seed: number): number {
  return (
    EDGE_BASE +
    1.15 * Math.sin(3 * theta + 0.9) +
    0.6 * Math.sin(5 * theta - 1.7) +
    0.8 * valueNoise(Math.cos(theta) * 2.4 + 8, Math.sin(theta) * 2.4 + 8, seed)
  )
}

export interface Cell {
  gx: number
  gz: number
  x: number
  z: number
  height: number
  beach: boolean
  /** Distance au rivage, en cellules. */
  inland: number
  /** Occlusion cuite par cellule : les creux et les pieds de falaise foncent. */
  ao: number
  /** Cellule du pourtour : c'est elle qui porte la bande mouillée. */
  rim: boolean
  /** Terre battue de la clairière. */
  trod: boolean
}

export type NodeKind = 'wood' | 'stone' | 'food'

export class Island {
  readonly group = new Group()
  readonly cells: Cell[] = []
  readonly pickables: InstancedMesh[] = []
  /** Flat ground spots reserved for buildings, ordered from the fire outwards. */
  readonly buildSlots: Vector3[] = []
  private kindOf = new Map<InstancedMesh, NodeKind>()
  private byKey = new Map<number, Cell>()

  constructor(private readonly seed = 1337) {
    const rnd = mulberry32(seed)
    const half = GRID / 2
    const plaza = STEP * 4

    for (let gx = 0; gx < GRID; gx++) {
      for (let gz = 0; gz < GRID; gz++) {
        const dx = gx - half + 0.5
        const dz = gz - half + 0.5
        const r = Math.hypot(dx, dz)
        const theta = Math.atan2(dz, dx)
        const edge = shoreEdge(theta, seed)
        if (r > edge) continue
        const inland = edge - r
        const hill = fbm(gx * 0.23, gz * 0.23, seed)
        const shore = Math.min(inland / 2.4, 1)
        const raw = 0.3 + shore * (0.3 + hill * 2.4)
        const x = dx * TILE
        const z = dz * TILE
        let height = Math.max(STEP, Math.round(raw / STEP) * STEP)
        // Un liseré de sable tout autour donnerait un gâteau. Suivant l'angle,
        // la côte est soit une plage, soit une petite falaise dans l'eau.
        const sandy = valueNoise(Math.cos(theta) * 3.1 + 20, Math.sin(theta) * 3.1 + 20, seed) > 0.44
        const beach = inland < 1.05 && sandy
        if (inland < 1.05) height = sandy ? STEP : STEP * 2
        else if (inland < 2.2) height = Math.min(height, STEP * 3)
        // La place centrale est plate : le village a besoin d'un socle lisible.
        if (Math.hypot(x, z) < PLAZA_RADIUS) height = plaza
        // Bord bruité : un disque de terre parfait ressemble à un décalque, pas
        // à un sol usé par les allées et venues.
        const trod =
          Math.hypot(x, z) < PLAZA_RADIUS &&
          Math.hypot(x - TROD.x, z - TROD.z) <
            TROD.r * (0.78 + valueNoise(x * 0.62, z * 0.62, seed + 31) * 0.42)
        // Le sol tassé s'enfonce d'un cheveu : le liseré d'herbe qui reste sur
        // le pourtour donne à la clairière une bordure au lieu d'un aplat.
        if (trod) height = plaza - 0.09
        const cell: Cell = { gx, gz, x, z, height, beach, inland, ao: 1, rim: false, trod }
        this.cells.push(cell)
        this.byKey.set(gx * 64 + gz, cell)
      }
    }

    this.bakeOcclusion()
    this.buildTerrain()
    this.buildWater()
    this.scatter(rnd)
  }

  /** Une cellule cernée de voisins plus hauts reçoit moins de ciel. Sans ça les
   *  terrasses s'aplatissent et l'île redevient une nappe verte uniforme. */
  private bakeOcclusion(): void {
    const offsets: [number, number, number][] = [
      [1, 0, 1],
      [-1, 0, 1],
      [0, 1, 1],
      [0, -1, 1],
      [1, 1, 0.6],
      [1, -1, 0.6],
      [-1, 1, 0.6],
      [-1, -1, 0.6],
    ]
    for (const c of this.cells) {
      let occ = 0
      for (const [ox, oz, w] of offsets) {
        const n = this.byKey.get((c.gx + ox) * 64 + (c.gz + oz))
        if (!n) {
          // Un voisin absent, c'est de l'eau : le pourtour garde tout son ciel,
          // sinon la silhouette s'assombrit là où elle doit trancher.
          if (Math.abs(ox) + Math.abs(oz) === 1) c.rim = true
          continue
        }
        const d = n.height - c.height
        if (d > 0.05) occ += w * Math.min(d / 0.75, 1)
      }
      c.ao = Math.max(0.42, 1 - occ * 0.215)
    }
  }

  private buildTerrain(): void {
    const geo = new BoxGeometry(TILE, 1, TILE)
    const mat = new MeshLambertMaterial()
    const rims = this.cells.filter((c) => c.rim)
    // Deux boîtes par cellule — socle de terre, couche d'herbe — plus une bande
    // mouillée sur le seul pourtour. La troisième boîte d'avant descendait
    // jusqu'au fond de l'eau : c'est elle qui noyait la ligne de flottaison.
    const mesh = new InstancedMesh(geo, mat, this.cells.length * 2 + rims.length)
    mesh.castShadow = true
    mesh.receiveShadow = true

    const refl = new InstancedMesh(geo, new MeshBasicMaterial(), this.cells.length)

    const dummy = new Object3D()
    const capColor = new Color()
    const socleColor = new Color()
    const wetColor = new Color()
    const reflColor = new Color()
    const grassRamp = [
      [0, PALETTE.grassDark],
      [0.55, PALETTE.grass],
      [1, PALETTE.grassLight],
    ] as const

    this.cells.forEach((c, i) => {
      const capBottom = Math.max(0.06, c.height - CAP)

      dummy.position.set(c.x, capBottom / 2, c.z)
      dummy.scale.set(1, capBottom, 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i * 2, dummy.matrix)

      dummy.position.set(c.x, (c.height + capBottom) / 2, c.z)
      dummy.scale.set(1, Math.max(0.06, c.height - capBottom), 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i * 2 + 1, dummy.matrix)

      if (c.trod) {
        // Plus on approche du feu, plus la terre est tassée et sombre.
        const packed = smoothstep(TROD.r, 0.6, Math.hypot(c.x - TROD.x, c.z - TROD.z))
        capColor.copy(PALETTE.dirt).lerp(PALETTE.dirtDark, packed * 0.75)
      } else if (c.beach) capColor.copy(PALETTE.sand)
      else ramp(grassRamp, smoothstep(0.5, 2.6, c.height), capColor)
      // Marbrure basse fréquence en plus du bruit par tuile : un aplat de
      // couleur unique sur toute une terrasse fait carton découpé.
      const mottle = 0.93 + fbm(c.gx * 0.55, c.gz * 0.55, 7) * 0.14
      capColor.copy(tint(capColor, c.gx * 31 + c.gz, 0.06)).multiplyScalar(c.ao * mottle)

      socleColor
        .copy(PALETTE.earth)
        .lerp(PALETTE.earthDark, 0.68 - smoothstep(0.4, 1.8, c.height) * 0.3)
        .multiplyScalar(c.ao * 0.88)

      mesh.setColorAt(i * 2, socleColor)
      mesh.setColorAt(i * 2 + 1, capColor)

      // Reflet : la colonne, retournée, accrochée exactement à l'arête (y=0).
      // Elle est décalée et élargie d'un rien avec la profondeur — l'eau ne
      // renvoie pas une copie nette, elle l'étire latéralement.
      const mirror = Math.max(0.06, c.height * MIRROR)
      const drift = 0.04 + mirror * 0.06
      dummy.position.set(
        c.x + Math.sin(c.gx * 1.73 + c.gz * 0.91) * drift,
        -mirror / 2,
        c.z + Math.cos(c.gx * 1.11 + c.gz * 1.67) * drift,
      )
      dummy.scale.set(1.1, mirror, 1.1)
      dummy.updateMatrix()
      refl.setMatrixAt(i, dummy.matrix)
      // Le reflet part de la couleur de l'eau, pas du haut-fond : mélangé au
      // haut-fond il virait au blanc laiteux et redevenait un halo.
      reflColor.copy(PALETTE.water).lerp(capColor, 0.56).multiplyScalar(0.86)
      refl.setColorAt(i, reflColor)
    })

    // Bande mouillée : deux ou trois pixels sombres et saturés retenus juste
    // au-dessus de l'arête. Sans elle, la coupe est nette mais sèche, et l'île
    // a l'air posée sur l'eau plutôt que dedans.
    const base = this.cells.length * 2
    rims.forEach((c, i) => {
      dummy.position.set(c.x, WET / 2, c.z)
      dummy.scale.set(1.008, WET, 1.008)
      dummy.updateMatrix()
      mesh.setMatrixAt(base + i, dummy.matrix)
      wetColor.copy(c.beach ? PALETTE.sand : PALETTE.earth).multiplyScalar(0.3)
      wetColor.offsetHSL(0, 0.22, 0)
      mesh.setColorAt(base + i, wetColor)
    })

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    refl.instanceMatrix.needsUpdate = true
    if (refl.instanceColor) refl.instanceColor.needsUpdate = true
    this.group.add(mesh, refl)
  }

  /** Deux fois la même nappe, à deux centièmes d'unité l'une de l'autre : une
   *  couche opaque qui donne la couleur, les reflets par-dessus, puis la même
   *  image translucide qui les repose dans l'eau. Le fond profond d'avant,
   *  posé trois unités plus bas, se lisait comme un disque sombre autour de
   *  l'île — une tache de fond, pas une ombre. */
  private buildWater(): void {
    const SPAN = 1600
    // Le contour de l'île, tabulé une fois : le recalculer par pixel coûterait
    // cent mille sinus.
    const LUT = 512
    const lut = new Float32Array(LUT)
    let maxEdge = 0
    for (let i = 0; i < LUT; i++) {
      const e = shoreEdge((i / LUT) * Math.PI * 2, this.seed)
      lut[i] = e
      if (e > maxEdge) maxEdge = e
    }
    // La texture ne couvre que l'île et trois cellules d'eau autour : la
    // résolution part là où se joue le trait de côte, le bord clampé donne
    // exactement la couleur du large. Chaque cellule de marge en plus est un
    // quart de texture payé pour peindre du bleu uni.
    const span = (maxEdge + 3.2) * TILE
    /** Distance signée au trait de côte, en cellules. La quantification en
     *  tuiles rentre autant qu'elle déborde : en moyenne la silhouette rendue
     *  tombe sur `shoreEdge`, sans correction. */
    const shoreDist = (x: number, z: number): number => {
      const t = ((fastAtan2(z, x) / (Math.PI * 2)) % 1) + 1
      const f = t * LUT
      const i0 = Math.floor(f) % LUT
      const k = f - Math.floor(f)
      const edge = lut[i0]! * (1 - k) + lut[(i0 + 1) % LUT]! * k
      return Math.sqrt(x * x + z * z) / TILE - edge
    }
    // Décalage de l'ombre portée : la direction du soleil de scene.ts projetée
    // au sol pour une hauteur d'île moyenne.
    const SHADE_X = 1.15
    const SHADE_Z = -0.81
    const tex = rampTexture(256, 256, (u, v, out) => {
      const x = (u - 0.5) * 2 * span
      // La nappe est tournée de -90° : le v de la texture descend en -z.
      const z = -(v - 0.5) * 2 * span
      const d = shoreDist(x, z)
      // Nappe d'une seule couleur : c'est la brume qui creuse la distance. Le
      // dégradé radial d'avant faisait exactement le halo qu'on nous reproche.
      out.copy(PALETTE.water).multiplyScalar(1 - smoothstep(0.4, 3.2, d) * 0.1)
      // Tout ce qui suit meurt avant deux cellules. Le large, qui est
      // l'essentiel de la texture, ne paie ni la ride ni la seconde empreinte.
      if (d < 2) {
        // Haut-fond serré : quelques dizaines de centimètres d'eau claire, pas
        // une auréole. Étalé sur plus d'une tuile, il redevient un halo.
        out.lerp(PALETTE.waterShallow, smoothstep(0.35, -0.7, d) * 0.4)
        // Ride claire qui épouse l'empreinte : un objet qui déplace l'eau.
        // Étroite et posée sur le contact — élargie, elle se confond avec le
        // reflet, qui occupe le même quart d'écran, et les deux font un halo.
        const ring = smoothstep(-0.05, 0.1, d) * smoothstep(0.34, 0.16, d)
        out.lerp(PALETTE.foam, ring * 0.62)
        // Ombre portée : la même empreinte, décalée à l'opposé du soleil.
        const shade =
          smoothstep(0.4, -0.3, shoreDist(x - SHADE_X, z - SHADE_Z)) * smoothstep(2, 0.2, d)
        out.multiplyScalar(1 - shade * 0.24)
      }
      // La moitié de la nappe laisse passer ce qu'il y a dessous au pied de
      // l'île, et rien au large : le reflet ne vit que collé à son objet.
      return 0.5 + smoothstep(0.9, 2.8, d) * 0.5
    })
    // La rampe ne couvre que le centre de la nappe ; au-delà, le bord clampé
    // donne exactement la couleur du large.
    const k = SPAN / span
    tex.repeat.set(k, k)
    tex.offset.set((1 - k) / 2, (1 - k) / 2)

    const disc = new CircleGeometry(SPAN, 64)

    // Couche opaque : même texture, même mapping, donc aucun décalage de
    // parallaxe avec la surface — ce qui n'est pas reflété reste invisible.
    const bed = new Mesh(disc, new MeshBasicMaterial({ map: tex, depthWrite: false }))
    bed.rotation.x = -Math.PI / 2
    bed.position.y = BED_Y
    bed.renderOrder = -3

    const surface = new Mesh(
      disc,
      new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
    )
    surface.rotation.x = -Math.PI / 2
    surface.renderOrder = -1

    this.group.add(bed, surface)
  }

  /** Trees, rocks and berry bushes: three instanced draw calls for the whole map,
   *  each one also serving as the tap target that sets the settler's focus. */
  private scatter(rnd: () => number): void {
    const solid = this.cells.filter((c) => !c.beach)
    const near = solid
      .filter((c) => Math.hypot(c.x, c.z) <= PLAZA_RADIUS + 1.2)
      .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))
    for (const c of near) this.buildSlots.push(new Vector3(c.x, c.height, c.z))

    // Le rivage reste nu : c'est lui qui donne sa découpe à la silhouette.
    const open = solid.filter((c) => !c.trod && c.inland > 1.7)
    const free = open.filter((c) => Math.hypot(c.x - TROD.x, c.z - TROD.z) > PLAZA_RADIUS + 0.9)
    // Les sapins reculent bien au-delà de la place : le feu est le seul signe
    // d'habitat de la maquette, il lui faut de l'air autour.
    const wooded = open.filter((c) => Math.hypot(c.x - TROD.x, c.z - TROD.z) > CLEAR_RADIUS)

    const centers: Cell[] = []
    for (let i = 0; i < 7; i++) {
      const c = wooded[Math.floor(rnd() * wooded.length)]
      if (c) centers.push(c)
    }
    // Bosquets plutôt que semis régulier : il faut des clairières pour voir le sol.
    const clustered = (pool: Cell[], spread: number): Cell[] =>
      pool
        .map((c) => ({
          c,
          k:
            centers.reduce((m, o) => Math.min(m, Math.hypot(c.x - o.x, c.z - o.z)), 99) +
            rnd() * spread,
        }))
        .sort((a, b) => a.k - b.k)
        .map((e) => e.c)

    const picked = new Set<Cell>()
    const take = (n: number, order: Cell[], ok: (c: Cell) => boolean): Cell[] => {
      const out: Cell[] = []
      for (const c of order) {
        if (out.length >= n) break
        if (picked.has(c) || !ok(c)) continue
        picked.add(c)
        out.push(c)
      }
      return out
    }

    this.addTrees(take(46, clustered(wooded, 3.4), () => true), rnd)
    // Pierres et buissons, eux, ont le droit de border la clairière : ce sont
    // eux qui l'encadrent une fois les sapins reculés.
    this.addRocks(take(22, clustered(free, 9), (c) => c.height > 1.2), rnd)
    this.addBushes(take(26, clustered(free, 6), () => true), rnd)
  }

  private addTrees(cells: Cell[], rnd: () => number): void {
    const trunkGeo = new CylinderGeometry(0.11, 0.16, 0.9, 6)
    const trunkMat = new MeshToonMaterial({ color: PALETTE.trunk })
    const trunks = new InstancedMesh(trunkGeo, trunkMat, cells.length)

    const leafGeo = new ConeGeometry(0.62, 1.5, 7)
    const leafMat = new MeshToonMaterial()
    const leaves = new InstancedMesh(leafGeo, leafMat, cells.length)
    const refl = new InstancedMesh(
      new ConeGeometry(0.62, 1.5, 7),
      new MeshBasicMaterial(),
      cells.length,
    )
    leaves.castShadow = true
    trunks.castShadow = true

    const d = new Object3D()
    const leafColors = [PALETTE.leafA, PALETTE.leafB, PALETTE.leafC]
    cells.forEach((c, i) => {
      const s = 0.72 + rnd() * 0.45
      const jx = (rnd() - 0.5) * 0.5
      const jz = (rnd() - 0.5) * 0.5
      d.position.set(c.x + jx, c.height + 0.45 * s, c.z + jz)
      d.rotation.set(0, rnd() * Math.PI, 0)
      d.scale.setScalar(s)
      d.updateMatrix()
      trunks.setMatrixAt(i, d.matrix)
      d.position.y = c.height + 1.65 * s
      d.updateMatrix()
      leaves.setMatrixAt(i, d.matrix)
      const leaf = tint(leafColors[i % 3]!, i, 0.08)
      leaves.setColorAt(i, leaf.clone().multiplyScalar(0.9 + c.ao * 0.1))

      // Même miroir que le terrain, sinon les sapins pendent sous l'île au lieu
      // de s'y raccorder ; plus faible, parce qu'ils tombent dans l'eau la plus
      // lointaine du reflet.
      // Cônes élargis et raccourcis : un reflet de sapin à la bonne forme fait
      // une frange de pointes détachée sous l'île. Étalé, il redevient une
      // tache verte dans l'eau, ce qu'un reflet flou est vraiment.
      const drift = 0.1 + rnd() * 0.16
      d.position.set(c.x + jx + drift, -MIRROR * (c.height + 1.2 * s), c.z + jz - drift)
      d.rotation.set(Math.PI, d.rotation.y, 0)
      d.scale.set(s * 1.7, s * MIRROR * 0.7, s * 1.7)
      d.updateMatrix()
      refl.setMatrixAt(i, d.matrix)
      refl.setColorAt(i, PALETTE.water.clone().lerp(leaf, 0.42).multiplyScalar(0.86))
    })
    trunks.instanceMatrix.needsUpdate = true
    leaves.instanceMatrix.needsUpdate = true
    refl.instanceMatrix.needsUpdate = true
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true
    if (refl.instanceColor) refl.instanceColor.needsUpdate = true
    this.group.add(trunks, leaves, refl)
    this.registerPickable(leaves, 'wood')
  }

  private addRocks(cells: Cell[], rnd: () => number): void {
    const geo = new DodecahedronGeometry(0.42, 0)
    const mat = new MeshToonMaterial()
    const mesh = new InstancedMesh(geo, mat, cells.length)
    mesh.castShadow = true
    mesh.receiveShadow = true

    const d = new Object3D()
    cells.forEach((c, i) => {
      const s = 0.55 + rnd() * 0.7
      d.position.set(c.x + (rnd() - 0.5) * 0.6, c.height + 0.2 * s, c.z + (rnd() - 0.5) * 0.6)
      d.rotation.set(rnd() * 0.5, rnd() * Math.PI, rnd() * 0.5)
      d.scale.set(s, s * 0.75, s)
      d.updateMatrix()
      mesh.setMatrixAt(i, d.matrix)
      mesh.setColorAt(i, tint(i % 3 === 0 ? PALETTE.rockDark : PALETTE.rock, i, 0.07))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    this.group.add(mesh)
    this.registerPickable(mesh, 'stone')
  }

  private addBushes(cells: Cell[], rnd: () => number): void {
    const geo = new IcosahedronGeometry(0.34, 0)
    const mat = new MeshToonMaterial()
    const mesh = new InstancedMesh(geo, mat, cells.length)
    mesh.castShadow = true

    const d = new Object3D()
    const berry = new Color('#4a7340')
    cells.forEach((c, i) => {
      const s = 0.7 + rnd() * 0.5
      d.position.set(c.x + (rnd() - 0.5) * 0.7, c.height + 0.22 * s, c.z + (rnd() - 0.5) * 0.7)
      d.rotation.set(0, rnd() * Math.PI, 0)
      d.scale.set(s, s * 0.8, s)
      d.updateMatrix()
      mesh.setMatrixAt(i, d.matrix)
      mesh.setColorAt(i, tint(berry, i * 7, 0.1))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    this.group.add(mesh)
    this.registerPickable(mesh, 'food')
  }

  private registerPickable(mesh: InstancedMesh, kind: NodeKind): void {
    this.pickables.push(mesh)
    this.kindOf.set(mesh, kind)
  }

  kindFor(mesh: InstancedMesh): NodeKind | undefined {
    return this.kindOf.get(mesh)
  }

  /** World position of one instance, used to send the settler to what was tapped. */
  instancePosition(mesh: InstancedMesh, index: number): Vector3 {
    const m = new Matrix4()
    mesh.getMatrixAt(index, m)
    const p = new Vector3()
    const q = new Quaternion()
    const s = new Vector3()
    m.decompose(p, q, s)
    return p
  }

  /** Ground height under a world position, for anything that walks. */
  heightAt(x: number, z: number): number {
    let best = 0
    let bestD = Infinity
    for (const c of this.cells) {
      const d = (c.x - x) ** 2 + (c.z - z) ** 2
      if (d < bestD) {
        bestD = d
        best = c.height
      }
    }
    return best
  }
}
