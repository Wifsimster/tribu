import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
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
import { PALETTE, SUN_DIR, ramp, rampTexture, smoothstep, tint } from './palette'

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
/** Le reflet est étiré vers le fond, jamais écrasé : à l'oblique, l'eau allonge
 *  ce qu'elle renvoie. L'écrasement, lui, donnait un tampon. */
const MIRROR = 2.4
/** Opacité du reflet à la ligne d'eau. Il s'éteint ensuite en profondeur : c'est
 *  l'arête franche du bas qui le faisait lire comme un empilement de boîtes. */
const REFL_ALPHA = 0.85
/** Bande mouillée sombre retenue au-dessus de l'arête, sur tout le pourtour. */
const WET = 0.15
/** Liseré spéculaire : la ligne claire pile au contact, sous la bande mouillée. */
const SHEEN = 0.05
/** Jupe immergée : la falaise continue sous la surface au lieu d'être tranchée
 *  net. C'est elle qui empêche les faces basses de virer au noir vide — vues à
 *  travers l'eau, elles doivent tirer vers le bleu. */
const SUB = 0.4
const PLAZA_RADIUS = 5.1
/** Clairière de terre battue. Centrée entre l'origine et le foyer que village.ts
 *  pose en (-1,15 ; 1,15), pour rester dans la place plate. */
const TROD = { x: -0.6, z: 0.6, r: 4.1 }
/** Rayon sans sapin autour du feu : la forêt doit encadrer le campement, pas
 *  le manger. */
const CLEAR_RADIUS = 8.6

/** La clairière est creusée plus loin derrière le campement que sur ses côtés.
 *  Au cadrage par défaut, la caméra regarde vers (−x,−z) : un sapin planté là
 *  monte à l'écran d'un demi-mètre par mètre de recul et vient poser sa base
 *  contre la pointe des tipis, alors qu'il en est loin dans le monde. */
function clearRadius(x: number, z: number): number {
  const dx = x - TROD.x
  const dz = z - TROD.z
  const d = Math.hypot(dx, dz)
  if (d < 1e-3) return CLEAR_RADIUS
  const back = Math.max(0, -(dx + dz) / (Math.SQRT2 * d))
  return CLEAR_RADIUS + back * back * back * 3.2
}

const EDGE_BASE = 9.3
const DEFAULT_SEED = 1337
/** Nombre de secteurs de la table de silhouette. À ce rayon, un secteur mesure
 *  un tiers de tuile : assez fin pour que la ride suive la découpe. */
const HULL_BINS = 256

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

/** Rayon de cadrage : la caméra s'en sert pour tenir l'île entière à l'écran.
 *  Mesuré sur la grille, pas majoré. La somme des amplitudes des trois lobes
 *  n'est jamais atteinte au même angle, et aucune tuile ne tombe sur ce maximum
 *  théorique : la valeur en dur surestimait le rayon de 5 %, autant de marge
 *  d'eau payée au cadrage pour du bleu uni. */
export const ISLAND_RADIUS = (() => {
  const half = GRID / 2
  const corner = TILE / 2
  let far = 0
  for (let gx = 0; gx < GRID; gx++) {
    for (let gz = 0; gz < GRID; gz++) {
      const dx = gx - half + 0.5
      const dz = gz - half + 0.5
      if (Math.hypot(dx, dz) > shoreEdge(Math.atan2(dz, dx), DEFAULT_SEED)) continue
      far = Math.max(far, Math.hypot(Math.abs(dx) * TILE + corner, Math.abs(dz) * TILE + corner))
    }
  }
  return far
})()

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
  /** Cellule du pourtour : c'est elle qui porte l'ourlet de rive. */
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
  /** Rayon de la silhouette rendue, par secteur angulaire. */
  private hull = new Float32Array(HULL_BINS)

  constructor(private readonly seed = DEFAULT_SEED) {
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
    this.bakeFootprint()
    this.buildTerrain()
    this.buildWater()
    this.buildRipple()
    this.scatter(rnd)
  }

  /** Empreinte réellement rendue : l'enveloppe polaire des coins des tuiles du
   *  pourtour. `shoreEdge` n'est que la courbe théorique ; ce que l'oeil voit
   *  est sa version quantifiée en tuiles, et c'est sur elle — pas sur une
   *  ellipse — que la ride et l'ombre de contact doivent se découper. */
  private bakeFootprint(): void {
    const step = (Math.PI * 2) / HULL_BINS
    // Plancher tiré de la courbe théorique : aucun secteur ne peut rester vide,
    // même dans une échancrure que les coins de tuiles couvrent mal.
    for (let i = 0; i < HULL_BINS; i++) {
      this.hull[i] = (shoreEdge(i * step, this.seed) - 0.7) * TILE
    }
    const h = TILE / 2
    for (const c of this.cells) {
      if (!c.rim) continue
      const a0 = Math.atan2(c.z, c.x)
      let lo = 0
      let hi = 0
      let far = 0
      for (let k = 0; k < 4; k++) {
        const cx = c.x + (k & 1 ? h : -h)
        const cz = c.z + (k & 2 ? h : -h)
        far = Math.max(far, Math.hypot(cx, cz))
        let a = Math.atan2(cz, cx) - a0
        if (a > Math.PI) a -= Math.PI * 2
        else if (a < -Math.PI) a += Math.PI * 2
        lo = Math.min(lo, a)
        hi = Math.max(hi, a)
      }
      const i0 = Math.floor((a0 + lo) / step)
      const i1 = Math.ceil((a0 + hi) / step)
      for (let i = i0; i <= i1; i++) {
        const j = ((i % HULL_BINS) + HULL_BINS) % HULL_BINS
        if (far > this.hull[j]!) this.hull[j] = far
      }
    }
    // Un cran de lissage : la ride épouse la découpe, elle n'en recopie pas
    // chaque marche d'escalier.
    const smooth = new Float32Array(HULL_BINS)
    for (let i = 0; i < HULL_BINS; i++) {
      smooth[i] =
        this.hull[(i + HULL_BINS - 1) % HULL_BINS]! * 0.25 +
        this.hull[i]! * 0.5 +
        this.hull[(i + 1) % HULL_BINS]! * 0.25
    }
    this.hull = smooth
  }

  /** Rayon de la silhouette dans une direction, interpolé entre deux secteurs. */
  private hullAt(theta: number): number {
    const f = (((theta / (Math.PI * 2)) % 1) + 1) * HULL_BINS
    const i = Math.floor(f)
    const k = f - i
    return this.hull[i % HULL_BINS]! * (1 - k) + this.hull[(i + 1) % HULL_BINS]! * k
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
    // Deux boîtes par cellule : socle de terre, couche d'herbe.
    const mesh = new InstancedMesh(geo, mat, this.cells.length * 2)
    mesh.castShadow = true
    mesh.receiveShadow = true

    // L'ourlet de rive est peint sans lumière : le liseré doit tenir sur la face
    // à l'ombre comme sur celle au soleil, et l'eau ne fait pas de clair-obscur
    // sur ce qu'elle noie. Éclairé, il s'éteignait sur la moitié du pourtour —
    // exactement la moitié où les falaises viraient au noir.
    const contact = new InstancedMesh(geo, new MeshBasicMaterial(), rims.length * 3)

    // Seule la bande côtière se reflète : au-delà, le reflet d'une colonne est
    // masqué par l'île elle-même et ne fait que s'empiler sous elle.
    const mirrored = this.cells.filter((c) => c.inland < 4)
    const refl = new InstancedMesh(
      this.reflectionBox(),
      new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }),
      mirrored.length,
    )
    refl.renderOrder = -2
    let reflIndex = 0

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
      // Le pied des falaises du pourtour prend un rien de l'eau qui le baigne :
      // sans ça, la face à l'ombre tombe dans un brun quasi noir alors qu'elle
      // devrait tirer vers le bleu de ce qui la mouille.
      if (c.rim) socleColor.lerp(PALETTE.water, 0.14)

      mesh.setColorAt(i * 2, socleColor)
      mesh.setColorAt(i * 2 + 1, capColor)

      if (c.inland < 4) {
        // Reflet : la colonne retournée, sans dérive ni élargissement, accrochée
        // sous la jupe immergée. Le décalage d'avant la détachait de la berge et
        // ses escaliers pâles se lisaient comme un calque translucide en travers
        // de l'eau. L'extinction en profondeur est cuite dans la géométrie.
        const mirror = Math.max(0.12, c.height * MIRROR)
        dummy.position.set(c.x, -SUB - mirror / 2, c.z)
        dummy.scale.set(1, mirror, 1)
        dummy.updateMatrix()
        refl.setMatrixAt(reflIndex, dummy.matrix)
        // Le reflet part de la couleur de l'eau, pas du haut-fond : mélangé au
        // haut-fond il virait au blanc laiteux et redevenait un halo.
        reflColor.copy(PALETTE.water).lerp(capColor, 0.45).multiplyScalar(0.92)
        refl.setColorAt(reflIndex, reflColor)
        reflIndex++
      }
    })

    // Trois bandes empilées sur le seul pourtour, du bas vers le haut : la jupe
    // immergée, le liseré mouillé pile au contact, puis deux ou trois pixels
    // sombres et saturés. C'est cet empilement qui pose l'île DANS l'eau au lieu
    // de la trancher au ras du plan.
    rims.forEach((c, i) => {
      const shore = c.beach ? PALETTE.sand : PALETTE.earth

      dummy.position.set(c.x, -SUB / 2, c.z)
      dummy.scale.set(1.004, SUB, 1.004)
      dummy.updateMatrix()
      contact.setMatrixAt(i * 3, dummy.matrix)
      wetColor.copy(shore).lerp(PALETTE.waterDeep, 0.74).multiplyScalar(0.95)
      contact.setColorAt(i * 3, wetColor)

      dummy.position.set(c.x, SHEEN / 2, c.z)
      dummy.scale.set(1.006, SHEEN, 1.006)
      dummy.updateMatrix()
      contact.setMatrixAt(i * 3 + 1, dummy.matrix)
      wetColor.copy(shore).lerp(PALETTE.sheen, 0.52).multiplyScalar(1.12)
      contact.setColorAt(i * 3 + 1, wetColor)

      dummy.position.set(c.x, SHEEN + WET / 2, c.z)
      dummy.scale.set(1.008, WET, 1.008)
      dummy.updateMatrix()
      contact.setMatrixAt(i * 3 + 2, dummy.matrix)
      wetColor.copy(shore).multiplyScalar(0.3).lerp(PALETTE.waterDeep, 0.34)
      contact.setColorAt(i * 3 + 2, wetColor)
    })

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    contact.instanceMatrix.needsUpdate = true
    if (contact.instanceColor) contact.instanceColor.needsUpdate = true
    refl.instanceMatrix.needsUpdate = true
    if (refl.instanceColor) refl.instanceColor.needsUpdate = true
    this.group.add(mesh, contact, refl)
  }

  /** Boîte du reflet, avec son extinction cuite dans l'alpha des sommets : plein
   *  à la ligne d'eau, éteint au fond. Un reflet qui se termine sur une arête
   *  franche ne lit pas comme un reflet mais comme une seconde île. */
  private reflectionBox(): BoxGeometry {
    const geo = new BoxGeometry(TILE, 1, TILE)
    const pos = geo.attributes.position!
    const rgba = new Float32Array(pos.count * 4)
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) + 0.5
      rgba[i * 4] = 1
      rgba[i * 4 + 1] = 1
      rgba[i * 4 + 2] = 1
      rgba[i * 4 + 3] = REFL_ALPHA * t * t
    }
    geo.setAttribute('color', new BufferAttribute(rgba, 4))
    return geo
  }

  /** La ride de contact, en géométrie et non en texture : un anneau découpé sur
   *  l'empreinte réelle, dont la partie intérieure passe sous les colonnes de
   *  terrain et se fait donc occlure par elles. Peinte dans la nappe, elle était
   *  étalée par le filtrage sur trente pixels et flottait en travers de la
   *  berge ; ici elle ne peut littéralement pas traverser l'île. */
  private buildRipple(): void {
    const RINGS = [
      { off: -0.45, alpha: 0.9 },
      { off: 0.1, alpha: 1 },
      { off: 0.34, alpha: 0.45 },
      { off: 0.82, alpha: 0 },
    ] as const
    const verts = new Float32Array(HULL_BINS * RINGS.length * 3)
    const colors = new Float32Array(HULL_BINS * RINGS.length * 4)
    const foam = PALETTE.foam
    for (let i = 0; i < HULL_BINS; i++) {
      const a = (i / HULL_BINS) * Math.PI * 2
      const cx = Math.cos(a)
      const cz = Math.sin(a)
      const r = this.hull[i]!
      RINGS.forEach((ring, k) => {
        const v = (k * HULL_BINS + i) * 3
        const d = r + ring.off * TILE
        verts[v] = cx * d
        // Juste au-dessus de la nappe : sous les tuiles, donc masquée par elles.
        verts[v + 1] = 0.012
        verts[v + 2] = cz * d
        const q = (k * HULL_BINS + i) * 4
        colors[q] = foam.r
        colors[q + 1] = foam.g
        colors[q + 2] = foam.b
        colors[q + 3] = ring.alpha * 0.5
      })
    }
    const index = new Uint16Array((RINGS.length - 1) * HULL_BINS * 6)
    let t = 0
    for (let k = 0; k < RINGS.length - 1; k++) {
      for (let i = 0; i < HULL_BINS; i++) {
        const j = (i + 1) % HULL_BINS
        const a0 = k * HULL_BINS + i
        const a1 = k * HULL_BINS + j
        const b0 = a0 + HULL_BINS
        const b1 = a1 + HULL_BINS
        index[t++] = a0
        index[t++] = b1
        index[t++] = b0
        index[t++] = a0
        index[t++] = a1
        index[t++] = b1
      }
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(verts, 3))
    geo.setAttribute('color', new BufferAttribute(colors, 4))
    geo.setIndex(new BufferAttribute(index, 1))
    const mesh = new Mesh(
      geo,
      // Une seule passe : `DoubleSide` sur un matériau transparent fait dessiner
      // l'anneau deux fois, et sa face utile est toujours celle du dessus.
      new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }),
    )
    this.group.add(mesh)
  }

  /** Deux fois la même nappe, à deux centièmes d'unité l'une de l'autre : une
   *  couche opaque qui donne la couleur, les reflets par-dessus, puis la même
   *  image translucide qui les repose dans l'eau. Le fond profond d'avant,
   *  posé trois unités plus bas, se lisait comme un disque sombre autour de
   *  l'île — une tache de fond, pas une ombre. */
  private buildWater(): void {
    const SPAN = 1600
    let maxEdge = 0
    for (let i = 0; i < HULL_BINS; i++) maxEdge = Math.max(maxEdge, this.hull[i]!)
    // La texture ne couvre que l'île et trois cellules d'eau autour : la
    // résolution part là où se joue le trait de côte, le bord clampé donne
    // exactement la couleur du large. Chaque cellule de marge en plus est un
    // quart de texture payé pour peindre du bleu uni.
    const span = maxEdge + 3.2 * TILE
    /** Distance signée à l'empreinte rendue, en cellules. */
    const shoreDist = (x: number, z: number): number =>
      (Math.sqrt(x * x + z * z) - this.hullAt(fastAtan2(z, x))) / TILE
    // Décalage de l'ombre portée : la direction du soleil, projetée au sol pour
    // une hauteur d'île moyenne. Recopiée à la main, elle finissait par ne plus
    // désigner le même soleil que la lumière de la scène.
    const SHADE_H = 1.55
    const SHADE_X = (-SUN_DIR.x / SUN_DIR.y) * SHADE_H
    const SHADE_Z = (-SUN_DIR.z / SUN_DIR.y) * SHADE_H
    const tex = rampTexture(256, 256, (u, v, out) => {
      const x = (u - 0.5) * 2 * span
      // La nappe est tournée de -90° : le v de la texture descend en -z.
      const z = -(v - 0.5) * 2 * span
      const d = shoreDist(x, z)
      // Nappe d'une seule couleur : c'est la brume qui creuse la distance. Le
      // dégradé radial d'avant faisait exactement le halo qu'on nous reproche.
      out.copy(PALETTE.water).multiplyScalar(1 - smoothstep(0.4, 3.2, d) * 0.1)
      // Tout ce qui suit meurt avant deux cellules. Le large, qui est
      // l'essentiel de la texture, ne paie pas l'ourlet de rive.
      if (d < 2.2) {
        // Haut-fond : une eau plus claire juste au large de la ride, décalée
        // vers l'extérieur pour laisser la place à l'ombre de contact.
        out.lerp(PALETTE.waterShallow, smoothstep(1.4, 0.5, d) * 0.12)
        // Ombre de contact : serrée sous le pourtour, indépendante du soleil.
        // C'est elle qui creuse le contact — sans elle, l'île est un pain de
        // terrain posé sur du bleu de valeur voisine.
        out.multiplyScalar(1 - smoothstep(0.7, -0.1, d) * 0.4)
        // Ombre portée : la même empreinte, décalée à l'opposé du soleil.
        const shade =
          smoothstep(0.4, -0.3, shoreDist(x - SHADE_X, z - SHADE_Z)) * smoothstep(2.2, 0.3, d)
        out.multiplyScalar(1 - shade * 0.2)
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
    const wooded = open.filter(
      (c) => Math.hypot(c.x - TROD.x, c.z - TROD.z) > clearRadius(c.x, c.z),
    )

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
    })
    trunks.instanceMatrix.needsUpdate = true
    leaves.instanceMatrix.needsUpdate = true
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true
    this.group.add(trunks, leaves)
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
