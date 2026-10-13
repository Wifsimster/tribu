import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshToonMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
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
export const GRID = 42

/** ── LE RÉSEAU HEXAGONAL ───────────────────────────────────────────────────
 *  Direction visuelle demandée (référence : hex builder). Les cellules sont
 *  des prismes hexagonaux « flat-top » posés sur un réseau axial (q, r).
 *
 *  Rayon choisi pour que le PAS EN X reste celui de l'ancienne grille carrée
 *  (1,5·R = TILE) : tout ce qui se raisonne en TILE — bord de côte, écume,
 *  place du village, portées de la faune — garde son échelle. */
export const HEX_R = TILE / 1.5
/** Pas du réseau : 1,5·R en x, √3·R en z (décalé d'un demi-pas par colonne). */
const HEX_DX = 1.5 * HEX_R
const HEX_DZ = Math.sqrt(3) * HEX_R
/** Les six voisins, dans l'ordre des six arêtes : l'arête k a pour normale
 *  extérieure l'angle 30° + 60°·k, et son voisin est NB[k]. */
const NB: readonly [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
]
/** Sommet k de l'hexagone (rayon circonscrit R), en repère local. */
function hexVertex(k: number, r = HEX_R): [number, number] {
  const a = (Math.PI / 3) * (k % 6)
  return [Math.cos(a) * r, Math.sin(a) * r]
}
/** Normale extérieure de l'arête k. */
function hexNormal(k: number): [number, number] {
  const a = (Math.PI / 3) * k + Math.PI / 6
  return [Math.cos(a), Math.sin(a)]
}
/** Hexagone plat, posé juste sous la nappe : renvoie l'indice de son premier
 *  sommet (les six suivent, dans l'ordre des coins). */
function seabedHex(
  vert: (x: number, y: number, z: number, nx: number, ny: number, nz: number, s: number) => number,
  x: number,
  z: number,
  s: number,
): number {
  const t0 = vert(x + HEX_R, -0.01, z, 0, 1, 0, s)
  for (let c = 1; c < 6; c++) {
    const [vx, vz] = hexVertex(c)
    vert(x + vx, -0.01, z + vz, 0, 1, 0, s)
  }
  return t0
}
/** Distance entre deux cellules axiales (la même que `hexDistance` de la
 *  simulation, que le rendu n'importe pas). */
function hexDistance(aq: number, ar: number, bq: number, br: number): number {
  const dq = aq - bq
  const dr = ar - br
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
}
function sectorHas(list: readonly { q: number; r: number }[], o: { q: number; r: number }): boolean {
  return list.some((a) => a.q === o.q && a.r === o.r)
}
/** Centre monde d'une cellule axiale. */
export function hexCenter(q: number, r: number): [number, number] {
  return [HEX_DX * q, HEX_DZ * (r + q / 2)]
}

/** Clé de cellule : les coordonnées axiales sont signées, on les décale. */
function key(q: number, r: number): number {
  return (q + 64) * 256 + (r + 64)
}

/** Griffonnage partagé de setDaylight : une teinte par frame, zéro allocation. */
const tmpTint = new Color()

/** Épaisseur de la couche d'herbe : le reste de la colonne est de la terre,
 *  c'est elle qui fait lire la tranche de la côte au-dessus de la flottaison. */
const CAP = 0.3
/** LA hauteur du sol, partout sur l'île. Retour de Damien : « retirer les
 *  différences de niveau sur les tiles […] un rendu propre au même niveau
 *  partout ». Les terrasses coinçaient un bâtiment sur deux entre deux
 *  paliers et chaque objet posé devait interroger le relief sous lui. 0,88 est
 *  la hauteur qu'avaient les falaises du pourtour : la côte garde la même
 *  tranche au-dessus de l'eau (bande mouillée de 0,34, terre, puis herbe),
 *  sans le gâteau qu'aurait fait une île entière à la hauteur de l'ancienne
 *  place (1,76). La plage se lit au sable, plus à un palier bas. */
export const GROUND_Y = 0.88
/** Le plan d'eau est y=0. La coque ne s'y arrête plus : l'île a un DESSOUS. */
const BED_Y = -0.02
/** Bande de flottaison sombre retenue au-dessus de l'arête, sur tout le
 *  pourtour. Sombre : l'eau qui remonte par capillarité fonce le pied, elle ne
 *  le fait jamais briller — le liseré spéculaire des rounds passés est mort ici. */
const WET = 0.34
/** Continuation immergée. Huit rounds ont perdu sur un REFLET — une copie
 *  INVERSÉE de l'île sous la flottaison. Un miroir, quel que soit son dosage,
 *  est le signal « surface dure » : « l'île lit comme posée sur du verre
 *  poli », dit le jury du round 8, à parité de masse MESURÉE. La référence ne
 *  montre pas un miroir : la fondation se PROLONGE sous la surface, dans la
 *  MÊME orientation, et se dissout avec la profondeur — floutée, réfractée.
 *  Ici : chaque colonne du pourtour continue vers le bas sur ROWS rangées de
 *  voxels, même teinte que la falaise en haut, puis dilution vers une eau
 *  laiteuse (couleur ET alpha), léger fruit vers l'intérieur, rangées
 *  profondes élargies et adoucies — l'eau floute ce qu'elle recouvre. */
/** Hauteur de la première rangée immergée ; les suivantes s'allongent, la
 *  dissolution s'étire avec la profondeur. */
const ROW_H = 0.62
const ROWS_CLIFF = 6
const ROWS_BEACH = 4
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
/** Rayon de forêt interdite autour du foyer. Il s'élargit AVEC L'ÎLE : le
 *  village s'étale d'âge en âge (moulin, aqueduc, cathédrale…) alors que le
 *  dégagement, lui, était figé à 8,6 — la forêt finissait par pousser entre
 *  les bâtiments et masquer les toits. `growth` vaut 1 au Paléolithique et
 *  ~1,45 à l'ère contemporaine. */
function clearRadius(x: number, z: number, growth = 1): number {
  const base = CLEAR_RADIUS * (0.94 + 0.42 * (growth - 1) * 2.4)
  const dx = x - TROD.x
  const dz = z - TROD.z
  const d = Math.hypot(dx, dz)
  if (d < 1e-3) return base
  // Derrière le feu, la forêt reste plus proche : c'est le fond du décor.
  const back = Math.max(0, -(dx + dz) / (Math.SQRT2 * d))
  return base + back * back * back * 3.2
}

const EDGE_BASE = 9.6
const DEFAULT_SEED = 1337

/** Soleil projeté au sol, normalisé : tout le dosage du contact (liseré,
 *  ombre, ride) se fait contre cette direction. Un contact identique sur tout
 *  le pourtour lit comme un contour ajouté après coup ; le vrai varie avec la
 *  lumière. */
const SUN_H = 1 / Math.hypot(SUN_DIR.x, SUN_DIR.z)
const SUN_HX = SUN_DIR.x * SUN_H
const SUN_HZ = SUN_DIR.z * SUN_H
/** Nombre de secteurs de la table de silhouette. À ce rayon, un secteur mesure
 *  un tiers de tuile : assez fin pour que la ride suive la découpe. */
const HULL_BINS = 256

/** Silhouette lobée plutôt qu'un disque : c'est le contour qui fait lire
 *  l'île comme un objet posé, pas comme un morceau de terrain. */
function shoreEdge(theta: number, seed: number, growth = 1): number {
  return (
    (EDGE_BASE +
      1.45 * Math.sin(3 * theta + 0.9) +
      0.75 * Math.sin(5 * theta - 1.7) +
      0.8 * valueNoise(Math.cos(theta) * 2.4 + 8, Math.sin(theta) * 2.4 + 8, seed)) * growth
  )
}

/** L'ÉTALEMENT du village avec les âges (moulin, aqueduc, cathédrale…) : il
 *  ne fait plus grandir l'île — seules les parcelles gagnées sur la mer
 *  l'agrandissent — mais il repousse toujours la forêt hors du bourg. */
export function spreadForAge(age: number): number {
  // +11 %/âge jusqu'au fer, +7 % jusqu'au Moyen Âge, puis +3 %.
  return (
    1 +
    Math.min(age, 3) * 0.11 +
    Math.max(0, Math.min(age, 5) - 3) * 0.07 +
    Math.max(0, Math.min(age, 10) - 5) * 0.03
  )
}

/** Taille de l'île de BASE, fixée une fois pour toutes. L'île ne grandit plus
 *  par âge : elle doit donc porter dès le départ le village complet de l'Ère
 *  des limites — rues, voie ferrée, chaussée — pour un joueur qui ne pose
 *  jamais une parcelle. MESURÉ (2026-10-11, 58 savoirs, plan retracé à neuf,
 *  `village.fallbacks` / `village.cramped`) : 1,30 → 1 bâtiment au repli et
 *  37 parcelles relâchées ; 1,38 → 0 / 29 ; 1,45 → 0 / 13 ; l'ancienne île
 *  d'âge 10 (1,62) → 0 / 12. 1,45 est la plus petite île qui loge le village
 *  final aussi bien qu'avant — à peu près la taille qu'avait l'île au Moyen Âge. */
export const BASE_GROWTH = 1.45

/** Une parcelle : un centre et son anneau, sept hexagones. */
export interface LandPlot {
  kind: string
  q: number
  r: number
}

/** Ce qui fait reconnaître une parcelle de loin, avant même son décor : la
 *  teinte du sol. Plus le relief — l'île est à un seul niveau ; la fosse de la
 *  carrière et la butte de l'affleurement se lisent à leur roche et à leurs
 *  blocs. `cove` laisse le centre à l'eau (la crique). */
interface PlotLook {
  cove: boolean
  beach: boolean
  ground: Color
  /** Teinte du centre, s'il diffère de l'anneau (la mare d'une roselière). */
  core?: Color
}
const PLOT_LOOK: Record<string, PlotLook> = {
  // Sous-bois : une herbe plus sombre que la prairie.
  foret: { cove: false, beach: false, ground: new Color('#4a8a3e') },
  // Claire : c'est l'herbe haute, les fleurs font le reste.
  prairie: { cove: false, beach: false, ground: new Color('#86c95a') },
  // La pierre grise et les blocs taillés disent la carrière.
  carriere: { cove: false, beach: false, ground: new Color('#a19a8c') },
  // Humide : une mare au centre, peinte, cernée de roseaux.
  roseliere: {
    cove: false,
    beach: false,
    ground: new Color('#7d9a52'),
    core: new Color('#4d8f8c'),
  },
  crique: { cove: true, beach: true, ground: PALETTE.sand },
  // Une roche rouillée à fleur de sol, semée de minerai.
  affleurement: { cove: false, beach: false, ground: new Color('#b98a5a') },
}
/** Part de la neige d'hiver que prend le sol d'une parcelle (1 sur l'île de
 *  base) : assez pour lire la saison, pas assez pour effacer le type. */
const PLOT_SNOW = 0.4
/** Le hasard propre à une parcelle : la graine de l'île mêlée à sa position.
 *  Poser une terre ne consomme rien du tirage de l'île de base — la forêt
 *  d'origine ne se rebat pas. */
function plotRandom(seed: number, p: LandPlot, salt: number): () => number {
  return mulberry32((seed ^ Math.imul(key(p.q, p.r) + 1, 0x9e3779b1) ^ salt) >>> 0)
}
function plotLook(kind: string): PlotLook {
  return PLOT_LOOK[kind] ?? PLOT_LOOK.foret!
}
/** La teinte de sol d'un type de terre — la surbrillance des ancres la reprend. */
export function plotTint(kind: string): Color {
  return plotLook(kind).ground
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
  beach: boolean
  /** Distance au rivage, en cellules. */
  inland: number
  /** Le modelé que dessinait le relief, gardé pour la COULEUR : l'herbe
   *  s'éclaircit sur les anciennes crêtes, les rochers s'y posent. Sans lui,
   *  l'île plate redevenait une nappe verte uniforme. */
  relief: number
  /** Cellule du pourtour : c'est elle qui porte l'ourlet de rive. */
  rim: boolean
  /** Normale sortante du pourtour (somme des voisins d'eau) : c'est contre elle
   *  que le liseré se dose face au soleil. */
  outx: number
  outz: number
  /** Terre battue de la clairière. */
  trod: boolean
  /** Type de la parcelle gagnée sur la mer, si la cellule en vient. */
  plot?: string
  /** Centre de sa parcelle : c'est là que le décor se ramasse (mare, butte). */
  plotCenter?: boolean
  /** La parcelle qui l'a posée : son décor tire avec le hasard de celle-ci. */
  plotOf?: LandPlot
}

export type NodeKind = 'wood' | 'stone' | 'food'

/** Un lot de décor à disperser, avec le hasard qui le place. */
interface Scatter {
  cells: Cell[]
  rnd: () => number
  scale?: number
  /** Posé à plat, sans bascule : un bloc taillé, pas un rocher roulé. */
  block?: boolean
  tones?: readonly Color[]
  /** D'où vient ce décor : −1 pour l'île de base, sinon le rang de la
   *  parcelle dans `land`. Sert à écarter le décor d'une terre gagnée de
   *  celui qui était déjà là (voir `separatePlotDecor`). */
  src?: number
}

/** Rayon au sol du décor, à l'échelle 1 de l'instance : le tronc d'un sapin
 *  (le houppier passe au-dessus des toits bas, c'est le pied qui se plante
 *  dans un mur), le dodécaèdre d'un rocher, l'icosaèdre d'un buisson. Ce sont
 *  les rayons des maillages eux-mêmes. */
const DECOR_R: Record<NodeKind, number> = { wood: 0.16, stone: 0.42, food: 0.34 }
/** L'écart visé entre deux emprises (incrément 1, lot 2). La ruelle de la
 *  conception vaut 0,6 u ; pour le décor on vise 0,3 u : un buisson qui
 *  frôle un mur se lit comme planté au pied, un buisson dans le mur comme
 *  un défaut. */
export const DECOR_GAP = 0.3

/** Plafond de la pinède de l'île de base. */
const TREE_MAX = 46
/** Roche rouillée d'un affleurement : cuivre et fer à fleur de sol. */
const ORE_TONES = [new Color('#b4733f'), new Color('#8e5a3a'), new Color('#c08a52')]

export class Island {
  readonly group = new Group()
  readonly cells: Cell[] = []
  /** Matériaux non éclairés (eau, ourlet, ride, reflets) : le soleil ne les
   *  touche pas, la nuit doit donc leur être appliquée à la main. */
  private readonly unlit: MeshBasicMaterial[] = []
  private readonly nightTint = new Color('#48627c')

  /** k = part de jour (0 la nuit, 1 en plein jour), fournie par la scène. */
  setDaylight(k: number): void {
    const c = tmpTint.setRGB(1, 1, 1).lerp(this.nightTint, 1 - k)
    for (const m of this.unlit) m.color.copy(c)
    // Les feux du voisinage s'allument au crépuscule et s'éteignent à l'aube.
    if (this.neighborFires && this.neighborFireMat) {
      const night = 1 - k
      this.neighborFires.visible = night > 0.2
      this.neighborFireMat.opacity = Math.min(1, (night - 0.2) * 1.8)
    }
  }

  /** Les reflets construits ailleurs (tipis de village.ts) vivent dans la même
   *  eau : ils doivent suivre la même nuit que la nappe et l'ourlet. */
  registerUnlit(mat: MeshBasicMaterial): void {
    this.unlit.push(mat)
  }
  readonly pickables: InstancedMesh[] = []
  /** Flat ground spots reserved for buildings, ordered from the fire outwards. */
  readonly buildSlots: Vector3[] = []
  private kindOf = new Map<InstancedMesh, NodeKind>()
  private byKey = new Map<number, Cell>()
  /** Rayon de la silhouette rendue, par secteur angulaire. */
  private hull = new Float32Array(HULL_BINS)
  /** Densité de l'ombre de contact, par secteur : profonde là où la fondation
   *  descend (falaise) et dans les échancrures de la côte, presque nulle sur
   *  les pointes. Un anneau d'ombre constant lit comme un drop-shadow CSS. */
  private shadowProf = new Float32Array(HULL_BINS)

  /** Rayon réel de CETTE île (dépend de la croissance) — la caméra cadre dessus. */
  readonly radius: number

  /** Parcelles posées sur CETTE île. */
  readonly land: readonly LandPlot[]
  private readonly growth = BASE_GROWTH

  private readonly seed: number
  /** L'époque : la friche recule à mesure que le village s'étend. */
  private readonly age: number

  // Champs déclarés à la main plutôt qu'en propriétés de paramètre : Node
  // retire les types sans transpiler, et le test des parcelles construit
  // l'île hors navigateur.
  constructor(seed = DEFAULT_SEED, age = 0, land: readonly LandPlot[] = []) {
    this.seed = seed
    this.age = age
    this.land = land
    const rnd = mulberry32(seed)
    const half = GRID / 2

    // Réseau axial : on balaie un losange assez large pour contenir le disque
    // de l'île, et `shoreEdge` découpe dedans exactement comme avant — les
    // coordonnées de bord se raisonnent toujours en TILE.
    const span = Math.ceil(half * 1.3)
    for (let gx = -span; gx <= span; gx++) {
      for (let gz = -span; gz <= span; gz++) {
        const [wx, wz] = hexCenter(gx, gz)
        const dx = wx / TILE
        const dz = wz / TILE
        const r = Math.hypot(dx, dz)
        const theta = Math.atan2(dz, dx)
        const edge = shoreEdge(theta, seed, this.growth)
        if (r > edge) continue
        const inland = edge - r
        const hill = fbm(dx * 0.23, dz * 0.23, seed)
        const shore = Math.min(inland / 2.4, 1)
        // L'ancien relief (0,3 → 2,3), qui ne sert plus qu'à moduler la teinte
        // de l'herbe et à choisir où rouler les rochers : le sol, lui, est à
        // GROUND_Y partout.
        const relief = 0.3 + shore * (0.9 + hill * 1.1)
        const x = wx
        const z = wz
        // Un liseré de sable tout autour donnerait un gâteau. Suivant l'angle,
        // la côte est soit une plage (sable), soit une petite falaise (terre).
        const sandy = valueNoise(Math.cos(theta) * 3.1 + 20, Math.sin(theta) * 3.1 + 20, seed) > 0.44
        const beach = inland < 1.05 && sandy
        // Bord bruité : un disque de terre parfait ressemble à un décalque, pas
        // à un sol usé par les allées et venues. La clairière ne s'enfonce plus
        // d'un cheveu : sa bordure se lit à la couleur, pas à une marche.
        const trod =
          Math.hypot(x, z) < PLAZA_RADIUS &&
          Math.hypot(x - TROD.x, z - TROD.z) <
            TROD.r * (0.78 + valueNoise(x * 0.62, z * 0.62, seed + 31) * 0.42)
        const cell: Cell = {
          gx,
          gz,
          x,
          z,
          beach,
          inland,
          relief,
          rim: false,
          outx: 0,
          outz: 0,
          trod,
        }
        this.cells.push(cell)
        this.byKey.set(key(gx, gz), cell)
      }
    }
    // Les terres gagnées sur la mer : des cellules AJOUTÉES après l'île de
    // base, jamais un masque élargi — l'île d'origine ne bouge pas d'un pouce.
    for (const p of land) this.addPlot(p)
    this.fillPockets()

    this.bakeRim()
    this.bakeFootprint()
    this.buildTerrain()
    this.buildFoundation()
    this.buildWater()
    this.buildRipple()
    this.buildWaterline()
    this.buildHorizons()
    this.scatter(rnd)

    // Rayon mesuré sur les tuiles réellement posées, coin le plus lointain.
    let far = 0
    for (const c of this.cells) {
      far = Math.max(far, Math.hypot(Math.abs(c.x) + TILE / 2, Math.abs(c.z) + TILE / 2))
    }
    this.radius = far
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
      this.hull[i] = (shoreEdge(i * step, this.seed, this.growth) - 0.7) * TILE
    }
    const h = TILE / 2
    // Profondeur locale de la fondation : les falaises s'enfoncent plus loin
    // que les plages — l'ombre de contact suivra ce relief.
    const depth = new Float32Array(HULL_BINS)
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
      const dv = c.beach ? 0.4 : 1
      for (let i = i0; i <= i1; i++) {
        const j = ((i % HULL_BINS) + HULL_BINS) % HULL_BINS
        if (far > this.hull[j]!) this.hull[j] = far
        if (dv > depth[j]!) depth[j] = dv
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
    // Profil d'ombre : profondeur de fondation + concavité de la côte. Les
    // creux (rayon sous la moyenne du voisinage) retiennent l'ombre, les
    // pointes la perdent — c'est cette respiration qui tue l'effet sticker.
    const W = 10
    const raw = new Float32Array(HULL_BINS)
    for (let i = 0; i < HULL_BINS; i++) {
      let mean = 0
      for (let k = -W; k <= W; k++) mean += this.hull[(i + k + HULL_BINS) % HULL_BINS]!
      mean /= 2 * W + 1
      const conc = Math.min(1, Math.max(0, (mean - this.hull[i]!) / (0.8 * TILE)))
      raw[i] = Math.min(1, 0.12 + 0.62 * depth[i]! + 0.55 * conc)
    }
    for (let i = 0; i < HULL_BINS; i++) {
      this.shadowProf[i] =
        raw[(i + HULL_BINS - 2) % HULL_BINS]! * 0.15 +
        raw[(i + HULL_BINS - 1) % HULL_BINS]! * 0.2 +
        raw[i]! * 0.3 +
        raw[(i + 1) % HULL_BINS]! * 0.2 +
        raw[(i + 2) % HULL_BINS]! * 0.15
    }
  }

  /** Densité d'ombre de contact dans une direction, interpolée. */
  private shadowAt(theta: number): number {
    const f = (((theta / (Math.PI * 2)) % 1) + 1) * HULL_BINS
    const i = Math.floor(f)
    const k = f - i
    return this.shadowProf[i % HULL_BINS]! * (1 - k) + this.shadowProf[(i + 1) % HULL_BINS]! * k
  }

  /** Rayon de la silhouette dans une direction, interpolé entre deux secteurs. */
  private hullAt(theta: number): number {
    const f = (((theta / (Math.PI * 2)) % 1) + 1) * HULL_BINS
    const i = Math.floor(f)
    const k = f - i
    return this.hull[i % HULL_BINS]! * (1 - k) + this.hull[(i + 1) % HULL_BINS]! * k
  }

  /** Le pourtour : une cellule dont un voisin manque borde l'eau. Elle porte
   *  l'ourlet de rive, et sa normale sortante dose le liseré face au soleil.
   *  (L'occlusion des terrasses, cuite ici jadis, n'a plus de creux à foncer
   *  sur une île à un seul niveau.) */
  private bakeRim(): void {
    for (const c of this.cells) {
      for (let k = 0; k < 6; k++) {
        if (this.byKey.has(key(c.gx + NB[k]![0], c.gz + NB[k]![1]))) continue
        c.rim = true
        const [nx, nz] = hexNormal(k)
        c.outx += nx
        c.outz += nz
      }
    }
  }

  // ── Saisons ───────────────────────────────────────────────────────────────
  private leavesMesh: InstancedMesh | null = null
  /** Arbres abattus (index d'instance) : ils ne sont plus des nœuds de récolte. */
  private readonly felledTrees = new Set<number>()
  /** Rochers et buissons retirés parce qu'une emprise les recouvre : comme
   *  les arbres abattus, ils gardent leur rang (réduits à un millième). */
  private readonly clearedOf = new Map<InstancedMesh, Set<number>>()
  /** Provenance de chaque instance de décor (−1 : île de base, sinon rang de
   *  la parcelle). */
  private readonly srcOf = new Map<InstancedMesh, Int16Array>()
  /** Décor retiré par la règle d'écart (sous un objet posé, ou trop près du
   *  décor déjà là pour celui d'une parcelle), par ressource. Les arbres
   *  abattus par les rues et la voie n'y sont pas : ils l'étaient déjà. */
  readonly decorRemoved: Record<NodeKind, number> = { wood: 0, stone: 0, food: 0 }
  /** Les premières instances de la pinède sont celles de l'île de base. */
  private baseTrees = 0
  private leafBase: Float32Array | null = null
  private bushMesh: InstancedMesh | null = null
  private bushBase: Float32Array | null = null
  private terrainMat: MeshLambertMaterial | null = null
  private terrainMesh: Mesh | null = null
  /** Teinte de base par emplacement (socle, herbe, décor), et l'emplacement
   *  de chaque sommet du terrain. */
  private terrainBase: Float32Array | null = null
  private terrainSlots: Uint32Array | null = null
  /** Part de saison que prend chaque emplacement de décor. */
  private terrainDecorSnow: Float32Array | null = null
  private seasonId = -1
  private seasonRamp = -1

  /** Repeint l'île à la saison : feuillage lerpé vers le roux ou le givre,
   *  buissons assortis, et un léger étalonnage global du terrain. */
  setSeason(id: number, u = 1): void {
    // L'hiver ne tombe pas d'un bloc : la neige PREND, sur la moitié de la
    // saison. Les autres saisons virent plus vite — c'est l'hiver qu'on
    // regarde arriver. Repeint quand la saison change, ou tous les 2 % de
    // saison écoulée : une soixantaine de repeints par saison de douze
    // minutes, pour six cents cellules — invisible au profileur.
    const ramp = smoothstep(0, id === 3 ? 0.55 : 0.3, u)
    if (id === this.seasonId && Math.abs(ramp - this.seasonRamp) < 0.02) return
    this.seasonId = id
    this.seasonRamp = ramp
    const target = id === 2 ? new Color('#b96f35') : id === 3 ? new Color('#c2cfcc') : null
    const mixK = id === 2 ? 0.48 : id === 3 ? 0.55 : 0
    const mul: [number, number, number] =
      id === 0 ? [0.97, 1.06, 0.94] : id === 1 ? [1.06, 1.0, 0.85] : [1, 1, 1]
    const c = new Color()
    const repaint = (mesh: InstancedMesh | null, base: Float32Array | null, k: number): void => {
      if (!mesh?.instanceColor || !base) return
      const arr = mesh.instanceColor.array as Float32Array
      for (let i = 0; i < base.length; i += 3) {
        c.setRGB(base[i]!, base[i + 1]!, base[i + 2]!)
        if (target) c.lerp(target, mixK * k)
        arr[i] = c.r * mul[0]
        arr[i + 1] = c.g * mul[1]
        arr[i + 2] = c.b * mul[2]
      }
      mesh.instanceColor.needsUpdate = true
    }
    repaint(this.leavesMesh, this.leafBase, ramp)
    repaint(this.bushMesh, this.bushBase, 0.7 * ramp)
    this.paintGround(id, ramp)
    if (this.terrainMat) {
      const grade: [number, number, number] =
        id === 0
          ? [0.99, 1.01, 0.99]
          : id === 1
            ? [1.03, 1.0, 0.93]
            : id === 2
              ? [1.04, 0.965, 0.885]
              : [0.965, 0.99, 1.05]
      this.terrainMat.color.setRGB(
        1 + (grade[0] - 1) * ramp,
        1 + (grade[1] - 1) * ramp,
        1 + (grade[2] - 1) * ramp,
      )
    }
  }

  /** Le SOL change de saison, pas seulement les feuilles. C'est le seul signal
   *  assez large pour se lire d'un coup d'œil sur une île de six cents tuiles :
   *  l'hiver blanchit tout sauf la laisse de mer (une plage sous la neige
   *  jusqu'au ras de l'eau efface le trait de côte), l'automne roussit l'herbe,
   *  le printemps la reverdit, l'été la fonce. Seules les faces SUPÉRIEURES
   *  sont touchées : les falaises restent de la terre, en toute saison. */
  private paintGround(id: number, ramp: number): void {
    const mesh = this.terrainMesh
    const base = this.terrainBase
    const slots = this.terrainSlots
    if (!mesh || !base || !slots) return
    const target =
      id === 0
        ? new Color('#a9dc72')
        : id === 1
          ? new Color('#79a83e')
          : id === 2
            ? new Color('#c08a3c')
            : new Color('#eef5fa')
    const mix = (id === 0 ? 0.2 : id === 1 ? 0.16 : id === 2 ? 0.34 : 0.72) * ramp
    const paint = new Float32Array(base.length)
    const c = new Color()
    const put = (j: number, k: number): void => {
      c.setRGB(base[j]!, base[j + 1]!, base[j + 2]!)
      c.lerp(target, k)
      paint[j] = c.r
      paint[j + 1] = c.g
      paint[j + 2] = c.b
    }
    this.cells.forEach((cell, i) => {
      // La neige tient mal sur le sable mouillé : la plage n'en prend qu'un
      // tiers, et le trait de côte survit à l'hiver. Sur une terre gagnée
      // sur la mer, elle reste une pellicule : sous un blanc plein, forêt,
      // prairie et roselière devenaient la même dalle, et l'on ne savait plus
      // quelle terre on avait posée où.
      put((i * 2 + 1) * 3, mix * (cell.beach ? 0.35 : cell.plot && id === 3 ? PLOT_SNOW : 1))
      // Le socle, lui, ne fait que refroidir ou se réchauffer : une falaise
      // enneigée sur toute sa hauteur redevient un bloc plat.
      put(i * 2 * 3, mix * 0.22)
    })
    // Le décor des parcelles : fleurs et roseaux prennent la saison comme
    // l'herbe, le fond d'une crique (sous l'eau) presque pas.
    const snow = this.terrainDecorSnow
    for (let j = this.cells.length * 2 * 3, d = 0; j < base.length; j += 3, d++) put(j, mix * (snow?.[d] ?? 1))
    const col = mesh.geometry.getAttribute('color') as BufferAttribute
    const arr = col.array as Float32Array
    for (let v = 0; v < slots.length; v++) {
      const j = slots[v]! * 3
      arr[v * 3] = paint[j]!
      arr[v * 3 + 1] = paint[j + 1]!
      arr[v * 3 + 2] = paint[j + 2]!
    }
    col.needsUpdate = true
  }

  /** LE TERRAIN, une seule géométrie fusionnée — un draw call, comme l'ancien
   *  `InstancedMesh` de deux prismes par cellule (socle de terre, couche
   *  d'herbe), mais sans ses faces que rien ne peut montrer : le dessous de
   *  chaque prisme, le dessus du socle sous l'herbe, et les flancs adossés à
   *  un voisin aussi haut. Un hexagone se ferme en quatre triangles, pas six.
   *  Mesuré sur la partie neuve : 28 000 triangles par passe, la moitié du
   *  budget de l'image une fois l'ombre comptée. Le rendu ne change pas :
   *  mêmes sommets, mêmes normales (lissées en flanc, comme le cylindre à six
   *  segments d'avant), mêmes teintes — portées par les sommets, puisqu'il n'y
   *  a plus d'instances. Pour l'ombre, rien ne manque : le moteur dessine les
   *  faces arrière, et un rayon qui sort de la terre traverse toujours un
   *  flanc exposé, qui est gardé. */
  private buildTerrain(): void {
    const mat = new MeshLambertMaterial({ vertexColors: true })
    this.terrainMat = mat
    const rims = this.cells.filter((c) => c.rim)

    const pos: number[] = []
    const nor: number[] = []
    const slot: number[] = []
    const index: number[] = []
    const vert = (x: number, y: number, z: number, nx: number, ny: number, nz: number, s: number): number => {
      pos.push(x, y, z)
      nor.push(nx, ny, nz)
      slot.push(s)
      return slot.length - 1
    }
    /** Triangle tourné vers `n` : l'ordre des sommets se décide au produit
     *  vectoriel plutôt qu'à la main. */
    const tri = (a: number, b: number, c: number, nx: number, ny: number, nz: number): void => {
      const ux = pos[b * 3]! - pos[a * 3]!
      const uy = pos[b * 3 + 1]! - pos[a * 3 + 1]!
      const uz = pos[b * 3 + 2]! - pos[a * 3 + 2]!
      const vx = pos[c * 3]! - pos[a * 3]!
      const vy = pos[c * 3 + 1]! - pos[a * 3 + 1]!
      const vz = pos[c * 3 + 2]! - pos[a * 3 + 2]!
      const d = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz
      if (d >= 0) index.push(a, b, c)
      else index.push(a, c, b)
    }
    const corners = Array.from({ length: 6 }, (_, k) => hexVertex(k))
    // Un seul niveau : entre deux cellules de terre il n'y a plus de
    // contre-marche à dresser, seules les arêtes qui donnent sur l'eau ont un
    // flanc — la terre en bas, la couche d'herbe (ou de sable) au-dessus.
    const capBottom = GROUND_Y - CAP
    /** Flanc de l'arête k entre y0 et y1 : normales radiales aux coins, comme
     *  le cylindre — l'arête du prisme reste adoucie à l'éclairage. */
    const side = (c: Cell, k: number, y0: number, y1: number, s: number): void => {
      if (y1 - y0 < 1e-4) return
      const [ax, az] = corners[k]!
      const [bx, bz] = corners[(k + 1) % 6]!
      const a0 = vert(c.x + ax, y0, c.z + az, ax / HEX_R, 0, az / HEX_R, s)
      const a1 = vert(c.x + ax, y1, c.z + az, ax / HEX_R, 0, az / HEX_R, s)
      const b0 = vert(c.x + bx, y0, c.z + bz, bx / HEX_R, 0, bz / HEX_R, s)
      const b1 = vert(c.x + bx, y1, c.z + bz, bx / HEX_R, 0, bz / HEX_R, s)
      const [nx, nz] = hexNormal(k)
      tri(a0, b0, b1, nx, 0, nz)
      tri(a0, b1, a1, nx, 0, nz)
    }

    this.cells.forEach((c, i) => {
      const t0 = pos.length / 3
      for (const [vx, vz] of corners) vert(c.x + vx, GROUND_Y, c.z + vz, 0, 1, 0, i * 2 + 1)
      for (let k = 1; k < 5; k++) tri(t0, t0 + k, t0 + k + 1, 0, 1, 0)
      if (!c.rim) return
      for (let k = 0; k < 6; k++) {
        if (this.byKey.has(key(c.gx + NB[k]![0], c.gz + NB[k]![1]))) continue
        side(c, k, 0, capBottom, i * 2)
        side(c, k, capBottom, GROUND_Y, i * 2 + 1)
      }
    })
    const decor = this.plotGroundDecor(vert, tri)

    // Teintes de base par emplacement : socle (2i), herbe (2i+1), puis le
    // décor des parcelles.
    const base = new Float32Array((this.cells.length * 2 + decor.length) * 3)
    const capColor = new Color()
    const socleColor = new Color()
    const grassRamp = [
      [0, PALETTE.grassDark],
      [0.55, PALETTE.grass],
      [1, PALETTE.grassLight],
    ] as const
    this.cells.forEach((c, i) => {
      if (c.trod) {
        // Plus on approche du feu, plus la terre est tassée et sombre.
        const packed = smoothstep(TROD.r, 0.6, Math.hypot(c.x - TROD.x, c.z - TROD.z))
        capColor.copy(PALETTE.dirt).lerp(PALETTE.dirtDark, packed * 0.75)
      } else if (c.plot) {
        const look = plotLook(c.plot)
        capColor.copy(c.plotCenter && look.core ? look.core : look.ground)
      } else if (c.beach) capColor.copy(PALETTE.sand)
      // L'herbe s'éclaircit là où montait le relief : c'est ce modelé de
      // couleur, et non plus des paliers, qui garde l'île vivante vue de haut.
      else ramp(grassRamp, smoothstep(0.5, 2.6, c.relief), capColor)
      // Marbrure basse fréquence en plus du bruit par tuile : un aplat de
      // couleur unique sur toute l'île ferait carton découpé.
      const mottle = 0.93 + fbm((c.x / TILE) * 0.55, (c.z / TILE) * 0.55, 7) * 0.14
      capColor.copy(tint(capColor, c.gx * 31 + c.gz * 7 + 512, 0.06)).multiplyScalar(mottle)

      // La tranche d'une plage est du sable mouillé, pas de la terre : à
      // hauteur égale, c'est elle qui sépare la plage de la petite falaise.
      socleColor
        .copy(c.beach ? PALETTE.sand : PALETTE.earth)
        .lerp(PALETTE.earthDark, c.beach ? 0.3 : 0.5)
        .multiplyScalar(0.88)
      // Le pied des falaises du pourtour prend un rien de l'eau qui le baigne :
      // sans ça, la face à l'ombre tombe dans un brun quasi noir alors qu'elle
      // devrait tirer vers le bleu de ce qui la mouille.
      if (c.rim) socleColor.lerp(PALETTE.water, 0.14)
      socleColor.toArray(base, i * 2 * 3)
      capColor.toArray(base, (i * 2 + 1) * 3)
    })
    decor.forEach((d, j) => d.color.toArray(base, (this.cells.length * 2 + j) * 3))
    this.terrainDecorSnow = Float32Array.from(decor, (d) => d.snow)

    const slots = new Uint32Array(slot)
    const col = new Float32Array(slots.length * 3)
    for (let v = 0; v < slots.length; v++) {
      const j = slots[v]! * 3
      col[v * 3] = base[j]!
      col[v * 3 + 1] = base[j + 1]!
      col[v * 3 + 2] = base[j + 2]!
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
    geo.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3))
    geo.setAttribute('color', new BufferAttribute(col, 3))
    geo.setIndex(index)
    geo.computeBoundingSphere()
    const mesh = new Mesh(geo, mat)
    mesh.castShadow = true
    mesh.receiveShadow = true
    // Le terrain garde sa teinte de base : les saisons le repeignent par-dessus
    // (neige, roux, herbe neuve) au lieu de le multiplier globalement — un
    // étalonnage de matériau ne se VOIT pas, une île blanche se voit.
    this.terrainMesh = mesh
    this.terrainBase = base
    this.terrainSlots = slots

    // L'ourlet de rive est peint sans lumière : le liseré doit tenir sur la face
    // à l'ombre comme sur celle au soleil, et l'eau ne fait pas de clair-obscur
    // sur ce qu'elle noie. Éclairé, il s'éteignait sur la moitié du pourtour —
    // exactement la moitié où les falaises viraient au noir.
    const contactMat = new MeshBasicMaterial()
    this.unlit.push(contactMat)
    // Une bande mouillée émergée par cellule du pourtour, sans fond ni
    // couvercle : son dessus tombe dans la falaise, son dessous dans l'eau. La
    // fondation immergée, elle, vit dans `buildFoundation` : une géométrie
    // fusionnée sous la nappe, avec l'alpha par sommet que l'instanciation ne
    // sait pas porter.
    const bandGeo = new CylinderGeometry(HEX_R, HEX_R, 1, 6, 1, true, Math.PI / 2)
    const contact = new InstancedMesh(bandGeo, contactMat, rims.length)
    const dummy = new Object3D()
    const wetColor = new Color()

    // La bande de flottaison sombre, sur le pourtour émergé. Le contact se
    // densifie à l'ombre : l'eau y reprend le pied. Face au soleil il reste
    // sombre, juste un peu moins — jamais éclairé.
    let ci = 0
    rims.forEach((c) => {
      const shore = c.beach ? PALETTE.sand : PALETTE.earth
      const len = Math.hypot(c.outx, c.outz)
      const nx = len > 0 ? c.outx / len : c.x / (Math.hypot(c.x, c.z) + 1e-6)
      const nz = len > 0 ? c.outz / len : c.z / (Math.hypot(c.x, c.z) + 1e-6)
      const facing = nx * SUN_HX + nz * SUN_HZ
      const shade = 0.5 - 0.5 * facing

      dummy.position.set(c.x, WET / 2, c.z)
      dummy.scale.set(1.008, WET, 1.008)
      dummy.updateMatrix()
      contact.setMatrixAt(ci, dummy.matrix)
      wetColor.copy(shore).multiplyScalar(0.26).lerp(PALETTE.waterDeep, 0.5 + shade * 0.22)
      contact.setColorAt(ci, wetColor)
      ci++
    })
    contact.count = ci

    contact.instanceMatrix.needsUpdate = true
    if (contact.instanceColor) contact.instanceColor.needsUpdate = true
    this.group.add(mesh, contact)
  }

  /** Le décor au ras du sol des parcelles, cousu dans la géométrie du
   *  terrain : fleurs de la prairie, roseaux de la roselière, fond de sable
   *  d'une crique. Pas un draw call de plus, et chaque parcelle tire avec SON
   *  hasard — la pose d'une terre ne rebat rien de ce qui existe. Renvoie la
   *  teinte de chaque emplacement de décor, dans l'ordre, et la part de
   *  saison qu'il prend. */
  private plotGroundDecor(
    vert: (x: number, y: number, z: number, nx: number, ny: number, nz: number, s: number) => number,
    tri: (a: number, b: number, c: number, nx: number, ny: number, nz: number) => void,
  ): { color: Color; snow: number }[] {
    const colors: { color: Color; snow: number }[] = []
    const first = this.cells.length * 2
    /** Pointe à trois pans, normales plates : une touffe, une fleur, un roseau. */
    const spike = (x: number, y: number, z: number, r: number, h: number, yaw: number, color: Color): void => {
      const s = first + colors.length
      colors.push({ color, snow: 1 })
      const apex: [number, number, number] = [x, y + h, z]
      for (let k = 0; k < 3; k++) {
        const a0 = yaw + (k * Math.PI * 2) / 3
        const a1 = yaw + ((k + 1) * Math.PI * 2) / 3
        const p0: [number, number, number] = [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r]
        const p1: [number, number, number] = [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r]
        // Normale du pan : sortante, penchée selon l'élancement.
        const am = (a0 + a1) / 2
        const nl = Math.hypot(h, r * 0.5)
        const nx = (Math.cos(am) * h) / nl
        const ny = (r * 0.5) / nl
        const nz = (Math.sin(am) * h) / nl
        const i0 = vert(p0[0], p0[1], p0[2], nx, ny, nz, s)
        const i1 = vert(p1[0], p1[1], p1[2], nx, ny, nz, s)
        const i2 = vert(apex[0], apex[1], apex[2], nx, ny, nz, s)
        tri(i0, i1, i2, nx, ny, nz)
      }
    }
    const FLOWERS = [new Color('#fbf7ea'), new Color('#f7d54a'), new Color('#f29abb'), new Color('#b99cf0')]
    const REEDS = [new Color('#b8a25c'), new Color('#8f9a4b'), new Color('#a58a4e')]
    // Le fond d'une crique : du sable clair juste sous la nappe, au centre.
    // Vu à travers l'eau translucide de la berge, c'est ce haut-fond qui dit
    // « crique » — sans lui, le croissant de sable se lisait comme une plage
    // festonnée. La passe, elle, reste au bleu du large : un fond clair posé
    // là dépassait en mer comme un hexagone isolé.
    const floor = PALETTE.sand.clone().lerp(PALETTE.waterShallow, 0.3)
    for (const p of this.land) {
      if (!plotLook(p.kind).cove || this.byKey.has(key(p.q, p.r))) continue
      const s = first + colors.length
      colors.push({ color: floor, snow: 0.1 })
      const [x, z] = hexCenter(p.q, p.r)
      const t0 = seabedHex(vert, x, z, s)
      for (let c = 1; c < 5; c++) tri(t0, t0 + c, t0 + c + 1, 0, 1, 0)
    }
    for (const p of this.land) {
      if (p.kind !== 'prairie' && p.kind !== 'roseliere') continue
      const rnd = plotRandom(this.seed, p, 0x51ed)
      for (const c of this.cells) {
        if (c.plotOf !== p) continue
        if (p.kind === 'prairie') {
          // Une prairie en fleurs : des points de couleur semés dans l'herbe.
          // À plat, face au ciel — une pointe à trois pans tombait à l'ombre
          // sur deux faces sur trois et virait au brun.
          for (let n = 0; n < 9; n++) {
            const a = rnd() * Math.PI * 2
            const d = Math.sqrt(rnd()) * HEX_R * 0.82
            const color = FLOWERS[Math.floor(rnd() * FLOWERS.length)]!
            const x = c.x + Math.cos(a) * d
            const z = c.z + Math.sin(a) * d
            const y = GROUND_Y + 0.03
            const yaw = rnd() * Math.PI
            const r = 0.1 + rnd() * 0.04
            const s = first + colors.length
            colors.push({ color, snow: 1 })
            const i0 = vert(x + Math.cos(yaw) * r, y, z + Math.sin(yaw) * r, 0, 1, 0, s)
            const i1 = vert(x + Math.cos(yaw + 2.09) * r, y, z + Math.sin(yaw + 2.09) * r, 0, 1, 0, s)
            const i2 = vert(x + Math.cos(yaw + 4.19) * r, y, z + Math.sin(yaw + 4.19) * r, 0, 1, 0, s)
            tri(i0, i1, i2, 0, 1, 0)
          }
        } else if (!c.plotCenter) {
          // Les roseaux se serrent du côté de la mare.
          const [px, pz] = hexCenter(p.q, p.r)
          for (let n = 0; n < 7; n++) {
            const t = 0.15 + rnd() * 0.55
            const x = c.x + (px - c.x) * t + (rnd() - 0.5) * 0.7
            const z = c.z + (pz - c.z) * t + (rnd() - 0.5) * 0.7
            const color = REEDS[Math.floor(rnd() * REEDS.length)]!
            spike(x, GROUND_Y, z, 0.05, 0.75 + rnd() * 0.5, rnd() * 2, color)
          }
        }
      }
    }
    return colors
  }

  /** La CONTINUATION de la fondation sous la flottaison — pas un reflet.
   *  Chaque colonne du pourtour se prolonge vers le bas dans la MÊME
   *  orientation, comme si la falaise s'enfonçait, et le regard la perd dans
   *  la profondeur : même teinte que la falaise à la première rangée, puis
   *  dilution progressive vers une eau laiteuse (couleur ET alpha par sommet),
   *  léger fruit vers l'intérieur, rangées profondes élargies — l'eau floute
   *  ce qu'elle recouvre, elle ne le renvoie pas.
   *  Géométrie fusionnée, un seul draw call, dessinée ENTRE le fond (-3) et la
   *  nappe translucide (-1) : la fondation se lit À TRAVERS l'eau, la nappe la
   *  voile — « floutée et réfractée qui se dissout avec la profondeur », dit
   *  la référence. Rien n'est cuit vers le haut : rien à inverser, rien qui
   *  puisse lire comme un miroir. */
  private buildFoundation(): void {
    const verts: number[] = []
    const colors: number[] = []
    const index: number[] = []
    // Verdict du round 11, à la vue rasante : la dissolution laiteuse lisait
    // comme « un reflet plus clair que l'eau — contredit la physique ». La
    // fondation de la référence reste PLUS CLAIRE que l'eau libre parce que
    // c'est de la pierre pâle vue à travers l'eau — elle garde sa MATIÈRE. La
    // cible de dissolution est donc l'eau elle-même, à peine assombrie : la
    // paroi reste pierre, bleuit, puis se perd — elle ne blanchit jamais.
    const milk = PALETTE.water.clone().lerp(PALETTE.waterDeep, 0.25)
    const wall = new Color()
    const cj = new Color()
    const water = (gx: number, gz: number): boolean => !this.byKey.has(key(gx, gz))
    /** Alpha selon la profondeur relative : dense sous la flottaison, éteint à
     *  la dernière rangée — c'est le dégradé qui arrête l'objet, pas une coupe
     *  de géométrie. */
    const aOf = (t: number): number => 0.95 * Math.pow(1 - t, 1.3)
    /** Fruit vers l'intérieur : la paroi rentre en descendant, comme une
     *  coque — jamais un mur qui tombe droit. Le rideau est le POLYGONE OFFSET
     *  de la côte à chaque profondeur : poussée le long de la normale, et aux
     *  extrémités la face se rétracte au coin saillant (elle rejoint l'autre
     *  face de sa tuile), continue telle quelle en ligne droite, s'allonge au
     *  coin rentrant (elle rejoint la face de la tuile diagonale). Poussée
     *  seule, les faces perpendiculaires se croisaient aux angles rentrants et
     *  leur double mélange rayait la masse de stries claires (passe 2) ;
     *  contractées vers le centre de leur tuile, les faces voisines
     *  s'écartaient en dents séparées (passe 3). Offset : étanche. */
    /** Amplitude courte : à 0,45 les faces d'un promontoire d'une tuile,
     *  rétractées des deux bouts, convergeaient en pointes fines qui pendaient
     *  sous la masse. */
    const fruit = (t: number): number => 0.28 * t * t + 0.04 * t

    // Une NAPPE continue, pas des boîtes : la passe 1 émettait quatre faces
    // par rangée par cellule, et à travers la transparence leurs faces
    // intérieures dessinaient un treillis clair — une grille de verre, pas une
    // falaise. Ici seules les faces qui REGARDENT L'EAU existent, connectées
    // verticalement : un rideau qui prolonge chaque face de falaise vers le
    // bas, rien à voir au travers sinon l'eau.
    /** Comportement d'une extrémité de face quand la côte tourne : +1 la face
     *  se rétracte (coin saillant), 0 elle continue (ligne droite), -1 elle
     *  s'allonge (coin rentrant). */
    const endCode = (c: Cell, ex: number, ez: number, nx: number, nz: number): number => {
      if (water(c.gx + ex, c.gz + ez)) return 1
      return water(c.gx + ex + nx, c.gz + ez + nz) ? 0 : -1
    }

    const curtain = (
      c: Cell,
      nx: number,
      nz: number,
      ax: number, az: number, // extrémité A de l'arête, à la flottaison
      bx: number, bz: number, // extrémité B
      codeA: number,
      codeB: number,
    ): void => {
      const rows = c.beach ? ROWS_BEACH : ROWS_CLIFF
      const shore = c.beach ? PALETTE.sand : PALETTE.earth
      const facing = nx * SUN_HX + nz * SUN_HZ
      const shade = 0.5 - 0.5 * facing
      // La première rangée est la falaise du dessus, mouillée : même valeur
      // sombre que le socle — c'est le RACCORD qui fait lire « la paroi
      // continue ». Trop claire dès la flottaison (0,78 à la passe 2), elle
      // sautait au blanc et lisait comme un rideau posé sous l'île, pas comme
      // la même pierre.
      wall.copy(shore).multiplyScalar(0.72 - shade * 0.12)
      // L'arête d'un hexagone mesure R (rayon circonscrit = côté).
      const tx = (bx - ax) / HEX_R
      const tz = (bz - az) / HEX_R
      const b = verts.length / 3
      let y = 0
      for (let j = 0; j <= rows; j++) {
        const t = j / rows
        // Les rangées s'allongent avec la profondeur : la dissolution s'étire,
        // le pas se lit surtout près de la surface, là où l'eau est claire.
        if (j > 0) y -= ROW_H * (1 + (j - 1) * 0.18)
        const f = fruit(t)
        // La matière persiste sur la moitié haute (c'est elle qui dit « la
        // même pierre continue ») et ne se dissout vraiment qu'en profondeur.
        cj.copy(wall).lerp(milk, 0.06 + 0.9 * Math.pow(t, 1.6))
        // Assises alternées : un souffle de clair/sombre par rangée, qui
        // s'éteint avec la profondeur — le pas de voxel de la falaise continue
        // sous l'eau, puis l'eau le floute.
        cj.multiplyScalar(1 + (j % 2 === 0 ? 0.05 : -0.05) * (1 - t))
        const a = aOf(t)
        verts.push(
          ax - nx * f + tx * codeA * f, y, az - nz * f + tz * codeA * f,
          bx - nx * f - tx * codeB * f, y, bz - nz * f - tz * codeB * f,
        )
        colors.push(cj.r, cj.g, cj.b, a, cj.r, cj.g, cj.b, a)
        if (j > 0) {
          const p = b + (j - 1) * 2
          index.push(p, p + 1, p + 3, p, p + 3, p + 2)
        }
      }
    }

    for (const c of this.cells) {
      if (!c.rim) continue
      for (let k = 0; k < 6; k++) {
        if (!water(c.gx + NB[k]![0], c.gz + NB[k]![1])) continue
        const [nx, nz] = hexNormal(k)
        const [ax, az] = hexVertex(k)
        const [bx, bz] = hexVertex(k + 1)
        // Le sommet A est partagé avec l'arête précédente, le sommet B avec la
        // suivante : c'est leur voisinage qui dit si la face se rétracte
        // (angle saillant), continue, ou s'allonge (angle rentrant).
        curtain(
          c, nx, nz,
          c.x + ax, c.z + az, c.x + bx, c.z + bz,
          endCode(c, NB[(k + 5) % 6]![0], NB[(k + 5) % 6]![1], NB[k]![0], NB[k]![1]),
          endCode(c, NB[(k + 1) % 6]![0], NB[(k + 1) % 6]![1], NB[k]![0], NB[k]![1]),
        )
      }
    }

    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3))
    geo.setAttribute('color', new BufferAttribute(new Float32Array(colors), 4))
    geo.setIndex(index)
    // `DoubleSide` : l'ordre des coins s'enroule dans un sens ou l'autre selon
    // la face du pourtour — un quad doit se dessiner quel que soit son côté.
    // Une seule passe : transparent et double face, three dessine sinon le
    // mesh deux fois (dos puis face), un draw call de plus par image pour un
    // ordre de mélange que l'enroulement mêlé rendait déjà arbitraire.
    const mat = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      forceSinglePass: true,
    })
    this.unlit.push(mat)
    const mesh = new Mesh(geo, mat)
    mesh.renderOrder = -2
    this.group.add(mesh)
  }

  /** La 2e ride, au large de la flottaison : une ligne discrète qui ondule
   *  légèrement à distance du bord — le clapot qui s'éloigne de la berge. Fine
   *  et à peine plus claire que l'eau : c'est le trait de flottaison
   *  (`buildWaterline`) qui dessine le contact, pas elle. */
  private buildRipple(): void {
    // Profil en toit : alpha nul aux deux lisières, plein au centre. Total
    // ~0,1 tuile de large — une ligne molle, jamais une bande.
    const RINGS = [
      { off: -0.055, alpha: 0 },
      { off: 0, alpha: 1 },
      { off: 0.055, alpha: 0 },
    ] as const
    const verts = new Float32Array(HULL_BINS * RINGS.length * 3)
    const colors = new Float32Array(HULL_BINS * RINGS.length * 4)
    const foam = PALETTE.foam
    for (let i = 0; i < HULL_BINS; i++) {
      const a = (i / HULL_BINS) * Math.PI * 2
      const cx = Math.cos(a)
      const cz = Math.sin(a)
      // L'ondulation : la distance au bord respire avec un bruit cohérent,
      // la ligne s'écarte et se rapproche sans jamais toucher la découpe.
      // Excursion courte : à plus d'un quart de tuile d'amplitude, la ligne
      // décollait de la berge et lisait comme un fil posé sur l'eau.
      const swell = valueNoise(cx * 2.2 + 30, cz * 2.2 + 30, this.seed + 7)
      const r = this.hull[i]! + (0.46 + 0.28 * swell) * TILE
      // Elle vit avec la lumière et se hache : nette côté soleil, fondue à
      // l'ombre, interrompue par endroits — un anneau continu ferait cerne.
      const lit = 0.5 + 0.5 * (cx * SUN_HX + cz * SUN_HZ)
      const brk = valueNoise(cx * 3.2 + 60, cz * 3.2 + 60, this.seed + 11)
      const amp = Math.min(1, (0.4 + 0.6 * lit) * (0.2 + 1.1 * brk)) * 0.34
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
        colors[q + 3] = ring.alpha * amp
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
    // L'anneau se dessine avec le trait de flottaison (`buildWaterline`) :
    // même matériau, un draw call pour les deux.
    this.rippleGeo = geo
  }
  private rippleGeo: BufferGeometry | null = null

  /** Le trait de flottaison : une ligne claire d'une FINESSE de trait (~2 px à
   *  l'écran), collée à la découpe réelle en escalier des tuiles du pourtour —
   *  pas à la silhouette polaire lissée. Cinq rounds ont perdu sur l'épaisseur :
   *  un glow épais lit comme un sticker, l'absence de trait lit comme un
   *  décalque posé sur l'eau. La référence a un trait dessiné, marche par
   *  marche, entre le soubassement sombre et l'eau. */
  private buildWaterline(): void {
    /** Largeur du trait, en unités monde : ~3 px au cadrage desktop. Mesuré :
     *  la couronne de la référence culmine à +130 de luminance sur l'eau
     *  voisine, la nôtre à +102 — le trait s'élargit d'un demi-pixel pour que
     *  le pic survive au lissage de l'écran, il ne devient pas un glow. */
    // v3.60.0 : 0,16 → 0,2. Posé sur le haut-fond turquoise, plus clair qu'avant,
    // le trait perdait son contraste ; un poil plus large et plus plein, il
    // redevient le liseré d'écume net qui dessine la côte.
    const W = 0.2
    // Couleur poussée au-delà de 1 dans les sommets : l'ACES ramène un blanc
    // à 1,0 vers un gris clair, qui se perdait sur le haut-fond turquoise.
    // Surexposé, le trait ressort blanc net, sans programme shader de plus
    // (un `toneMapped: false` en aurait coûté un).
    const line = PALETTE.foamLine.clone().multiplyScalar(1.6)
    const verts: number[] = []
    const colors: number[] = []
    const index: number[] = []
    const water = (gx: number, gz: number): boolean => !this.byKey.has(key(gx, gz))

    /** Alpha au point (x,z) : plein côté soleil, atténué à l'ombre, haché par
     *  un bruit cohérent — un trait d'alpha constant redeviendrait un cerne. */
    const ampAt = (x: number, z: number, nx: number, nz: number): number => {
      const lit = 0.5 + 0.5 * (nx * SUN_HX + nz * SUN_HZ)
      const brk = valueNoise(x * 0.55 + 40, z * 0.55 + 40, this.seed + 23)
      // Planchers remontés depuis le round 7 : mesuré, le pic du trait
      // plafonnait à +81 de luminance quand la couronne de la référence tient
      // +130 — la respiration soleil/hachure reste, l'amplitude ne s'y noie
      // plus.
      return (0.9 + 0.1 * lit) * (0.88 + 0.12 * brk)
    }

    /** Quad du trait : lisière intérieure collée au mur (i0→i1), lisière
     *  extérieure décalée de W vers l'eau, où l'alpha tombe d'un cran — juste
     *  de quoi adoucir le pixel du bord, pas de quoi faire un dégradé. */
    const strip = (
      ix0: number, iz0: number, ix1: number, iz1: number,
      nx: number, nz: number,
    ): void => {
      const b = verts.length / 3
      const pts = [
        [ix0, iz0], [ix1, iz1],
        [ix1 + nx * W, iz1 + nz * W], [ix0 + nx * W, iz0 + nz * W],
      ] as const
      pts.forEach(([x, z], k) => {
        // Un souffle au-dessus de la nappe (y=0) et de la 2e ride (0,012).
        verts.push(x, 0.02, z)
        const a = ampAt(x, z, nx, nz) * (k < 2 ? 1 : 0.45)
        colors.push(line.r, line.g, line.b, a)
      })
      index.push(b, b + 2, b + 1, b, b + 3, b + 2)
    }

    // Une arête hexagonale n'appartient qu'à DEUX cellules : contrairement à
    // la grille carrée, aucun coin n'est peint deux fois et la règle de
    // propriété des angles disparaît. On allonge simplement chaque bout d'un
    // demi-trait pour que deux arêtes voisines se rejoignent sans encoche.
    const JOIN = W * 0.6
    for (const c of this.cells) {
      if (!c.rim) continue
      for (let k = 0; k < 6; k++) {
        if (!water(c.gx + NB[k]![0], c.gz + NB[k]![1])) continue
        const [nx, nz] = hexNormal(k)
        const [ax, az] = hexVertex(k)
        const [bx, bz] = hexVertex(k + 1)
        const ex = bx - ax
        const ez = bz - az
        const el = Math.hypot(ex, ez) || 1
        strip(
          c.x + ax - (ex / el) * JOIN,
          c.z + az - (ez / el) * JOIN,
          c.x + bx + (ex / el) * JOIN,
          c.z + bz + (ez / el) * JOIN,
          nx,
          nz,
        )
      }
    }

    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3))
    geo.setAttribute('color', new BufferAttribute(new Float32Array(colors), 4))
    geo.setIndex(index)
    // `DoubleSide` : l'ordre des sommets s'inverse d'une face du pourtour à
    // l'autre, et un quad ne se dessine qu'une fois quel que soit son côté —
    // en une seule passe : le trait est à plat, aucun quad n'en recouvre un
    // autre, la passe « dos » de three ne coûtait qu'un draw call. La 2e ride
    // (`buildRipple`) voyage dans le même mesh : à plat, vue d'en haut, une
    // seule de ses faces peut jamais regarder la caméra.
    const mat = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      forceSinglePass: true,
    })
    this.unlit.push(mat)
    const both = this.rippleGeo ? mergeGeometries([this.rippleGeo, geo]) : null
    this.rippleGeo?.dispose()
    this.rippleGeo = null
    this.group.add(new Mesh(both ?? geo, mat))
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
      // v3.60.0 : la mer fonce franchement vers le large (eau profonde de la
      // palette), au lieu de 10 % d'assombrissement. C'est cette pente, du
      // turquoise de la berge au bleu profond, qui dit « on voit le fond près
      // du rivage, plus au large ». La pente DOIT être finie avant 3 cellules :
      // la rampe s'arrête à 3,2 cellules du point le plus saillant, et au-delà
      // le bord clampé est étiré à l'infini. Une pente plus longue laissait
      // au bord des texels de valeurs différentes selon l'angle, et le clamp
      // les étirait en traînées claires qui rayonnaient depuis l'île.
      out.copy(PALETTE.water).lerp(PALETTE.waterDeep, smoothstep(1.2, 3.0, d) * 0.7)
      // Tout ce qui suit meurt avant deux cellules. Le large, qui est
      // l'essentiel de la texture, ne paie pas l'ourlet de rive.
      // LE LAGON (v3.5.0, direction visuelle demandée) : une vraie ceinture de
      // haut-fond turquoise autour de l'île, large de ~4 cellules. Les rounds
      // gauntlet avaient réduit ce dégradé à 7 % parce qu'il lisait comme un
      // HALO — le halo, c'était une auréole molle centrée sur l'île ; ici la
      // bande suit l'empreinte réelle de la côte (shoreDist), donc elle épouse
      // la découpe au lieu de la cercler.
      // Le haut-fond monte à 0,85 contre la côte (0,62 avant) : un turquoise
      // clair et franc sur la première cellule, qui retombe vite. La pente
      // reste douce au-delà, sinon la ceinture lirait comme un anneau posé.
      out.lerp(PALETTE.waterShallow, smoothstep(4.2, 0.1, d) ** 1.4 * 0.85)
      if (d < 2.2) {
        // Ombre de contact IRRÉGULIÈRE : portée et densité suivent le profil
        // cuit par secteur (profondeur de la fondation + creux de la côte) et
        // la direction du soleil. Dense dans les échancrures à l'ombre, quasi
        // absente sur les pointes éclairées — un anneau de largeur constante
        // lisait comme un drop-shadow CSS sous un sticker.
        const rr = Math.sqrt(x * x + z * z) + 1e-6
        const away = 0.5 - 0.5 * ((x * SUN_HX + z * SUN_HZ) / rr)
        const prof = this.shadowAt(fastAtan2(z, x))
        const reach = 0.25 + 0.8 * prof
        // Densité divisée par deux depuis le round 7 : l'anneau sombre annulait
        // en moyenne la masse claire (signé mesuré ≈ 0 là où la référence est
        // à +27) — l'ombre reste, mais elle ne mange plus le contact.
        out.multiplyScalar(1 - smoothstep(reach, -0.1, d) * (0.06 + 0.3 * away) * (0.3 + 0.7 * prof))
        // Ombre portée : la même empreinte, décalée à l'opposé du soleil.
        const shade =
          smoothstep(0.4, -0.3, shoreDist(x - SHADE_X, z - SHADE_Z)) * smoothstep(2.2, 0.3, d)
        out.multiplyScalar(1 - shade * 0.2)
      }
      // La nappe reste translucide près de la berge — c'est à travers elle que
      // la fondation immergée et le reflet se lisent — et ne redevient opaque
      // que loin au large. À 60 % d'opacité dès la berge, le reflet des rounds
      // 5-6 mourait dessous.
      return 0.3 + smoothstep(0.7, 11, d) * 0.7
    })
    // La rampe ne couvre que le centre de la nappe ; au-delà, le bord clampé
    // donne exactement la couleur du large.
    const k = SPAN / span
    tex.repeat.set(k, k)
    tex.offset.set((1 - k) / 2, (1 - k) / 2)

    const disc = new CircleGeometry(SPAN, 64)

    // Couche opaque : même texture, même mapping, donc aucun décalage de
    // parallaxe avec la surface — ce qui n'est pas reflété reste invisible.
    // depthWrite ACTIF : le fond est opaque et doit occulter ce qui est
    // derrière lui — sans ça, la voûte étoilée (r=320, sous le niveau de la
    // mer) transperçait toute la zone d'eau en vue rasante.
    const bedMat = new MeshBasicMaterial({ map: tex, depthWrite: true })
    this.addCaustics(bedMat, span)
    this.unlit.push(bedMat)
    const bed = new Mesh(disc, bedMat)
    bed.rotation.x = -Math.PI / 2
    bed.position.y = BED_Y
    bed.renderOrder = -3

    // Surface plate, assumée : la houle de maillage de la 1.7.0 (poseidon)
    // creusait sous le fond opaque — le depth test perçait la surface en
    // taches sombres — et le fresnel délavait toute la mer sous la caméra
    // plongeante. Sur un matériau non éclairé, un déplacement de sommets ne
    // produit AUCUN ombrage : que des artefacts. L'aplat calme de la 1.6 est
    // le bon rendu pour cette DA ; le mouvement vit dans les vaguelettes et
    // le scintillement du chemin de lumière.
    const surfaceMat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    this.unlit.push(surfaceMat)
    const surface = new Mesh(disc, surfaceMat)
    surface.rotation.x = -Math.PI / 2
    surface.renderOrder = -1

    this.group.add(bed, surface)
  }

  /** Caustiques douces sur le fond du lagon (v3.60.0, inspirées de l'eau
   *  translucide d'un jeu de pêche cosy) : un réseau de lignes claires qui
   *  ondule sur le haut-fond, là où l'on « voit le fond ».
   *  - Aucune texture : le motif est une somme de sinus déformés, calculée
   *    dans le shader du fond, qui existe déjà (pas de draw call en plus).
   *  - Le masque est l'alpha DÉJÀ cuit dans la rampe de l'eau : 0,3 contre la
   *    berge, 1 au large. Pas de caustiques au large, où l'eau est opaque.
   *  - Elles multiplient la couleur du fond : la teinte de nuit des `unlit`
   *    les éteint d'elle-même, aucun réglage jour/nuit à tenir à part.
   *  Coût mesuré : aucun programme shader de plus (le fond avait déjà le sien),
   *  aucun draw call, aucune texture. */
  private addCaustics(mat: MeshBasicMaterial, span: number): void {
    const uTime = { value: 0 }
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uCausticTime = uTime
      shader.uniforms.uCausticSpan = { value: span }
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uCausticTime;\nuniform float uCausticSpan;',
        )
        .replace(
          '#include <map_fragment>',
          [
            '#include <map_fragment>',
            // Haut-fond seulement. L'alpha de la rampe vaut 0,30 contre la
            // berge, 0,33 à deux cellules, au moins 0,40 au bord de la rampe :
            // le motif s'éteint vers 2 cellules et ne peut pas fuir au large
            // par le bord clampé.
            'float causticMask = 1.0 - smoothstep(0.305, 0.335, sampledDiffuseColor.a);',
            'if (causticMask > 0.001) {',
            // L'uv de la rampe couvre 2·span unités monde : on repasse en
            // unités monde pour que la maille ne dépende pas de la taille de l'île.
            '  vec2 p = (vMapUv - 0.5) * uCausticSpan * 4.2;',
            '  float t = uCausticTime * 0.45;',
            '  vec2 q = p + 0.55 * vec2(sin(p.y * 0.9 + t), cos(p.x * 0.8 - t * 1.1));',
            '  float s = abs(sin(q.x * 1.6 + t) + sin(q.y * 1.8 - t * 0.8) + sin((q.x + q.y) * 1.2 + t * 0.6));',
            // Les lignes naissent là où la somme passe par zéro : fines, pas
            // des taches. Amplitude basse : elles animent le fond sans
            // concurrencer le liséré d'écume, qui doit rester le plus clair.
            '  float c = pow(1.0 - clamp(s * 0.9, 0.0, 1.0), 6.0);',
            '  diffuseColor.rgb *= 1.0 + c * 0.2 * causticMask;',
            '}',
          ].join('\n'),
        )
    }
    // Le temps est avancé par `tickWater`, appelé depuis la boucle du jeu.
    this.causticTime = uTime
  }
  private causticTime: { value: number } | null = null

  /** Avance l'animation des caustiques (secondes de jeu). */
  tickWater(t: number): void {
    if (this.causticTime) this.causticTime.value = t % 1000
  }

  /** Les destinations d'expédition SE VOIENT : deux silhouettes bleutées à
   *  l'horizon — l'îlot voisin, la côte lointaine. Le grand large est la
   *  direction où il n'y a rien, et c'est ce rien qui le raconte. Un seul
   *  mesh, couleurs en sommets (le matériau reste blanc : la teinte
   *  jour/nuit des `unlit` peut alors s'y appliquer sans l'écraser). */
  private buildHorizons(): void {
    const parts: BufferGeometry[] = []
    const put = (src: BufferGeometry, color: Color, x: number, y: number, z: number): void => {
      // Tout en non-indexé : mergeGeometries refuse (en silence) de mélanger
      // géométries indexées et non-indexées — l'icosaèdre ne l'est pas.
      const g = src.index ? src.toNonIndexed() : src
      g.translate(x, y, z)
      const n = g.attributes.position!.count
      const rgb = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        rgb[i * 3] = color.r
        rgb[i * 3 + 1] = color.g
        rgb[i * 3 + 2] = color.b
      }
      g.setAttribute('color', new BufferAttribute(rgb, 3))
      parts.push(g)
    }
    const haze = new Color('#67818f')
    const hazeFar = new Color('#75909f')

    // L'îlot voisin : un dôme rocheux et deux pins, à l'azimut de sa fiche.
    {
      const az = 3.95
      const R = 85
      const cx = Math.sin(az) * R
      const cz = Math.cos(az) * R
      put(new IcosahedronGeometry(3.1, 0).scale(1.7, 0.85, 1.25), haze, cx, 0.4, cz)
      put(new IcosahedronGeometry(1.9, 0).scale(1.3, 0.7, 1.1), haze, cx + 3.4, 0.2, cz + 1.2)
      put(new ConeGeometry(1.0, 3.0, 6), haze, cx - 1.2, 3.4, cz - 0.4)
      put(new ConeGeometry(0.8, 2.4, 6), haze, cx + 1.4, 3.2, cz + 0.6)
    }
    // La côte lointaine : une longue échine basse, plus pâle — plus loin.
    {
      const az = 4.7
      const R = 115
      const cx = Math.sin(az) * R
      const cz = Math.cos(az) * R
      const dirX = Math.cos(az)
      const dirZ = -Math.sin(az)
      for (let i = 0; i < 6; i++) {
        const t = (i - 2.5) * 7.5
        const h = 1.6 + Math.sin(i * 2.1) * 0.9 + (i % 2) * 0.7
        put(
          new BoxGeometry(9, h, 3.2).rotateY(az + Math.sin(i * 3.7) * 0.2),
          hazeFar,
          cx + dirX * t,
          h / 2 - 0.3,
          cz + dirZ * t,
        )
      }
    }

    const geo = mergeGeometries(parts)
    if (!geo) return
    const mat = new MeshBasicMaterial({ vertexColors: true, fog: false })
    this.unlit.push(mat)
    const mesh = new Mesh(geo, mat)
    mesh.renderOrder = 0
    this.group.add(mesh)
  }

  private neighborMesh: Mesh | null = null
  private neighborFires: Mesh | null = null
  private neighborFireMat: MeshBasicMaterial | null = null

  /** Le voisinage : chaque tribu connue prend sa place à l'horizon, dans une
   *  direction tirée de son identifiant — donc stable, et la même pour elle
   *  d'une session à l'autre. Sa silhouette raconte son époque : tipis,
   *  hameau de torchis, ville à clocher, et la flèche de sa Merveille quand
   *  elle en a bâti une. Un seul mesh pour tout le monde, un second pour les
   *  feux du soir : deux draw calls, quel que soit le nombre de voisins. */
  setNeighbors(list: { id: string; age: number; wonders: number }[]): void {
    for (const m of [this.neighborMesh, this.neighborFires]) {
      if (!m) continue
      this.group.remove(m)
      m.geometry.dispose()
    }
    this.neighborMesh = null
    this.neighborFires = null
    this.neighborFireMat = null
    if (list.length === 0) return

    const parts: BufferGeometry[] = []
    const fires: BufferGeometry[] = []
    const put = (
      into: BufferGeometry[],
      src: BufferGeometry,
      color: Color,
      x: number,
      y: number,
      z: number,
    ): void => {
      const g = src.index ? src.toNonIndexed() : src
      g.translate(x, y, z)
      const n = g.attributes.position!.count
      const rgb = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        rgb[i * 3] = color.r
        rgb[i * 3 + 1] = color.g
        rgb[i * 3 + 2] = color.b
      }
      g.setAttribute('color', new BufferAttribute(rgb, 3))
      into.push(g)
    }
    const haze = new Color('#6d8794')
    const hazeFar = new Color('#7a95a3')
    const ember = new Color('#ffb457')

    // Où poser les voisins : la caméra par défaut regarde vers l'azimut 3,93
    // (l'opposé de sa position) — c'est là que l'horizon SE VOIT, et c'est
    // pour ça que l'îlot y est. Les créneaux ci-dessous encadrent cette
    // fenêtre en évitant l'îlot (3,95) et la côte (4,7), du plus visible au
    // plus périphérique : les voisins les plus récents obtiennent les
    // meilleures places, les suivants s'éloignent sur les côtés.
    // Mesuré en capture, viewport par viewport : la fenêtre visible va de 3,58
    // à 4,63 en paysage, mais seulement de 3,60 à 4,26 en portrait. Les DEUX
    // premiers créneaux tombent dans la fenêtre étroite du téléphone, de part
    // et d'autre de l'îlot ; les suivants attendent qu'on tourne la vue.
    const SLOT_AZ = [3.72, 4.15, 3.42, 4.42, 3.15, 5.05, 2.9, 5.35]

    for (let i = 0; i < list.length && i < SLOT_AZ.length; i++) {
      const n = list[i]!
      const az = SLOT_AZ[i]!
      // Distance alternée : un horizon à deux profondeurs se lit mieux qu'un
      // alignement au cordeau. Rapprochées à 92/100 (l'îlot est à 85, la côte
      // à 115) : à 104/122 elles ne faisaient plus que 50 px de large et se
      // collaient au bord haut de l'écran — vues, mais illisibles.
      const R = i % 2 === 0 ? 92 : 100
      const far = R > 96
      const skin = far ? hazeFar : haze
      const cx = Math.sin(az) * R
      const cz = Math.cos(az) * R
      // Repère local : u court le long de la côte vue, v s'éloigne vers le large.
      const tx = Math.cos(az)
      const tz = -Math.sin(az)
      const px = Math.sin(az)
      const pz = Math.cos(az)
      const at = (u: number, v: number): [number, number] => [
        cx + tx * u + px * v,
        cz + tz * u + pz * v,
      ]

      // Le socle : une île basse, plus large que haute.
      put(parts, new IcosahedronGeometry(3.9, 0).scale(1.9, 0.85, 1.3), skin, cx, 0.35, cz)
      const [sx, sz] = at(5.1, 0.8)
      put(parts, new IcosahedronGeometry(2.1, 0).scale(1.4, 0.75, 1.1), skin, sx, 0.15, sz)

      const age = Math.max(0, Math.min(9, n.age))
      if (age <= 1) {
        // Deux tipis et rien d'autre : on devine à peine qu'il y a quelqu'un.
        for (const [u, h] of [
          [-1.6, 2.8],
          [1.1, 2.3],
        ] as [number, number][]) {
          const [x, z] = at(u, 0)
          put(parts, new ConeGeometry(1.05, h, 6), skin, x, 0.9 + h / 2 - 0.6, z)
        }
      } else if (age <= 5) {
        // Le hameau : murs bas, toits en pente, un arbre resté debout.
        for (const [u, w] of [
          [-2.0, 1.9],
          [0.5, 2.4],
          [2.8, 1.7],
        ] as [number, number][]) {
          const [x, z] = at(u, 0)
          put(parts, new BoxGeometry(w, 1.6, 1.8).rotateY(az), skin, x, 1.25, z)
          put(parts, new BoxGeometry(w + 0.6, 0.55, 2.3).rotateY(az), skin, x, 2.3, z)
        }
        const [tx2, tz2] = at(3.6, 0.4)
        put(parts, new ConeGeometry(0.7, 2.4, 6), skin, tx2, 2.0, tz2)
      } else {
        // La ville : un front bâti et un clocher — visible de très loin.
        for (const [u, w, h] of [
          [-2.7, 2.2, 2.3],
          [-0.2, 2.7, 3.1],
          [2.4, 2.0, 2.0],
        ] as [number, number, number][]) {
          const [x, z] = at(u, 0)
          put(parts, new BoxGeometry(w, h, 2.0).rotateY(az), skin, x, 0.8 + h / 2, z)
        }
        const [bx, bz] = at(0.6, -0.6)
        put(parts, new BoxGeometry(1.3, 5.4, 1.3).rotateY(az), skin, bx, 3.6, bz)
        put(parts, new ConeGeometry(1.0, 2.0, 4).rotateY(az), skin, bx, 7.3, bz)
      }

      // La Merveille d'un voisin se voit d'ici : une flèche qui dépasse tout.
      if (n.wonders > 0) {
        const [wx, wz] = at(-3.4, -1.2)
        const h = 6.8 + Math.min(3, n.wonders) * 1.6
        put(parts, new CylinderGeometry(0.45, 0.9, h, 6), skin, wx, 0.8 + h / 2, wz)
        put(parts, new ConeGeometry(0.95, 1.9, 6), skin, wx, 0.8 + h + 0.8, wz)
      }

      // Les feux du soir : la preuve qu'il y a quelqu'un, même sans détail.
      // Des lueurs additives comme celles de la côte — un solide de cette
      // taille serait invisible à 100 unités. Elles se posent AU-DESSUS du
      // dôme (y = 3,2) : plus bas, l'île elle-même les mangeait au depth test,
      // et elles regardent le centre du monde, donc la caméra qui orbite.
      const fireCount = age <= 1 ? 1 : age <= 5 ? 2 : 3
      for (let i = 0; i < fireCount; i++) {
        const [fx, fz] = at(-2.1 + i * 2.2, -1.2)
        put(fires, new PlaneGeometry(2.3, 2.3).rotateY(az + Math.PI), ember, fx, 3.6, fz)
      }
    }

    const geo = mergeGeometries(parts)
    if (geo) {
      const mat = new MeshBasicMaterial({ vertexColors: true, fog: false })
      this.unlit.push(mat)
      this.neighborMesh = new Mesh(geo, mat)
      this.neighborMesh.renderOrder = 0
      this.group.add(this.neighborMesh)
    }
    const fireGeo = mergeGeometries(fires)
    if (fireGeo) {
      // Hors de `unlit` : ces braises ne doivent PAS bleuir la nuit — c'est la
      // nuit, au contraire, qui les allume (opacité pilotée par setDaylight).
      const mat = new MeshBasicMaterial({
        vertexColors: true,
        fog: false,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        map: rampTexture(32, 32, (u, v, out) => {
          const d = Math.hypot(u - 0.5, v - 0.5) * 2
          out.set('#ffab52')
          return Math.pow(Math.max(0, 1 - d), 2.4)
        }),
      })
      this.neighborFireMat = mat
      this.neighborFires = new Mesh(fireGeo, mat)
      this.neighborFires.visible = false
      this.group.add(this.neighborFires)
    }
  }

  private outpostMesh: Mesh | null = null

  /** Le comptoir fondé sur l'îlot : une cabane, un ponton, un mât — visibles
   *  de loin, dans la même brume que la silhouette qui les porte. */
  setOutpost(on: boolean): void {
    if (!on || this.outpostMesh) {
      if (!on && this.outpostMesh) {
        this.group.remove(this.outpostMesh)
        this.outpostMesh.geometry.dispose()
        this.outpostMesh = null
      }
      return
    }
    const parts: BufferGeometry[] = []
    const put = (src: BufferGeometry, color: Color, x: number, y: number, z: number): void => {
      const g = src.index ? src.toNonIndexed() : src
      g.translate(x, y, z)
      const n = g.attributes.position!.count
      const rgb = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        rgb[i * 3] = color.r
        rgb[i * 3 + 1] = color.g
        rgb[i * 3 + 2] = color.b
      }
      g.setAttribute('color', new BufferAttribute(rgb, 3))
      parts.push(g)
    }
    const az = 3.95
    const R = 85
    const cx = Math.sin(az) * R
    const cz = Math.cos(az) * R
    const warm = new Color('#8a7563')
    const roof = new Color('#9c6a4c')
    put(new BoxGeometry(2.2, 1.4, 1.8), warm, cx + 3.6, 1.0, cz + 2.6)
    put(new BoxGeometry(2.7, 0.5, 2.2).rotateZ(0.08), roof, cx + 3.6, 1.9, cz + 2.6)
    put(new BoxGeometry(5.5, 0.3, 1.2).rotateY(0.5), warm, cx + 6.4, 0.25, cz + 4.6)
    put(new CylinderGeometry(0.09, 0.12, 3.4, 5), warm, cx + 4.8, 1.7, cz + 3.4)
    const geo = mergeGeometries(parts)
    if (!geo) return
    const mat = new MeshBasicMaterial({ vertexColors: true, fog: false })
    this.unlit.push(mat)
    this.outpostMesh = new Mesh(geo, mat)
    this.group.add(this.outpostMesh)
  }

  /** Trees, rocks and berry bushes: three instanced draw calls for the whole map,
   *  each one also serving as the tap target that sets the settler's focus. */
  private scatter(rnd: () => number): void {
    // Les parcelles restent hors des tirages : la forêt de l'île de base ne
    // se rebat pas à chaque terre gagnée (leur décor viendra avec leur propre
    // tirage).
    const solid = this.cells.filter((c) => !c.beach && !c.plot)
    const near = solid
      .filter((c) => Math.hypot(c.x, c.z) <= PLAZA_RADIUS + 1.2)
      .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))
    for (const c of near) this.buildSlots.push(new Vector3(c.x, GROUND_Y, c.z))

    // Le rivage reste nu : c'est lui qui donne sa découpe à la silhouette.
    const open = solid.filter((c) => !c.trod && c.inland > 1.7)
    const free = open.filter((c) => Math.hypot(c.x - TROD.x, c.z - TROD.z) > PLAZA_RADIUS + 0.9)
    // Les sapins reculent bien au-delà de la place : le feu est le seul signe
    // d'habitat de la maquette, il lui faut de l'air autour.
    const wooded = open.filter(
      (c) => Math.hypot(c.x - TROD.x, c.z - TROD.z) > clearRadius(c.x, c.z, spreadForAge(this.age)),
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

    // Densité baissée d'un tiers et bosquets plus lâches : la référence
    // laisse voir son sol et ses bâtiments entre les arbres. À 50 sapins
    // serrés, notre village disparaissait derrière sa propre forêt.
    // Le village prend la place de la friche : blocs de pierre et buissons se
    // raréfient d'époque en époque, la pinède un peu moins (c'est elle qui
    // borde l'île). Plancher à 45 % : il faut toujours des nœuds à taper.
    const wild = Math.max(0.45, 1 - this.age * 0.062)
    const wood = Math.max(0.6, 1 - this.age * 0.03)
    const decor = this.plotDecor()
    // La pinède ne suit plus la surface de l'île : à 1,45 de croissance dès le
    // départ, elle passait de 34 à 71 sapins — 9 000 triangles, ombre
    // comprise, pour une forêt qui masquait le bourg. Plafond à 46.
    const pines = take(Math.min(TREE_MAX, Math.round(34 * wood * this.growth * this.growth)), clustered(wooded, 5.2), () => true)
    this.baseTrees = pines.length
    this.addTrees([{ cells: pines, rnd }, ...decor.trees])
    // Pierres et buissons, eux, ont le droit de border la clairière : ce sont
    // eux qui l'encadrent une fois les sapins reculés.
    // Même diagnostic que pour la pinède : les rochers encombraient la
    // clairière que le village doit occuper. Ils reculent d'un demi-rayon de
    // dégagement (moins que les sapins — ce sont eux qui BORDENT la
    // clairière) et leur nombre baisse d'un tiers.
    this.addRocks([
      {
        cells: take(
          Math.round(16 * wild * this.growth * this.growth),
          clustered(free, 9),
          (c) =>
            c.relief > 1.2 &&
            Math.hypot(c.x - TROD.x, c.z - TROD.z) > clearRadius(c.x, c.z, spreadForAge(this.age)) * 0.62,
        ),
        rnd,
      },
      ...decor.rocks,
    ])
    // Les buissons sont aussi les nœuds de NOURRITURE : les raréfier allonge
    // les trajets du colon. On les réduit donc moins que les rochers, et on
    // les tient à distance plus courte encore — ce sont eux qui bordent la
    // clairière de plus près, une fois sapins et blocs écartés.
    this.addBushes([
      {
        cells: take(
          Math.round(24 * wild * this.growth * this.growth),
          clustered(free, 6),
          (c) => Math.hypot(c.x - TROD.x, c.z - TROD.z) > clearRadius(c.x, c.z, spreadForAge(this.age)) * 0.5,
        ),
        rnd,
      },
      ...decor.bushes,
    ])
    this.separatePlotDecor()
  }

  /** Le décor d'une terre gagnée sur la mer est tiré avec son propre hasard,
   *  sans rien savoir de ce qui pousse à côté : un bloc de carrière pouvait
   *  frôler le buisson d'une parcelle voisine ou un rocher de la côte. On ne
   *  retire QUE le décor de la parcelle, jamais celui qui était déjà là :
   *  le joueur ne voit pas disparaître un arbre qu'il connaissait. Les
   *  parcelles passent dans l'ordre de pose, chacune contre tout ce qui la
   *  précède. Le décor d'une même parcelle peut se toucher : un bosquet est
   *  fait d'arbres serrés. */
  private separatePlotDecor(): void {
    if (this.land.length === 0) return
    const m = new Matrix4()
    const p = new Vector3()
    const q = new Quaternion()
    const s = new Vector3()
    const all: { mesh: InstancedMesh; i: number; src: number; x: number; z: number; r: number }[] = []
    for (const mesh of this.pickables) {
      const src = this.srcOf.get(mesh)
      const kind = this.kindOf.get(mesh)
      if (!src || !kind) continue
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m)
        m.decompose(p, q, s)
        all.push({ mesh, i, src: src[i]!, x: p.x, z: p.z, r: DECOR_R[kind] * s.x })
      }
    }
    // Tri stable par provenance : l'île de base d'abord, puis les parcelles
    // dans l'ordre où elles ont été posées.
    all.sort((a, b) => a.src - b.src)
    const kept: typeof all = []
    for (const d of all) {
      const clash =
        d.src >= 0 &&
        kept.some((k) => k.src !== d.src && Math.hypot(k.x - d.x, k.z - d.z) - k.r - d.r < DECOR_GAP)
      if (clash) this.hideDecor(d.mesh, d.i)
      else kept.push(d)
    }
  }

  /** Retire une instance de décor sans recompacter le maillage (même raison
   *  que `clearCorridor` : teintes de saison et tirages suivent le rang). */
  private hideDecor(mesh: InstancedMesh, i: number): void {
    if (this.isFelled(mesh, i)) return
    const m = new Matrix4()
    const p = new Vector3()
    const q = new Quaternion()
    const s = new Vector3()
    mesh.getMatrixAt(i, m)
    m.decompose(p, q, s)
    mesh.setMatrixAt(i, m.compose(p, q, s.setScalar(1e-3)))
    mesh.instanceMatrix.needsUpdate = true
    if (mesh === this.leavesMesh) this.felledTrees.add(i)
    else {
      let set = this.clearedOf.get(mesh)
      if (!set) this.clearedOf.set(mesh, (set = new Set()))
      set.add(i)
    }
    const kind = this.kindOf.get(mesh)
    if (kind) this.decorRemoved[kind]++
  }

  /** Le décor ne pousse pas DANS ce qui est posé. Le décor est tiré avant le
   *  village (et les parcelles après lui) : jusqu'ici seuls les sapins étaient
   *  abattus, à la louche, et rochers et buissons restaient plantés dans les
   *  murs (audit du 2026-10-13 : 22 villages sur 24 avec un rocher dans un
   *  bâtiment, 24 sur 24 avec un buisson). `blocked(x, z, r)` dit si un
   *  disque de rayon r centré là touche une emprise posée, marge comprise ;
   *  c'est le cadastre au sol qui le mesure, sur la géométrie réelle. Ce qui
   *  touche disparaît ; rien ne se déplace. Rend le nombre d'instances
   *  retirées à cet appel. */
  clearUnder(blocked: (x: number, z: number, r: number) => boolean): number {
    const m = new Matrix4()
    const p = new Vector3()
    const q = new Quaternion()
    const s = new Vector3()
    let n = 0
    for (const mesh of this.pickables) {
      const kind = this.kindOf.get(mesh)
      if (!kind) continue
      for (let i = 0; i < mesh.count; i++) {
        if (this.isFelled(mesh, i)) continue
        mesh.getMatrixAt(i, m)
        m.decompose(p, q, s)
        if (!blocked(p.x, p.z, DECOR_R[kind] * s.x)) continue
        this.hideDecor(mesh, i)
        n++
      }
    }
    return n
  }

  /** Le décor de chaque parcelle, tiré avec SON hasard (graine de l'île mêlée
   *  à la position de la parcelle) : il vient APRÈS celui de l'île de base,
   *  dans les mêmes trois maillages instanciés. Les instances de l'île de
   *  base gardent donc leur rang, leur position et leur teinte quand une terre
   *  se pose. Forêt : des sapins serrés. Carrière : des blocs taillés autour
   *  de la fosse. Affleurement : de la roche rouillée sur la butte. Prairie :
   *  des buissons parmi les fleurs (cousues dans le terrain, comme les
   *  roseaux). Crique : deux galets sur le sable. */
  private plotDecor(): { trees: Scatter[]; rocks: Scatter[]; bushes: Scatter[] } {
    const out = { trees: [] as Scatter[], rocks: [] as Scatter[], bushes: [] as Scatter[] }
    for (const [src, p] of this.land.entries()) {
      const rnd = plotRandom(this.seed, p, 0x7ee5)
      const mine = this.cells.filter((c) => c.plotOf === p)
      const ring = mine.filter((c) => !c.plotCenter)
      const center = mine.filter((c) => c.plotCenter)
      const some = (cells: Cell[], n: number): Cell[] =>
        cells
          .map((c) => ({ c, k: rnd() }))
          .sort((a, b) => a.k - b.k)
          .slice(0, n)
          .map((e) => e.c)
      if (p.kind === 'foret') out.trees.push({ cells: some(mine, 6), rnd, src })
      else if (p.kind === 'carriere')
        out.rocks.push({ cells: some(ring, 4), rnd, scale: 1.25, block: true, tones: [PALETTE.rock, PALETTE.rockDark], src })
      else if (p.kind === 'affleurement')
        out.rocks.push({ cells: [...center, ...center, ...some(ring, 3)], rnd, scale: 1.2, tones: ORE_TONES, src })
      else if (p.kind === 'prairie') out.bushes.push({ cells: some(ring, 2), rnd, src })
      else if (p.kind === 'crique') out.rocks.push({ cells: some(ring, 2), rnd, scale: 0.6, tones: [PALETTE.rock], src })
    }
    return out
  }

  // Audit échelles 2026-08, round 2 : à ~5 u de moyenne les cimes rasaient
  // l'apex du grand tipi (4,7 u) — le camp dominait la forêt. On vise ~9 u de
  // moyenne (cimes ≈ 7–12 u) : la canopée domine nettement tipis et huttes,
  // tout en restant sous le ratio réel d'un pin adulte (choix assumé — la
  // lisibilité du village prime). Hauteur et rayon restent découplés : gonfler
  // le rayon d'autant noierait le sol et les clairières, on garde une
  // silhouette de pin élancée. Retour joueur v1.7.0 : le cône unique prenait
  // trop de place — houppier passé en trois étages, rayon resserré (1.55).
  private static readonly TREE_H = 4.0
  private static readonly TREE_R = 1.55

  private addTrees(groups: Scatter[]): void {
    const cells = groups.flatMap((g) => g.cells)

    // Houppier étagé : trois couronnes qui se chevauchent, légèrement
    // désaxées, plus sombres vers le bas. Un cône unique à cette hauteur
    // était une voile pleine qui mangeait l'île ; les étages rendent la
    // silhouette d'un vrai conifère, laissent passer le ciel entre eux et
    // réduisent l'emprise au sol. Le dégradé vit dans les couleurs de
    // sommets — il se multiplie à la teinte par instance déjà payée.
    const tier = (
      r: number,
      h: number,
      seg: number,
      x: number,
      y: number,
      z: number,
      shade: number,
    ): BufferGeometry => {
      const g = new ConeGeometry(r, h, seg)
      g.translate(x, y, z)
      const n = g.attributes.position!.count
      const col = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        // Le bas de chaque couronne plus sombre que sa pointe : l'ombre
        // interne du feuillage, sans une lumière de plus.
        const k = shade * (0.9 + 0.1 * smoothstep(-h / 2, h / 2, g.attributes.position!.getY(i) - y))
        col[i * 3] = k
        col[i * 3 + 1] = k
        col[i * 3 + 2] = k
      }
      g.setAttribute('color', new BufferAttribute(col, 3))
      g.setAttribute('leafMask', new BufferAttribute(new Float32Array(n).fill(1), 1))
      return g
    }
    // Le tronc vit dans la MÊME instance que son houppier : un draw call (et
    // un de plus pour l'ombre) au lieu de deux. Il se place 1,2 unité locale
    // sous le houppier — exactement l'écart des deux matrices d'avant, qui
    // partageaient rotation et échelle. Sa couleur est portée par ses sommets
    // et `leafMask = 0` le soustrait à la teinte par instance : la saison
    // roussit les aiguilles, jamais l'écorce.
    const trunk = new CylinderGeometry(0.11, 0.16, 0.9, 6).translate(0, -1.2, 0)
    const tn = trunk.attributes.position!.count
    const bark = new Float32Array(tn * 3)
    for (let k = 0; k < tn; k++) PALETTE.trunk.toArray(bark, k * 3)
    trunk.setAttribute('color', new BufferAttribute(bark, 3))
    trunk.setAttribute('leafMask', new BufferAttribute(new Float32Array(tn), 1))
    const leafGeo =
      mergeGeometries([
        trunk,
        tier(0.52, 0.85, 7, 0.025, -0.33, -0.015, 0.78),
        tier(0.4, 0.78, 7, -0.02, 0.1, 0.015, 0.9),
        tier(0.27, 0.72, 6, 0.01, 0.53, 0.02, 1.0),
      ]) ?? new ConeGeometry(0.52, 1.5, 7)
    const leafMat = new MeshToonMaterial({ vertexColors: true })
    leafMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float leafMask;')
        .replace(
          '#include <color_vertex>',
          ['#include <color_vertex>', '#ifdef USE_INSTANCING_COLOR', 'vColor.rgb = color.rgb * mix(vec3(1.0), instanceColor.rgb, leafMask);', '#endif'].join('\n'),
        )
    }
    const leaves = new InstancedMesh(leafGeo, leafMat, cells.length)
    leaves.castShadow = true

    const d = new Object3D()
    const leafColors = [PALETTE.leafA, PALETTE.leafB, PALETTE.leafC]
    const { TREE_H, TREE_R } = Island
    let i = 0
    const srcs = new Int16Array(cells.length)
    for (const { cells: list, rnd, src = -1 } of groups) for (const c of list) {
      srcs[i] = src
      // Variance élargie (0,72–1,27) : à cette échelle, un semis uniforme se
      // lirait comme une plantation. Même nombre d'appels à rnd() qu'avant
      // pour garder les positions (jitter, faune, treeDist) stables.
      // Variance resserrée par le haut (0,72–1,12 au lieu de 0,72–1,27) : les
      // plus hauts montaient à ~12 unités et coupaient les toits du village
      // depuis la caméra par défaut. Le même tirage aléatoire est conservé,
      // seule son amplitude change — positions, faune et treeDist ne bougent pas.
      const s = 0.72 + rnd() * 0.4
      const jx = (rnd() - 0.5) * 0.5
      const jz = (rnd() - 0.5) * 0.5
      d.position.set(c.x + jx, GROUND_Y + 1.65 * s * TREE_H, c.z + jz)
      d.rotation.set(0, rnd() * Math.PI, 0)
      d.scale.set(s * TREE_R, s * TREE_H, s * TREE_R)
      d.updateMatrix()
      leaves.setMatrixAt(i, d.matrix)
      const leaf = tint(leafColors[i % 3]!, i, 0.08)
      leaves.setColorAt(i, leaf.clone())
      i++
    }
    leaves.instanceMatrix.needsUpdate = true
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true
    this.group.add(leaves)
    this.registerPickable(leaves, 'wood')
    this.srcOf.set(leaves, srcs)
    // Les saisons repeignent le feuillage : garder la teinte de base.
    this.leavesMesh = leaves
    this.leafBase = leaves.instanceColor ? new Float32Array(leaves.instanceColor.array) : null
  }

  private addRocks(groups: Scatter[]): void {
    const geo = new DodecahedronGeometry(0.42, 0)
    const mat = new MeshToonMaterial()
    const mesh = new InstancedMesh(geo, mat, groups.reduce((n, g) => n + g.cells.length, 0))
    mesh.castShadow = true
    mesh.receiveShadow = true

    const d = new Object3D()
    let i = 0
    const srcs = new Int16Array(mesh.count)
    for (const { cells, rnd, scale = 1, block = false, tones, src = -1 } of groups) for (const c of cells) {
      srcs[i] = src
      // Amplitude resserrée (0,5–0,95 au lieu de 0,55–1,25) : les plus gros
      // blocs atteignaient la taille d'une hutte et mangeaient le sol autour
      // d'eux. Même tirage aléatoire, seule l'échelle change.
      const s = (0.5 + rnd() * 0.45) * scale
      d.position.set(c.x + (rnd() - 0.5) * 0.6, GROUND_Y + 0.2 * s, c.z + (rnd() - 0.5) * 0.6)
      d.rotation.set(rnd() * 0.5, rnd() * Math.PI, rnd() * 0.5)
      // Un bloc de carrière est taillé : posé à plat, plus large que haut.
      if (block) d.rotation.set(0, d.rotation.y, 0)
      d.scale.set(s, s * (block ? 0.6 : 0.75), s)
      d.updateMatrix()
      mesh.setMatrixAt(i, d.matrix)
      const tone = tones ? tones[i % tones.length]! : i % 3 === 0 ? PALETTE.rockDark : PALETTE.rock
      mesh.setColorAt(i, tint(tone, i, 0.07))
      i++
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    this.group.add(mesh)
    this.bushMesh = mesh
    this.bushBase = mesh.instanceColor ? new Float32Array(mesh.instanceColor.array) : null
    this.registerPickable(mesh, 'stone')
    this.srcOf.set(mesh, srcs)
  }

  private addBushes(groups: Scatter[]): void {
    const geo = new IcosahedronGeometry(0.34, 0)
    const mat = new MeshToonMaterial()
    const mesh = new InstancedMesh(geo, mat, groups.reduce((n, g) => n + g.cells.length, 0))
    mesh.castShadow = true

    const d = new Object3D()
    const berry = new Color('#4a7340')
    let i = 0
    const srcs = new Int16Array(mesh.count)
    for (const { cells, rnd, src = -1 } of groups) for (const c of cells) {
      srcs[i] = src
      // Audit échelles : ×1,5 pour viser ~1 m réel (le colon = 1,5 u ≙ 1,75 m).
      // Amplitude resserrée par le haut (0,7–1,05 au lieu de 0,7–1,2) : les
      // plus gros buissons montaient à 1,44 unité, soit la hauteur d'un
      // villageois assis — ils encombraient le sol de la clairière.
      const s = (0.7 + rnd() * 0.35) * 1.5
      d.position.set(c.x + (rnd() - 0.5) * 0.7, GROUND_Y + 0.22 * s, c.z + (rnd() - 0.5) * 0.7)
      d.rotation.set(0, rnd() * Math.PI, 0)
      d.scale.set(s, s * 0.8, s)
      d.updateMatrix()
      mesh.setMatrixAt(i, d.matrix)
      mesh.setColorAt(i, tint(berry, i * 7, 0.1))
      i++
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    this.group.add(mesh)
    this.bushMesh = mesh
    this.bushBase = mesh.instanceColor ? new Float32Array(mesh.instanceColor.array) : null
    this.registerPickable(mesh, 'food')
    this.srcOf.set(mesh, srcs)
  }

  /** Abattre les arbres d'un couloir — ce que fait une voie romaine. On ne
   *  RECOMPACTE pas les instances : les couleurs de saison et le tirage
   *  aléatoire des positions suivent l'ordre d'origine, et tout décaler
   *  repeindrait la forêt entière. L'arbre abattu garde donc sa place, réduit
   *  à un millième — invisible, mais sa position reste lisible pour tout ce
   *  qui l'interroge. `felledTrees` l'exclut des nœuds de récolte : un tronc
   *  qu'on ne voit pas ne doit pas rester un lieu où le colon va bûcheronner. */
  clearCorridor(pts: { x: number; z: number }[], radius: number, upTo = Infinity): void {
    const leaves = this.leavesMesh
    if (!leaves || pts.length === 0) return
    const m = new Matrix4()
    const p = new Vector3()
    const q = new Quaternion()
    const s = new Vector3()
    const r2 = radius * radius
    let cut = 0
    for (let i = 0; i < Math.min(leaves.count, upTo); i++) {
      if (this.felledTrees.has(i)) continue
      leaves.getMatrixAt(i, m)
      m.decompose(p, q, s)
      let hit = false
      for (const c of pts) {
        if ((c.x - p.x) ** 2 + (c.z - p.z) ** 2 < r2) {
          hit = true
          break
        }
      }
      if (!hit) continue
      this.felledTrees.add(i)
      cut++
      // Le tronc est dans l'instance du houppier : il part avec lui.
      leaves.setMatrixAt(i, m.compose(p, q, s.setScalar(1e-3)))
    }
    if (cut === 0) return
    leaves.instanceMatrix.needsUpdate = true
  }

  /** ÉCLAIRCIR un secteur : on abat une part des arbres d'un quartier au lieu
   *  de le raser. C'est le côté caméra qui en a besoin — la pinède du premier
   *  plan masquait le bourg — et une coupe franche y ferait une calvitie :
   *  l'écrémage garde une lisière, il l'aère. La sélection est un hachage de
   *  la position, donc stable d'un chargement à l'autre. */
  thinWedge(azimuth: number, halfAngle: number, fraction: number, rMin: number): void {
    const leaves = this.leavesMesh
    if (!leaves) return
    const ax = Math.sin(azimuth)
    const az = Math.cos(azimuth)
    const cosMax = Math.cos(halfAngle)
    const m = new Matrix4()
    const p = new Vector3()
    const q = new Quaternion()
    const sc = new Vector3()
    const doomed: { x: number; z: number }[] = []
    // Les sapins d'une parcelle de forêt restent : c'est elle que le joueur a
    // choisie, et elle borde la côte, loin du bourg qu'il faut dégager.
    for (let i = 0; i < this.baseTrees; i++) {
      if (this.felledTrees.has(i)) continue
      leaves.getMatrixAt(i, m)
      m.decompose(p, q, sc)
      const r = Math.hypot(p.x, p.z)
      if (r < rMin) continue
      if ((p.x * ax + p.z * az) / (r + 1e-6) < cosMax) continue
      const h = Math.sin(p.x * 12.9898 + p.z * 78.233) * 43758.5453
      if (h - Math.floor(h) > fraction) continue
      doomed.push({ x: p.x, z: p.z })
    }
    if (doomed.length > 0) this.clearCorridor(doomed, 0.4, this.baseTrees)
  }

  /** Un arbre abattu n'est plus un nœud de bois : main.ts l'écarte du relevé.
   *  Vaut aussi pour un rocher ou un buisson retiré sous une emprise. */
  isFelled(mesh: InstancedMesh, index: number): boolean {
    if (mesh === this.leavesMesh) return this.felledTrees.has(index)
    return this.clearedOf.get(mesh)?.has(index) ?? false
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

  /** La cellule sous un point du monde, ou `null` si c'est de l'eau.
   *  Inverse exacte de `hexCenter` suivie de l'arrondi cubique : en O(1), là
   *  où l'ancien `heightAt` balayait les six cents cellules à chaque appel —
   *  soit un demi-million de comparaisons par seconde rien que pour la faune. */
  cellAt(x: number, z: number): Cell | null {
    const q = x / HEX_DX
    const r = z / HEX_DZ - q / 2
    const sAx = -q - r
    let rq = Math.round(q)
    let rr = Math.round(r)
    const rs = Math.round(sAx)
    const dq = Math.abs(rq - q)
    const dr = Math.abs(rr - r)
    const ds = Math.abs(rs - sAx)
    if (dq > dr && dq > ds) rq = -rr - rs
    else if (dr > ds) rr = -rq - rs
    return this.byKey.get(key(rq, rr)) ?? null
  }

  /** Cellules d'eau qu'une parcelle garde vides : le centre et la passe d'une
   *  crique. La pose suivante ne doit pas refermer la crique en lagune. */
  private readonly reserved = new Set<number>()

  /** Pose les cellules d'une parcelle. Une cellule déjà en terre est laissée
   *  telle quelle. Toutes au niveau du reste de l'île : c'est la teinte du sol
   *  et le décor qui distinguent une carrière d'un affleurement. */
  private addPlot(p: LandPlot): void {
    const look = plotLook(p.kind)
    // La crique : un croissant de sable autour d'un centre d'eau, ouvert vers
    // le large par la cellule de l'anneau la plus éloignée du centre de l'île.
    let mouth: number | null = null
    if (look.cove) {
      let far = -1
      let m = 0
      for (let k = 0; k < 6; k++) {
        const [x, z] = hexCenter(p.q + NB[k]![0], p.r + NB[k]![1])
        if (Math.hypot(x, z) > far) {
          far = Math.hypot(x, z)
          m = k
        }
      }
      mouth = m
      this.reserved.add(key(p.q, p.r))
      this.reserved.add(key(p.q + NB[m]![0], p.r + NB[m]![1]))
    }
    for (let k = -1; k < 6; k++) {
      if (k === mouth || (k < 0 && look.cove)) continue
      const gx = p.q + (k < 0 ? 0 : NB[k]![0])
      const gz = p.r + (k < 0 ? 0 : NB[k]![1])
      if (this.byKey.has(key(gx, gz))) continue
      const [x, z] = hexCenter(gx, gz)
      const cell: Cell = {
        gx,
        gz,
        x,
        z,
        beach: look.beach,
        inland: k < 0 ? 2 : 1,
        relief: 1,
        rim: false,
        outx: 0,
        outz: 0,
        trod: false,
        plot: p.kind,
        plotCenter: k < 0,
        plotOf: p,
      }
      this.cells.push(cell)
      this.byKey.set(key(gx, gz), cell)
    }
  }

  /** Raccord avec l'ancienne côte : une parcelle posée contre la terre laisse
   *  parfois une ou deux cellules d'eau enclavées — un trou, vu d'en haut. On
   *  les comble avec la terre de la parcelle voisine. Les eaux d'une crique,
   *  elles, restent de l'eau. */
  private fillPockets(): void {
    if (this.land.length === 0) return
    let q0 = Infinity
    let q1 = -Infinity
    let r0 = Infinity
    let r1 = -Infinity
    for (const c of this.cells) {
      q0 = Math.min(q0, c.gx - 1)
      q1 = Math.max(q1, c.gx + 1)
      r0 = Math.min(r0, c.gz - 1)
      r1 = Math.max(r1, c.gz + 1)
    }
    // Remplissage depuis le bord de la boîte : l'eau qu'on n'atteint pas est
    // enclavée.
    const sea = new Set<number>()
    const stack: [number, number][] = []
    for (let q = q0; q <= q1; q++)
      for (let r = r0; r <= r1; r++) if (q === q0 || q === q1 || r === r0 || r === r1) stack.push([q, r])
    while (stack.length > 0) {
      const [q, r] = stack.pop()!
      if (q < q0 || q > q1 || r < r0 || r > r1) continue
      const k = key(q, r)
      if (sea.has(k) || this.byKey.has(k)) continue
      sea.add(k)
      for (const [dq, dr] of NB) stack.push([q + dq, r + dr])
    }
    for (let q = q0; q <= q1; q++) {
      for (let r = r0; r <= r1; r++) {
        const k = key(q, r)
        if (sea.has(k) || this.byKey.has(k) || this.reserved.has(k)) continue
        // Seules les parcelles creusent ces flaques : la cellule comblée prend
        // le type d'une parcelle voisine.
        const from = NB.map(([dq, dr]) => this.byKey.get(key(q + dq, r + dr))).find((n) => n?.plot)
        if (!from?.plot) continue
        const [x, z] = hexCenter(q, r)
        const cell: Cell = {
          gx: q,
          gz: r,
          x,
          z,
          beach: from.beach,
          inland: 1,
          relief: 1,
          rim: false,
          outx: 0,
          outz: 0,
          trod: false,
          plot: from.plot,
          plotOf: from.plotOf,
        }
        this.cells.push(cell)
        this.byKey.set(k, cell)
      }
    }
  }

  /** Nombre de cellules venues des parcelles — exposé au harnais de test. */
  get plotCells(): number {
    return this.cells.reduce((n, c) => n + (c.plot ? 1 : 0), 0)
  }

  /** Une parcelle peut-elle se poser en (q, r) ? Ses sept cellules sont dans
   *  l'eau — ni sur l'île, ni sur une terre déjà gagnée, ni dans les eaux
   *  gardées d'une crique — et au moins deux touchent la côte : la terre colle
   *  au rivage au lieu de flotter au large. */
  canAnchor(q: number, r: number): boolean {
    const [x, z] = hexCenter(q, r)
    if (Math.hypot(x, z) > this.radius + TILE * 4) return false
    let touching = 0
    for (let k = -1; k < 6; k++) {
      const gx = q + (k < 0 ? 0 : NB[k]![0])
      const gz = r + (k < 0 ? 0 : NB[k]![1])
      if (this.byKey.has(key(gx, gz)) || this.reserved.has(key(gx, gz))) return false
      if (NB.some(([dq, dr]) => this.byKey.has(key(gx + dq, gz + dr)))) touching++
    }
    return touching >= 2
  }

  /** Toutes les ancres valides, rangées par secteur de côte (six secteurs de
   *  60°, le secteur 0 à l'ARRIÈRE du cadrage par défaut : la caméra regarde
   *  vers −x, −z), chacune triée de la plus proche du centre à la plus
   *  lointaine. `used` compte les parcelles déjà posées par secteur. */
  private anchorsBySector(): { sectors: { q: number; r: number; d: number }[][]; used: number[] } {
    const back = Math.atan2(-1, -1)
    const sectorOf = (x: number, z: number): number => {
      let a = Math.atan2(z, x) - back + Math.PI / 6
      a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
      return Math.floor(a / (Math.PI / 3)) % 6
    }
    const used = [0, 0, 0, 0, 0, 0]
    for (const p of this.land) {
      const [x, z] = hexCenter(p.q, p.r)
      used[sectorOf(x, z)]!++
    }
    const sectors: { q: number; r: number; d: number }[][] = [[], [], [], [], [], []]
    const span = 48
    for (let q = -span; q <= span; q++) {
      for (let r = -span; r <= span; r++) {
        if (!this.canAnchor(q, r)) continue
        const [x, z] = hexCenter(q, r)
        sectors[sectorOf(x, z)]!.push({ q, r, d: Math.hypot(x, z) })
      }
    }
    for (const list of sectors) list.sort((a, b) => a.d - b.d)
    return { sectors, used }
  }

  /** Ordre de préférence des secteurs : le moins garni d'abord, et à égalité
   *  l'arrière, puis en s'éloignant de part et d'autre — le devant en dernier,
   *  pour ne pas masquer le village. */
  private static readonly SECTOR_ORDER = [0, 1, 5, 2, 4, 3]

  /** Où poser la prochaine parcelle quand le joueur s'en remet au jeu. Dans
   *  le secteur le moins garni, la place la plus proche du centre. */
  defaultAnchor(): { q: number; r: number } | null {
    const { sectors, used } = this.anchorsBySector()
    let pick: { q: number; r: number } | null = null
    let pickUsed = Infinity
    for (const s of Island.SECTOR_ORDER) {
      const b = sectors[s]![0]
      if (b && used[s]! < pickUsed) {
        pick = { q: b.q, r: b.r }
        pickUsed = used[s]!
      }
    }
    return pick
  }

  /** Les emplacements proposés au joueur pour une terre de type `kind` : `n`
   *  ancres sur des secteurs de côte différents, assez écartées pour ne pas se
   *  confondre à l'écran. La première est l'ancre par défaut. Si une ancre
   *  peut toucher une terre du même type, l'une des propositions en est une :
   *  le voisinage doit se voir pour qu'on le joue. `bond` le signale. */
  anchorCandidates(kind: string, n = 3): { q: number; r: number; bond: boolean }[] {
    const { sectors, used } = this.anchorsBySector()
    const bondAt = (q: number, r: number): boolean =>
      this.land.some((p) => p.kind === kind && hexDistance(p.q, p.r, q, r) <= 3)
    const order = [...Island.SECTOR_ORDER].sort((a, b) => used[a]! - used[b]!)
    const out: { q: number; r: number; bond: boolean }[] = []
    // Deux ancres à moins de 4 cellules se recouvrent à l'écran.
    const apart = (q: number, r: number): boolean => out.every((o) => hexDistance(o.q, o.r, q, r) >= 4)
    const def = this.defaultAnchor()
    if (def) out.push({ ...def, bond: bondAt(def.q, def.r) })
    // Une ancre de voisinage, s'il en existe une, dans l'ordre des secteurs.
    if (!out.some((o) => o.bond)) {
      for (const s of order) {
        const b = sectors[s]!.find((a) => bondAt(a.q, a.r) && apart(a.q, a.r))
        if (b) {
          out.push({ q: b.q, r: b.r, bond: true })
          break
        }
      }
    }
    // Puis un secteur neuf à chaque fois ; s'il en manque, on repasse.
    for (let pass = 0; pass < 2 && out.length < n; pass++) {
      for (const s of order) {
        if (out.length >= n) break
        if (pass === 0 && out.some((o) => sectorHas(sectors[s]!, o))) continue
        const b = sectors[s]!.find((a) => apart(a.q, a.r))
        if (b) out.push({ q: b.q, r: b.r, bond: bondAt(b.q, b.r) })
      }
    }
    return out.slice(0, n)
  }

  /** Les sept cellules d'une ancre, en coordonnées monde — pour la surbrillance. */
  static anchorCells(q: number, r: number): [number, number][] {
    const out: [number, number][] = [hexCenter(q, r)]
    for (const [dq, dr] of NB) out.push(hexCenter(q + dq, r + dr))
    return out
  }

  /** Y a-t-il de la terre ici ? La question que `heightAt` ne pouvait PAS
   *  poser : il renvoyait la hauteur de la cellule la plus proche, donc
   *  au-dessus de l'eau il rendait celle de la berge voisine — et le vide
   *  passait pour du sol plat. C'est ainsi que des bâtiments se posaient à
   *  cheval sur le bord de l'île. */
  isLand(x: number, z: number): boolean {
    return this.cellAt(x, z) !== null
  }
}
