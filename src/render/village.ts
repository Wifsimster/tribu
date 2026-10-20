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
  Euler,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  Object3D,
  PointLight,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Sprite,
  TetrahedronGeometry,
  TorusGeometry,
  SpriteMaterial,
  Sphere,
  Vector3,
} from 'three'
import type { DataTexture } from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PALETTE, rampTexture, smoothstep, tint } from './palette'
import { GROUND_Y, GROWN_GROWTH, Island, RAIL_AGE } from './island'
import { beltFor, beltPath, beltRadius, cleanBelt, growBelt, insideBelt, nearestOnLoop } from './belt'
import { TOOLS, WONDER_BY_AGE } from '../game/content'
import { halfSpanOf, heightOf } from './model-geo'
import { loadModels, modelGeometry, modelGeometryReady } from './models'
import { VEHICLE_SCALE, headingYaw, vehicleGeometry, type VehicleId } from './vehicles'
import type { Footprint, GroundSource } from './ground'
import {
  CAR_LENGTH,
  CAR_MODEL,
  TRAIN_SCALE,
  consistFor,
  layConsist,
  pointAt,
  rankCargo,
  wrapS,
  type CarKind,
  type CarPose,
  type Cargo,
  type Track,
} from './consist'

/** Le foyer est posé à côté du point de dépôt, pas dessus, et perpendiculairement
 *  à l'axe de la caméra par défaut: sinon le colon rentre dans les flammes et sa
 *  silhouette se noie dedans. */
const HEARTH = { x: -1.15, z: 1.15 }

/** Le campement de départ, en coordonnées locales au foyer. Il est composé dans
 *  l'espace de l'écran et non dans celui du monde: à la vue par défaut, l'axe
 *  (+x,−z) va vers la droite et (+x,+z) vers la caméra. Chaque pièce est donc
 *  posée pour ne pas retomber sur la flamme — la tente à droite, le séchoir et
 *  le bois à gauche, le sol de travail devant. */
const CAMP = {
  tent: { x: 0.99, z: -2.55 },
  lean: { x: 3.88, z: -3.17 },
  rack: { x: 0, z: 2.4 },
  wood: { x: -1.77, z: 1.48 },
  frame: { x: -2.26, z: -1.13 },
  knap: { x: 2.9, z: 0.78 },
  screen: { x: -2.05, z: -3.05 },
} as const

/** Le campement entier est joué plus grand que l'échelle du terrain. Sur un
 *  téléphone la tente fait quarante pixels: à cette taille, la justesse
 *  d'échelle perd contre le fait d'exister. Le colon est déjà joué ainsi. */
const SCALE = 1.2

/** Le plan de rues. LANE_R0 : où commence une rue, au bord de la place du
 *  camp. LANE_STEP : la longueur d'un pas de tracé. PLOT_EVERY : une parcelle
 *  tous les N pas — l'entraxe des façades. PLOT_OFFSET : recul de la façade
 *  par rapport à l'axe de la rue, assez large pour que la chaussée (1,6 u) et
 *  ses bordures passent entre deux rangées. */
const LANE_R0 = 4.8
const LANE_STEP = 1.6
const PLOT_EVERY = 1
const PLOT_OFFSET = 2.6
/** Les parcelles : deux rangées de part et d'autre de l'axe, la seconde en
 *  retrait derrière la première. */
const PLOT_ROWS: readonly (readonly [number, number])[] = [
  [1, PLOT_OFFSET],
  [-1, PLOT_OFFSET],
  [1, PLOT_OFFSET * 2.15],
  [-1, PLOT_OFFSET * 2.15],
]

/** Le colon rentre au feu, pas au centre géométrique de l'île: c'est ce qui
 *  fait du foyer un lieu où l'on revient, et non un décor à côté duquel on
 *  dépose. Lu par settler.ts. */
export const CAMP_HOME = { x: HEARTH.x + 1.49 * SCALE, z: HEARTH.z + 0.07 * SCALE }

/** Position du foyer, pour que le colon sache vers quoi se tourner en rentrant. */
export const CAMP_FIRE = { x: HEARTH.x, z: HEARTH.z }

/** Emprise au sol de ce qui est plein, en monde: le colon la contourne. Un
 *  homme qui ressort par la peau d'une tente ruine le peu de solidité qu'on
 *  vient de donner au campement. */
export const CAMP_BLOCKERS: readonly { x: number; z: number; r: number }[] = (
  [
    [CAMP.tent, 1.8],
    [CAMP.lean, 1.25],
    [CAMP.rack, 1.02],
    [CAMP.wood, 1.0],
    [CAMP.frame, 0.75],
    [CAMP.screen, 1.25],
    [{ x: 0, z: 0 }, 1.35],
  ] as const
).map(([s, r]) => ({ x: HEARTH.x + s.x * SCALE, z: HEARTH.z + s.z * SCALE, r: r * SCALE }))

/** Regarder le feu ne suffit pas: une pièce ouverte tournée vers la flamme
 *  présente son dos à la caméra et redevient un panneau. Ces trois-là sont donc
 *  ouvertes de trois quarts, entre le feu et l'œil. */
const CAMERA_YAW = Math.PI / 4
const TENT_YAW = Math.atan2(-CAMP.tent.x, -CAMP.tent.z) + 0.5

/** Murs et toits chauds posés sur des pierres froides: c'est ce contraste, plus
 *  que le nombre de polygones, qui fait qu'une maison a l'air habitée. */
const C = {
  stone: new Color('#a7aeba'),
  stoneDark: new Color('#828a98'),
  stoneLight: new Color('#c9cfd7'),
  wall: new Color('#e2b57f'),
  plaster: new Color('#f3e7d1'),
  tile: new Color('#4260c4'),
  tileDark: new Color('#31489b'),
  ridge: new Color('#8ba2ea'),
  wood: PALETTE.trunk,
  woodDark: new Color('#5f4229'),
  hide: PALETTE.hide,
  hideDark: new Color('#93643d'),
  // Les peaux tirent vers la craie: contre une île verte, c'est la valeur claire
  // qui fait exister le campement, pas sa saturation. Elles restent sous le
  // blanc, sinon la lumière du feu les fait déborder en zone brûlée.
  hideLight: new Color('#cdac81'),
  hidePale: new Color('#e2cba3'),
  ochre: new Color('#b4713d'),
  meat: new Color('#9d5340'),
  bone: new Color('#efe6d2'),
  glass: new Color('#46606b'),
  soil: new Color('#8f6a4a'),
  soilDark: new Color('#6d4f36'),
  wheat: PALETTE.wheat,
  water: PALETTE.water,
  ash: new Color('#544c45'),
  char: new Color('#332c27'),
  // Au-dessus de 1: le matériau toon multiplie cette couleur par son éclairage,
  // et sans cette marge une braise à l'ombre redevient une pastille brune.
  emberCore: new Color(2.1, 1.02, 0.34),
  emberFlame: new Color(2.6, 1.62, 0.7),
  smoke: new Color('#8d9aa0'),
  emberSmoke: new Color('#e4854a'),
  sky: new Color('#cfe3ec'),
} as const

/** Une pièce teintée puis posée. Un bâtiment entier finit fondu en une seule
 *  géométrie: on peut empiler les rangs de tuiles sans payer un draw call. */
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

/** Le dessus du rail : la base des modèles de la rame (dessous des roues).
 *  Ballast à GROUND_Y + 0,05, rails de 0,07 centrés 0,13 plus haut. L'ancien
 *  train était posé à GROUND_Y + 0,06 : ses roues s'enfonçaient dans le rail. */
const RAIL_TOP = GROUND_Y + 0.05 + 0.13 + 0.035

/** Un véhicule de la rame en primitives, au repère de son modèle (base à 0,
 *  avant en +Z, centré, sa longueur d'attelage à attelage). Ne sert que si le
 *  fichier manque : la rame reste entière et attelée. */
function primitiveCar(kind: CarKind): BufferGeometry {
  const iron = new Color('#3b4149')
  const wheel = new Color('#5a6068')
  const len = CAR_LENGTH[kind]
  const p: BufferGeometry[] = []
  const axles = kind === 'loco' ? [0.6, 0, -0.7] : kind === 'coach' ? [0.52, -0.52] : [0.4, -0.4]
  for (const s of [-1, 1])
    for (const z of axles)
      p.push(part(new CylinderGeometry(0.15, 0.15, 0.06, 8).rotateZ(Math.PI / 2), wheel, s * 0.34, 0.15, z))
  if (kind === 'loco') {
    p.push(part(new BoxGeometry(0.8, 0.14, 2.0), iron, 0, 0.27, -0.1))
    p.push(part(new CylinderGeometry(0.3, 0.3, 1.3, 10).rotateX(Math.PI / 2), new Color('#7d2f28'), 0, 0.62, 0.35))
    p.push(part(new BoxGeometry(0.66, 0.7, 0.62), iron, 0, 0.7, -0.75))
    p.push(part(new CylinderGeometry(0.13, 0.17, 0.42, 8), iron, 0, 1.0, 0.8))
  } else {
    const body =
      kind === 'coach' ? new Color('#2f5d46') : kind === 'empty' ? tint(C.woodDark, 4, 0.06) : C.wood
    p.push(part(new BoxGeometry(0.8, 0.1, len - 0.2), iron, 0, 0.27, 0))
    p.push(part(new BoxGeometry(0.74, kind === 'coach' ? 0.55 : 0.4, len - 0.3), body, 0, kind === 'coach' ? 0.6 : 0.52, 0))
  }
  // La barre d'attelage, de bout en bout : c'est elle qui touche le voisin.
  p.push(part(new BoxGeometry(0.08, 0.06, len), iron, 0, 0.21, 0))
  return mergeGeometries(p)!
}

/** Chaque pièce du campement est construite autour de son propre axe, porte
 *  vers +z, puis tournée et posée: on écrit un abri, pas des coordonnées. */
function place(
  out: BufferGeometry[],
  parts: BufferGeometry[],
  angle: number,
  x: number,
  z: number,
): void {
  for (const g of parts) out.push(g.rotateY(angle).translate(x, 0, z))
}

/** Angle qui tourne la face +z d'une pièce vers le foyer, à l'origine locale. */
function facingFire(x: number, z: number): number {
  return Math.atan2(-x, -z)
}

const FIRE_GLOW = new Color('#ff8f3a')
/** L'autre moitié du contraste. Ce qui tourne le dos à la flamme ne doit pas
 *  seulement s'assombrir, il doit virer au bleu: sans ce froid-là, le campement
 *  garde exactement la température de la forêt et se noie dedans. */
const FIRE_SHADE = new Color('#3c5772')

/** Une lampe ponctuelle assez forte pour teinter la tente brûlerait les pierres
 *  du foyer. La chaleur est donc peinte dans les sommets, face par face: seules
 *  les surfaces tournées vers la flamme la reçoivent, et ça ne coûte rien à
 *  l'image. */
function bakeFirelight(geo: BufferGeometry): void {
  const pos = geo.attributes.position
  const nor = geo.attributes.normal
  const col = geo.attributes.color
  if (!pos || !nor || !col) return
  const c = new Color()
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    const dx = -pos.getX(i)
    const dy = 0.8 - y
    const dz = -pos.getZ(i)
    const d = Math.max(0.05, Math.hypot(dx, dy, dz))
    const facing = (dx * nor.getX(i) + dy * nor.getY(i) + dz * nor.getZ(i)) / d
    const reach = smoothstep(6.6, 0.8, d)
    if (reach < 0.004) continue
    c.setRGB(col.getX(i), col.getY(i), col.getZ(i))
    // Concentré sur les faces vraiment tournées vers la flamme: étalé sur tout
    // l'hémisphère, ce n'est plus un liseré, c'est une couche de peinture.
    const warm = Math.min(0.8, Math.pow(Math.max(0, facing), 1.25) * reach * 0.92)
    // Le rebond du sol remonte sous les peaux: c'est ce bas éclairé qui pose le
    // campement sur sa terre battue au lieu de l'y superposer.
    const bounce = smoothstep(1.7, 0, y) * reach * 0.22
    const cool = Math.max(0, -facing) * reach
    if (cool > 0.01) c.lerp(FIRE_SHADE, cool * 0.3).multiplyScalar(1 - cool * 0.1)
    const k = Math.min(0.92, warm + bounce)
    // Le gain final est retenu sur ce qui est déjà clair: sans ce frein, les
    // peaux tendues, qui sont les surfaces les plus pâles et les plus tournées
    // vers la flamme, partaient en drap blanc.
    if (k > 0.004) {
      const lum = c.r * 0.3 + c.g * 0.59 + c.b * 0.11
      c.lerp(FIRE_GLOW, k).multiplyScalar(1 + k * 0.34 * (1 - smoothstep(0.45, 0.95, lum)))
    }
    col.setXYZ(i, c.r, c.g, c.b)
  }
  col.needsUpdate = true
}

/** Demi-étendue d'un maillage centré, en x puis en z. */
/** Une case du relevé de l'avion : position en plan (u vers le nez, v vers
 *  l'aile gauche), bas et haut de la colonne depuis le pivot, rayon en plan —
 *  à sa taille 3.61.0. */
interface PlaneCell {
  u: number
  v: number
  y: number
  top: number
  r: number
}

/** Distance en plan du point (px, pz) au segment [a, b]. */
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const L = dx * dx + dz * dz
  const u = L < 1e-12 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L))
  return Math.hypot(px - ax - u * dx, pz - az - u * dz)
}

function halfX(geo: BufferGeometry): number {
  geo.computeBoundingBox()
  const b = geo.boundingBox!
  return Math.max(-b.min.x, b.max.x)
}
function halfZ(geo: BufferGeometry): number {
  geo.computeBoundingBox()
  const b = geo.boundingBox!
  return Math.max(-b.min.z, b.max.z)
}

/** Grain de matière. Une valeur légèrement différente par sommet, tirée de sa
 *  position: c'est ce qui tient lieu d'enduit tacheté et d'appareillage
 *  irrégulier, et ça se range dans l'attribut de couleur qu'on paie déjà. */
function grain(geo: BufferGeometry, amount = 0.11): void {
  const pos = geo.attributes.position
  const col = geo.attributes.color
  if (!pos || !col) return
  for (let i = 0; i < pos.count; i++) {
    const s = Math.sin(pos.getX(i) * 51.7 + pos.getY(i) * 97.3 + pos.getZ(i) * 31.1) * 43758.5453
    const n = (s - Math.floor(s) - 0.5) * 2 * amount
    // Le bleu bouge moins que le rouge: les éclats sont chauds, les creux
    // froids, comme sur une pierre vraiment taillée.
    col.setXYZ(i, col.getX(i) * (1 + n), col.getY(i) * (1 + n * 0.9), col.getZ(i) * (1 + n * 0.72))
  }
  col.needsUpdate = true
}

/** Halo du foyer: un disque additif toujours face caméra. Une lampe ponctuelle
 *  ne peint rien à cette distance — c'est ce disque, et lui seul, qui fait que
 *  la flamme a l'air d'émettre au lieu d'être un sprite posé. */
function haloTexture(inner: Color, outer: Color, power: number): DataTexture {
  return rampTexture(64, 64, (u, v, out) => {
    const d = Math.min(1, Math.hypot(u - 0.5, v - 0.5) * 2)
    out.copy(inner).lerp(outer, smoothstep(0, 0.72, d))
    return Math.pow(1 - smoothstep(0, 1, d), power)
  })
}

/** Halo circulaire dégradé, posé à plat sur le sol. L'alpha vit dans la couleur
 *  des sommets: pas une texture de plus à téléverser, et tous les halos de la
 *  scène se fondent dans une seule géométrie. */
function glowDisc(radius: number, color: Color, alpha: number, segments = 18): BufferGeometry {
  const core = new CircleGeometry(radius * 0.38, segments)
  const halo = new RingGeometry(radius * 0.38, radius, segments, 2)
  const geo = mergeGeometries([core, halo]) ?? core
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position!
  const rgba = new Float32Array(pos.count * 4)
  for (let i = 0; i < pos.count; i++) {
    const d = Math.hypot(pos.getX(i), pos.getZ(i)) / radius
    rgba[i * 4] = color.r
    rgba[i * 4 + 1] = color.g
    rgba[i * 4 + 2] = color.b
    rgba[i * 4 + 3] = alpha * (1 - smoothstep(0, 1, d))
  }
  geo.setAttribute('color', new BufferAttribute(rgba, 4))
  geo.deleteAttribute('uv')
  return geo
}

/** Perche fourchue: le montant de tout ce qui tient debout dans un campement. */
function post(h: number, r = 0.06): BufferGeometry[] {
  return [
    part(new CylinderGeometry(r * 0.85, r, h, 5), C.wood, 0, h / 2, 0),
    part(new ConeGeometry(r * 1.5, 0.16, 5), C.woodDark, 0, h + 0.05, 0),
  ]
}

/** Grande tente en peaux: des rangs cousus qui débordent l'un sur l'autre, des
 *  perches qui se croisent au-dessus du trou de fumée, une porte encadrée de
 *  bois clair. Rangs de peaux plutôt que rangs de tuiles — c'est la même
 *  densité de matière que la barre, dans le vocabulaire du paléolithique. */
function hideTent(radius: number, height: number): BufferGeometry[] {
  const p: BufferGeometry[] = []
  const rows = 5
  for (let i = 0; i < rows; i++) {
    const y0 = (i / rows) * height
    const y1 = ((i + 1) / rows) * height
    const r0 = radius * (1 - y0 / height)
    const r1 = radius * (1 - y1 / height)
    // Chaque rang déborde franchement sur le précédent: c'est ce ressaut, et lui
    // seul, qui fait lire une peau cousue plutôt qu'un cône lisse.
    p.push(
      part(
        new CylinderGeometry(Math.max(0.05, r1 - 0.02), r0 + 0.14, y1 - y0, 12, 1, true),
        i === 0
          ? tint(C.hideDark, 3, 0.05)
          : i % 2 === 0
            ? tint(C.hideLight, i * 7, 0.05)
            : tint(C.hide, i * 5, 0.05),
        0,
        (y0 + y1) / 2,
        0,
      ),
    )
  }
  // Bouchon sombre au sommet: sans lui on voit l'intérieur du cône par le
  // trou de fumée, et la tente redevient un cornet vide.
  p.push(part(new ConeGeometry(radius * 0.14, 0.3, 8), C.char, 0, height - 0.12, 0))

  // Peu de perches et fines: neuf montants sombres découpaient la silhouette de
  // l'abri en tranches et le cône cessait d'être un volume.
  const tilt = Math.atan2(radius, height + 0.5)
  const span = Math.hypot(radius, height + 0.5)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3
    p.push(
      part(
        new CylinderGeometry(0.028, 0.042, span, 5).rotateZ(tilt).rotateY(a),
        i === 1 ? C.woodDark : C.wood,
        (Math.cos(a) * radius) / 2,
        (height + 0.5) / 2,
        (-Math.sin(a) * radius) / 2,
      ),
    )
  }
  // Ligne de laçage: une rangée de chevilles d'os à mi-hauteur, la seule chose
  // qui donne une échelle humaine à une paroi de deux mètres et demi.
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2
    const y = 1.16
    const r = radius * (1 - y / height) + 0.07
    p.push(
      part(new BoxGeometry(0.07, 0.12, 0.07).rotateY(a), C.bone, Math.cos(a) * r, y, -Math.sin(a) * r),
    )
  }
  // Porte: un pan découpé dans le cône lui-même, donc parfaitement épousé à sa
  // pente — encadré, linteauté, avec le rabat roulé au-dessus. C'est le seul
  // noir franc du campement: le point d'entrée que l'œil trouve en premier.
  const doorH = height * 0.42
  const wide = 0.62
  const rBase = radius + 0.03
  const rTop = radius * (1 - doorH / height) + 0.03
  p.push(
    part(
      new CylinderGeometry(rTop, rBase, doorH, 6, 1, true, -wide / 2, wide),
      C.char,
      0,
      doorH / 2,
      0,
    ),
  )
  const jamb = Math.hypot(rBase - rTop, doorH)
  for (const s of [-1, 1]) {
    const a = (s * wide) / 2 - Math.PI / 2
    p.push(
      part(
        new CylinderGeometry(0.05, 0.062, jamb + 0.12, 5)
          .rotateZ(Math.atan2(rBase - rTop, doorH))
          .rotateY(a),
        C.hidePale,
        (Math.cos(a) * (rBase + rTop)) / 2,
        doorH / 2,
        (-Math.sin(a) * (rBase + rTop)) / 2,
      ),
    )
  }
  const lintel = 2 * rTop * Math.sin(wide / 2) + 0.16
  p.push(
    part(new CylinderGeometry(0.05, 0.05, lintel, 5).rotateZ(Math.PI / 2), C.hidePale, 0, doorH, rTop),
  )
  // Rabat relevé et roulé: la porte est ouverte, il n'y a personne à déranger.
  p.push(
    part(
      new CylinderGeometry(0.14, 0.14, lintel - 0.2, 7).rotateZ(Math.PI / 2),
      C.hide,
      0,
      doorH + 0.2,
      radius * (1 - (doorH + 0.2) / height) + 0.1,
    ),
  )
  for (let i = 0; i < 4; i++) {
    p.push(
      part(
        new DodecahedronGeometry(0.17 + (i % 2) * 0.04, 0).scale(1, 0.55, 1),
        tint(PALETTE.rock, i * 6, 0.08),
        -0.42 + i * 0.28,
        0.05,
        rBase + 0.14,
      ),
    )
  }
  // Pierres de lest tout autour du bas: la peau ne s'envole pas toute seule.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.4
    // Rien devant le seuil: la porte reste dégagée.
    if (-Math.sin(a) > 0.7) continue
    p.push(
      part(
        new DodecahedronGeometry(0.15 + (i % 3) * 0.03, 0).rotateY(i).scale(1, 0.66, 1),
        tint(i % 3 === 0 ? PALETTE.rockDark : PALETTE.rock, i * 4, 0.09),
        Math.cos(a) * (radius + 0.04),
        0.08,
        -Math.sin(a) * (radius + 0.04),
      ),
    )
  }
  return p
}

/** Séchoir à peaux et à viande: la masse claire suspendue à côté du feu. */
function dryingRack(width: number, height: number): BufferGeometry[] {
  const p: BufferGeometry[] = []
  const hw = width / 2
  for (const s of [-1, 1]) p.push(...post(height).map((g) => g.translate(s * hw, 0, 0)))
  p.push(
    part(new CylinderGeometry(0.05, 0.05, width + 0.3, 5).rotateZ(Math.PI / 2), C.wood, 0, height, 0),
  )
  p.push(
    part(
      new CylinderGeometry(0.04, 0.04, width + 0.1, 5).rotateZ(Math.PI / 2),
      C.woodDark,
      0,
      height * 0.52,
      0.02,
    ),
  )
  const hides = [
    [-0.52, 0.6, 0.72, C.hidePale],
    [0.06, 0.52, 0.62, C.hide],
    [0.56, 0.46, 0.8, C.hideLight],
  ] as const
  for (const [x, w, h, col] of hides) {
    p.push(part(new BoxGeometry(w, h, 0.05), col, x, height - h / 2 - 0.06, 0))
    p.push(part(new BoxGeometry(w + 0.06, 0.06, 0.07), C.bone, x, height - 0.05, 0))
  }
  for (let i = 0; i < 5; i++) {
    p.push(
      part(new BoxGeometry(0.1, 0.3, 0.05), C.meat, -0.62 + i * 0.31, height * 0.52 - 0.16, 0.02),
    )
  }
  return p
}

/** Tas de bois: des rondins empilés, rangés entre deux pieux. Un campement sans
 *  réserve de bois n'a pas passé l'hiver. */
function woodPile(length: number): BufferGeometry[] {
  const p: BufferGeometry[] = []
  for (const s of [-1, 1]) {
    p.push(
      part(new CylinderGeometry(0.05, 0.06, 1.0, 5), C.woodDark, (s * length) / 2 - s * 0.02, 0.5, 0.12),
    )
    p.push(
      part(new CylinderGeometry(0.05, 0.06, 1.0, 5), C.woodDark, (s * length) / 2 - s * 0.02, 0.5, -0.34),
    )
  }
  const counts = [4, 3, 2]
  for (let row = 0; row < counts.length; row++) {
    const n = counts[row]!
    for (let i = 0; i < n; i++) {
      const r = 0.115
      p.push(
        part(
          new CylinderGeometry(r, r, length - 0.16, 6).rotateZ(Math.PI / 2).rotateX((i + row) * 0.9),
          (i + row) % 3 === 0 ? C.woodDark : tint(C.wood, i * 5 + row, 0.07),
          0,
          r + row * (r * 1.85),
          -0.11 + (i - (n - 1) / 2) * (r * 2.05),
        ),
      )
      // Cœur clair du rondin: sans lui l'empilement n'est qu'un grillage brun.
      p.push(
        part(
          new CylinderGeometry(r * 0.62, r * 0.62, length - 0.1, 6).rotateZ(Math.PI / 2),
          C.hidePale,
          0,
          r + row * (r * 1.85),
          -0.11 + (i - (n - 1) / 2) * (r * 2.05),
        ),
      )
    }
  }
  return p
}

/** Peau tendue sur cadre: un rectangle clair et vertical, posé à droite du feu
 *  pour équilibrer la masse de la tente. */
function hideFrame(width: number, height: number): BufferGeometry[] {
  const p: BufferGeometry[] = []
  const hw = width / 2
  for (const s of [-1, 1]) {
    p.push(part(new CylinderGeometry(0.05, 0.06, height, 5), C.wood, s * hw, height / 2, 0))
    p.push(
      part(new CylinderGeometry(0.04, 0.045, 0.75, 5).rotateX(0.5), C.woodDark, s * hw, 0.34, -0.22),
    )
  }
  for (const y of [height - 0.08, height * 0.28]) {
    p.push(
      part(new CylinderGeometry(0.045, 0.045, width + 0.16, 5).rotateZ(Math.PI / 2), C.wood, 0, y, 0),
    )
  }
  p.push(part(new BoxGeometry(width - 0.2, height * 0.62, 0.05), C.hidePale, 0, height * 0.6, 0))
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    p.push(
      part(
        new CylinderGeometry(0.02, 0.02, 0.16, 4).rotateX(Math.PI / 2),
        C.bone,
        Math.cos(a) * (width / 2 - 0.06),
        height * 0.6 + Math.sin(a) * height * 0.3,
        0,
      ),
    )
  }
  return p
}

/** L'atelier: une peau étalée, une enclume de pierre, des éclats. Tout est bas,
 *  parce que ça se pose entre la caméra et le colon. */
function knappingSpot(): BufferGeometry[] {
  const p: BufferGeometry[] = []
  p.push(part(new BoxGeometry(1.15, 0.05, 0.9).rotateY(0.4), C.hide, 0, 0.03, 0))
  p.push(
    part(new DodecahedronGeometry(0.29, 0).rotateY(1.1).scale(1, 0.7, 1), PALETTE.rock, -0.24, 0.14, -0.1),
  )
  for (let i = 0; i < 6; i++) {
    p.push(
      part(
        new DodecahedronGeometry(0.06 + (i % 3) * 0.02, 0).rotateY(i * 1.7).scale(1, 0.5, 1),
        i % 2 === 0 ? C.hidePale : PALETTE.rockDark,
        0.16 + Math.sin(i * 2.1) * 0.24,
        0.05,
        0.1 + Math.cos(i * 2.1) * 0.26,
      ),
    )
  }
  p.push(part(new CylinderGeometry(0.26, 0.22, 0.3, 8), C.hideLight, 0.46, 0.15, -0.28))
  p.push(part(new CylinderGeometry(0.27, 0.27, 0.06, 8), C.woodDark, 0.46, 0.31, -0.28))
  p.push(
    part(new CylinderGeometry(0.035, 0.045, 0.62, 5).rotateZ(1.3), C.bone, -0.36, 0.06, 0.28),
  )
  return p
}

/** Paravent de branches tressées, planté au vent derrière le foyer. Il ferme la
 *  silhouette du campement du côté où il n'y avait que de l'herbe, et sa face
 *  intérieure est le plus grand pan que la flamme éclaire vraiment. */
function windScreen(width: number, height: number): BufferGeometry[] {
  const p: BufferGeometry[] = []
  const bow = 0.5
  for (let i = 0; i < 6; i++) {
    const u = i / 5 - 0.5
    const x = u * width
    const z = -bow * (1 - 4 * u * u)
    const h = height * (0.82 + 0.18 * (1 - Math.abs(u) * 1.6)) + 0.2
    // Les pieux descendent sous le sol: une palissade qui affleure exactement
    // la terre a l'air posée dessus, pas plantée dedans.
    p.push(
      part(new CylinderGeometry(0.045, 0.062, h, 5), i % 2 ? C.woodDark : C.wood, x, h / 2 - 0.2, z),
    )
  }
  // Clayonnage: des brins qui passent devant et derrière, d'où le décalage en z
  // alterné. Sans lui c'est une palissade, pas un tressage.
  for (let k = 0; k < 5; k++) {
    const y = height * (0.08 + k * 0.2)
    for (let i = 0; i < 5; i++) {
      const u0 = i / 5 - 0.5
      const u1 = (i + 1) / 5 - 0.5
      const z0 = -bow * (1 - 4 * u0 * u0) + ((i + k) % 2 ? 0.07 : -0.07)
      const z1 = -bow * (1 - 4 * u1 * u1) + ((i + k) % 2 ? 0.07 : -0.07)
      const len = Math.hypot((u1 - u0) * width, z1 - z0)
      p.push(
        part(
          new CylinderGeometry(0.036, 0.036, len + 0.05, 4)
            .rotateZ(Math.PI / 2)
            .rotateY(Math.atan2(z1 - z0, (u1 - u0) * width)),
          k % 2 ? tint(C.wood, k * 5 + i, 0.09) : tint(C.woodDark, i * 3, 0.09),
          ((u0 + u1) / 2) * width,
          y,
          (z0 + z1) / 2,
        ),
      )
    }
  }
  // Pas de peau tendue ici: une seconde tache pâle à côté du séchoir et du
  // cadre faisait trois draps blancs alignés, et le campement redevenait un
  // étal. Le tressage seul suffit à fermer la silhouette.
  for (let i = 0; i < 3; i++) {
    p.push(
      part(
        new DodecahedronGeometry(0.17 + (i % 2) * 0.04, 0).rotateY(i).scale(1, 0.6, 1),
        tint(PALETTE.rock, i * 8, 0.09),
        (i - 1) * width * 0.33,
        0.06,
        0.2,
      ),
    )
  }
  return p
}

/** Godet de braises sur trois pierres. C'est la lanterne du paléolithique: un
 *  second point chaud, loin du foyer, qui dit qu'on habite là sans montrer
 *  personne. La couleur du cœur passe au-dessus de 1 — le matériau toon la
 *  multiplie par son éclairage, il faut cette marge pour qu'il reste brûlant. */
function emberBowl(): BufferGeometry[] {
  const p: BufferGeometry[] = []
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    p.push(
      part(
        new DodecahedronGeometry(0.13, 0).rotateY(i).scale(1, 0.7, 1),
        tint(PALETTE.rockDark, i * 5, 0.08),
        Math.cos(a) * 0.2,
        0.06,
        Math.sin(a) * 0.2,
      ),
    )
  }
  p.push(part(new CylinderGeometry(0.22, 0.16, 0.16, 8), C.char, 0, 0.2, 0))
  p.push(part(new CylinderGeometry(0.19, 0.19, 0.05, 8), C.emberCore, 0, 0.29, 0))
  p.push(part(new ConeGeometry(0.11, 0.22, 6), C.emberFlame, 0, 0.38, 0))
  return p
}

/** Dallage: des pierres plates et dissemblables posées là où l'on marche. Un
 *  sol qui a de la matière fait autant pour l'habitat qu'un mur de plus, et il
 *  reçoit la lumière du feu à plat, donc en pleine face. */
function paving(
  out: BufferGeometry[],
  cx: number,
  cz: number,
  radius: number,
  count: number,
  seed: number,
): void {
  for (let i = 0; i < count; i++) {
    const a = i * 2.399 + seed
    const r = radius * (0.3 + ((i * 7 + seed) % 5) * 0.175)
    const s = 0.15 + ((i * 3 + seed) % 4) * 0.038
    out.push(
      part(
        new DodecahedronGeometry(s, 0).rotateY(i * 1.7 + seed).scale(1.5, 0.13, 1.5),
        // Enfoncées dans la terre battue et non posées dessus: des pierres
        // claires font un champ de cailloux, pas un seuil.
        tint(i % 3 === 0 ? PALETTE.rockDark : PALETTE.dirtDark, i * 6 + seed, 0.13),
        cx + Math.cos(a) * r,
        0.035,
        cz + Math.sin(a) * r,
      ),
    )
  }
}

/** Toit à deux pentes couvert de rangs de tuiles décalés, plus la faîtière et la
 *  planche de rive claires. Le rang, pas la tuile: assez dense de loin, tenable
 *  en triangles. */
function gableRoof(
  p: BufferGeometry[],
  length: number,
  halfWidth: number,
  rise: number,
  y: number,
  rows = 5,
): void {
  const slope = Math.hypot(halfWidth, rise)
  const angle = Math.atan2(rise, halfWidth)
  const prism = new CylinderGeometry(1, 1, length, 3, 1)
    .rotateX(-Math.PI / 2)
    .rotateY(Math.PI / 2)
    .scale(1, rise / 1.5, halfWidth / 0.866)
  p.push(part(prism, C.tileDark, 0, y + rise / 3, 0))

  const depth = (slope / rows) * 1.34
  const ny = Math.cos(angle) * 0.026
  const nz = Math.sin(angle) * 0.026
  for (const side of [1, -1]) {
    for (let k = 0; k < rows; k++) {
      const u = (k + 0.5) / rows
      const row = new BoxGeometry(length + 0.14, 0.05, depth).rotateX(side * angle)
      p.push(
        part(
          row,
          tint(k % 2 === 0 ? C.tile : C.tileDark, k * 3 + side, 0.05),
          0,
          y + rise * u + ny,
          side * (halfWidth * (1 - u) + nz),
        ),
      )
    }
    // Planche de rive: le liseré clair qui détache le toit du mur, comme la barre.
    p.push(
      part(
        new BoxGeometry(length + 0.2, 0.08, 0.1),
        C.ridge,
        0,
        y - 0.02,
        side * (halfWidth + 0.06),
      ),
    )
  }
  p.push(part(new BoxGeometry(length + 0.16, 0.1, 0.16), C.ridge, 0, y + rise + 0.02, 0))
}

/** Un mur de moellons: rangs décalés, teintes légèrement dissemblables. */
function masonry(
  p: BufferGeometry[],
  w: number,
  d: number,
  courses: number,
  h: number,
  x: number,
  y: number,
  z: number,
  seed: number,
  light: Color = C.stone,
  dark: Color = C.stoneDark,
): void {
  for (let k = 0; k < courses; k++) {
    const shift = k % 2 === 0 ? 0.03 : -0.03
    p.push(
      part(
        new BoxGeometry(w + shift, h * 0.92, d + shift),
        tint(k % 3 === 0 ? dark : light, seed + k * 5, 0.07),
        x,
        y + h * (k + 0.5),
        z,
      ),
    )
  }
}

/** Les quatre bâtiments hérités (hutte, champ, grenier, aqueduc) vivaient en
 *  Object3D séparés : quatre meshes, huit draw calls avec la passe d'ombre.
 *  Ils sont désormais des générateurs de pièces comme les ateliers, fondus dans
 *  le mesh unique — leur géométrie est inchangée au sommet près. */
function hutParts(): BufferGeometry[] {
  const p: BufferGeometry[] = []
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    p.push(
      part(
        new DodecahedronGeometry(0.17 + (i % 3) * 0.03, 0).rotateY(i * 1.3).scale(1, 0.72, 1),
        tint(i % 4 === 0 ? PALETTE.rockDark : PALETTE.rock, i * 5, 0.09),
        Math.sin(a) * 1.03,
        0.08,
        Math.cos(a) * 1.03,
      ),
    )
  }
  p.push(part(new ConeGeometry(1.02, 1.75, 10), C.hideDark, 0, 0.87, 0))
  // Rangs de peaux cousues, en gradins débordants: l'équivalent primitif des
  // rangs de tuiles, et la seule façon de faire lire une paroi conique.
  for (let i = 0; i < 5; i++) {
    const y = 0.06 + i * 0.31
    const r = 1.02 * (1 - y / 1.75)
    p.push(
      part(
        new CylinderGeometry(1.02 * (1 - (y + 0.33) / 1.75) - 0.01, r + 0.09, 0.33, 10, 1, true),
        i % 2 === 0 ? tint(C.hide, i * 9, 0.05) : tint(C.hideDark, i * 4, 0.05),
        0,
        y + 0.165,
        0,
      ),
    )
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.25
    p.push(
      part(
        new CylinderGeometry(0.038, 0.055, 1.55, 5).rotateZ(-0.52).rotateY(a),
        C.woodDark,
        Math.cos(a) * 0.34,
        1.25,
        -Math.sin(a) * 0.34,
      ),
    )
  }
  // Trou de fumée au sommet : une hutte de peaux en a forcément un, et c'est
  // par lui que sort la fumée du foyer. Un anneau clair le cercle.
  p.push(part(new CylinderGeometry(0.2, 0.26, 0.14, 8, 1, true), C.hidePale, 0, 1.72, 0))
  p.push(part(new CylinderGeometry(0.1, 0.1, 0.06, 8), C.char, 0, 1.76, 0))
  // Haubans et piquets : ce qui tient une tente de peaux par grand vent, et ce
  // qui l'ancre visuellement au sol au lieu de la poser dessus.
  for (const a of [0.6, 2.5, 4.4]) {
    const px = Math.sin(a) * 1.5
    const pz = Math.cos(a) * 1.5
    p.push(part(new CylinderGeometry(0.018, 0.018, 1.5, 4).rotateZ(0.72).rotateY(-a), C.bone, px * 0.6, 0.78, pz * 0.6))
    p.push(part(new CylinderGeometry(0.03, 0.045, 0.28, 4).rotateZ(0.2), C.woodDark, px, 0.12, pz))
  }
  // Le rabat de porte, roulé et attaché sur le côté.
  p.push(part(new CylinderGeometry(0.09, 0.11, 0.7, 6).rotateZ(0.1), C.hideLight, 0.33, 0.42, 0.78))
  p.push(part(new BoxGeometry(0.5, 0.74, 0.34), C.char, 0, 0.37, 0.74))
  p.push(part(new CylinderGeometry(0.055, 0.07, 0.92, 6), C.bone, -0.31, 0.46, 0.83))
  p.push(part(new CylinderGeometry(0.055, 0.07, 0.92, 6), C.bone, 0.31, 0.46, 0.83))
  p.push(
    part(new CylinderGeometry(0.05, 0.05, 0.74, 6).rotateZ(Math.PI / 2), C.bone, 0, 0.9, 0.8),
  )
  // Trophée au-dessus de la porte: une tache claire à hauteur d'œil.
  p.push(part(new SphereGeometry(0.14, 8, 6).scale(1, 0.9, 1.15), C.bone, 0, 1.16, 0.63))
  p.push(part(new ConeGeometry(0.05, 0.3, 4).rotateZ(0.9), C.bone, -0.2, 1.26, 0.6))
  p.push(part(new ConeGeometry(0.05, 0.3, 4).rotateZ(-0.9), C.bone, 0.2, 1.26, 0.6))
  return p
}

function fieldParts(): BufferGeometry[] {
  const p: BufferGeometry[] = []
  p.push(part(new BoxGeometry(1.9, 0.2, 1.8), C.soil, -0.5, 0.1, 0))
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2
    p.push(
      part(
        new BoxGeometry(0.2, 0.16, 0.2).rotateY(i),
        tint(i % 3 === 0 ? PALETTE.rockDark : PALETTE.rock, i * 4, 0.08),
        -0.5 + Math.sin(a) * 1.0,
        0.13,
        Math.cos(a) * 0.94,
      ),
    )
  }
  // Sillons et récolte. Chaque touffe était un cône unique : à la taille du
  // champ, ça lisait comme une rangée de quilles. Une GERBE — trois tiges
  // serrées de hauteurs différentes, coiffées d'un épi plus clair — donne la
  // même silhouette de loin et tient le regard de près.
  for (let i = 0; i < 5; i++) {
    const z = -0.7 + i * 0.35
    // Sillons alternés : la terre retournée est plus sombre que la butte.
    p.push(part(new BoxGeometry(1.76, 0.1, 0.13), i % 2 === 0 ? C.soilDark : C.soil, -0.5, 0.22, z))
    // Une rangée sur cinq est encore verte : un champ ne mûrit pas d'un bloc.
    const green = i === 2
    for (let j = 0; j < 6; j++) {
      const base = green ? new Color('#8fae52') : C.wheat
      for (let k = 0; k < 3; k++) {
        const lean = (k - 1) * 0.16
        const h = 0.3 + ((i + j + k) % 3) * 0.06
        p.push(
          part(
            new ConeGeometry(0.045, h, 4).rotateZ(lean).rotateY(i + j + k),
            tint(base, i * 6 + j + k * 3, 0.09),
            -1.24 + j * 0.3 + lean * 0.12,
            0.28 + h / 2,
            z + (k - 1) * 0.035,
          ),
        )
        // L'épi : une tête plus claire et plus large que la tige.
        if (!green)
          p.push(
            part(
              new ConeGeometry(0.055, 0.11, 4).rotateZ(lean),
              tint(C.bone, i * 3 + j + k, 0.05),
              -1.24 + j * 0.3 + lean * 0.2,
              0.28 + h + 0.03,
              z + (k - 1) * 0.035,
            ),
          )
      }
    }
  }
  // Clôture: quelques traits sombres qui donnent une échelle au champ.
  for (let i = 0; i < 6; i++) {
    p.push(
      part(new CylinderGeometry(0.035, 0.04, 0.5, 5), C.woodDark, -1.4 + i * 0.36, 0.31, -0.98),
    )
  }
  p.push(part(new BoxGeometry(1.94, 0.05, 0.05), C.wood, -0.5, 0.44, -0.98))
  p.push(part(new BoxGeometry(1.94, 0.05, 0.05), C.wood, -0.5, 0.29, -0.98))

  // Une vraie petite maison: socle froid, mur clair, toit de tuiles. C'est là que
  // le vocabulaire de la barre entre dans le jeu.
  const sx = 1.16
  masonry(p, 1.0, 1.06, 2, 0.13, sx, 0, 0.06, 3)
  p.push(part(new BoxGeometry(0.92, 0.78, 0.98), C.plaster, sx, 0.65, 0.06))
  p.push(part(new BoxGeometry(0.07, 0.8, 0.07), C.woodDark, sx - 0.45, 0.65, 0.53))
  p.push(part(new BoxGeometry(0.07, 0.8, 0.07), C.woodDark, sx + 0.45, 0.65, 0.53))
  p.push(part(new BoxGeometry(0.94, 0.08, 0.07), C.woodDark, sx, 0.7, 0.53))
  p.push(part(new BoxGeometry(0.3, 0.5, 0.06), C.woodDark, sx - 0.19, 0.51, 0.56))
  p.push(part(new BoxGeometry(0.26, 0.26, 0.05), C.bone, sx + 0.23, 0.78, 0.56))
  p.push(part(new BoxGeometry(0.16, 0.16, 0.07), C.glass, sx + 0.23, 0.78, 0.57))
  const roof: BufferGeometry[] = []
  gableRoof(roof, 1.14, 0.62, 0.46, 1.04, 5)
  for (const g of roof) p.push(g.translate(sx, 0, 0.06))
  return p
}

function granaryParts(): BufferGeometry[] {
  const p: BufferGeometry[] = []
  for (const [x, z] of [
    [-0.55, -0.55],
    [0.55, -0.55],
    [-0.55, 0.55],
    [0.55, 0.55],
  ] as const) {
    p.push(part(new BoxGeometry(0.34, 0.2, 0.34), C.stoneDark, x, 0.1, z))
    p.push(part(new CylinderGeometry(0.08, 0.09, 0.62, 6), C.wood, x, 0.51, z))
    // Rondelle anti-rongeurs: le petit disque clair qui fait "grenier sur pilotis".
    p.push(part(new CylinderGeometry(0.24, 0.24, 0.06, 10), C.bone, x, 0.84, z))
  }
  p.push(part(new BoxGeometry(1.52, 0.14, 1.52), C.woodDark, 0, 0.94, 0))
  p.push(part(new BoxGeometry(1.34, 0.86, 1.34), C.wall, 0, 1.44, 0))
  // Colombage: montants sombres sur mur clair, la densité chaude de la barre.
  for (const [ox, oz, rot] of [
    [0, 0.68, 0],
    [0, -0.68, 0],
    [0.68, 0, 1],
    [-0.68, 0, 1],
  ] as const) {
    for (let i = 0; i < 4; i++) {
      const t = -0.5 + i * 0.335
      const g = new BoxGeometry(0.08, 0.88, 0.06)
      if (rot) g.rotateY(Math.PI / 2)
      p.push(part(g, C.woodDark, ox + (rot ? 0 : t), 1.44, oz + (rot ? t : 0)))
    }
    const rail = new BoxGeometry(1.38, 0.09, 0.06)
    if (rot) rail.rotateY(Math.PI / 2)
    p.push(part(rail, C.woodDark, ox, 1.62, oz))
  }
  // La porte : deux vantaux de planches, un linteau clair, et le loquet.
  p.push(part(new BoxGeometry(0.2, 0.56, 0.06), C.woodDark, -0.11, 1.3, 0.71))
  p.push(part(new BoxGeometry(0.2, 0.56, 0.06), tint(C.woodDark, 3, 0.06), 0.11, 1.3, 0.71))
  p.push(part(new BoxGeometry(0.42, 0.05, 0.07), C.wood, 0, 1.3, 0.73))
  p.push(part(new SphereGeometry(0.04, 5, 4), C.bone, 0.05, 1.28, 0.75))
  p.push(part(new BoxGeometry(0.52, 0.08, 0.1), C.bone, 0, 1.62, 0.71))
  // Une lucarne d'aération au pignon : un grenier respire, sinon le grain
  // chauffe. C'est aussi la tache sombre qui casse le mur clair.
  p.push(part(new BoxGeometry(0.26, 0.2, 0.06), C.char, 0, 1.78, 0.7))
  p.push(part(new BoxGeometry(0.3, 0.05, 0.07), C.wood, 0, 1.9, 0.71))
  // Sacs de grain empilés sous le plancher, à l'abri de la pluie.
  for (const [gx, gz, r] of [[-0.38, 0.2, 0.16], [-0.2, 0.34, 0.13], [-0.44, 0.42, 0.12]] as const)
    p.push(part(new SphereGeometry(r, 6, 5).scale(1, 0.8, 1), tint(C.wheat, gx * 40, 0.07), gx, r * 0.8, gz))
  // Une gerbe appuyée contre un pilotis : le grenier vient d'être rempli.
  for (let i = 0; i < 5; i++)
    p.push(part(new CylinderGeometry(0.02, 0.025, 0.8, 4).rotateZ(0.28 + i * 0.04).rotateY(i), tint(C.wheat, i * 9, 0.08), 0.6 + i * 0.02, 0.4, -0.5 + i * 0.03))
  gableRoof(p, 1.66, 0.86, 0.66, 1.87, 6)
  // Échelle vers la porte.
  for (let i = 0; i < 4; i++) {
    p.push(
      part(
        new CylinderGeometry(0.028, 0.028, 0.34, 5).rotateZ(Math.PI / 2),
        C.wood,
        0,
        0.34 + i * 0.24,
        0.92 - i * 0.05,
      ),
    )
  }
  p.push(
    part(new CylinderGeometry(0.035, 0.035, 1.25, 5).rotateX(0.22), C.wood, -0.17, 0.72, 0.98),
  )
  p.push(
    part(new CylinderGeometry(0.035, 0.035, 1.25, 5).rotateX(0.22), C.wood, 0.17, 0.72, 0.98),
  )
  return p
}

function aqueductParts(): BufferGeometry[] {
  const p: BufferGeometry[] = []
  // Naissance de l'arc à mi-hauteur: si la pile monte trop haut, il ne reste
  // qu'un trou de souris et l'aqueduc redevient un mur.
  const spring = 0.95
  const radius = 0.52
  // Pierre CHAUDE (grès/enduit): le gris bleu d'acier faisait lire l'ouvrage
  // comme un pont cassé abandonné, hors palette du village. Les assises
  // sombres restent au-dessus du rockDark: à l'ombre, tout ce qui est plus
  // sombre vire au bleu.
  const warm = tint(C.plaster, 3, 0.04)
  const warmDark = PALETTE.rock
  const warmLight = C.ridge
  for (let i = 0; i < 3; i++) {
    const x = -1.32 + i * 1.32
    masonry(p, 0.5, 0.62, 7, 0.226, x, 0, 0, i * 11, warm, warmDark)
    if (i < 2) {
      // Claveaux: neuf blocs le long de l'arc, c'est ce qui fait "taillé" plutôt
      // que "moulé".
      for (let k = 0; k <= 8; k++) {
        const a = (k / 8) * Math.PI
        p.push(
          part(
            new BoxGeometry(0.21, 0.22, 0.64).rotateZ(Math.PI / 2 - a),
            tint(k % 2 === 0 ? warm : warmLight, k * 7 + i, 0.06),
            x + 0.66 - Math.cos(a) * radius,
            spring + Math.sin(a) * radius,
            0,
          ),
        )
      }
    }
  }
  masonry(p, 3.14, 0.56, 2, 0.22, 0, 1.58, 0, 21, warm, warmDark)
  p.push(part(new BoxGeometry(3.34, 0.12, 0.92), warm, 0, 2.08, 0))
  p.push(part(new BoxGeometry(3.18, 0.14, 0.78), warm, 0, 2.21, 0))
  p.push(part(new BoxGeometry(3.18, 0.3, 0.2), warmDark, 0, 2.43, 0.29))
  p.push(part(new BoxGeometry(3.18, 0.3, 0.2), warmDark, 0, 2.43, -0.29))
  p.push(part(new BoxGeometry(3.06, 0.16, 0.38), C.water, 0, 2.4, 0))
  p.push(part(new BoxGeometry(3.26, 0.07, 0.26), warmLight, 0, 2.62, 0.29))
  // Ce qui manquait à l'ouvrage : la trace de l'EAU. Une coulure sombre sous
  // la conduite, de la mousse au pied des piles, et un filet qui tombe d'une
  // fuite — un aqueduc sec n'est qu'un pont.
  p.push(part(new BoxGeometry(0.1, 0.5, 0.12), tint(C.water, 4, 0.05), -0.66, 2.1, 0.36))
  p.push(part(new BoxGeometry(0.07, 1.5, 0.07), tint(C.water, 9, 0.05), -0.66, 1.3, 0.38))
  for (let i = 0; i < 3; i++) {
    const x = -1.32 + i * 1.32
    p.push(part(new BoxGeometry(0.56, 0.14, 0.68), new Color('#5d7a48'), x, 0.1, 0))
    // Assises usées au pied : la pierre du bas est toujours plus sombre.
    p.push(part(new BoxGeometry(0.54, 0.22, 0.66), tint(warmDark, i * 6, 0.05), x, 0.2, 0))
  }
  // Un bassin de réception au bout de l'ouvrage.
  p.push(part(new CylinderGeometry(0.42, 0.34, 0.26, 10), warmDark, 1.9, 0.13, 0))
  p.push(part(new CylinderGeometry(0.34, 0.34, 0.04, 10), tint(C.water, 2, 0.04), 1.9, 0.25, 0))
  p.push(part(new BoxGeometry(3.26, 0.07, 0.26), warmLight, 0, 2.62, -0.29))
  // ×1.7 : un aqueduc porte son eau à ~8 m — à 2.65 u, le colon touchait le
  // canal du bout de la lance. Le slot ne bouge pas, seule la pierre grandit.
  for (const g of p) g.scale(1.7, 1.7, 1.7)
  return p
}

/** Everything the tribe builds. Buildings pop in when their technology lands, so
 *  research has an immediate, physical consequence on screen. */
/** La maison du colon, qui remplace les tipis dès l'âge du bronze. Deux robes :
 *  torchis à colombages sous chaume (âges 2–5), enduit clair sous tuiles avec
 *  cheminée (âges 6+). La face +z regarde le feu, comme la tente avant elle. */
function houseParts(modern: boolean): BufferGeometry[] {
  const p: BufferGeometry[] = []
  const w = modern ? 2.7 : 2.4
  const d = modern ? 2.1 : 1.9
  const h = modern ? 1.3 : 1.1
  const straw = new Color('#c2a061')
  const wall = modern ? C.plaster : C.wall
  p.push(part(new BoxGeometry(w + 0.16, 0.34, d + 0.16), C.stoneDark, 0, 0.17, 0))
  p.push(part(new BoxGeometry(w, h, d), tint(wall, 5, 0.04), 0, 0.34 + h / 2, 0))
  if (!modern) {
    // Colombages : poteaux d'angle et sablière sombres sur le torchis.
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        p.push(
          part(
            new BoxGeometry(0.13, h, 0.13),
            C.woodDark,
            sx * (w / 2 - 0.02),
            0.34 + h / 2,
            sz * (d / 2 - 0.02),
          ),
        )
    p.push(part(new BoxGeometry(w + 0.1, 0.1, d + 0.1), C.woodDark, 0, 0.34 + h, 0))
  }
  // Porte et fenêtres face au feu : la maison vit tournée vers la veillée.
  p.push(
    part(new BoxGeometry(0.5, 0.86, 0.07), C.woodDark, modern ? -0.6 : 0, 0.34 + 0.43, d / 2 + 0.02),
  )
  if (!modern)
    p.push(part(new BoxGeometry(0.64, 0.09, 0.1), C.woodDark, 0, 0.34 + 0.9, d / 2 + 0.02))
  p.push(part(new BoxGeometry(0.36, 0.36, 0.07), C.glass, modern ? 0.5 : 0.62, 0.34 + h * 0.6, d / 2 + 0.02))
  if (modern)
    p.push(part(new BoxGeometry(0.07, 0.36, 0.36), C.glass, w / 2 + 0.02, 0.34 + h * 0.6, 0.2))
  // Toit à deux pans débordants, fermé par une cloison intérieure qui bouche
  // les pignons sans coûter deux triangles sur mesure.
  const pitch = modern ? 0.58 : 0.66
  const y0 = 0.34 + h
  const S = d / 2 + 0.3
  const R = S * Math.tan(pitch)
  const L = S / Math.cos(pitch) + 0.12
  for (const s of [-1, 1] as const)
    p.push(
      part(
        new BoxGeometry(w + 0.55, 0.085, L).rotateX(s * pitch),
        modern ? (s < 0 ? C.tile : C.tileDark) : tint(straw, s * 4, 0.05),
        0,
        y0 + R / 2,
        s * (S / 2),
      ),
    )
  p.push(part(new BoxGeometry(w - 0.06, R, 0.12), tint(wall, 9, 0.04), 0, y0 + R / 2, 0))
  p.push(part(new BoxGeometry(w + 0.45, 0.09, 0.16), modern ? C.ridge : C.woodDark, 0, y0 + R, 0))
  if (modern) {
    p.push(part(new BoxGeometry(0.26, 0.72, 0.26), C.tileDark, w * 0.22, y0 + R * 0.55 + 0.3, -S * 0.3))
    p.push(part(new BoxGeometry(0.34, 0.08, 0.34), C.stoneLight, w * 0.22, y0 + R * 0.55 + 0.68, -S * 0.3))
  }
  return p
}

/** Appentis de travail : quatre poteaux, un toit en appent, du rangement. */
function annexParts(modern: boolean): BufferGeometry[] {
  const p: BufferGeometry[] = []
  const straw = new Color('#c2a061')
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const h = sz > 0 ? 1.18 : 0.92
      p.push(part(new CylinderGeometry(0.05, 0.065, h, 5), C.wood, sx * 0.78, h / 2, sz * 0.58))
    }
  p.push(
    part(
      new BoxGeometry(1.9, 0.07, 1.55).rotateX(0.2),
      modern ? C.tileDark : tint(straw, 3, 0.05),
      0,
      1.1,
      0,
    ),
  )
  p.push(part(new BoxGeometry(1.7, 0.5, 0.06), C.wood, 0, 0.62, -0.58))
  if (modern) {
    p.push(part(new BoxGeometry(0.46, 0.46, 0.46), new Color('#d9c8a4'), -0.3, 0.23, 0.05))
    p.push(part(new BoxGeometry(0.4, 0.4, 0.4).rotateY(0.4), C.wood, 0.42, 0.2, -0.1))
  } else {
    for (const [x, z] of [[-0.32, 0], [0.38, -0.12]] as const) {
      p.push(part(new CylinderGeometry(0.14, 0.18, 0.44, 7), C.ochre, x, 0.22, z))
      p.push(part(new SphereGeometry(0.13, 7, 5), C.ochre, x, 0.46, z))
    }
  }
  return p
}

/** Pile de caisses : le séchoir à peaux n'a plus sa place après le chaume. */
function crateStack(): BufferGeometry[] {
  return [
    part(new BoxGeometry(0.52, 0.5, 0.52), new Color('#d9c8a4'), 0, 0.25, 0),
    part(new BoxGeometry(0.46, 0.44, 0.46).rotateY(0.35), C.wood, 0.56, 0.22, 0.16),
    part(new BoxGeometry(0.4, 0.38, 0.4).rotateY(-0.2), new Color('#d9c8a4'), 0.08, 0.72, 0.04),
  ]
}

/** Tonneau cerclé — l'eau et la bière du foyer moderne. */
function barrelParts(): BufferGeometry[] {
  return [
    part(new CylinderGeometry(0.24, 0.22, 0.62, 9), C.wood, 0, 0.31, 0),
    part(new CylinderGeometry(0.255, 0.255, 0.05, 9), C.char, 0, 0.16, 0),
    part(new CylinderGeometry(0.255, 0.255, 0.05, 9), C.char, 0, 0.46, 0),
  ]
}

/** Jarres à provisions près du seuil, du bronze au moyen âge. */
function jarCluster(): BufferGeometry[] {
  const p: BufferGeometry[] = []
  for (const [x, z, s] of [[-0.2, 0.1, 1], [0.26, -0.08, 0.82]] as const) {
    p.push(part(new CylinderGeometry(0.15 * s, 0.19 * s, 0.46 * s, 7), C.ochre, x, 0.23 * s, z))
    p.push(part(new SphereGeometry(0.14 * s, 7, 5), C.ochre, x, 0.48 * s, z))
  }
  return p
}

/** Billot de fente, toutes époques : on coupe du bois même sous l'ampoule. */
function choppingBlock(): BufferGeometry[] {
  return [part(new CylinderGeometry(0.2, 0.24, 0.36, 7), tint(C.wood, 4, 0.06), 0, 0.18, 0)]
}

/** Barrière basse à deux lisses : elle remplace le paravent de peaux. */
function fenceRun(): BufferGeometry[] {
  const p: BufferGeometry[] = []
  for (const x of [-1.05, 0, 1.05])
    p.push(part(new CylinderGeometry(0.05, 0.06, 0.68, 5), C.wood, x, 0.34, 0))
  p.push(part(new BoxGeometry(2.4, 0.07, 0.05), C.woodDark, 0, 0.3, 0))
  p.push(part(new BoxGeometry(2.4, 0.07, 0.05), C.woodDark, 0, 0.54, 0))
  return p
}

/** La Merveille de l'âge, par étape de chantier (0 fondations … 4 achevée).
 *  Dix silhouettes distinctes, un vocabulaire commun : socle, corps, couronne.
 *  Pendant le chantier, des perches d'échafaudage cernent l'ouvrage. */
function wonderParts(age: number, stage: number): BufferGeometry[] {
  const p: BufferGeometry[] = [wonderPlaza()]
  const iron = new Color('#6b7078')
  const steel = new Color('#9aa4ae')
  const brick = new Color('#b3603f')
  const put = (g: BufferGeometry, c: Color, x: number, y: number, z: number): void => {
    p.push(part(g, c, x, y, z))
  }
  const s1 = stage >= 1
  const s2 = stage >= 2
  const s3 = stage >= 3
  const s4 = stage >= 4
  switch (age) {
    case 0:
      for (let i = 0; i < 7; i++) {
        if (i / 7 > stage / 4 && stage < 4) break
        const a = (i / 7) * Math.PI * 2
        put(new BoxGeometry(0.5, 1.9 + (i % 3) * 0.5, 0.66).rotateY(a), tint(C.stone, i * 7, 0.08), Math.sin(a) * 1.7, 1.2, Math.cos(a) * 1.7)
      }
      break
    case 1:
      if (s1) put(new BoxGeometry(0.9, 2.2, 0.7), C.stone, -1.2, 1.4, 0)
      if (s2) put(new BoxGeometry(0.9, 2.2, 0.7), tint(C.stone, 5, 0.06), 1.2, 1.4, 0)
      if (s3) put(new BoxGeometry(0.8, 2.0, 0.7), tint(C.stone, 9, 0.06), 0, 1.3, -1.1)
      if (s4) put(new BoxGeometry(4.2, 0.7, 2.6).rotateY(0.06), C.stoneLight, 0, 2.9, -0.3)
      break
    case 2:
      put(new BoxGeometry(4.0, 1.1, 4.0), brick, 0, 0.85, 0)
      if (s1) put(new BoxGeometry(3.1, 1.0, 3.1), tint(brick, 4, 0.06), 0, 1.9, 0)
      if (s2) put(new BoxGeometry(2.2, 1.0, 2.2), tint(brick, 8, 0.06), 0, 2.9, 0)
      if (s3) put(new BoxGeometry(1.4, 0.9, 1.4), tint(brick, 12, 0.06), 0, 3.85, 0)
      if (s4) {
        put(new BoxGeometry(0.9, 0.8, 0.9), C.stoneLight, 0, 4.7, 0)
        put(new BoxGeometry(0.5, 1.6, 4.05), C.stoneLight, 0, 1.0, 0)
      }
      break
    case 3:
      put(new CylinderGeometry(1.0, 1.2, 0.6, 9), C.stone, 0, 0.6, 0)
      if (s1) put(new CylinderGeometry(0.42, 0.48, 2.2, 9), C.stoneLight, 0, 2.0, 0)
      if (s2) put(new CylinderGeometry(0.42, 0.42, 2.0, 9), tint(C.stoneLight, 6, 0.05), 0, 4.0, 0)
      if (s3) put(new CylinderGeometry(0.5, 0.44, 0.4, 9), C.stone, 0, 5.2, 0)
      if (s4) put(new ConeGeometry(0.34, 0.9, 7), new Color('#d9b23f'), 0, 5.9, 0)
      break
    case 4:
      put(new CylinderGeometry(1.5, 1.8, 1.4, 8), C.stoneLight, 0, 1.0, 0)
      if (s1) put(new CylinderGeometry(1.0, 1.4, 2.2, 8), tint(C.stoneLight, 4, 0.05), 0, 2.7, 0)
      if (s2) put(new CylinderGeometry(0.7, 0.95, 2.2, 8), tint(C.stoneLight, 8, 0.05), 0, 4.9, 0)
      if (s3) put(new CylinderGeometry(0.5, 0.65, 1.6, 8), C.stone, 0, 6.7, 0)
      if (s4) {
        put(new CylinderGeometry(0.62, 0.62, 0.5, 8), C.stoneDark, 0, 7.7, 0)
        put(new SphereGeometry(0.3, 7, 5), new Color('#ffd76a'), 0, 8.15, 0)
      }
      break
    case 5:
      put(new BoxGeometry(2.2, 2.2, 3.8), C.stoneLight, 0, 1.4, 0)
      if (s1) put(new BoxGeometry(2.6, 0.9, 4.2).rotateZ(0), C.tileDark, 0, 2.9, 0)
      if (s2) put(new BoxGeometry(1.3, 3.4, 1.3), tint(C.stoneLight, 6, 0.05), 0, 3.4, 1.6)
      if (s3) put(new BoxGeometry(1.0, 1.2, 1.0), C.stone, 0, 5.5, 1.6)
      if (s4) put(new ConeGeometry(0.72, 2.4, 6), C.tileDark, 0, 7.2, 1.6)
      break
    case 6:
      put(new BoxGeometry(3.6, 1.6, 3.6), C.plaster, 0, 1.1, 0)
      if (s1) put(new CylinderGeometry(1.7, 1.7, 1.1, 10), tint(C.plaster, 4, 0.04), 0, 2.4, 0)
      if (s2) put(new SphereGeometry(1.65, 10, 7).scale(1, 0.85, 1), C.tile, 0, 3.4, 0)
      if (s3) put(new CylinderGeometry(0.4, 0.5, 0.9, 8), C.plaster, 0, 5.0, 0)
      if (s4) put(new SphereGeometry(0.26, 6, 5), new Color('#d9b23f'), 0, 5.6, 0)
      break
    case 7: {
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const)
        put(new CylinderGeometry(0.09, 0.16, 2.6, 5).rotateZ(sx * 0.28).rotateX(-sz * 0.28), iron, sx * 1.2, 1.4, sz * 1.2)
      if (s1) put(new BoxGeometry(1.9, 0.22, 1.9), iron, 0, 2.7, 0)
      if (s2) for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const)
        put(new CylinderGeometry(0.07, 0.1, 2.4, 5).rotateZ(sx * 0.14).rotateX(-sz * 0.14), iron, sx * 0.62, 3.9, sz * 0.62)
      if (s3) {
        put(new BoxGeometry(0.9, 0.18, 0.9), iron, 0, 5.1, 0)
        put(new CylinderGeometry(0.16, 0.3, 1.8, 5), iron, 0, 6.0, 0)
      }
      if (s4) put(new CylinderGeometry(0.03, 0.03, 1.1, 4), steel, 0, 7.4, 0)
      break
    }
    case 8:
      put(new BoxGeometry(2.6, 2.2, 2.6), C.stoneLight, 0, 1.4, 0)
      if (s1) put(new BoxGeometry(2.0, 2.2, 2.0), tint(C.glass, 3, 0.1), 0, 3.6, 0)
      if (s2) put(new BoxGeometry(1.5, 2.2, 1.5), tint(C.glass, 7, 0.1), 0, 5.8, 0)
      if (s3) put(new BoxGeometry(1.0, 1.8, 1.0), tint(C.glass, 11, 0.1), 0, 7.8, 0)
      if (s4) put(new CylinderGeometry(0.05, 0.09, 1.5, 4), steel, 0, 9.4, 0)
      break
    default: {
      put(new BoxGeometry(3.2, 0.7, 3.2), C.stoneDark, 0, 0.7, 0)
      if (s1) put(new BoxGeometry(0.5, 4.2, 0.5), iron, -1.15, 3.1, -0.9)
      if (s2) {
        put(new CylinderGeometry(0.55, 0.55, 3.4, 9), new Color('#e8e4da'), 0.4, 2.9, 0.3)
        put(new CylinderGeometry(0.55, 0.62, 0.7, 9), brick, 0.4, 1.35, 0.3)
      }
      if (s3) put(new ConeGeometry(0.55, 1.1, 9), brick, 0.4, 5.15, 0.3)
      if (s4) {
        put(new BoxGeometry(0.28, 1.4, 0.28).rotateZ(0.5), iron, -0.5, 4.6, -0.3)
        for (const a of [0.6, 2.7, 4.8]) put(new BoxGeometry(0.5, 0.9, 0.06).rotateY(a), brick, 0.4 + Math.sin(a) * 0.5, 1.1, 0.3 + Math.cos(a) * 0.5)
      }
    }
  }
  // Échafaudages tant que l'œuvre n'est pas finie.
  if (stage < 4) p.push(...wonderScaffold(1.6 + stage * 1.2))
  return p
}

/** Dessus de l'esplanade : tout ce qui se bâtit sur le chantier part de là. */
const PLAZA_TOP = 0.3
/** Les perches d'échafaudage, aux quatre coins, à cette distance de l'axe. Une
 *  Merveille modelée doit tenir entre elles : c'est sa limite en plan. */
const WONDER_POLE = 2.2

/** Socle commun : l'esplanade du chantier, 4,6 × 4,6. */
function wonderPlaza(): BufferGeometry {
  return part(new BoxGeometry(4.6, PLAZA_TOP, 4.6), C.stoneDark, 0, PLAZA_TOP / 2, 0)
}

/** Quatre perches et leurs lisses, hautes de `h` au-dessus de l'esplanade.
 *  Posées à 2,2 de l'axe et non plus 2,0 : les Merveilles modelées occupent
 *  le socle jusqu'à 2,1, les perches les traversaient. Demi-diagonale des
 *  lisses : 3,13, sous WONDER_R. */
function wonderScaffold(h: number): BufferGeometry[] {
  const p: BufferGeometry[] = []
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    p.push(part(new CylinderGeometry(0.05, 0.06, h, 5), C.wood, sx * WONDER_POLE, h / 2 + PLAZA_TOP, sz * WONDER_POLE))
    p.push(part(new BoxGeometry(0.06, 0.06, WONDER_POLE * 2), C.woodDark, sx * WONDER_POLE, h + PLAZA_TOP - 0.1, 0))
  }
  return p
}

/** Hauteur de la primitive achevée de chaque âge, esplanade comprise, MESURÉE
 *  sur sa géométrie : c'est la silhouette que le joueur connaît, et le modèle
 *  ne doit pas la trahir. */
const primitiveTops = new Map<number, number>()
function primitiveTop(age: number): number {
  let top = primitiveTops.get(age)
  if (top === undefined) {
    top = 0
    for (const g of wonderParts(age, 4)) {
      const pos = g.getAttribute('position')
      for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i))
      g.dispose()
    }
    primitiveTops.set(age, top)
  }
  return top
}

/** Combien le modèle peut dépasser la primitive en hauteur. 1,15 : la
 *  silhouette reste celle qu'on connaît, un peu plus fière. La fusée a droit
 *  à 1,3 : elle n'avait pas de primitive à elle (elle partageait la branche
 *  par défaut, celle du réacteur, 5,7 de haut), il n'y a donc pas de
 *  silhouette connue à respecter, et une fusée plus courte que le phare se
 *  lisait mal. Mesuré : 7,4 de haut, sous le phare (7,4) et la cathédrale
 *  (8,6). */
const WONDER_HEIGHT_CAP: Record<string, number> = { fusee: 1.3 }

/** Échelle d'une Merveille modelée, calculée une fois sur le modèle ACHEVÉ et
 *  appliquée à tous les stades : une pierre posée ne change pas de taille
 *  quand on pose la suivante. Trois plafonds, le plus serré gagne : tenir
 *  entre les perches (2,1 de demi-côté), tenir dans WONDER_R en plan (la
 *  parcelle réservée, ruelle non comprise), ne pas dépasser la primitive de
 *  plus de 15 %. Le modèle remplit le socle autant que ces règles le
 *  permettent. */
const wonderScales = new Map<string, number>()
function wonderScale(id: string, age: number): number | null {
  let k = wonderScales.get(id)
  if (k === undefined) {
    const full = modelGeometry(id)
    if (!full) return null
    const pos = full.getAttribute('position')
    let r = 0
    for (let i = 0; i < pos.count; i++) r = Math.max(r, Math.hypot(pos.getX(i), pos.getZ(i)))
    const cap = WONDER_HEIGHT_CAP[id] ?? 1.15
    k = Math.min(
      (WONDER_POLE - 0.1) / Math.max(0.01, halfSpanOf(full)),
      (Village.WONDER_R - 0.1) / Math.max(0.01, r),
      (primitiveTop(age) * cap - PLAZA_TOP) / Math.max(0.01, heightOf(full)),
    )
    full.dispose()
    wonderScales.set(id, k)
  }
  return k
}

/** La Merveille modelée dans Blender, au stade voulu : esplanade, pièces déjà
 *  posées, et des perches qui montent avec l'ouvrage. Null tant que le modèle
 *  n'est pas arrivé : l'appelant garde la primitive. */
function wonderModelParts(id: string, age: number, stage: number): BufferGeometry[] | null {
  const k = wonderScale(id, age)
  const built = k === null ? null : modelGeometry(id, stage)
  if (k === null || !built) return null
  built.scale(k, k, k).translate(0, PLAZA_TOP, 0)
  const p = [wonderPlaza(), built]
  // Les perches dépassent de 0,35 la pièce la plus haute déjà posée : le
  // chantier se lit à sa hauteur, pas à une hauteur forfaitaire qui noyait la
  // fusée ou dominait le dolmen.
  if (stage < 4) p.push(...wonderScaffold(Math.max(1.2, heightOf(built) - PLAZA_TOP + 0.35)))
  return p
}

/** Les triangles de géométries en coordonnées monde, à plat (x,y,z × 3). */
function trianglesOf(geos: BufferGeometry[]): number[] {
  const out: number[] = []
  for (const g of geos) {
    const pos = g.getAttribute('position')
    const idx = g.index
    const n = idx ? idx.count : pos.count
    for (let k = 0; k < n; k++) {
      const i = idx ? idx.getX(k) : k
      out.push(pos.getX(i), pos.getY(i), pos.getZ(i))
    }
  }
  return out
}

/** Un ruban plat de demi-largeur h, de a à b : deux triangles. */
function flatQuad(ax: number, az: number, bx: number, bz: number, h: number): number[] {
  const L = Math.hypot(bx - ax, bz - az) || 1
  const nx = (-(bz - az) / L) * h
  const nz = ((bx - ax) / L) * h
  return [ax + nx, 0, az + nz, ax - nx, 0, az - nz, bx - nx, 0, bz - nz, ax + nx, 0, az + nz, bx - nx, 0, bz - nz, bx + nx, 0, bz + nz]
}

/** Ce que la sauvegarde garde du plan, en plus des bâtiments : la ceinture,
 *  les rues, la Merveille et le musée. Tout est optionnel et relu
 *  défensivement : une sauvegarde d'avant la ceinture n'en a rien. */
export interface VillagePlan {
  belt?: readonly number[] | null
  streets?: readonly (readonly { x: number; z: number }[])[] | null
  wonderAt?: { x: number; z: number } | null
  museumAt?: { x: number; z: number } | null
  /** Le village d'une île d'avant la ceinture, construit pour relire ses
   *  rues (migration) : ni ceinture, ni voie. */
  legacy?: boolean
}

export class Village implements GroundSource {
  readonly group = new Group()
  private readonly solid = new MeshToonMaterial({ vertexColors: true })
  private readonly placed = new Set<string>()
  /** Tout ce qui occupe le sol du bourg, en disques : bâtiments, Merveille,
   *  musée, gare, pied du ponton. Le rayon est MESURÉ sur la géométrie
   *  (`reach`), pas tiré d'une table d'emprises : la table sous-estimait
   *  l'aqueduc (2,2 pour 3,9 réels) ou la villa (1,6 pour 2,9), d'où des
   *  toits qui se touchaient. */
  private readonly lots: { x: number; z: number; r: number }[] = []
  private readonly dummy = new Object3D()
  private readonly scratch = new Color()
  private flame!: Mesh
  private core!: Mesh
  private embers!: InstancedMesh
  private smoke!: InstancedMesh
  private fireLight!: PointLight
  private glowMat!: MeshBasicMaterial
  private halo!: Sprite
  private haloCore!: Sprite
  /** Décalage vertical des braises et de la fumée quand la flamme est en
   *  hauteur (brasero) : l'update anime tout au-dessus de cette base. */
  private fireLift = 0
  private flameK = 1
  private haloBase = 6.4
  private haloCoreBase = 2.5

  /** L'âge et l'électricité changent la FORME du centre, jamais sa place : le
   *  foyer reste l'ancre visuelle et lumineuse du village à toutes les époques.
   *  Tipis aux âges primitifs, maison ensuite ; feu ouvert, puis brasero à
   *  l'antiquité, puis lampadaire dès que l'électricité est un savoir. */
  private readonly island: Island
  private readonly age: number
  private readonly electric: boolean
  /** Le temps des cadeaux : des paquets attendent autour du feu. */
  private readonly yule: boolean

  // Champs déclarés à la main plutôt qu'en propriétés de paramètre, comme
  // l'île : Node retire les types sans transpiler, et le test du plan du
  // village construit le bourg hors navigateur.
  private readonly plan: VillagePlan

  constructor(island: Island, age = 0, electric = false, yule = false, plan: VillagePlan = {}) {
    this.island = island
    this.age = age
    this.electric = electric
    this.yule = yule
    this.plan = plan
    if (!plan.legacy) {
      // La ceinture de CETTE île, jamais en deçà de celle de la sauvegarde :
      // elle ne fait que s'éloigner du centre, terre après terre.
      const prior = cleanBelt(plan.belt)
      this.beltRadii = growBelt(prior, beltFor((x, z) => island.isLand(x, z), age >= RAIL_AGE))
      this.beltGrew = prior !== null && this.beltRadii.some((r, j) => r !== prior[j])
      const t = beltPath(this.beltRadii)
      this.beltTrack = { pts: t.pts, cum: t.cum, closed: true }
      this.beltLength = t.cum[t.cum.length - 1]!
      // Avant l'âge 7, le bâti réserve déjà la place de la VOIE : la ceinture
      // de l'île agrandie (même graine, mêmes terres), tracée sur son seul
      // relevé de cellules. Le sentier, lui, suit la côte d'aujourd'hui ; on ne
      // bâtit pas dessus, mais on peut bâtir au-delà — la mer reculera.
      if (age >= RAIL_AGE) this.railRadii = this.beltRadii
      else {
        const future = new Island(island.seedValue, RAIL_AGE, island.land, GROWN_GROWTH, true)
        this.railRadii = growBelt(this.beltRadii, beltFor((x, z) => future.isLand(x, z), true))
        const f = beltPath(this.railRadii)
        this.railPts = f.pts
      }
    }
    this.buildCampfire()
    this.buildShore()
    // Les reflets miroir des loges ont vécu ici jusqu'au round 8 : une image
    // INVERSÉE des tipis sous la flottaison. Le jury les lisait — avec le
    // miroir du terrain — comme « posée sur du verre poli ». L'eau de ce round
    // ne renvoie rien : la fondation CONTINUE sous la surface (island.ts,
    // buildFoundation) et les objets posés dessus n'ont pas d'image.
  }

  /** Feu ouvert, brasero ou lampadaire selon l'époque. */
  private get fireMode(): 'open' | 'brazier' | 'lamp' {
    return this.electric ? 'lamp' : this.age >= 4 ? 'brazier' : 'open'
  }

  private buildCampfire(): void {
    const fire = new Group()
    const p: BufferGeometry[] = []
    const mode = this.fireMode
    if (mode === 'open') {
      p.push(part(new CylinderGeometry(0.86, 1.0, 0.14, 12), C.ash, 0, 0.07, 0))
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2
        const s = 0.22 + ((i * 7) % 5) * 0.036
        p.push(
          part(
            new DodecahedronGeometry(s, 0).rotateY(i * 1.7).rotateX(i * 0.4).scale(1, 0.82, 1),
            tint(i % 3 === 0 ? PALETTE.rockDark : PALETTE.rock, i * 3, 0.09),
            Math.sin(a) * 1.06,
            0.1,
            Math.cos(a) * 1.06,
          ),
        )
      }
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.4
        p.push(
          part(
            new CylinderGeometry(0.08, 0.1, 1.24, 6).rotateZ(0.62).rotateY(a),
            i % 2 === 0 ? C.char : C.woodDark,
            Math.cos(a) * 0.3,
            0.34,
            -Math.sin(a) * 0.3,
          ),
        )
      }
    } else if (mode === 'brazier') {
      // Brasero sur trépied : la flamme quitte le sol, le cercle de pierres
      // disparaît — on n'entoure plus un feu de pierres quand on sait forger.
      p.push(part(new CylinderGeometry(0.5, 0.62, 0.08, 12), C.ash, 0, 0.04, 0))
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.5
        p.push(
          part(
            new CylinderGeometry(0.045, 0.06, 1.28, 5).rotateZ(0.4).rotateY(a),
            C.char,
            Math.cos(a) * 0.24,
            0.6,
            -Math.sin(a) * 0.24,
          ),
        )
      }
      p.push(part(new CylinderGeometry(0.5, 0.32, 0.28, 9), new Color('#6b7078'), 0, 1.12, 0))
      p.push(part(new CylinderGeometry(0.42, 0.42, 0.05, 9), C.char, 0, 1.24, 0))
    } else {
      // Lampadaire : dalle, fût, crosse et abat-jour. La lumière du soir est
      // désormais publique et ne fume plus.
      p.push(part(new CylinderGeometry(0.36, 0.44, 0.14, 10), C.stoneDark, 0, 0.07, 0))
      const iron = new Color('#3f454e')
      p.push(part(new CylinderGeometry(0.05, 0.075, 3.3, 7), iron, 0, 1.72, 0))
      p.push(part(new CylinderGeometry(0.038, 0.038, 0.66, 5).rotateZ(Math.PI / 2), iron, 0.3, 3.34, 0))
      p.push(part(new ConeGeometry(0.3, 0.24, 9), iron, 0.58, 3.3, 0))
    }
    this.camp(p)
    // PAS le ponton ici : ce mesh vit dans le repère du campement, joué ×1,2
    // depuis le foyer. Le ponton y était poussé au large et surélevé d'autant
    // — d'où DEUX pontons à l'écran quand le vrai a rejoint le repère de
    // l'île (buildShore). Un seul ponton, dans le repère du terrain.
    const geo = mergeGeometries(p) ?? new BufferGeometry()
    grain(geo)
    bakeFirelight(geo)
    // Le cadastre au sol lit cette géométrie (repère du foyer, ×1,2) : c'est
    // la forme réelle des abris, pas les sept disques de CAMP_BLOCKERS.
    this.campGeo = geo
    const hearth = new Mesh(geo, this.solid)
    hearth.castShadow = true
    hearth.receiveShadow = true

    this.flame = new Mesh(
      new ConeGeometry(0.34, 1.16, 7),
      new MeshBasicMaterial({ color: 0xef8536 }),
    )
    this.flame.position.y = 0.78
    this.core = new Mesh(
      new ConeGeometry(0.18, 0.7, 6),
      new MeshBasicMaterial({ color: 0xffe49a }),
    )
    this.core.position.y = 0.62

    this.embers = new InstancedMesh(
      new IcosahedronGeometry(0.045, 0),
      new MeshBasicMaterial({ color: 0xffb457 }),
      7,
    )
    this.embers.frustumCulled = false

    // Le seul mouvement lent de la scène: une colonne de fumée qui monte donne au
    // village un centre vivant même quand le colon est parti à l'autre bout.
    this.smoke = new InstancedMesh(
      new IcosahedronGeometry(0.3, 1),
      // Plus discrète qu'avant: à neuf boules pleines, la colonne se lisait
      // comme un chapelet de disques posés devant la tente.
      new MeshBasicMaterial({ transparent: true, opacity: 0.17, depthWrite: false }),
      9,
    )
    this.smoke.frustumCulled = false
    this.smoke.renderOrder = 3

    // Décroissance adoucie et portée longue: il faut que la chaleur atteigne la
    // tente et le colon. Une décroissance quadratique brûle le foyer avant
    // d'avoir éclairé quoi que ce soit à deux mètres.
    this.fireLight = new PointLight(0xff9d4e, 1.5, 10, 1.7)
    this.fireLight.position.y = 1.0

    // Deux nappes: une large et sourde qui baigne les abris, une serrée et
    // brûlante autour de la flamme. C'est le halo qui manquait — sans lui la
    // flamme reste un cône orange collé sur une image froide.
    this.halo = new Sprite(
      new SpriteMaterial({
        map: haloTexture(new Color('#ffbe72'), new Color('#c2470f'), 2.1),
        blending: AdditiveBlending,
        depthWrite: false,
        transparent: true,
        fog: false,
      }),
    )
    this.halo.scale.set(6.4, 6.4, 1)
    this.halo.position.y = 1.15
    this.haloCore = new Sprite(
      new SpriteMaterial({
        // Assez chaud pour rester orange une fois additionné: un cœur blanc
        // mange la flamme au lieu de l'entourer.
        map: haloTexture(new Color('#ffbe6a'), new Color('#e2560c'), 1.9),
        blending: AdditiveBlending,
        depthWrite: false,
        transparent: true,
        fog: false,
      }),
    )
    this.haloCore.scale.set(2.5, 2.5, 1)
    this.haloCore.position.y = 0.86

    if (mode === 'brazier') {
      // La flamme vit dans la vasque : plus petite, plus haute, moins de fumée.
      this.fireLift = 0.7
      this.flameK = 0.62
      this.haloBase = 5.2
      this.haloCoreBase = 2.0
      this.flame.scale.setScalar(0.62)
      this.flame.position.y = 1.5
      this.core.scale.setScalar(0.6)
      this.core.position.y = 1.38
      this.fireLight.position.y = 1.75
      this.halo.position.y = 1.85
      this.haloCore.position.y = 1.55
    } else if (mode === 'lamp') {
      // Plus de flamme, plus de braises, plus de fumée : une ampoule sous
      // l'abat-jour et deux halos blanc chaud, parfaitement immobiles.
      this.flame.visible = false
      this.embers.visible = false
      this.smoke.visible = false
      this.core.geometry.dispose()
      this.core.geometry = new IcosahedronGeometry(0.12, 1)
      ;(this.core.material as MeshBasicMaterial).color.set(0xffedbe)
      this.core.scale.setScalar(1)
      this.core.position.set(0.58, 3.18, 0)
      this.fireLight.color.set(0xffd9a0)
      this.fireLight.distance = 13
      this.fireLight.position.set(0.58, 3.05, 0)
      ;(this.halo.material as SpriteMaterial).map = haloTexture(
        new Color('#fff1c9'),
        new Color('#b98a2e'),
        2.2,
      )
      this.halo.scale.set(4.8, 4.8, 1)
      this.halo.position.set(0.58, 3.15, 0)
      ;(this.haloCore.material as SpriteMaterial).map = haloTexture(
        new Color('#fff7dd'),
        new Color('#d3a238'),
        1.9,
      )
      this.haloCore.scale.set(1.5, 1.5, 1)
      this.haloCore.position.set(0.58, 3.16, 0)
    }
    fire.add(
      hearth,
      this.flame,
      this.core,
      this.embers,
      this.smoke,
      this.fireLight,
      this.halo,
      this.haloCore,
    )
    this.addDecals(fire)
    // Le colon rentre "au feu", c'est-à-dire au point (0,0,0) que lui fixe la
    // boucle: si le foyer y était aussi, il passerait sa vie dans les flammes.
    fire.position.set(HEARTH.x, GROUND_Y, HEARTH.z)
    fire.scale.setScalar(SCALE)
    this.group.add(fire)
  }

  /** Deux nappes posées au sol: la flaque de lumière du feu, qui déborde sur
   *  deux tuiles et bat avec la flamme, et les ombres de contact qui posent les
   *  abris sur la terre. Sans elles, tout le campement lévite. */
  private addDecals(fire: Group): void {
    // Les nappes vivent dans le repère du campement, posé au sol : l'île
    // étant à un seul niveau, elles flottent toutes d'un même cheveu au-dessus
    // de la terre — plus besoin de relire le relief sous chacune.
    const lift = 0.03

    // Nappe additive et non peinte: elle éclaircit et sature ce qu'elle
    // recouvre au lieu de le repeindre, donc la terre battue reste de la terre.
    // Et elle porte trois fois plus loin qu'avant — une flaque qui s'arrête au
    // pied de la tente n'éclaire rien, elle décore le foyer.
    // Sous un lampadaire, la flaque tire vers le blanc chaud du sodium ; sous
    // une flamme, vers l'orange braise.
    const pool = this.electric
      ? (['#b98a3a', '#ddb057', '#ffe19a'] as const)
      : (['#d4621d', '#ef8a3a', '#ffb45c'] as const)
    const glow = [
      glowDisc(7.4, new Color(pool[0]), 0.34, 26).translate(0, lift, 0),
      glowDisc(3.4, new Color(pool[1]), 0.5, 22).translate(0, lift + 0.004, 0),
      glowDisc(1.5, new Color(pool[2]), 0.46, 16).translate(0, lift + 0.008, 0),
    ]
    // Braises visibles par la porte de la tente: quelqu'un est rentré. La
    // maison des âges suivants a une porte pleine — pas de lueur par le seuil.
    if (this.age <= 1)
      glow.push(
        glowDisc(0.46, new Color('#ffc06a'), 0.9, 10)
          .rotateX(Math.PI / 2 - 0.42)
          .rotateY(TENT_YAW)
          .translate(
            CAMP.tent.x + Math.sin(TENT_YAW) * 1.68,
            lift + 0.6,
            CAMP.tent.z + Math.cos(TENT_YAW) * 1.68,
          ),
      )
    // Chaque brasero a sa flaque au sol et son halo debout, incliné vers l'œil:
    // c'est le halo qui fait qu'une lanterne éclaire au lieu de seulement
    // briller, et ces deux-là signent l'habitat loin du foyer.
    const lamp = new Color('#e88a35')
    for (const [x, z] of [
      [CAMP.tent.x + 1.72, CAMP.tent.z + 1.02],
      [CAMP.frame.x - 0.95, CAMP.frame.z + 0.5],
    ] as const) {
      glow.push(glowDisc(1.4, lamp, 0.5, 14).translate(x, lift + 0.002, z))
      glow.push(
        glowDisc(0.62, new Color('#ffc275'), 0.72, 10)
          .rotateX(Math.PI / 2 - 0.55)
          .rotateY(CAMERA_YAW)
          .translate(x, lift + 0.34, z),
      )
    }

    // Ombre franchement bleue: c'est l'écart de température, plus que l'écart
    // de valeur, qui détache un campement chaud d'une île verte et froide.
    const dark = new Color('#16344f')
    const shade: [number, number, number, number][] = [
      [CAMP.tent.x, CAMP.tent.z, 1.95, 0.36],
      [CAMP.lean.x, CAMP.lean.z, 1.35, 0.3],
      [CAMP.rack.x, CAMP.rack.z, 0.95, 0.24],
      [CAMP.wood.x, CAMP.wood.z, 1.1, 0.28],
      [CAMP.frame.x, CAMP.frame.z, 0.85, 0.22],
      [CAMP.knap.x, CAMP.knap.z, 0.8, 0.18],
      [CAMP.screen.x, CAMP.screen.z, 1.3, 0.26],
    ]
    const contact = shade.map(([x, z, r, a]) =>
      glowDisc(r, dark, a, 14).translate(x, lift - 0.005, z),
    )

    this.glowMat = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    })
    const glowMesh = new Mesh(mergeGeometries(glow) ?? new BufferGeometry(), this.glowMat)
    glowMesh.renderOrder = 2
    const shadeMesh = new Mesh(
      mergeGeometries(contact) ?? new BufferGeometry(),
      new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }),
    )
    shadeMesh.renderOrder = 1
    fire.add(shadeMesh, glowMesh)
  }

  /** Au premier âge, le feu est le seul bâti de l'île, et une flamme haute de
   *  cinquante centimètres se noie dans la nappe verte. Il lui faut un vrai
   *  campement: une tente fermée qui masse derrière la flamme, un appentis, un
   *  séchoir, du bois rangé. Tout est fondu dans le foyer — un seul draw call
   *  pour l'ensemble — et tout existe avant la première recherche. */
  /** Un ponton de planches, poussé sur l'eau depuis la plage la plus proche
   *  de la caméra par défaut. C'est un décor pur — il n'occupe aucun
   *  emplacement de bâtiment et la faune l'ignore, il est au-dessus de l'eau
   *  — mais c'est LE prop qui dit « on vit avec la mer ». Fondu dans la même
   *  géométrie que le reste du village : zéro draw call de plus. */
  /** Le rivage aménagé : le ponton, et la chaussée qui y mène dès les voies
   *  romaines. Il vit dans le repère de l'ÎLE et non dans celui du campement —
   *  ce dernier est joué ×1,2 depuis le foyer, ce qui poussait le ponton au
   *  large et le surélevait d'autant. Un seul mesh, sans passe d'ombre. */
  private buildShore(): void {
    // Ponton, gare et arbres abattus par les rues changent ici.
    this.revision++
    this.stationTris = null
    if (this.shoreMesh) {
      this.group.remove(this.shoreMesh)
      this.shoreMesh.geometry.dispose()
      this.shoreMesh = null
    }
    const p: BufferGeometry[] = []
    this.jetty(p)
    this.road(p)
    const geo = mergeGeometries(p)
    if (!geo) return
    grain(geo, 0.09)
    this.shoreMesh = new Mesh(geo, this.solid)
    this.shoreMesh.receiveShadow = true
    this.group.add(this.shoreMesh)
  }

  /** La chaussée romaine : du ponton jusqu'au seuil de la maison, en dalles
   *  posées à même le sol. Elle contourne les sapins
   *  déjà plantés : une voie qui traverse un tronc ne lit pas comme une voie.
   *  Fondue dans le mesh du rivage : aucun appel de rendu de plus. */
  private road(p: BufferGeometry[]): void {
    this.buildLanes()
    const head = this.jettyHead
    for (let li = 0; li < this.lanes!.length; li++) {
      const pts: { x: number; z: number }[] = this.lanes![li]!.pts.map((v) => ({ x: v.x, z: v.z }))
      if (pts.length < 2) continue
      // La rue part du bord de la place : on la rattache au foyer d'un côté,
      // et la première rue court jusqu'au ponton de l'autre — c'est LA voie du
      // village, celle que pavent les voies romaines.
      pts.unshift({ x: HEARTH.x, z: HEARTH.z })
      if (li === 0 && head) {
        const last = pts[pts.length - 1]!
        // Jusqu'au ponton. Depuis l'âge 7, la mer a reculé : la rue tracée sur
        // l'île d'avant (gardée dans la sauvegarde) s'arrête loin de la
        // nouvelle plage, et la route la prolonge pas à pas.
        const ext =
          Math.hypot(head.x - last.x, head.z - last.z) < 14 ? [] : this.reachJetty(last, head)
        pts.push(...ext, { x: head.x, z: head.z })
        this.roadExt = []
        const tail = [last, ...ext, head]
        for (let k = 1; k < tail.length; k++) {
          const a = tail[k - 1]!
          const b = tail[k]!
          const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5))
          for (let j = 1; j <= n; j++) this.roadExt.push({ x: a.x + ((b.x - a.x) * j) / n, z: a.z + ((b.z - a.z) * j) / n })
        }
      }
      // La rue passe : la pinède cède. Sans cela la chaussée existait bel et
      // bien mais disparaissait sous la canopée sur les deux tiers de son
      // parcours — mesuré, pas supposé. Le dégagement porte jusqu'aux
      // parcelles : c'est lui qui rend le village VISIBLE et accessible.
      if (li === 0) {
        // La route du village : c'est elle que l'automobile parcourt.
        this.roadPath = pts.slice()
        this.roadCum = [0]
        for (let k = 1; k < pts.length; k++)
          this.roadCum.push(
            this.roadCum[k - 1]! + Math.hypot(pts[k]!.x - pts[k - 1]!.x, pts[k]!.z - pts[k - 1]!.z),
          )
      }
      this.island.clearCorridor(pts, li === 0 ? 4.4 : 4.0)
      this.track(p, pts, this.roadKnown && li === 0)
    }
    if (this.beltRadii.length > 0) {
      this.crossRoad()
      this.reserveStation()
      this.beltway(p)
    } else if (this.plan.legacy && this.railKnown) this.legacyRailway()
    // Le PREMIER PLAN : la caméra par défaut regarde depuis l'azimut 0,785, et
    // la pinède de ce côté-là passait devant le bourg. On l'éclaircit de moitié
    // sur un secteur large — pas de coupe franche, la lisière reste.
    this.island.thinWedge(0.785, 0.75, 0.55, 5)
  }

  /** Une voie posée à même le sol : dallée quand la tribu sait paver, en
   *  terre battue sinon. Fondue dans le mesh du rivage : aucun appel de rendu
   *  de plus. */
  private track(p: BufferGeometry[], pts: { x: number; z: number }[], paved: boolean): void {
    // Un hachage stable sur le rang du pavé : la voie est irrégulière, mais
    // elle l'est TOUJOURS DE LA MÊME FAÇON d'un chargement à l'autre.
    const jit = (n: number): number => {
      const v = Math.sin(n * 91.7 + 13.1) * 43758.5453
      return v - Math.floor(v)
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!
      const b = pts[i + 1]!
      const mx = (a.x + b.x) / 2
      const mz = (a.z + b.z) / 2
      // On ne dalle pas le foyer : la place reste en terre battue.
      if (Math.hypot(mx - HEARTH.x, mz - HEARTH.z) < 1.7) continue
      const seg = Math.hypot(b.x - a.x, b.z - a.z)
      if (seg < 0.05) continue
      const yaw = Math.atan2(b.x - a.x, b.z - a.z)
      const cy = Math.cos(yaw)
      const sy = Math.sin(yaw)
      // Posée à même le sol, partout au même niveau : plus de palier qui
      // avale une dalle.
      const y = GROUND_Y + 0.04
      /** Pose une pièce en coordonnées de la VOIE : u en travers, v le long. */
      const lay = (
        geo: BufferGeometry,
        color: Color,
        u: number,
        h: number,
        v: number,
      ): void => {
        p.push(part(geo.rotateY(yaw), color, mx + cy * u + sy * v, y + h, mz - sy * u + cy * v))
      }

      if (paved) {
        // 1. L'ASSISE. Une voie romaine est un empilement : le statumen de
        //    blocage dépasse sous le dallage, et c'est ce liseré sombre qui
        //    donne son épaisseur à la chaussée.
        lay(new BoxGeometry(1.86, 0.1, seg * 1.02), tint(C.soilDark, i * 5, 0.05), 0, 0.05, 0)
        // 2. LE DALLAGE. Six pavés par segment, chacun tourné et dimensionné
        //    au hasard STABLE : un damier régulier lisait comme un carrelage
        //    de salle de bains. Et la chaussée est BOMBÉE — les Romains la
        //    cambraient pour que l'eau file aux caniveaux.
        for (let c = 0; c < 3; c++)
          for (let r = 0; r < 2; r++) {
            const k = i * 17 + c * 5 + r
            const u = (c - 1) * 0.5 + (jit(k) - 0.5) * 0.06
            const v = (r - 0.5) * seg * 0.5
            const w = 0.42 + jit(k + 1) * 0.09
            const l = seg * 0.44 + jit(k + 2) * 0.08
            const crown = 0.128 - Math.abs(c - 1) * 0.022
            const tone = jit(k + 3)
            lay(
              new BoxGeometry(w, 0.11, l).rotateY((jit(k + 4) - 0.5) * 0.13),
              tint(tone > 0.62 ? C.stoneLight : tone > 0.3 ? C.stone : C.stoneDark, k, 0.055),
              u,
              crown,
              v,
            )
          }
        // 3. LES BORDURES (crepidines), continues et légèrement plus hautes :
        //    ce sont elles qui tiennent le dallage et dessinent la voie de loin.
        for (const side of [-1, 1])
          lay(
            new BoxGeometry(0.22, 0.2, seg * 1.02),
            tint(C.stoneLight, i * 9 + side, 0.05),
            side * 0.92,
            0.11,
            0,
          )
        // 4. L'USURE. Une ornière plus sombre de chaque côté de l'axe : deux
        //    mille ans de roues au même écartement.
        if (i % 2 === 0)
          for (const side of [-1, 1])
            lay(
              new BoxGeometry(0.2, 0.02, seg * 0.9),
              tint(C.stoneDark, i * 3 + side, 0.04),
              side * 0.34,
              0.185,
              0,
            )
      } else {
        // Sentier de terre battue : UNE bande, pas deux planches parallèles.
        // Le double ruban lisait comme une échelle posée dans l'herbe.
        lay(new BoxGeometry(1.28, 0.09, seg * 1.02), tint(C.soil, i * 7, 0.07), 0, 0.045, 0)
        // Les deux ornières creusées par le passage, et une frange plus claire
        // sur les bords, là où l'herbe reprend.
        for (const side of [-1, 1])
          lay(
            new BoxGeometry(0.3, 0.03, seg),
            tint(C.soilDark, i * 11 + side, 0.06),
            side * 0.3,
            0.09,
            0,
          )
        // Quelques cailloux déchaussés : c'est ce qui distingue un chemin
        // d'une bande de peinture marron.
        if (i % 2 === 0) {
          const k = i * 13
          lay(
            new DodecahedronGeometry(0.07 + jit(k) * 0.04, 0).scale(1, 0.5, 1),
            tint(C.stone, k, 0.08),
            (jit(k + 1) - 0.5) * 1.1,
            0.1,
            (jit(k + 2) - 0.5) * seg,
          )
        }
      }
    }
  }

  // ── La ceinture : sentier, chemin, puis voie ferrée en boucle ─────────────
  // Le tracé est celui de belt.ts : le rivage lissé, à une case de l'eau. Il
  // existe dès le Paléolithique — un sentier côtier, puis un chemin de terre
  // quand la tribu trace des routes, et la voie ferrée à l'âge 7. Aucun
  // bâtiment ne se pose dessus (`fits`), si bien que l'arrivée du train ne
  // déplace rien dans une partie commencée avec la ceinture.

  /** La ceinture posée (sentier, chemin ou voie), fondue dans le mesh du
   *  rivage : zéro appel de dessin de plus. */
  private beltway(p: BufferGeometry[]): void {
    if (this.beltTrack.pts.length < 8) return
    if (this.railKnown) return this.railway(p)
    // Avant le train : un sentier, puis un chemin. Le tracé est le même, il
    // prend de l'importance d'âge en âge.
    const coarse = beltPath(this.beltRadii, 0.8)
    const path = this.roadKnown || this.age >= 4
    const pts = coarse.pts
    // Un bâtiment peut se trouver sur le sentier (sauvegarde d'avant la
    // ceinture, ou gros ouvrage de l'île de base qui n'avait pas d'autre
    // place) : le sentier le CONTOURNE, poussé au bord de son disque. S'il
    // tomberait alors dans l'eau, il s'interrompt — il passe derrière.
    const around = (q: { x: number; z: number }): { x: number; z: number } | null => {
      let x = q.x
      let z = q.z
      for (let pass = 0; pass < 3; pass++)
        for (const l of this.lots) {
          const need = l.r + 0.45
          const d = Math.hypot(x - l.x, z - l.z)
          if (d >= need) continue
          const k = need / Math.max(d, 1e-3)
          x = l.x + (x - l.x) * k
          z = l.z + (z - l.z) * k
        }
      if (this.lots.some((l) => Math.hypot(x - l.x, z - l.z) < l.r + 0.3)) return null
      return this.island.isLand(x, z) ? { x, z } : null
    }
    const run: { x: number; z: number }[][] = [[]]
    for (const q of pts) {
      const at = around(q)
      if (!at) {
        if (run[run.length - 1]!.length > 0) run.push([])
        continue
      }
      run[run.length - 1]!.push(at)
    }
    for (const r of run) {
      if (r.length < 2) continue
      if (path) this.track(p, r, false)
      else this.footpath(p, r)
    }
    this.island.clearCorridor(pts, path ? 1.9 : 1.5)
  }

  /** Le sentier côtier des premiers âges : une trace claire et étroite, des
   *  pierres affleurantes. Ce n'est pas encore une route. */
  private footpath(p: BufferGeometry[], pts: { x: number; z: number }[]): void {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!
      const b = pts[i + 1]!
      const seg = Math.hypot(b.x - a.x, b.z - a.z)
      if (seg < 0.05) continue
      const yaw = Math.atan2(b.x - a.x, b.z - a.z)
      const mx = (a.x + b.x) / 2
      const mz = (a.z + b.z) / 2
      // Usé en son milieu : la trace s'élargit un peu là où l'on passe.
      p.push(part(new BoxGeometry(0.55, 0.05, seg * 1.04).rotateY(yaw), tint(C.soil, i * 5, 0.06), mx, GROUND_Y + 0.025, mz))
      if (i % 3 === 0) {
        const k = i * 7 + 3
        const v = Math.sin(k * 91.7) * 43758.5453
        const j = v - Math.floor(v)
        p.push(
          part(
            new DodecahedronGeometry(0.07 + j * 0.04, 0).scale(1, 0.45, 1),
            tint(C.stone, k, 0.08),
            mx + Math.cos(yaw) * (j - 0.5) * 0.7,
            GROUND_Y + 0.05,
            mz - Math.sin(yaw) * (j - 0.5) * 0.7,
          ),
        )
      }
    }
  }

  /** LA VOIE FERRÉE en boucle : ballast, traverses et deux rails sur toute la
   *  ceinture, le passage à niveau sur la route du ponton, la gare. L'écartement
   *  suit l'échelle de la rame (TRAIN_SCALE) : ses roues tombent sur les rails. */
  private railway(p: BufferGeometry[]): void {
    const track = this.beltTrack.pts
    const k = TRAIN_SCALE
    const gauge = 0.3 * k
    const ballast = tint(C.stoneDark, 5, 0.05)
    const steel = new Color('#8b8f96')
    for (let i = 0; i < track.length - 1; i++) {
      const a = track[i]!
      const b = track[i + 1]!
      const mx = (a.x + b.x) / 2
      const mz = (a.z + b.z) / 2
      const seg = Math.hypot(b.x - a.x, b.z - a.z)
      if (seg < 0.05) continue
      const yaw = Math.atan2(b.x - a.x, b.z - a.z)
      const cy = Math.cos(yaw)
      const sy = Math.sin(yaw)
      const y = GROUND_Y + 0.05
      p.push(part(new BoxGeometry(Village.BALLAST, 0.09, seg * 1.02).rotateY(yaw), ballast, mx, y, mz))
      // Une traverse par pas de 0,4 u : c'est ce qui fait lire « voie ».
      p.push(part(new BoxGeometry(1.1, 0.07, 0.16).rotateY(yaw), tint(C.woodDark, i * 7, 0.08), mx, y + 0.07, mz))
      for (const side of [-1, 1])
        p.push(
          part(
            new BoxGeometry(0.08, 0.07, seg * 1.02).rotateY(yaw),
            steel,
            mx + cy * side * gauge,
            y + 0.13,
            mz - sy * side * gauge,
          ),
        )
    }
    this.island.clearCorridor([...track], 2.2)
    this.levelCrossing(p)
    this.station(p)
    this.buildTrain()
  }

  /** La voie de la 3.61, pour le seul village de passage de la migration
   *  (`plan.ts`) : une corde à travers l'île par le foyer, et la gare au
   *  point libre le plus proche du feu. Rien n'est dessiné : ce tracé ne sert
   *  qu'à retrouver où la 3.61 posait la Merveille et le musée, qu'elle ne
   *  gardait pas dans la sauvegarde. */
  private legacyRailway(): void {
    const cross = 0.785 + Math.PI / 2
    const west = this.traceLane(cross, 34, true)
    const east = this.traceLane(cross + Math.PI, 34, true)
    const pts = [...east.slice().reverse(), { x: HEARTH.x, z: HEARTH.z }, ...west].map((v) => ({ x: v.x, z: v.z }))
    if (pts.length < 6) return
    this.legacyRail = pts
    const prior = this.stationAt
    if (prior) {
      const k = this.lots.findIndex((l) => l.x === prior.x && l.z === prior.z)
      if (k >= 0) this.lots.splice(k, 1)
    }
    let best = 1
    let bestD = Infinity
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.hypot(pts[i]!.x - HEARTH.x, pts[i]!.z - HEARTH.z)
      const score = this.clearOfLots(pts[i]!.x, pts[i]!.z, Village.STATION_R) ? d : d + 1000
      if (score < bestD) {
        bestD = score
        best = i
      }
    }
    this.stationAt = { x: pts[best]!.x, z: pts[best]!.z }
    this.lots.push({ x: pts[best]!.x, z: pts[best]!.z, r: Village.STATION_R })
  }
  private legacyRail: { x: number; z: number }[] = []

  /** Où la route du ponton franchit la ceinture : l'UNIQUE traversée. Les rues
   *  latérales s'arrêtent avant la voie (`clipLane`), la route du ponton la
   *  coupe pour descendre à la plage. */
  private crossRoad(): void {
    this.crossing = null
    this.crossings = 0
    this.zoneKey = ''
    const road = this.roadPath
    if (road.length < 2 || this.beltRadii.length === 0) return
    const inside = (q: { x: number; z: number }): boolean => insideBelt(this.beltRadii, q.x, q.z)
    for (const lane of [road, ...this.sideLanes()]) {
      for (let i = 1; i < lane.length; i++) {
        const a = lane[i - 1]!
        const b = lane[i]!
        if (inside(a) === inside(b)) continue
        this.crossings++
        if (lane !== road || this.crossing) continue
        // Dichotomie sur le segment : le point exact où la route coupe l'axe.
        let lo = 0
        let hi = 1
        for (let it = 0; it < 30; it++) {
          const m = (lo + hi) / 2
          const q = { x: a.x + (b.x - a.x) * m, z: a.z + (b.z - a.z) * m }
          if (inside(q) === inside(a)) lo = m
          else hi = m
        }
        const u = (lo + hi) / 2
        const x = a.x + (b.x - a.x) * u
        const z = a.z + (b.z - a.z) * u
        const seg = Math.hypot(b.x - a.x, b.z - a.z)
        this.crossing = {
          x,
          z,
          sTrack: nearestOnLoop(this.beltTrack, { x, z }).s,
          sRoad: this.roadCum[i - 1]! + seg * u,
          yaw: Math.atan2(b.x - a.x, b.z - a.z),
        }
      }
    }
  }

  /** Les rues latérales telles que dessinées (rattachées au foyer). */
  private sideLanes(): { x: number; z: number }[][] {
    return (this.lanes ?? []).slice(1).map((l) => [{ x: HEARTH.x, z: HEARTH.z }, ...l.pts.map((v) => ({ x: v.x, z: v.z }))])
  }

  /** Le passage à niveau : un platelage entre les rails, une barrière et une
   *  croix de Saint-André de chaque côté. Pas de pont : l'île n'a qu'un
   *  niveau, et des rampes de 10 u ne tiennent pas dans la bande côtière. */
  private levelCrossing(p: BufferGeometry[]): void {
    const c = this.crossing
    if (!c) return
    const t = this.trackDir(c.sTrack)
    const ty = Math.atan2(t.x, t.z)
    // Le platelage, à fleur du rail, sur la largeur de la chaussée.
    p.push(part(new BoxGeometry(Village.BALLAST + 0.1, 0.08, 2.1).rotateY(ty + Math.PI / 2), tint(C.wood, 4, 0.06), c.x, RAIL_TOP - 0.04, c.z))
    const ry = c.yaw
    const rx = Math.sin(ry)
    const rz = Math.cos(ry)
    const red = new Color('#a8302a')
    for (const s of [-1, 1]) {
      // De chaque côté de la voie, sur l'accotement droit de la route.
      const bx = c.x - rx * s * 1.6 + rz * s * 1.15
      const bz = c.z - rz * s * 1.6 - rx * s * 1.15
      p.push(part(new CylinderGeometry(0.06, 0.07, 0.7, 6), C.stoneDark, bx, GROUND_Y + 0.35, bz))
      // La lisse levée (la rame ne s'arrête jamais : c'est l'auto qui attend).
      p.push(part(new BoxGeometry(0.07, 1.3, 0.07), C.plaster, bx, GROUND_Y + 1.25, bz))
      for (const h of [0.85, 1.25, 1.65]) p.push(part(new BoxGeometry(0.08, 0.14, 0.08), red, bx, GROUND_Y + h, bz))
      // La croix de Saint-André, un pas plus loin, face à la route.
      const ax = bx - rx * s * 0.5
      const az = bz - rz * s * 0.5
      p.push(part(new CylinderGeometry(0.035, 0.035, 1.1, 5), C.stoneDark, ax, GROUND_Y + 0.55, az))
      for (const tilt of [0.75, -0.75])
        p.push(
          part(new BoxGeometry(0.55, 0.07, 0.02).rotateZ(tilt).rotateY(ry), C.plaster, ax, GROUND_Y + 1.05, az),
        )
    }
  }

  /** La tangente unitaire de la voie à l'abscisse `s`, dans le sens de marche. */
  private trackDir(s: number): { x: number; z: number } {
    const t = this.beltTrack
    const a = pointAt(t, s - 0.2)
    const b = pointAt(t, s + 0.2)
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1
    return { x: (b.x - a.x) / l, z: (b.z - a.z) / l }
  }

  /** LA GARE. Sur la boucle, près du passage à niveau, quai côté intérieur :
   *  c'est la porte du bourg, face au village. Elle se pose au premier
   *  emplacement libre en s'écartant du passage à niveau (6 u, puis de plus en
   *  plus loin, d'un côté puis de l'autre) : ce qui est déjà bâti ne bouge
   *  pas pour elle. Le choix ne dépend que de la ceinture, de la route et du
   *  plan adopté : une partie rechargée la retrouve au même endroit. */
  private station(p: BufferGeometry[]): void {
    const at = this.stationSpot()
    if (!at) return
    const c = pointAt(this.beltTrack, at.s)
    const t = this.trackDir(at.s)
    const yaw = Math.atan2(t.x, t.z)
    const cy = Math.cos(yaw)
    const sy = Math.sin(yaw)
    const y = GROUND_Y
    const side = at.side
    const from = p.length
    const put = (geo: BufferGeometry, col: Color, u: number, h: number, v: number): void => {
      p.push(part(geo.rotateY(yaw), col, c.x + cy * u * side + sy * v, y + h, c.z - sy * u * side + cy * v))
    }
    // Quai surélevé et sa bordure claire : le bord du quai à 0,15 u au moins
    // du flanc de la rame (0,59 u de demi-largeur à l'échelle 1,4).
    const u0 = Village.QUAY_EDGE
    put(new BoxGeometry(1.5, 0.26, 5.2), tint(C.stoneDark, 3, 0.05), u0 + 0.75, 0.13, 0)
    put(new BoxGeometry(0.16, 0.3, 5.2), C.stoneLight, u0 + 0.08, 0.15, 0)
    // L'abri : quatre poteaux, un toit à deux pentes, un banc.
    for (const u of [u0 + 0.3, u0 + 1.2])
      for (const v of [-0.8, 0.8]) put(new CylinderGeometry(0.06, 0.06, 0.9, 6), C.woodDark, u, 0.7, v)
    put(new BoxGeometry(1.5, 0.1, 2.2), tint(C.tileDark, 5, 0.05), u0 + 0.75, 1.2, 0)
    put(new BoxGeometry(1.62, 0.08, 2.32), C.ridge, u0 + 0.75, 1.14, 0)
    put(new BoxGeometry(0.9, 0.08, 1.3), C.wood, u0 + 1.1, 0.42, 0)
    put(new BoxGeometry(0.12, 0.34, 1.3), C.woodDark, u0 + 1.3, 0.6, 0)
    // Le panneau du quai, face aux voyageurs.
    put(new CylinderGeometry(0.04, 0.04, 0.8, 5), C.stoneDark, u0 + 0.25, 0.66, 2.1)
    put(new BoxGeometry(0.06, 0.3, 0.8), C.plaster, u0 + 0.25, 1.0, 2.1)
    // Le cadastre au sol garde la gare telle qu'elle est dessinée.
    this.stationTris = trianglesOf(p.slice(from))
  }

  /** L'emplacement de la gare, réservé dès l'âge 7 (même avant le savoir du
   *  chemin de fer : un atelier ne prend pas la place du quai). */
  private stationSpot(): { s: number; side: 1 | -1 } | null {
    if (this.stationS !== null) return { s: this.stationS, side: this.stationSide }
    return null
  }

  private reserveStation(): void {
    const prior = this.stationAt
    if (prior) {
      const k = this.lots.findIndex((l) => l.x === prior.x && l.z === prior.z)
      if (k >= 0) this.lots.splice(k, 1)
    }
    this.stationAt = null
    this.stationS = null
    const c = this.crossing
    if (!c || this.age < RAIL_AGE) return
    const L = this.beltLength
    const spot = (off: number): { x: number; z: number; s: number; side: 1 | -1 } | null => {
      const s = (((c.sTrack + off) % L) + L) % L
      const q = pointAt(this.beltTrack, s)
      const t = this.trackDir(s)
      // Le côté du bourg : vers le centre de l'île.
      const side: 1 | -1 = -q.x * t.z + q.z * t.x > 0 ? 1 : -1
      const u = Village.QUAY_EDGE + 0.75
      const x = q.x + t.z * u * side
      const z = q.z - t.x * u * side
      return { x, z, s, side }
    }
    const free = (q: { x: number; z: number }): boolean => {
      if (!this.island.isLand(q.x, q.z) || !this.clearOfLots(q.x, q.z, Village.STATION_R)) return false
      for (const r of this.roadPath) if (Math.hypot(r.x - q.x, r.z - q.z) < Village.STATION_R + 0.95) return false
      return true
    }
    let best: { x: number; z: number; s: number; side: 1 | -1 } | null = null
    for (let d = 6; d <= L / 2 && !best; d += 1)
      for (const sg of [1, -1]) {
        const q = spot(sg * d)
        if (q && free(q)) {
          best = q
          break
        }
      }
    // Tout le pourtour est bâti : la gare se pose quand même à 6 u du passage
    // à niveau. Elle ne déloge personne (le cadastre au sol la contourne).
    best ??= spot(6)
    if (!best) return
    this.stationS = best.s
    this.stationSide = best.side
    this.stationAt = { x: best.x, z: best.z }
    this.railStop = best.s
    this.lots.push({ x: best.x, z: best.z, r: Village.STATION_R })
  }

  /** LA RAME : la locomotive, la voiture de voyageurs dès l'Ère moderne, et
   *  un wagon par ressource que la tribu produit le plus (consist.ts), à
   *  l'échelle TRAIN_SCALE.
   *
   *  UN SEUL mesh pour toute la rame, comme l'ancien train : les véhicules
   *  sont fondus bout à bout et c'est le processeur qui repose leurs sommets
   *  à chaque image (quelques milliers, un rien), chacun sur la voie à sa
   *  propre abscisse. Un mesh par wagon aurait coûté jusqu'à six appels de
   *  dessin de plus — douze avec l'ombre. */
  private buildTrain(): void {
    if (this.train) {
      this.group.remove(this.train)
      this.train.geometry.dispose()
      this.train = null
    }
    if (this.stationS === null) return
    this.trainCars = consistFor(this.age, this.cargoRank, this.beltLength / 3)
    this.trainBounds()
    this.trainGeometry()
    if (!this.train) return
    this.trainHead = -1
    // La rame part de la gare, à quai.
    this.trainS = this.trainStop
    this.trainV = 0
    this.trainWait = 2
    this.poseTrain(this.trainS)
    // Les dix fichiers d'un coup, et seulement maintenant que la voie existe :
    // une composition qui change en gare trouve son wagon déjà là, il n'y a
    // pas de wagon qui change de tête en pleine voie. Fichier absent : le
    // wagon couvert, puis la primitive, tiennent la place sans un mot.
    const ids = Object.values(CAR_MODEL)
    if (ids.every((id) => modelGeometryReady(id))) return
    void loadModels(ids).then((fresh) => {
      if (fresh && this.train && this.group.parent) {
        this.trainGeometry()
        this.poseTrain(this.trainHead, true)
      }
    })
  }

  /** Fond les véhicules de la composition courante en une géométrie, et garde
   *  leurs sommets d'origine (repère du modèle, à l'échelle de la rame) pour
   *  les reposer ensuite. */
  private trainGeometry(): void {
    const parts: BufferGeometry[] = []
    const ranges: { start: number; count: number }[] = []
    let start = 0
    for (const kind of this.trainCars) {
      const geo =
        modelGeometry(CAR_MODEL[kind]) ??
        // Un wagon de marchandises sans son fichier prend le wagon couvert :
        // il garde la bonne longueur, les attelages se touchent toujours.
        (kind !== 'loco' && kind !== 'coach' ? modelGeometry(CAR_MODEL.empty) : null) ??
        primitiveCar(kind)
      // L'échelle de la rame, depuis le dessous des roues : elles restent sur
      // le rail.
      geo.scale(TRAIN_SCALE, TRAIN_SCALE, TRAIN_SCALE)
      // Le même grain que le reste du village : pas d'aplats trop lisses.
      grain(geo, 0.06)
      const count = geo.attributes.position!.count
      ranges.push({ start, count })
      start += count
      parts.push(geo)
    }
    const geo = mergeGeometries(parts)
    for (const g of parts) g.dispose()
    if (!geo) return
    this.trainRanges = ranges
    this.trainBase = Float32Array.from(geo.attributes.position!.array as Float32Array)
    this.trainBaseN = Float32Array.from(geo.attributes.normal!.array as Float32Array)
    if (this.train) {
      this.train.geometry.dispose()
      this.train.geometry = geo
    } else {
      this.train = new Mesh(geo, this.solid)
      this.train.castShadow = true
      this.group.add(this.train)
    }
  }

  /** L'arrêt en gare : la voiture de voyageurs (ou, sans elle, le milieu de
   *  la rame) devant l'abri du quai. */
  private trainBounds(): void {
    const track = this.beltTrack
    const cars = this.trainCars
    const target = cars.indexOf('coach')
    const mid = (p: CarPose[]): number =>
      target >= 0
        ? (p[target]!.sFront + p[target]!.sBack) / 2
        : (p[0]!.sFront + p[p.length - 1]!.sBack) / 2
    let s = this.railStop + (this.railStop - mid(layConsist(track, this.railStop, 1, cars, TRAIN_SCALE)))
    for (let k = 0; k < 4; k++) s += this.railStop - mid(layConsist(track, s, 1, cars, TRAIN_SCALE))
    this.trainStop = wrapS(track, s)
  }

  /** Pose chaque véhicule sur la voie : ses deux attelages sur l'axe, l'un à
   *  sa longueur de l'autre, le suivant accroché au même point. Les roues
   *  sont à la cote du dessus du rail. */
  private poseTrain(head: number, force = false): void {
    const mesh = this.train
    if (!mesh || (!force && head === this.trainHead)) return
    this.trainHead = head
    const poses = layConsist(this.beltTrack, head, 1, this.trainCars, TRAIN_SCALE)
    this.trainPoses = poses
    const pos = mesh.geometry.attributes.position!
    const nor = mesh.geometry.attributes.normal!
    const P = pos.array as Float32Array
    const N = nor.array as Float32Array
    const B = this.trainBase
    const BN = this.trainBaseN
    let cx = 0
    let cz = 0
    for (let k = 0; k < poses.length; k++) {
      const c = poses[k]!
      cx += c.x / poses.length
      cz += c.z / poses.length
      const co = Math.cos(c.yaw)
      const si = Math.sin(c.yaw)
      const { start, count } = this.trainRanges[k]!
      for (let i = start * 3, end = (start + count) * 3; i < end; i += 3) {
        // La rotation de three autour de Y : +Z local part vers (sin, cos).
        const x = B[i]!
        const z = B[i + 2]!
        P[i] = c.x + co * x + si * z
        P[i + 1] = RAIL_TOP + B[i + 1]!
        P[i + 2] = c.z - si * x + co * z
        const nx = BN[i]!
        const nz = BN[i + 2]!
        N[i] = co * nx + si * nz
        N[i + 1] = BN[i + 1]!
        N[i + 2] = -si * nx + co * nz
      }
    }
    pos.needsUpdate = true
    nor.needsUpdate = true
    // La sphère englobante suit la rame : sans elle, le tri hors champ de
    // three garderait celle de la première pose et ferait disparaître le train.
    let r = 0
    for (const c of poses) r = Math.max(r, Math.hypot(c.x - cx, c.z - cz) + c.len / 2 + 0.8)
    const sphere = (mesh.geometry.boundingSphere ??= new Sphere())
    sphere.center.set(cx, RAIL_TOP + 0.7, cz)
    sphere.radius = r
  }

  /** Les ressources produites, par ordre décroissant : main.ts les donne
   *  régulièrement, la rame les CHARGE à son prochain arrêt en gare. */
  setCargo(rates: Partial<Record<string, number>>): void {
    const rank = rankCargo(rates)
    // En expédition, la tribu ne produit plus rien : la rame garde son
    // chargement plutôt que de repartir à vide.
    if (rank.length === 0) return
    this.cargoRank = rank
  }

  /** Le tour de l'île : la rame roule toujours dans le même sens, loco en
   *  tête, freine à l'approche de la gare, y marque cinq secondes d'arrêt
   *  (le seul arrêt du tour : au passage à niveau, c'est l'auto qui attend),
   *  recharge, et repart. Plus de terminus ni de demi-tour. */
  private tickTrain(dt: number): void {
    if (!this.train || this.beltLength < 1) return
    const L = this.beltLength
    if (this.trainWait > 0) {
      this.trainWait -= dt
      if (this.trainWait > 0) return
      this.trainWait = 0
      // Départ : la gare passe derrière, la prochaine est à un tour.
      this.trainS = (this.trainStop + 1e-4) % L
    }
    // Ce qu'il reste de voie jusqu'à la gare, devant la loco.
    const ahead = (((this.trainStop - this.trainS) % L) + L) % L
    // Freinage régulier à l'approche : v² = 2·a·d, jamais tout à fait nul
    // pour que la rame arrive au quai.
    const vMax = Math.min(Village.TRAIN_SPEED, Math.max(0.08, Math.sqrt(2 * Village.TRAIN_ACCEL * ahead)))
    this.trainV = Math.min(this.trainV + Village.TRAIN_ACCEL * dt, vMax)
    const step = this.trainV * dt
    if (step >= ahead) {
      // À quai : la rame s'arrête pile devant l'abri, et charge.
      this.trainS = this.trainStop
      this.trainV = 0
      this.trainWait = Village.TRAIN_STOP
      this.reloadTrain()
      this.poseTrain(this.trainS, true)
      return
    }
    this.trainS = (this.trainS + step) % L
    this.poseTrain(this.trainS)
  }

  /** Recompose la rame en gare si la production a changé d'ordre. Même âge,
   *  même nombre de wagons : seules les cargaisons changent, la rame garde sa
   *  longueur et sa place le long du quai. */
  private reloadTrain(): void {
    const next = consistFor(this.age, this.cargoRank, this.beltLength / 3)
    if (next.join() === this.trainCars.join()) return
    this.trainCars = next
    this.trainGeometry()
    this.poseTrain(this.trainHead, true)
  }

  /** L'intervalle de voie occupé par la rame, élargi de `margin` : couvre-t-il
   *  l'abscisse `s` ? (Abscisses circulaires.) */
  private trainCovers(s: number, margin: number): boolean {
    const poses = this.trainPoses
    if (!this.train || poses.length === 0) return false
    const L = this.beltLength
    const head = poses[0]!.sFront
    const tail = poses[poses.length - 1]!.sBack
    const span = head - tail
    const d = ((((head + margin - s) % L) + L) % L)
    return d <= span + 2 * margin
  }

  /** Passe un véhicule au modèle Blender : tout de suite s'il est déjà là,
   *  sinon dès qu'il arrive. Le mesh reste le même (pivot, matériau, ombre) :
   *  seule sa géométrie change, et le nombre d'appels de dessin aussi. Si le
   *  fichier manque, la primitive construite juste avant reste en place. */
  private vehicleModel(mesh: Mesh, id: VehicleId, grainAmount: number): void {
    const swap = (): boolean => {
      const geo = vehicleGeometry(id)
      if (!geo) return false
      // Le même grain que la primitive : le véhicule ne détonne pas, à côté
      // du bâti fondu, par des aplats trop lisses.
      grain(geo, grainAmount)
      mesh.geometry.dispose()
      mesh.geometry = geo
      return true
    }
    if (swap()) return
    void loadModels([id]).then((fresh) => {
      // L'avion se regare selon la forme du modèle (planeProxy) : le cadastre
      // refait, la boucle rappelle fitMovers.
      if (fresh && this.group.parent && swap() && id === 'plane') this.revision++
    })
  }

  /** Le phare ne se pose pas au village : il lui faut une pointe face au large,
   *  à l'écart du ponton — deux ouvrages collés ne font qu'une tache. */
  private shoreSlot(strict = false): Vector3 | null {
    // Pas l'axe de la caméra : une tour de dix unités plantée pile en face
    // masque le village entier. On vise la côte à main droite — vue de face,
    // mais sur le côté, comme un vrai amer d'entrée de passe.
    const camX = Math.sin(0.785 + 0.95)
    const camZ = Math.cos(0.785 + 0.95)
    const head = this.jettyHead
    let best: Vector3 | null = null
    let bestK = -Infinity
    for (const c of this.island.cells) {
      // Pas sur une parcelle : le phare ne doit pas changer de côte quand une
      // terre se pose.
      if (!c.rim || c.trod || c.plot) continue
      const r = Math.hypot(c.x, c.z) + 1e-6
      const dx = c.x / r
      const dz = c.z / r
      // La MER, pas une flaque — même sonde que le ponton.
      if (
        this.island.isLand(c.x + dx * 2.2, c.z + dz * 2.2) ||
        this.island.isLand(c.x + dx * 5, c.z + dz * 5)
      )
        continue
      if (head && Math.hypot(c.x - head.x, c.z - head.z) < 6.5) continue
      // Loin du bourg : une tour de dix unités plantée au milieu des maisons
      // masque le village entier depuis la caméra par défaut.
      if (Math.hypot(c.x - HEARTH.x, c.z - HEARTH.z) < this.island.radius * 0.62) continue
      if (this.treeDist(c.x, c.z) < 2.6) continue
      const k = (c.x * camX + c.z * camZ) / r + r * 0.06
      if (k > bestK) {
        // Rentré d'une cellule et demie : posé sur la cellule de bord même,
        // un socle de trois unités de rayon déborde dans le vide.
        const ix = c.x - dx * 1.5
        const iz = c.z - dz * 1.5
        const slot = new Vector3(ix, GROUND_Y, iz)
        // Un phare dont le socle déborde sur l'eau a un pied dans le vide :
        // même exigence de terre ferme que pour les bâtiments du village.
        if (!this.onLand(slot, 2.6)) continue
        if (!this.clearOfLots(ix, iz, this.reach('lighthouse'))) continue
        // Dans la bande côtière, entre la voie et la mer, sans toucher la voie.
        if (
          this.beltRadii.length > 0 &&
          (insideBelt(this.beltRadii, ix, iz) || this.beltDist(ix, iz) < this.reach('lighthouse') + Village.BELT_CLEAR)
        )
          continue
        bestK = k
        best = slot
      }
    }
    if (best) this.lots.push({ x: best.x, z: best.z, r: this.reach('lighthouse') })
    // Repli (cap trop étroit) : côté terre, dans la ceinture.
    return best ?? this.slotOrNull(this.reach('lighthouse'), 2.6, 3, false, undefined, strict)
  }

  /** Bout du ponton : c'est là que la barque vient s'amarrer au repos. */
  jettyEnd: { x: number; z: number; yaw: number } | null = null

  private jetty(p: BufferGeometry[]): void {
    // La caméra par défaut regarde depuis l'azimut 0,785 : la plage qui lui
    // fait face est celle dont la direction s'en approche le plus.
    const camX = Math.sin(0.785)
    const camZ = Math.cos(0.785)
    let best: { x: number; z: number } | null = null
    let bestK = -Infinity
    // La tête du ponton est au-delà de la ceinture : la route y descend en
    // franchissant la voie. Dans une anse où la ceinture frôle la plage, un
    // ponton posé en deçà laissait la route finir sans jamais la croiser.
    // (Si aucune plage ne s'y prête, on revient à la règle d'avant.)
    for (const strict of this.beltRadii.length > 0 ? [true, false] : [false]) {
      for (const c of this.island.cells) {
        // Le sable d'une crique n'attire pas le ponton : il resterait à sa
        // place d'origine, sur l'île de base.
        if (!c.beach || !c.rim || c.plot) continue
        const r = Math.hypot(c.x, c.z) + 1e-6
        const dx = c.x / r
        const dz = c.z / r
        // La MER, pas une flaque. `rim` signifie seulement « un voisin manque » :
        // il est vrai aussi sur la berge d'un plan d'eau INTÉRIEUR. Mesuré à
        // l'âge 9 : la cellule élue se trouvait à 15,8 du centre pour une île de
        // rayon 26,3 — le ponton partait d'une lagune vers le large.
        // On exige donc que la direction du large soit dégagée sur cinq unités.
        if (
          this.island.isLand(c.x + dx * 1.6, c.z + dz * 1.6) ||
          this.island.isLand(c.x + dx * 3.2, c.z + dz * 3.2) ||
          this.island.isLand(c.x + dx * 5, c.z + dz * 5)
        )
          continue
        if (strict) {
          const hx = c.x - dx * 0.75
          const hz = c.z - dz * 0.75
          // 2,4 u : l'auto qui attend au bout de la route (demi-longueur
          // 1,15) reste hors du passage de la rame (0,72 u de l'axe).
          if (insideBelt(this.beltRadii, hx, hz) || this.beltDist(hx, hz) < 2.4) continue
        }
        // On veut à la fois « face à la caméra » et « bien au bord ».
        const k = (c.x * camX + c.z * camZ) / r + r * 0.03
        if (k > bestK) {
          bestK = k
          best = { x: c.x, z: c.z }
        }
      }
      if (best) break
    }
    if (!best) return
    const dir = Math.atan2(best.x, best.z)
    const dx = Math.sin(dir)
    const dz = Math.cos(dir)
    // Tête de ponton côté terre : c'est là que la chaussée romaine se raccorde.
    this.jettyHead = { x: best.x - dx * 0.75, z: best.z - dz * 0.75 }
    // Deux hauteurs : le tablier repose sur la plage côté terre, puis descend
    // vers l'eau. La première planche MORD sur la plage : posée à 0,5 du
    // centre de la cellule, elle démarrait au large, le bord d'un hexagone
    // étant à 0,78.
    const yLand = GROUND_Y + 0.05
    const ySea = GROUND_Y - 0.18
    const y = ySea
    // Tablier : sept planches, la première MORDANT sur la plage (t négatif),
    // les suivantes gagnant le large.
    for (let i = 0; i < 7; i++) {
      const t = -0.75 + i * 0.62
      // La pente ne dure que le temps de quitter la rive.
      const k = Math.min(1, Math.max(0, (t + 0.4) / 1.2))
      const py = yLand + (ySea - yLand) * (k * k * (3 - 2 * k))
      p.push(
        part(
          new BoxGeometry(1.35, 0.09, 0.44).rotateY(dir),
          i % 2 === 0 ? C.wood : C.woodDark,
          best.x + dx * t,
          py,
          best.z + dz * t,
        ),
      )
    }
    // Pieux : deux paires, plantées dans l'eau.
    for (const t of [1.1, 2.9]) {
      for (const side of [-1, 1]) {
        p.push(
          part(
            new CylinderGeometry(0.075, 0.09, y + 0.5, 6),
            C.woodDark,
            best.x + dx * t + dz * side * 0.5,
            y * 0.5 - 0.12,
            best.z + dz * t - dx * side * 0.5,
          ),
        )
      }
    }
    // Le bout du tablier, pour que la barque s'y amarre.
    this.jettyEnd = { x: best.x + dx * 3.5, z: best.z + dz * 3.5, yaw: dir }
    // Une caisse oubliée au bout : le détail qui fait vivant.
    p.push(
      part(
        new BoxGeometry(0.4, 0.4, 0.4).rotateY(dir + 0.4),
        C.wood,
        best.x + dx * 3.15 + dz * 0.28,
        y + 0.24,
        best.z + dz * 3.15 - dx * 0.28,
      ),
    )
  }

  private camp(p: BufferGeometry[]): void {
    const put = (parts: BufferGeometry[], s: { x: number; z: number }, yaw?: number): void =>
      place(p, parts, yaw ?? facingFire(s.x, s.z), s.x, s.z)

    // Le temps des cadeaux : quelques paquets posés au pied du foyer. Ils
    // vivent dans la géométrie du camp — zéro appel de rendu de plus — et ne
    // durent que la semaine de Noël sur l'horloge du joueur.
    if (this.yule) {
      const wrap = [new Color('#c0392b'), new Color('#1e7a4a'), new Color('#e0b13a')]
      const ribbon = new Color('#f5efe0')
      const spots: readonly (readonly [number, number, number, number])[] = [
        [1.42, 0.62, 0.46, 0.5],
        [1.86, 1.24, 0.34, 1.4],
        [0.72, 1.5, 0.4, 0.2],
        [-0.5, 1.72, 0.3, 2.3],
        [2.1, 0.1, 0.28, 0.9],
      ]
      spots.forEach(([bx, bz, sz, yaw], i) => {
        const box = new BoxGeometry(sz, sz * 0.8, sz).rotateY(yaw)
        p.push(part(box, tint(wrap[i % 3]!, i * 9, 0.07), bx, sz * 0.4, bz))
        // Les deux rubans croisés : c'est ce qui fait lire « paquet » et non
        // « caisse » à quarante pixels.
        p.push(part(new BoxGeometry(sz * 1.03, sz * 0.83, sz * 0.16).rotateY(yaw), ribbon, bx, sz * 0.4, bz))
        p.push(part(new BoxGeometry(sz * 0.16, sz * 0.83, sz * 1.03).rotateY(yaw), ribbon, bx, sz * 0.4, bz))
        p.push(part(new BoxGeometry(sz * 0.3, sz * 0.12, sz * 0.3).rotateY(yaw + 0.6), ribbon, bx, sz * 0.86, bz))
      })
    }

    if (this.age <= 1) {
      // Deux loges, une grande et une petite, dont les silhouettes se recouvrent à
      // l'écran: c'est une masse bâtie, pas deux objets posés côte à côte.
      // Round 2 : la grande tente culminait à 4,66 u monde (3,1 colons) — elle
      // dominait les sapins voisins et, à l'âge urbain, dépassait le moulin. Un
      // tipi réel fait ~4,5 m : apex ramené à ~3,5 u (2,3 colons), sous la
      // canopée (sapins ≈ 3,8–6,2 u). La petite loge suit pour garder la
      // hiérarchie grande/petite.
      put(hideTent(1.55, 2.9), CAMP.tent, TENT_YAW)
      put(hideTent(1.0, 1.9), CAMP.lean, facingFire(CAMP.lean.x, CAMP.lean.z) - 0.4)
      put(dryingRack(2.0, 1.82), CAMP.rack, CAMERA_YAW + 0.3)
      put(woodPile(1.75), CAMP.wood)
      put(hideFrame(1.15, 1.4), CAMP.frame, CAMERA_YAW - 0.2)
      put(knappingSpot(), CAMP.knap)
      put(windScreen(2.6, 1.45), CAMP.screen)
    } else {
      // Dès l'âge du bronze, on ne dort plus sous les peaux : la maison prend
      // la place de la grande tente (mêmes emprises — le colon et la faune
      // gardent leurs repères), l'appentis celle de la petite, et le vocabulaire
      // paléolithique (séchoir, taille de silex, paravent) cède aux caisses,
      // jarres et barrières.
      const modern = this.age >= 6
      put(houseParts(modern), CAMP.tent, TENT_YAW)
      put(annexParts(modern), CAMP.lean, facingFire(CAMP.lean.x, CAMP.lean.z) - 0.4)
      put(modern ? crateStack() : dryingRack(2.0, 1.82), CAMP.rack, CAMERA_YAW + 0.3)
      put(woodPile(1.75), CAMP.wood)
      put(modern ? barrelParts() : jarCluster(), CAMP.frame, CAMERA_YAW - 0.2)
      put(choppingBlock(), CAMP.knap)
      put(fenceRun(), CAMP.screen)
    }

    // Deux sièges au bord du foyer: c'est ce qui transforme un feu en veillée.
    p.push(
      part(
        new CylinderGeometry(0.19, 0.19, 0.94, 7).rotateZ(Math.PI / 2).rotateY(0.9),
        C.wood,
        -1.55,
        0.19,
        0.35,
      ),
    )
    p.push(part(new BoxGeometry(0.96, 0.06, 0.26).rotateY(0.9), C.hidePale, -1.55, 0.4, 0.35))
    p.push(
      part(
        new DodecahedronGeometry(0.38, 0).rotateY(0.7).scale(1.1, 0.62, 1),
        tint(PALETTE.rock, 12, 0.07),
        1.35,
        0.16,
        1.45,
      ),
    )

    // Traînée d'objets entre le feu et les abris: des braises éteintes, un
    // ballot, des branches. Le vide entre deux volumes est ce qui trahit un
    // décor posé plutôt qu'un lieu habité. Elle n'a de sens qu'autour d'un feu
    // ouvert — un brasero ne sème pas de braises, un lampadaire encore moins.
    if (this.fireMode === 'open')
      for (let i = 0; i < 7; i++) {
        const a = i * 2.39 + 0.6
        const r = 1.55 + (i % 3) * 0.42
        p.push(
          part(
            new DodecahedronGeometry(0.11 + (i % 3) * 0.03, 0).rotateY(i * 2.1).scale(1, 0.55, 1),
            tint(i % 2 === 0 ? PALETTE.rockDark : C.ash, i * 9, 0.1),
            Math.cos(a) * r,
            0.06,
            -Math.sin(a) * r,
          ),
        )
      }
    for (let i = 0; i < 5; i++) {
      p.push(
        part(
          new CylinderGeometry(0.045, 0.06, 0.9, 5).rotateZ(Math.PI / 2).rotateY(i * 1.1 + 0.3),
          i % 2 === 0 ? C.wood : C.woodDark,
          -1.05 + i * 0.12,
          0.05,
          -0.55 - i * 0.1,
        ),
      )
    }
    p.push(part(new SphereGeometry(0.26, 8, 6).scale(1.15, 0.72, 1), C.hide, -0.75, 0.18, -1.45))
    p.push(part(new BoxGeometry(0.4, 0.06, 0.3).rotateY(0.4), C.hideLight, -0.75, 0.36, -1.45))

    // Le sol du campement: un dallage devant chaque seuil et le long du chemin
    // du feu à la tente. C'est plat, donc ça prend la lumière du foyer de plein
    // fouet — la nappe chaude devient de la matière et non un calque.
    paving(p, CAMP.tent.x * 0.5, CAMP.tent.z * 0.52, 1.5, 7, 1)
    paving(p, CAMP.rack.x * 0.55, CAMP.rack.z * 0.6, 1.15, 4, 5)
    paving(p, -1.42, -0.35, 1.25, 5, 9)

    // Deux braseros loin de la flamme: la présence humaine se signe par des
    // points de feu allumés, pas par des figurants.
    place(p, emberBowl(), 0, CAMP.tent.x + 1.72, CAMP.tent.z + 1.02)
    place(p, emberBowl(), 0, CAMP.frame.x - 0.95, CAMP.frame.z + 0.5)
  }

  /** Le sol sous une emprise doit EXISTER : l'île est à un seul niveau, la
   *  seule façon d'avoir un mur en l'air est d'enjamber le rivage. On
   *  échantillonne le pourtour de l'emprise et on refuse les slots dont un
   *  point tombe dans l'eau. */
  private onLand(slot: Vector3, footprint: number): boolean {
    if (footprint <= 0) return true
    // Deux couronnes : le pourtour de l'emprise, et une intermédiaire — un
    // bâtiment large peut enjamber une échancrure que le seul bord manquerait.
    for (const k of [1, 0.6]) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        const px = slot.x + Math.cos(a) * footprint * k
        const pz = slot.z + Math.sin(a) * footprint * k
        if (!this.island.isLand(px, pz)) return false
      }
    }
    return true
  }

  /** Le village se construit derrière le feu, jamais devant. Un bâtiment qui se
   *  glisse entre la caméra et le colon coûte plus cher que tous les défauts
   *  qu'on pourrait lui trouver par ailleurs; le reste (écart minimal, rayon de
   *  dégagement) empêche seulement les toits de s'interpénétrer.
   *  `central` est réservé aux monuments (campanile, moulin, aqueduc): un
   *  ouvrage urbain relégué seul en rase campagne lit comme une ruine. */

  /** Croissance organique en hameaux, sur toute l'île. Le verdict du joueur
   *  était sans appel : la couronne régulière autour du feu lisait comme un
   *  cercle de pierres, pas comme un village. Ici, chaque bâtiment s'installe
   *  près d'un voisin (distance de ruelle ~3,5), un nouveau hameau s'ouvre
   *  tous les cinq bâtiments un peu plus loin, et le terrain doit être dégagé
   *  (ni arbre, ni camp, ni rivage). */
  /** Les RUES du village : trois voies qui partent du bord de la place et
   *  s'enfoncent dans l'île. Elles ne vont pas droit — à chaque pas elles
   *  choisissent, entre cinq caps, celui qui reste le plus loin des sapins.
   *  D'où un tracé organique, et non une étoile géométrique.
   *
   *  C'est le squelette du plan : les bâtiments prennent des parcelles LE LONG
   *  de ces rues. Avant, chaque bâtiment cherchait la meilleure cellule de
   *  toute l'île — d'où un semis sans structure, à moitié caché dans la
   *  pinède, où l'on ne voyait ni n'atteignait rien. */
  private lanes: { pts: Vector3[] }[] | null = null

  private buildLanes(): void {
    if (this.lanes) return
    let raw = this.plan.streets?.map((l) => l.map((q) => ({ x: q.x, z: q.z })))
    if (!raw || raw.length === 0) {
      // La rue principale descend au ponton : c'est elle que pavent les voies
      // romaines, et c'est l'axe que la caméra regarde par défaut.
      const head = this.jettyHead
      const az0 = head ? Math.atan2(head.x - HEARTH.x, head.z - HEARTH.z) : 0.785
      // La rue du ponton court jusqu'au rivage — elle y mène. Les deux autres
      // ne sont que des rues de bourg : elles desservent les parcelles et
      // s'arrêtent. Rien n'a besoin de traverser l'île de bord en bord.
      // Arrondies au centième : la rue relue de la sauvegarde est alors
      // EXACTEMENT celle du premier tracé.
      const r2 = (v: number): number => Math.round(v * 100) / 100
      raw = [this.traceLane(az0, 20, false, 1.6), this.traceLane(az0 + 2.2, 8), this.traceLane(az0 - 2.2, 8)].map(
        (l) => l.map((v) => ({ x: r2(v.x), z: r2(v.z) })),
      )
    }
    this.streetsRaw = raw
    this.lanes = raw.map((l, li) => ({
      pts: this.clipLane(l, li).map((q) => new Vector3(q.x, GROUND_Y, q.z)),
    }))
  }

  /** Les rues telles que tracées la première fois, pour la sauvegarde : elles
   *  ne bougent plus ensuite, ni quand une terre se pose, ni quand la mer
   *  recule à l'âge 7 (la forêt et le ponton, qui guidaient leur tracé,
   *  changent alors). */
  get streets(): { x: number; z: number }[][] {
    this.buildLanes()
    return this.streetsRaw.map((l) => l.map((q) => ({ x: q.x, z: q.z })))
  }
  private streetsRaw: { x: number; z: number }[][] = []

  /** Une rue de bourg s'arrête avant la ceinture : seule la route du ponton
   *  la traverse, au passage à niveau. Elle reste à 2,5 u de l'axe au moins
   *  (demi-chaussée 0,93, ruelle 0,6, demi-ballast 0,73, arrondi). */
  private clipLane(pts: { x: number; z: number }[], li: number): { x: number; z: number }[] {
    if (li === 0 || this.beltRadii.length === 0) return pts
    const out: { x: number; z: number }[] = []
    for (const q of pts) {
      // Ni la voie (celle d'aujourd'hui ou de l'île agrandie), ni le sentier :
      // une rue s'arrête à 2,5 u de la voie, à 1,3 u du sentier (sa
      // demi-chaussée et la demi-largeur du chemin).
      if (!this.beltClear(q.x, q.z, Village.LANE_BELT)) break
      const pathGap = this.railRadii === this.beltRadii ? Village.LANE_BELT : 1.3
      if (!insideBelt(this.beltRadii, q.x, q.z) || this.beltDist(q.x, q.z) < pathGap) break
      out.push(q)
    }
    return out
  }

  /** Distance à l'axe de la ceinture. */
  beltDist(x: number, z: number): number {
    let best = Infinity
    for (const q of this.beltTrack.pts) {
      const d = (q.x - x) ** 2 + (q.z - z) ** 2
      if (d < best) best = d
    }
    return Math.sqrt(best)
  }

  /** Le point (x, z) est-il dans la ceinture, à `need` au moins de son axe ?
   *  C'est la VOIE qui compte : avant l'âge 7, celle de l'île agrandie. */
  private beltClear(x: number, z: number, need: number): boolean {
    if (this.railRadii.length === 0) return true
    const rho = Math.hypot(x, z)
    const R = beltRadius(this.railRadii, Math.atan2(z, x))
    if (rho >= R) return false
    // Loin à l'intérieur : la distance radiale suffit (la ceinture ne
    // s'incline jamais de plus de 25° sur le cercle).
    if ((R - rho) * 0.9 >= need) return true
    let best = Infinity
    for (const q of this.railPts ?? this.beltTrack.pts) best = Math.min(best, (q.x - x) ** 2 + (q.z - z) ** 2)
    return Math.sqrt(best) >= need
  }

  /** Au-delà de la voie, à `need` au moins de son axe : la bande côtière. */
  private beyondBelt(x: number, z: number, need: number): boolean {
    if (this.railRadii.length === 0) return false
    const rho = Math.hypot(x, z)
    if (rho <= beltRadius(this.railRadii, Math.atan2(z, x))) return false
    let best = Infinity
    for (const q of this.railPts ?? this.beltTrack.pts) best = Math.min(best, (q.x - x) ** 2 + (q.z - z) ** 2)
    return Math.sqrt(best) >= need
  }

  /** Avant l'âge 7 : le bord à 0,9 u au moins de l'axe du sentier (ou du
   *  chemin), d'un côté comme de l'autre. */
  private pathClear(x: number, z: number, r: number): boolean {
    if (this.railRadii === this.beltRadii || this.beltRadii.length === 0) return true
    const rho = Math.hypot(x, z)
    const R = beltRadius(this.beltRadii, Math.atan2(z, x))
    if (Math.abs(R - rho) * 0.9 >= r + Village.PATH_CLEAR) return true
    return this.beltDist(x, z) >= r + Village.PATH_CLEAR
  }

  /** La route prolongée jusqu'au ponton, pas à pas, en évitant les sapins
   *  comme une rue : elle ne dépend que de l'île, jamais du plan bâti (sinon
   *  elle changerait d'un chargement à l'autre). */
  private reachJetty(from: { x: number; z: number }, to: { x: number; z: number }): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = []
    let x = from.x
    let z = from.z
    for (let i = 0; i < 40; i++) {
      if (Math.hypot(to.x - x, to.z - z) <= LANE_STEP * 1.2) break
      const az0 = Math.atan2(to.x - x, to.z - z)
      let best = az0
      let bestSc = -Infinity
      for (const off of [-0.5, -0.25, 0, 0.25, 0.5]) {
        const a = az0 + off
        const nx = x + Math.sin(a) * LANE_STEP
        const nz = z + Math.cos(a) * LANE_STEP
        if (!this.island.isLand(nx, nz)) continue
        const sc = Math.min(this.treeDist(nx, nz), 3) * 0.2 - Math.abs(off) * 0.8
        if (sc > bestSc) {
          bestSc = sc
          best = a
        }
      }
      x += Math.sin(best) * LANE_STEP
      z += Math.cos(best) * LANE_STEP
      out.push({ x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 })
    }
    return out
  }

  /** Trace une voie depuis le bord de la place : à chaque pas elle choisit,
   *  entre cinq caps, celui qui reste le plus loin des sapins sans trop
   *  tourner. D'où un tracé organique, et non une étoile géométrique. */
  private traceLane(start: number, steps = 30, avoidBuilt = false, margin = 2.2): Vector3[] {
    /** Assez loin du bord ? On sonde autour du point : une voie large de deux
     *  unités posée sur la dernière cellule débordait dans la mer. */
    const inland = (x: number, z: number): boolean => {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2
        if (!this.island.isLand(x + Math.cos(a) * margin, z + Math.sin(a) * margin)) return false
      }
      return true
    }
    const pts: Vector3[] = []
    let az = start
    let x = HEARTH.x + Math.sin(az) * LANE_R0
    let z = HEARTH.z + Math.cos(az) * LANE_R0
    for (let i = 0; i < steps; i++) {
      let bestAz = az
      let bestScore = -Infinity
      for (const d of [-0.3, -0.12, 0, 0.12, 0.3]) {
        const a = az + d
        const nx = x + Math.sin(a) * LANE_STEP
        const nz = z + Math.cos(a) * LANE_STEP
        if (!this.island.isLand(nx, nz)) continue
        // Le dégagement d'abord, puis la ligne droite.
        let sc = Math.min(this.treeDist(nx, nz), 3) * 0.2 - Math.abs(d) * 0.6
        // La voie ferrée est tracée APRÈS le bourg : c'est à elle de se
        // faufiler. Elle paie très cher tout pas qui frôle un bâtiment —
        // sinon elle traversait les maisons, ce qu'on a vu en jeu.
        if (avoidBuilt)
          for (const l of this.lots) {
            const need = l.r + 1.0
            const dd = Math.hypot(nx - l.x, nz - l.z)
            if (dd < need) sc -= (need - dd) * 40
          }
        if (sc > bestScore) {
          bestScore = sc
          bestAz = a
        }
      }
      const nx = x + Math.sin(bestAz) * LANE_STEP
      const nz = z + Math.cos(bestAz) * LANE_STEP
      if (!inland(nx, nz)) break
      az = bestAz
      x = nx
      z = nz
      pts.push(new Vector3(x, GROUND_Y, z))
    }
    return pts
  }

  /** Orientation de la dernière parcelle rendue : la façade regarde la rue.
   *  Lue par `sync` juste après l'appel — un bâtiment tourné vers le centre
   *  géométrique de l'île présentait son pignon à la ruelle. */
  private slotRot = 0
  /** Bâtiments posés au repli, faute de parcelle : le harnais le surveille —
   *  c'est le signe qu'une île est trop petite pour son village. Un repli
   *  respecte quand même la règle de contact ; il est seulement posé hors des
   *  rues. */
  fallbacks = 0
  /** Passes où l'entraxe des façades a dû être relâché (jamais la règle de
   *  contact). */
  cramped = 0
  /** Bâtiments posés dans la bande côtière, faute de place dans la ceinture. */
  coastal = 0
  /** Avant l'âge 7 : bâtiments posés sur le sentier, sur la future voie. */
  onPath = 0
  straddled = 0
  private relaxBelt = 0

  /** Ruelle minimale entre deux disques d'occupation. C'est LA règle que
   *  demandait le joueur : deux bâtiments ne se touchent jamais. Elle n'est
   *  relâchée par aucun repli — faute de place, on cherche plus loin. */
  static readonly ALLEY = 0.6

  /** Le disque `r` centré en (x, z) laisse-t-il une ruelle à tous les autres ? */
  private clearOfLots(x: number, z: number, r: number, spacing = 0): boolean {
    for (const l of this.lots) {
      const need = Math.max(spacing, l.r + r + Village.ALLEY)
      if ((l.x - x) ** 2 + (l.z - z) ** 2 < need * need) return false
    }
    return true
  }

  /** Les contraintes communes à toutes les parcelles : sur la terre, hors du
   *  camp, hors de la voie ferrée, sans voisin à moins d'une ruelle. */
  private fits(
    slot: Vector3,
    r: number,
    footprint: number,
    spacing: number,
    trees: boolean,
    accept?: (x: number, z: number) => boolean,
    coast = false,
  ): boolean {
    const { x, z } = slot
    if (!this.island.isLand(x, z)) return false
    if (accept && !accept(x, z)) return false
    if (!this.clearOfLots(x, z, r, spacing)) return false
    if (CAMP_BLOCKERS.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 1.6 + r * 0.5)) return false
    if (trees && this.treeDist(x, z) < 1.1 + footprint * 0.35) return false
    // Dans la ceinture, et jamais dessus : le bord à 1,2 u au moins de l'axe
    // (demi-ballast 0,625 + ruelle 0,6). Elle est réservée dès le sentier du
    // Paléolithique : le train de l'âge 7 ne délogera personne.
    if (this.relaxBelt < 2 && (coast ? !this.beyondBelt(x, z, r + Village.BELT_CLEAR) : !this.beltClear(x, z, r + Village.BELT_CLEAR)))
      return false
    if (this.relaxBelt < 1 && !this.pathClear(x, z, r)) return false
    if (this.legacyRail.some((q) => Math.hypot(x - q.x, z - q.z) < 1.0 + r)) return false
    // Ni sur la route du ponton hors des rues, ni sur le passage à niveau.
    const cross = this.crossing
    if (cross && Math.hypot(x - cross.x, z - cross.z) < r + 2.2) return false
    if (this.roadExt.some((q) => Math.hypot(x - q.x, z - q.z) < r + 1.2)) return false
    // Le pied du ponton reste libre : la chaussée et la barque y arrivent.
    const head = this.jettyHead
    if (head && Math.hypot(x - head.x, z - head.z) < r + 1.0 + Village.ALLEY) return false
    return this.onLand(slot, footprint)
  }

  /** La prochaine parcelle libre. On balaie les rues en rond et, sur chacune,
   *  les parcelles en s'éloignant de la place, en alternant les deux côtés :
   *  le village pousse par le centre et gagne du terrain, comme un vrai
   *  bourg. La première parcelle qui tient debout (sur la terre, hors camp,
   *  hors sapins, sans voisin trop proche) est la bonne.
   *
   *  `r` est le rayon d'occupation mesuré (`reach`), `footprint` l'emprise
   *  au sol qui doit reposer sur la terre, `spacing` l'entraxe souhaité. */
  private nextSlot(
    r: number,
    footprint: number,
    spacing: number,
    central = false,
    accept?: (x: number, z: number) => boolean,
  ): Vector3 {
    return this.slotOrNull(r, footprint, spacing, central, accept, false)!
  }

  /** `nextSlot`, avec `strict` : faute de place, rien (au lieu du foyer). Un
   *  bâtiment délogé par la ceinture qui ne retrouve pas de place n'est pas
   *  perdu : il reste où il était. */
  private slotOrNull(
    r: number,
    footprint: number,
    spacing: number,
    central = false,
    accept?: (x: number, z: number) => boolean,
    strict = false,
  ): Vector3 | null {
    const s = this.laneSlot(r, footprint, central ? spacing * 0.8 : spacing, accept)
    if (s) return s
    // L'entraxe d'abord : c'est du confort, pas la règle de contact.
    this.cramped++
    const tight = this.laneSlot(r, footprint, 0, accept)
    if (tight) return tight
    // Plus de parcelle le long des rues : on cherche sur toute l'île, en
    // partant du feu. Avant, on relâchait l'emprise puis l'écart — et deux
    // toits finissaient l'un dans l'autre.
    this.fallbacks++
    const cells = [...this.island.cells].sort(
      (a, b) => Math.hypot(a.x - HEARTH.x, a.z - HEARTH.z) - Math.hypot(b.x - HEARTH.x, b.z - HEARTH.z),
    )
    // Une place sans rocher ni buisson d'abord : le repli tombe souvent au
    // bord de l'île, là où pousse le décor, et un bourg qui l'efface paraît
    // défriché (test « l'île ne paraît pas déboisée »).
    for (const bare of this.plan.legacy ? [false] : [true, false])
      for (const c of cells) {
        const slot = new Vector3(c.x, GROUND_Y, c.z)
        if (!this.fits(slot, r, footprint, 0, false, accept)) continue
        if (bare && !this.bare(c.x, c.z, r)) continue
        this.slotRot = Math.atan2(HEARTH.x - c.x, HEARTH.z - c.z)
        this.lots.push({ x: c.x, z: c.z, r })
        return slot
      }
    // Avant l'âge 7, l'île de base est petite : un gros ouvrage (aqueduc,
    // moulin) peut ne trouver sa place que sur le sentier — qui passe alors
    // derrière lui —, et en dernier recours sur le tracé de la future voie :
    // le grand tracé de l'âge 7 le relogera. Plutôt que sur le foyer.
    // Sur le sentier, on prend d'abord une place sans rocher ni buisson : ces
    // places-là sont au bord de l'île, là où pousse le décor, et un bourg qui
    // l'efface paraît défriché.
    if (this.railRadii !== this.beltRadii)
      for (const [level, bare] of [[1, true], [1, false], [2, false]] as const) {
        this.relaxBelt = level
        let found: Vector3 | null = null
        for (const c of cells) {
          const slot = new Vector3(c.x, GROUND_Y, c.z)
          if (!this.fits(slot, r, footprint, 0, false, accept)) continue
          if (bare && !this.bare(c.x, c.z, r)) continue
          found = slot
          break
        }
        this.relaxBelt = 0
        if (found) {
          if (level === 1) this.onPath++
          else this.straddled++
          this.slotRot = Math.atan2(HEARTH.x - found.x, HEARTH.z - found.z)
          this.lots.push({ x: found.x, z: found.z, r })
          return found
        }
      }
    // Le bourg est plein jusqu'à la voie : en tout dernier recours, la bande
    // côtière, sur un cap assez large pour que le bâtiment ne touche ni la
    // voie ni l'eau. Mesuré (dix graines, âge 10) : un à trois bâtiments sur
    // quelques graines, qui sinon se seraient posés sur le foyer.
    for (const c of cells) {
      const slot = new Vector3(c.x, GROUND_Y, c.z)
      if (!this.fits(slot, r, footprint, 0, false, accept, true)) continue
      this.coastal++
      this.slotRot = Math.atan2(HEARTH.x - c.x, HEARTH.z - c.z)
      this.lots.push({ x: c.x, z: c.z, r })
      return slot
    }
    if (strict) return null
    // L'île entière est pleine : on pose au feu plutôt que de ne rien montrer.
    // Le test d'espacement échoue alors, et c'est voulu : l'île est trop petite.
    this.slotRot = 0
    this.lots.push({ x: HEARTH.x, z: HEARTH.z, r })
    return new Vector3(HEARTH.x, GROUND_Y, HEARTH.z)
  }

  private laneSlot(
    r: number,
    footprint: number,
    spacing: number,
    accept?: (x: number, z: number) => boolean,
  ): Vector3 | null {
    this.buildLanes()
    const lanes = this.lanes!
    const maxStep = Math.max(...lanes.map((l) => l.pts.length))
    for (let step = 0; step < maxStep; step += PLOT_EVERY) {
      for (let li = 0; li < lanes.length; li++) {
        const pts = lanes[li]!.pts
        if (step >= pts.length) continue
        const a = pts[step]!
        const b = pts[Math.min(step + 1, pts.length - 1)]!
        const dx = b.x - a.x
        const dz = b.z - a.z
        const len = Math.hypot(dx, dz) || 1
        // Normale à la rue : c'est elle qui porte les deux rangées de façades.
        const nx = dz / len
        const nz = -dx / len
        // Deux rangées de chaque côté : les façades sur rue, puis un
        // arrière-plan de dépendances. Un village n'a pas qu'une épaisseur de
        // maison.
        for (const [side, baseRow] of PLOT_ROWS) {
          // Un gros bâtiment est REPOUSSÉ : le moulin débordait sur la
          // chaussée. La façade recule d'au moins son emprise plus une voie.
          const row = Math.max(baseRow, footprint + 1.25)
          const slot = new Vector3(a.x + nx * side * row, GROUND_Y, a.z + nz * side * row)
          if (!this.fits(slot, r, footprint, spacing, true, accept)) continue
          // La façade regarde la rue : elle est du côté opposé à la normale.
          this.slotRot = Math.atan2(-nx * side, -nz * side)
          this.lots.push({ x: slot.x, z: slot.z, r })
          return slot
        }
      }
    }
    return null
  }

  /** Distance au sapin le plus proche : un bâtiment ne pousse pas dans un arbre. */
  private treeXZ: number[] | null = null
  private treeDist(x: number, z: number): number {
    if (!this.treeXZ) {
      this.treeXZ = []
      for (const m of this.island.pickables) {
        if (this.island.kindFor(m) !== 'wood') continue
        for (let i = 0; i < m.count; i++) {
          const p = this.island.instancePosition(m, i)
          this.treeXZ.push(p.x, p.z)
        }
      }
    }
    let bestD = Infinity
    for (let i = 0; i < this.treeXZ.length; i += 2) {
      const d = (this.treeXZ[i]! - x) ** 2 + (this.treeXZ[i + 1]! - z) ** 2
      if (d < bestD) bestD = d
    }
    return Math.sqrt(bestD)
  }

  /** Rayon d'occupation d'un bâtiment, MESURÉ sur sa géométrie : le point
   *  le plus éloigné de son centre, en plan, pièces animées comprises (les
   *  ailes du moulin, l'attelage qui laboure, la voiture garée). Mis en cache :
   *  la géométrie ne dépend que de l'identifiant. */
  private readonly reaches = new Map<string, number>()
  private reach(id: string): number {
    const known = this.reaches.get(id)
    if (known !== undefined) return known
    let r = Village.MOVER_REACH[id] ?? 0
    for (const g of this.propGeo(id) ?? []) {
      const pos = g.getAttribute('position')
      for (let i = 0; i < pos.count; i++) r = Math.max(r, Math.hypot(pos.getX(i), pos.getZ(i)))
      g.dispose()
    }
    // Plancher : un objet minuscule garde une parcelle à hauteur d'homme.
    r = Math.max(0.6, r)
    this.reaches.set(id, r)
    return r
  }
  /** Ce que les pièces animées balaient hors de la géométrie fixe, mesuré
   *  sur leurs maillages (2026-10-12) : ailes du moulin (pivot avancé, rayon
   *  des pales), attelage qui fait l'aller-retour sur ±1,2, halo du phare,
   *  voiture et avion à l'arrêt. */
  private static readonly MOVER_REACH: Record<string, number> = {
    windmill: 3.15, plough: 2.14, lighthouse: 2.7, garage: 1.28, plane: 1.14,
  }
  /** La Merveille : socle de 4,6 × 4,6, demi-diagonale 3,25. */
  static readonly WONDER_R = 3.3
  /** Le musée : esplanade de 3,8 × 2,6, demi-diagonale 2,3. */
  private static readonly MUSEUM_R = 2.3
  /** La gare, depuis son point de voie : quai et abri jusqu'à 2,25 de côté
   *  sur 2,1 de long. */
  private static readonly STATION_R = 3.1

  /** Monuments urbains: ils réclament un slot proche du centre, pas la lisière. */
  private static readonly MONUMENTS = new Set(['clock', 'windmill', 'aqueduct'])
  /** Emprise au sol des gros objets: le slot doit être plat sous toute la base.
   *  Les valeurs suivent les remises à l'échelle des rounds 1 et 2 (villa ×2,
   *  aqueduc ×1.7, moulins ×2.5/×5.5, campanile ×4.5, garage ×2, antenne). */
  private static readonly FOOTPRINT: Record<string, number> = {
    hut: 1.1, field: 1.7, granary: 1.0, aqueduct: 2.2, forge: 1.3, lighthouse: 2.6,
    datacenter: 1.4, battery: 1.4, desal: 1.3, genlab: 1.3, capture: 1.2, quantum: 1.1, plane: 1.5, garage: 1.3,
    railway: 1.2, villa: 1.6, threefield: 0.8, milestone: 0.8,
    clock: 0.9, windmill: 2.3, watermill: 1.4, phone: 0.6,
  }
  /** Les quatre bâtiments v1 gardent les règles d'espacement de l'époque où ils
   *  étaient des Object3D séparés : les slots choisis — donc le plan du village
   *  entier — ne bougent pas d'un centimètre. */
  private static readonly LEGACY = new Set(['hut', 'field', 'granary', 'aqueduct'])

  /** Adopte le plan sauvegardé AVANT toute nouvelle pose : un bâtiment déjà
   *  posé ne bouge plus jamais. L'île n'a qu'un niveau : tout se pose à
   *  GROUND_Y, rien à relire. C'est la réponse à « les bâtiments changent de
   *  place à chaque rafraîchissement » : le plan était recalculé de zéro, et
   *  il dépend de la taille de l'île. */
  adoptLayout(saved: { id: string; x: number; z: number; rot: number }[], resolve = false): void {
    for (const s of saved) {
      if (this.placed.has(s.id)) continue
      const y = GROUND_Y
      this.propPlacements.push({ id: s.id, x: s.x, y, z: s.z, rot: s.rot })
      this.placed.add(s.id)
      this.lots.push({ x: s.x, z: s.z, r: this.reach(s.id) })
      // Les ouvrages LINÉAIRES ne sont pas dans le plan (ils n'occupent pas de
      // parcelle) : leur drapeau doit être restauré ici, sinon un village
      // rechargé perdait sa chaussée ou sa voie ferrée — le bâtiment étant
      // déjà « placé », la branche qui les pose ne s'exécutait plus.
      if (s.id === 'milestone') this.roadKnown = true
      if (s.id === 'railway') this.railKnown = true
      this.adopted = true
    }
    if (resolve) this.evictConflicts()
    this.buildShore()
  }

  /** LE GRAND TRACÉ : les bâtiments du plan adopté qui empiètent sur la
   *  ceinture (bord à moins de 1,2 u de l'axe, ou posés au-delà), ou sur la
   *  route prolongée jusqu'au ponton. Ils sont retirés ici et reposés par
   *  `sync`, du plus gros au plus petit ; un bâtiment qui ne trouve aucune
   *  place reste où il était. Les autres ne bougent pas d'un centimètre. Le
   *  phare, lui, vit entre la voie et la mer : il n'est délogé que s'il
   *  touche la voie. */
  private evictConflicts(): void {
    if (this.beltRadii.length === 0) return
    for (let i = this.propPlacements.length - 1; i >= 0; i--) {
      const pl = this.propPlacements[i]!
      const r = this.reach(pl.id)
      const onRoad = this.roadExt.some((q) => Math.hypot(pl.x - q.x, pl.z - q.z) < r + 1.2)
      const bad =
        onRoad ||
        (pl.id === 'lighthouse'
          ? this.beltDist(pl.x, pl.z) < r + Village.BELT_CLEAR
          : !this.beltClear(pl.x, pl.z, r + Village.BELT_CLEAR))
      if (!bad) continue
      this.propPlacements.splice(i, 1)
      this.placed.delete(pl.id)
      const k = this.lots.findIndex((t) => t.x === pl.x && t.z === pl.z)
      if (k >= 0) this.lots.splice(k, 1)
      this.evicted.push({ id: pl.id, x: pl.x, z: pl.z, rot: pl.rot, r })
    }
  }

  /** Pendant dix secondes, les bâtiments reposés par le grand tracé portent
   *  un échafaudage et un liseré doré au sol : on voit ce qui a déménagé. Un
   *  seul mesh, retiré ensuite (`update`). */
  markMoved(): void {
    if (this.moved.length === 0) return
    const p: BufferGeometry[] = []
    const gold = new Color('#e8c25a')
    for (const m of this.moved) {
      const r = this.reach(m.id)
      const k = Math.max(0.7, r * 0.72)
      const h = 1.6 + r * 0.5
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        p.push(part(new CylinderGeometry(0.05, 0.06, h, 5), C.wood, m.to.x + sx * k, GROUND_Y + h / 2, m.to.z + sz * k))
        p.push(part(new BoxGeometry(0.06, 0.06, k * 2), C.woodDark, m.to.x + sx * k, GROUND_Y + h - 0.1, m.to.z))
        p.push(part(new BoxGeometry(k * 2, 0.06, 0.06), C.woodDark, m.to.x, GROUND_Y + h * 0.55, m.to.z + sz * k))
      }
      p.push(part(new RingGeometry(r + 0.05, r + 0.3, 28).rotateX(-Math.PI / 2), gold, m.to.x, GROUND_Y + 0.03, m.to.z))
    }
    const geo = mergeGeometries(p)
    if (!geo) return
    this.scaffold = new Mesh(geo, this.solid)
    this.scaffoldLeft = 10
    this.group.add(this.scaffold)
  }
  private scaffold: Mesh | null = null
  private scaffoldLeft = 0

  /** Délogés en attente d'une nouvelle place (voir `evictConflicts`). */
  private evicted: { id: string; x: number; z: number; rot: number; r: number }[] = []
  /** Ce que le grand tracé a déplacé à ce chargement, et ce qu'il n'a pas pu
   *  reloger (resté en place). Lu par main.ts pour la carte et la Chronique. */
  readonly moved: { id: string; from: { x: number; z: number }; to: { x: number; z: number } }[] = []
  readonly stuck: string[] = []

  /** Le plan à écrire dans la sauvegarde. */
  get layout(): { id: string; x: number; z: number; rot: number }[] {
    return this.propPlacements.map((p) => ({ id: p.id, x: p.x, z: p.z, rot: p.rot }))
  }

  private adopted = false

  sync(buildings: Set<string>): void {
    let dirty = this.adopted
    this.adopted = false
    // Ce qui n'est plus de son temps s'efface : un ouvrage remplacé ou tombé
    // en désuétude ne reste pas planté au milieu du bourg. La parcelle est
    // rendue au plan, un autre bâtiment pourra la reprendre.
    for (let i = this.propPlacements.length - 1; i >= 0; i--) {
      const pl = this.propPlacements[i]!
      if (buildings.has(pl.id)) continue
      this.propPlacements.splice(i, 1)
      this.placed.delete(pl.id)
      const k = this.lots.findIndex((t) => t.x === pl.x && t.z === pl.z)
      if (k >= 0) this.lots.splice(k, 1)
      dirty = true
    }
    // Les délogés du grand tracé d'abord, du plus gros au plus petit : ce
    // sont eux qui ont le plus de mal à trouver une place.
    if (this.evicted.length > 0) {
      const order = [...this.evicted].sort((a, b) => b.r - a.r || (a.id < b.id ? -1 : 1))
      this.evicted = []
      for (const e of order) {
        if (!buildings.has(e.id) || this.placed.has(e.id)) continue
        const s = this.slotFor(e.id, true)
        if (s) {
          const rot = e.id === 'lighthouse' ? Math.atan2(-s.x, -s.z) : this.slotRot
          this.propPlacements.push({ id: e.id, x: s.x, y: s.y, z: s.z, rot })
          this.moved.push({ id: e.id, from: { x: e.x, z: e.z }, to: { x: s.x, z: s.z } })
        } else {
          // Aucune place : il reste où il était, plutôt que d'être perdu.
          this.propPlacements.push({ id: e.id, x: e.x, y: GROUND_Y, z: e.z, rot: e.rot })
          this.lots.push({ x: e.x, z: e.z, r: e.r })
          this.stuck.push(e.id)
        }
        this.placed.add(e.id)
        dirty = true
      }
    }
    for (const b of buildings) {
      if (this.placed.has(b)) continue
      const s = this.slotFor(b, false)!
      // La façade regarde la rue (slotRot) ; le phare, posé hors du plan,
      // continue de regarder le large.
      const rot = b === 'lighthouse' ? Math.atan2(-s.x, -s.z) : this.slotRot
      this.propPlacements.push({ id: b, x: s.x, y: s.y, z: s.z, rot })
      this.placed.add(b)
      dirty = true
      // La borne milliaire n'est que la signature des voies romaines : ce que
      // le savoir pose vraiment, c'est la chaussée qui traverse l'île.
      if (b === 'milestone' && !this.roadKnown) {
        this.roadKnown = true
        this.buildShore()
      }
      // Le dépôt ne fait pas le chemin de fer : ce que le savoir pose vraiment,
      // c'est la VOIE qui traverse l'île, et le train qui la parcourt.
      if (b === 'railway' && !this.railKnown) {
        this.railKnown = true
        this.buildShore()
      }
    }
    // Une seule refonte du mesh par lot : au chargement d'une partie avancée,
    // reconstruire après chaque savoir rendait le coût quadratique.
    if (dirty) this.rebuildProps()
  }


  // ── Ateliers de savoir ────────────────────────────────────────────────────
  // Chaque technologie pose son objet dans le village : le savoir se VOIT.
  // Tous les ateliers vivent dans UN SEUL mesh fusionné (`restack`, avec la
  // Merveille et le musée) : dix-sept objets pour un draw call.

  /** La parcelle d'un nouveau bâtiment. `strict` : rien plutôt que le foyer
   *  si l'île est pleine. */
  private slotFor(b: string, strict: boolean): Vector3 | null {
    // L'écart minimal suit l'emprise : depuis les remises à l'échelle, une
    // villa de 4 u posée à 2 u d'une hutte lui rentrait dans le toit — et à
    // ×2.2 d'emprise elle venait encore s'accoler aux arches de l'aqueduc.
    // Aucun bâtiment n'a une emprise nulle : sans plancher, `onLand`
    // renvoyait vrai sans rien vérifier et le bord de l'île redevenait
    // constructible.
    const fp = Math.max(0.6, Village.FOOTPRINT[b] ?? 0.5)
    const central = Village.MONUMENTS.has(b)
    // Le phare réserve lui-même son disque dans `shoreSlot`.
    if (b === 'lighthouse') return this.shoreSlot(strict)
    if (Village.LEGACY.has(b)) return this.slotOrNull(this.reach(b), fp, 3.4, central, undefined, strict)
    return this.slotOrNull(this.reach(b), fp, Math.max(2.0, fp * 2.6), central, undefined, strict)
  }

  private readonly propPlacements: { id: string; x: number; y: number; z: number; rot: number }[] = []
  private propsGeo: BufferGeometry | null = null
  /** Le mesh (ou, en repli, les meshes) qui porte ateliers, Merveille, musée. */
  private statics: Mesh[] = []
  /** Le phare est joué à part : c'est un amer, pas un atelier. Il doit passer
   *  au-dessus de la pinède (sapins ≈ 9,6 u) pour être vu du large. */
  private static readonly BEACON_K = 1.55
  private static readonly BEACON_HALO = 5.4
  /** Le rivage : ponton et chaussée, un mesh à part dans le repère de l'île. */
  private shoreMesh: Mesh | null = null
  private jettyHead: { x: number; z: number } | null = null
  private roadKnown = false
  /** Le chemin de fer : une VOIE qui traverse l'île, et une locomotive qui la
   *  parcourt en aller-retour. Posée sur la rue la plus longue après la
   *  chaussée principale — un rail ne double pas une route, il en prend une
   *  autre. */
  private railKnown = false
  private roadPath: { x: number; z: number }[] = []
  private roadCum: number[] = []
  /** La route au-delà des rues (jusqu'au ponton), en points tous les 0,5 u. */
  private roadExt: { x: number; z: number }[] = []
  /** La ceinture : ses 72 rayons (belt.ts), sa polyligne fermée, sa longueur. */
  private beltRadii: number[] = []
  private beltTrack: Track = { pts: [], cum: [0], closed: true }
  private beltLength = 0
  /** La ceinture a grandi à ce chargement (terre gagnée, mer qui recule). */
  beltGrew = false
  /** La ceinture de la VOIE : celle d'aujourd'hui dès l'âge 7, celle de l'île
   *  agrandie avant (et sa polyligne, dans ce cas seulement). */
  private railRadii: number[] = []
  private railPts: { x: number; z: number }[] | null = null
  /** Le passage à niveau : le point, son abscisse sur la voie et sur la route,
   *  le cap de la route. */
  private crossing: { x: number; z: number; sTrack: number; sRoad: number; yaw: number } | null = null
  /** Nombre de traversées route/voie (attendu : une). Lu par les tests. */
  crossings = 0
  /** La gare : abscisse de son point de voie et côté du quai. */
  private stationS: number | null = null
  private stationSide: 1 | -1 = 1
  /** La rame entière, un seul mesh (voir buildTrain). */
  private train: Mesh | null = null
  /** Abscisse de la gare sur la voie : le train y marque l'arrêt. */
  private railStop = 0
  /** La composition roulante, de la loco à la queue. */
  private trainCars: CarKind[] = []
  /** Les ressources de la tribu, de la plus produite à la moins produite. */
  private cargoRank: Cargo[] = []
  /** Les sommets de chaque véhicule dans la géométrie fondue. */
  private trainRanges: { start: number; count: number }[] = []
  private trainBase = new Float32Array(0)
  private trainBaseN = new Float32Array(0)
  /** Abscisses de la tête : arrêt en gare, dernière pose ; marche (position,
   *  vitesse, attente à quai). */
  private trainStop = 0
  private trainHead = -1
  private trainS = 0
  private trainV = 0
  private trainWait = 0
  /** La dernière pose de chaque véhicule — lue par le harnais de mesure. */
  trainPoses: CarPose[] = []
  /** Marche de la rame : 2,2 u/s en ligne, 0,6 u/s² au freinage et au départ,
   *  5 s à quai. */
  private static readonly TRAIN_SPEED = 2.2
  private static readonly TRAIN_ACCEL = 0.6
  private static readonly TRAIN_STOP = 5
  /** Largeur du ballast : 1,25 u, les traverses (1,1 u) et les rails (à
   *  ±0,42 u, l'écartement de la rame à l'échelle 1,4) dessus. */
  private static readonly BALLAST = 1.25
  /** Bord du quai de la gare, depuis l'axe : demi-gabarit 0,60 + débord en
   *  courbe + 0,15 de jour. */
  private static readonly QUAY_EDGE = 0.85
  /** Bord de bâtiment ↔ axe de la voie : demi-ballast 0,625 + ruelle 0,6,
   *  la règle de la conception (1,2 u). Le flanc de la rame passe à 0,72 u
   *  de l'axe au plus (0,59 de demi-gabarit, 0,13 de débord en courbe). */
  static readonly BELT_CLEAR = 1.2
  /** Bord de bâtiment ↔ axe du sentier ou du chemin, avant l'âge 7 :
   *  demi-chemin 0,3 (il s'élargit à 0,64) + ruelle 0,6. */
  private static readonly PATH_CLEAR = 0.9
  /** Bout d'une rue de bourg ↔ axe de la voie. */
  private static readonly LANE_BELT = 2.5

  /** La voie (boucle fermée), pour les tests et le harnais. */
  get railTrack(): Track {
    return this.beltTrack
  }
  /** Les rayons de la ceinture, pour la sauvegarde. */
  get belt(): number[] {
    return [...this.beltRadii]
  }
  /** La lueur du phare, hors fusion : elle est additive et doit respirer. */
  private beaconHalo: Sprite | null = null

  private propGeo(id: string): BufferGeometry[] | null {
    const p: BufferGeometry[] = []
    const copper = new Color('#c47a3f')
    const gold = new Color('#d9b23f')
    const iron = new Color('#6b7078')
    switch (id) {
      case 'knapping': {
        // Atelier de taille : peau claire étalée, nucléus d'obsidienne SOMBRE,
        // éclats clairs en éventail — le dodécaèdre gris se confondait avec les
        // rochers décoratifs du camp.
        p.push(part(new BoxGeometry(1.15, 0.05, 0.9).rotateY(0.35), C.hidePale, 0, 0.03, 0))
        p.push(part(new CylinderGeometry(0.24, 0.28, 0.3, 7), C.wood, -0.35, 0.15, -0.28))
        p.push(part(new DodecahedronGeometry(0.2, 0).rotateY(0.8).scale(1, 0.85, 1), C.char, 0.02, 0.19, -0.05))
        for (let i = 0; i < 6; i++) {
          const a = -0.6 + i * 0.34
          p.push(part(new TetrahedronGeometry(0.08, 0).rotateY(i * 1.3).scale(1, 0.5, 1), C.stoneLight, Math.sin(a) * 0.42, 0.07, 0.1 + Math.cos(a) * 0.32))
        }
        return p
      }
      case 'woodpile': {
        // Réserve de bois du feu : bûches empilées en pyramide.
        for (let row = 0; row < 3; row++)
          for (let i = 0; i <= 2 - row; i++)
            p.push(part(new CylinderGeometry(0.09, 0.09, 0.72, 6).rotateX(Math.PI / 2), row % 2 ? C.woodDark : C.wood, -0.2 + i * 0.2 + row * 0.1, 0.09 + row * 0.15, 0))
        return p
      }
      case 'lamps': {
        // Lampes à graisse : x2, posées sur une dalle surélevée, flammes
        // surcuites — trois pierres de 9 cm se noyaient dans le halo du foyer.
        p.push(part(new DodecahedronGeometry(0.52, 0).rotateY(0.4).scale(1.35, 0.32, 1.05), tint(PALETTE.rock, 3, 0.06), 0, 0.12, 0))
        for (let i = 0; i < 3; i++) {
          const x = -0.42 + i * 0.42
          const z = (i % 2) * 0.22 - 0.06
          p.push(part(new CylinderGeometry(0.15, 0.19, 0.16, 6), PALETTE.rockDark, x, 0.32, z))
          p.push(part(new CylinderGeometry(0.11, 0.11, 0.05, 6), C.emberCore, x, 0.41, z))
          p.push(part(new ConeGeometry(0.07, 0.24, 5), C.emberFlame, x, 0.55, z))
        }
        return p
      }
      case 'spearrack': {
        // Râtelier : deux croix, épieux REDRESSÉS (~60° du sol) et grosses
        // pointes de silex — à 72° de la verticale, l'objet lisait comme un
        // chevalet de sciage.
        for (const sx of [-0.38, 0.38]) {
          p.push(part(new CylinderGeometry(0.03, 0.03, 0.55, 5).rotateZ(0.4), C.wood, sx, 0.26, 0))
          p.push(part(new CylinderGeometry(0.03, 0.03, 0.55, 5).rotateZ(-0.4), C.wood, sx, 0.26, 0))
        }
        for (let i = 0; i < 3; i++) {
          const x = -0.14 + i * 0.14
          p.push(part(new CylinderGeometry(0.024, 0.034, 1.1, 5).rotateZ(0.5), C.woodDark, x, 0.5, 0.04 * i))
          p.push(part(new TetrahedronGeometry(0.09, 0).scale(0.65, 1.5, 0.65).rotateZ(0.5), C.stoneLight, x - 0.27, 0.99, 0.04 * i))
        }
        return p
      }
      case 'ropes': {
        // Corderie : deux poteaux, trois cordes tendues, écheveaux.
        for (const sx of [-0.45, 0.45]) p.push(part(new CylinderGeometry(0.035, 0.045, 0.62, 5), C.wood, sx, 0.31, 0))
        for (let i = 0; i < 3; i++)
          p.push(part(new CylinderGeometry(0.014, 0.014, 0.9, 4).rotateZ(Math.PI / 2), C.hidePale, 0, 0.5 - i * 0.12, 0))
        p.push(part(new TorusGeometry(0.09, 0.03, 5, 8), C.hideLight, -0.3, 0.06, 0.22))
        p.push(part(new TorusGeometry(0.07, 0.025, 5, 8), C.hidePale, 0.25, 0.05, 0.2))
        return p
      }
      case 'jars': {
        // Trois jarres sur leur natte, avec un petit four d'argile : du
        // contexte — deux points orange seuls en pleine prairie ne lisaient rien.
        p.push(part(new BoxGeometry(1.05, 0.04, 0.85).rotateY(0.25), C.hidePale, 0, 0.02, 0))
        p.push(part(new SphereGeometry(0.24, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.6), C.soil, -0.34, 0.05, -0.22))
        p.push(part(new BoxGeometry(0.12, 0.1, 0.06), C.emberCore, -0.34, 0.08, 0.02))
        const jar = (s: number) => [
          part(new SphereGeometry(0.16 * s, 8, 6).scale(1, 1.15, 1), C.ochre, 0, 0.18 * s, 0),
          part(new CylinderGeometry(0.07 * s, 0.09 * s, 0.09 * s, 6), C.tileDark, 0, 0.36 * s, 0),
        ]
        place(p, jar(1), 0, 0.02, 0.02)
        place(p, jar(0.8), 0, 0.32, 0.16)
        const couche = [
          part(new SphereGeometry(0.13, 8, 6).scale(1, 1.15, 1).rotateZ(Math.PI / 2), C.ochre, 0, 0.13, 0),
        ]
        place(p, couche, 0.6, 0.22, -0.28)
        return p
      }
      case 'loom': {
        // Métier à tisser vertical : toile UNIE écru, fils de chaîne sombres,
        // navette — les rayures sont réservées à la voile, sinon trois ateliers
        // lisent comme des barrières de chantier interchangeables.
        for (const sx of [-0.32, 0.32]) p.push(part(new CylinderGeometry(0.03, 0.04, 0.78, 5), C.wood, sx, 0.39, 0))
        p.push(part(new CylinderGeometry(0.03, 0.03, 0.72, 5).rotateZ(Math.PI / 2), C.wood, 0, 0.76, 0))
        p.push(part(new CylinderGeometry(0.025, 0.025, 0.66, 5).rotateZ(Math.PI / 2), C.woodDark, 0, 0.14, 0.01))
        p.push(part(new BoxGeometry(0.56, 0.34, 0.02), C.plaster, 0, 0.56, 0.01))
        for (let i = 0; i < 6; i++)
          p.push(part(new BoxGeometry(0.02, 0.26, 0.025), C.woodDark, -0.25 + i * 0.1, 0.27, 0.01))
        // La navette va et vient (buildShuttle) : elle n'est plus ici.
        return p
      }
      case 'chopping': {
        // Billot, hache plantée, bûches fendues.
        p.push(part(new CylinderGeometry(0.22, 0.25, 0.34, 7), C.wood, 0, 0.17, 0))
        p.push(part(new CylinderGeometry(0.025, 0.03, 0.46, 5).rotateZ(0.7), C.woodDark, 0.16, 0.5, 0))
        p.push(part(new BoxGeometry(0.16, 0.09, 0.04), C.stoneLight, 0.32, 0.62, 0))
        for (let i = 0; i < 3; i++)
          p.push(part(new CylinderGeometry(0.07, 0.07, 0.4, 5).rotateX(Math.PI / 2).rotateY(i), C.hideLight, 0.3 - i * 0.3, 0.07, 0.3))
        return p
      }
      case 'orepile': {
        // Minerai de cuivre : blocs x2 et panier renversé — six dés de 7 cm
        // n'étaient qu'un pixel orange à distance de jeu.
        p.push(part(new CylinderGeometry(0.24, 0.18, 0.36, 7).rotateZ(1.3), C.hideDark, -0.42, 0.17, 0))
        p.push(part(new CylinderGeometry(0.19, 0.19, 0.05, 7).rotateZ(1.3), C.woodDark, -0.59, 0.21, 0))
        for (let i = 0; i < 7; i++)
          p.push(part(new DodecahedronGeometry(0.13, 0).rotateY(i * 1.7), i % 2 ? copper : PALETTE.rockDark, 0.05 + (i % 3) * 0.2, 0.1 + Math.floor(i / 3) * 0.17, (i % 2) * 0.2 - 0.06))
        p.push(part(new DodecahedronGeometry(0.11, 0), copper, -0.32, 0.14, 0.05))
        return p
      }
      case 'furnace': {
        // Four à bronze : dôme massif, cheminée, gueule ROUGEOYANTE émissive,
        // tas de lingots x2 — le dôme gris de 0.3 u était un caillou parmi les
        // cailloux.
        p.push(part(new SphereGeometry(0.42, 9, 7, 0, Math.PI * 2, 0, Math.PI * 0.55), tint(PALETTE.rockDark, 2, 0.05), 0, 0.13, 0))
        p.push(part(new CylinderGeometry(0.12, 0.17, 0.5, 6), PALETTE.rockDark, 0, 0.62, 0))
        p.push(part(new CylinderGeometry(0.15, 0.13, 0.07, 6), C.char, 0, 0.9, 0))
        p.push(part(new BoxGeometry(0.24, 0.22, 0.1), C.char, 0, 0.16, 0.36))
        p.push(part(new BoxGeometry(0.17, 0.15, 0.07), C.emberCore, 0, 0.13, 0.4))
        for (let i = 0; i < 6; i++)
          p.push(part(new BoxGeometry(0.2, 0.06, 0.11), gold, 0.52 + (i % 2) * 0.05, 0.04 + Math.floor(i / 2) * 0.068, -0.07 + (i % 2) * 0.15))
        return p
      }
      case 'cart': {
        // Charrette à bras : caisse, deux roues, brancards.
        p.push(part(new BoxGeometry(0.55, 0.16, 0.4), C.wood, 0, 0.3, 0))
        p.push(part(new BoxGeometry(0.55, 0.05, 0.44), C.woodDark, 0, 0.2, 0))
        for (const sz of [-0.24, 0.24]) p.push(part(new CylinderGeometry(0.16, 0.16, 0.05, 10).rotateX(Math.PI / 2), C.woodDark, 0, 0.16, sz))
        for (const sz of [-0.1, 0.1]) p.push(part(new CylinderGeometry(0.02, 0.02, 0.5, 5).rotateZ(1.35), C.wood, 0.45, 0.32, sz))
        p.push(part(new SphereGeometry(0.09, 6, 5), C.wheat, -0.1, 0.42, 0.05))
        p.push(part(new SphereGeometry(0.07, 6, 5), C.ochre, 0.08, 0.4, -0.08))
        // ×1.8 : à 0.42 u de haut elle arrivait au genou du colon — une vraie
        // charrette à bras (~1.8 m) lui arrive à l'épaule, roues comprises.
        for (const g of p) g.scale(1.8, 1.8, 1.8)
        return p
      }
      case 'tablets': {
        // Table basse et tablettes d'argile.
        p.push(part(new BoxGeometry(0.5, 0.06, 0.34), C.wood, 0, 0.2, 0))
        for (const sx of [-0.2, 0.2]) for (const sz of [-0.12, 0.12]) p.push(part(new BoxGeometry(0.05, 0.18, 0.05), C.woodDark, sx, 0.09, sz))
        for (let i = 0; i < 3; i++) p.push(part(new BoxGeometry(0.13, 0.02, 0.18).rotateY(i * 0.3 - 0.3), C.hidePale, -0.1 + i * 0.12, 0.24, 0))
        return p
      }
      case 'sailframe': {
        // Gréement d'essai : mât, vergue, voile BOMBÉE écru à une seule bande
        // ocre — la voile carrée rayée rouge/blanc lisait comme un panneau de
        // passage à niveau.
        p.push(part(new CylinderGeometry(0.045, 0.06, 1.2, 6), C.wood, 0, 0.6, 0))
        p.push(part(new ConeGeometry(0.07, 0.12, 5), C.woodDark, 0, 1.24, 0))
        p.push(part(new CylinderGeometry(0.03, 0.03, 1.0, 5).rotateZ(Math.PI / 2), C.woodDark, 0, 1.02, 0))
        const sail = new CylinderGeometry(0.44, 0.5, 0.72, 10, 1, true, 0, Math.PI)
          .rotateY(-Math.PI / 2)
          .scale(1, 1, 0.5)
        p.push(part(sail, C.plaster, 0, 0.6, -0.06))
        const band = new CylinderGeometry(0.455, 0.475, 0.16, 10, 1, true, 0, Math.PI)
          .rotateY(-Math.PI / 2)
          .scale(1.01, 1, 0.51)
        p.push(part(band, C.ochre, 0, 0.6, -0.06))
        // Deux jambes d'appui : le mât d'essai tient debout sur la grève.
        for (const s of [-1, 1])
          p.push(part(new CylinderGeometry(0.03, 0.04, 0.6, 5).rotateX(s * 0.5), C.wood, 0, 0.26, s * 0.24))
        return p
      }
      case 'forge': {
        // La forge n'est plus un objet posé dans l'herbe : c'est un ATELIER,
        // à l'échelle du colon (1,5 u). L'ancienne version tenait dans 34 cm
        // de large — une enclume de poupée, invisible dès qu'on dézoomait,
        // alors que la maîtrise du fer est LE basculement de l'âge.
        // Il est ouvert côté village (+z) : on doit voir travailler dedans.
        const rock = PALETTE.rockDark
        // Aire dallée et cendrée.
        p.push(part(new BoxGeometry(2.35, 0.12, 1.8), tint(C.stoneDark, 3, 0.05), 0, 0.06, 0))
        p.push(part(new BoxGeometry(1.85, 0.03, 1.25), C.ash, 0, 0.13, 0.12))
        // Mur du fond et joues, en moellons à rangs décalés.
        p.push(part(new BoxGeometry(2.3, 1.05, 0.24), tint(C.stone, 5, 0.06), 0, 0.62, -0.8))
        for (let i = 0; i < 3; i++)
          p.push(part(new BoxGeometry(2.34, 0.07, 0.28), tint(C.stoneLight, i * 7, 0.05), 0, 0.34 + i * 0.31, -0.8))
        for (const sx of [-1.05, 1.05])
          p.push(part(new BoxGeometry(0.24, 0.92, 1.65), tint(C.stone, 9, 0.06), sx, 0.58, -0.06))
        // Façade ouverte : deux poteaux et leur sablière.
        for (const sx of [-1.0, 1.0])
          p.push(part(new CylinderGeometry(0.09, 0.115, 1.36, 6), C.woodDark, sx, 0.68, 0.76))
        p.push(part(new BoxGeometry(2.28, 0.13, 0.17), C.wood, 0, 1.37, 0.76))
        gableRoof(p, 2.6, 1.05, 0.62, 1.44, 4)
        // Bas foyer : massif de pierre, gueule rougeoyante (les braises
        // elles-mêmes PULSENT dans leur propre mesh, voir buildEmbers), hotte
        // tronconique et conduit qui perce la toiture.
        p.push(part(new BoxGeometry(1.05, 0.64, 0.66), tint(rock, 2, 0.06), -0.5, 0.44, -0.44))
        p.push(part(new BoxGeometry(1.12, 0.11, 0.72), C.stoneLight, -0.5, 0.81, -0.44))
        p.push(part(new BoxGeometry(0.62, 0.28, 0.12), C.char, -0.5, 0.5, -0.1))
        p.push(part(new CylinderGeometry(0.32, 0.66, 0.52, 4).rotateY(Math.PI / 4), tint(C.stone, 7, 0.05), -0.5, 1.12, -0.44))
        p.push(part(new BoxGeometry(0.44, 1.25, 0.44), tint(C.stone, 11, 0.05), -0.5, 1.9, -0.44))
        p.push(part(new BoxGeometry(0.56, 0.11, 0.56), C.stoneLight, -0.5, 2.53, -0.44))
        // Soufflet : outre de cuir, buse et levier. C'est lui qui explique la
        // respiration des braises.
        p.push(part(new BoxGeometry(0.36, 0.28, 0.36), C.hideDark, -1.18, 0.62, -0.44))
        p.push(part(new ConeGeometry(0.19, 0.4, 4).rotateZ(-Math.PI / 2), C.hide, -0.9, 0.6, -0.44))
        p.push(part(new CylinderGeometry(0.045, 0.055, 0.62, 5).rotateZ(0.22), C.wood, -1.2, 0.92, -0.44))
        // Enclume sur billot, en pleine lumière côté village.
        p.push(part(new CylinderGeometry(0.25, 0.31, 0.52, 8), C.woodDark, 0.6, 0.32, 0.22))
        p.push(part(new BoxGeometry(0.2, 0.12, 0.17), iron, 0.6, 0.63, 0.22))
        p.push(part(new BoxGeometry(0.46, 0.13, 0.24), iron, 0.6, 0.75, 0.22))
        p.push(part(new ConeGeometry(0.1, 0.32, 6).rotateZ(Math.PI / 2), iron, 0.95, 0.77, 0.22))
        // Bac à tremper : une forge sans eau ne trempe rien.
        p.push(part(new CylinderGeometry(0.27, 0.23, 0.36, 8), C.wood, 1.05, 0.3, -0.32))
        p.push(part(new CylinderGeometry(0.235, 0.235, 0.03, 8), C.water, 1.05, 0.47, -0.32))
        p.push(part(new CylinderGeometry(0.275, 0.275, 0.04, 8), C.woodDark, 1.05, 0.44, -0.32))
        // Râtelier d'outils au mur : marteaux et tenailles pendus.
        for (let i = 0; i < 3; i++) {
          const hx = 0.12 + i * 0.24
          p.push(part(new CylinderGeometry(0.025, 0.025, 0.42, 4), C.wood, hx, 0.98, -0.66))
          p.push(part(new BoxGeometry(0.15, 0.09, 0.09), iron, hx, 1.21, -0.66))
        }
        // Barres de fer en attente, et le tas de charbon de bois.
        for (let i = 0; i < 4; i++)
          p.push(part(new BoxGeometry(0.055, 0.95, 0.055).rotateX(0.3), iron, 1.02 - i * 0.08, 0.52, -0.6))
        for (let i = 0; i < 7; i++)
          p.push(
            part(
              new DodecahedronGeometry(0.1, 0).rotateY(i * 1.3),
              tint(C.char, i * 4, 0.08),
              -1.28 + (i % 3) * 0.15,
              0.16,
              0.42 + Math.floor(i / 3) * 0.17,
            ),
          )
        return p
      }
      case 'lighthouse': {
        // La tour à feu : elle est posée sur la POINTE, pas au village — et
        // c'est le seul bâtiment dont la fonction est d'être vu du large. Sa
        // silhouette doit donc tenir contre le ciel : socle large, fût effilé,
        // galerie en encorbellement, brasier découvert au sommet.
        const band = tint(C.stoneLight, 4, 0.05)
        p.push(part(new CylinderGeometry(1.05, 1.3, 0.42, 8), tint(C.stoneDark, 3, 0.06), 0, 0.21, 0))
        p.push(part(new CylinderGeometry(0.88, 1.05, 0.3, 8), tint(C.stone, 6, 0.05), 0, 0.57, 0))
        // Fût en deux tronçons : c'est la bande claire qui fait lire un phare.
        p.push(part(new CylinderGeometry(0.64, 0.84, 2.0, 8), tint(C.stone, 9, 0.05), 0, 1.72, 0))
        p.push(part(new CylinderGeometry(0.6, 0.64, 0.22, 8), band, 0, 2.83, 0))
        p.push(part(new CylinderGeometry(0.5, 0.6, 1.5, 8), tint(C.stone, 13, 0.05), 0, 3.69, 0))
        // Escalier extérieur en encorbellement : quinze marches en spirale.
        for (let i = 0; i < 15; i++) {
          const a = i * 0.42
          const rr = 0.78 - i * 0.012
          p.push(
            part(
              new BoxGeometry(0.42, 0.07, 0.2).rotateY(-a),
              tint(C.stoneDark, i * 3, 0.06),
              Math.sin(a) * rr,
              0.78 + i * 0.23,
              Math.cos(a) * rr,
            ),
          )
        }
        // Galerie, garde-corps, et la vasque où brûle le feu.
        p.push(part(new CylinderGeometry(0.8, 0.56, 0.2, 8), tint(C.stoneDark, 5, 0.05), 0, 4.53, 0))
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2
          p.push(part(new CylinderGeometry(0.05, 0.05, 0.44, 4), C.char, Math.sin(a) * 0.68, 4.85, Math.cos(a) * 0.68))
        }
        p.push(part(new CylinderGeometry(0.74, 0.74, 0.05, 8), C.char, 0, 5.05, 0))
        p.push(part(new CylinderGeometry(0.36, 0.26, 0.32, 8), iron, 0, 4.85, 0))
        p.push(part(new CylinderGeometry(0.33, 0.33, 0.07, 8), C.emberCore, 0, 5.03, 0))
        p.push(part(new ConeGeometry(0.26, 0.5, 7), C.emberFlame, 0, 5.28, 0))
        // Un phare n'est pas un bâtiment de village : c'est un AMER. Il doit
        // dépasser la pinède (sapins ≈ 9,6 u) pour être vu du large, donc du
        // joueur. À l'échelle du village il faisait 3,5 colons — un pigeonnier.
        // Ici : ~12,7 u, soit huit colons et demi.
        return p.map((g) => g.scale(Village.BEACON_K, Village.BEACON_K, Village.BEACON_K))
      }
      case 'plough': {
        // Le LABOUR, pas l'outil posé. La bande de terre s'allonge : c'est le
        // champ que l'attelage traverse. L'araire et le bœuf, eux, se déplacent
        // — ils vivent dans buildPloughTeam.
        p.push(part(new BoxGeometry(3.2, 0.1, 1.1), C.soil, 0, 0.05, 0))
        // Sillons déjà tracés d'un côté, terre encore lisse de l'autre : on
        // voit ce que l'attelage a fait et ce qu'il lui reste à faire.
        for (let i = 0; i < 4; i++)
          p.push(part(new BoxGeometry(3.0, 0.07, 0.1), C.soilDark, 0, 0.11, -0.36 + i * 0.24))
        // Bornes de bout de champ.
        for (const bx of [-1.6, 1.6])
          p.push(part(new CylinderGeometry(0.04, 0.05, 0.34, 5), C.woodDark, bx, 0.17, -0.5))
        return p
      }
      case 'stele': {
        // Stèle gravée : grès chaud, gravures larges rehaussées d'ocre — le
        // gris-bleu froid à traits de 2 px lisait comme une pierre tombale.
        p.push(part(new BoxGeometry(0.4, 0.95, 0.16), tint(C.wall, 4, 0.05), 0, 0.48, 0))
        p.push(part(new BoxGeometry(0.5, 0.12, 0.24), C.hideDark, 0, 0.06, 0))
        for (let i = 0; i < 4; i++) p.push(part(new BoxGeometry(0.26, 0.05, 0.02), C.ochre, 0, 0.82 - i * 0.14, 0.085))
        p.push(part(new BoxGeometry(0.13, 0.13, 0.02), C.tileDark, 0, 0.28, 0.085))
        return p
      }
      case 'market': {
        // Étal de marchand : table, auvent rayé, pièces d'électrum.
        p.push(part(new BoxGeometry(0.6, 0.05, 0.36), C.wood, 0, 0.3, 0))
        for (const sx of [-0.25, 0.25]) for (const sz of [-0.13, 0.13]) p.push(part(new BoxGeometry(0.05, 0.3, 0.05), C.woodDark, sx, 0.15, sz))
        for (const sx of [-0.27, 0.27]) p.push(part(new CylinderGeometry(0.02, 0.02, 0.5, 4), C.wood, sx, 0.55, -0.14))
        // Auvent uni écru + liseré ocre : plus de rayures partagées avec la voile.
        for (let i = 0; i < 3; i++) p.push(part(new BoxGeometry(0.24, 0.02, 0.3).rotateX(-0.25), tint(C.plaster, i * 5, 0.04), -0.24 + i * 0.24, 0.82, -0.02))
        p.push(part(new BoxGeometry(0.74, 0.025, 0.06).rotateX(-0.25), C.ochre, 0, 0.785, 0.12))
        for (let i = 0; i < 5; i++) p.push(part(new CylinderGeometry(0.035, 0.035, 0.015, 8), gold, -0.15 + (i % 3) * 0.12, 0.34, -0.05 + Math.floor(i / 3) * 0.1))
        return p
      }
      case 'villa': {
        // Villa x2 avec péristyle : elle était plus petite que la ferme
        // néolithique et lisait comme une table à toit rouge.
        p.push(part(new BoxGeometry(2.0, 0.2, 1.55), C.stoneLight, 0, 0.1, 0))
        p.push(part(new BoxGeometry(1.7, 0.72, 1.15), C.plaster, 0, 0.56, -0.12))
        p.push(part(new BoxGeometry(0.36, 0.5, 0.06), C.woodDark, 0, 0.45, 0.46))
        for (let i = 0; i < 6; i++)
          p.push(part(new CylinderGeometry(0.06, 0.075, 0.74, 6), C.bone, -0.8 + i * 0.32, 0.57, 0.62))
        // Chapiteaux et bases : une colonne sans ni l'un ni l'autre est un
        // tuyau. Ce sont eux qui font lire « romain » à cette taille.
        for (let i = 0; i < 6; i++) {
          const cx = -0.8 + i * 0.32
          p.push(part(new BoxGeometry(0.16, 0.06, 0.16), C.bone, cx, 0.23, 0.62))
          p.push(part(new BoxGeometry(0.17, 0.07, 0.17), C.ridge, cx, 0.95, 0.62))
        }
        p.push(part(new BoxGeometry(1.82, 0.09, 0.34), C.plaster, 0, 0.98, 0.58))
        // Fronton : le triangle au-dessus du péristyle, avec son tympan clair.
        p.push(part(new CylinderGeometry(0.5, 0.5, 0.3, 3).rotateX(Math.PI / 2).rotateZ(Math.PI), C.ridge, 0, 1.16, 0.6))
        // Deux fenêtres sombres et un enduit qui s'écaille au bas du mur.
        for (const wx of [-0.55, 0.55]) {
          p.push(part(new BoxGeometry(0.22, 0.26, 0.05), C.glass, wx, 0.68, 0.44))
          p.push(part(new BoxGeometry(0.26, 0.05, 0.06), C.ridge, wx, 0.83, 0.45))
        }
        p.push(part(new BoxGeometry(1.72, 0.16, 1.17), tint(C.stoneLight, 5, 0.05), 0, 0.28, -0.12))
        // Vasque du jardin et deux cyprès taillés : la villa a une cour.
        p.push(part(new CylinderGeometry(0.17, 0.13, 0.12, 9), C.stoneLight, 0.72, 0.26, 0.5))
        p.push(part(new CylinderGeometry(0.12, 0.12, 0.03, 9), C.water, 0.72, 0.33, 0.5))
        for (const cx of [-0.86, 0.86])
          p.push(part(new ConeGeometry(0.13, 0.6, 6), new Color('#3f6f3c'), cx, 0.5, 0.9))
        gableRoof(p, 2.0, 0.85, 0.52, 1.02, 5)
        // ×2 : à 1.56 u de faîte, la villa restait sous la hutte paléolithique.
        // Une villa de ~5 m doit dominer le colon de deux fois sa taille.
        for (const g of p) g.scale(2, 2, 2)
        return p
      }
      case 'watermill': {
        // Roue à aubes SUR bassin bleu, goulotte alimentée : l'eau vient avec
        // elle — plantée en prairie sèche, la roue n'expliquait rien.
        p.push(part(new BoxGeometry(1.0, 0.12, 0.66), C.stoneDark, 0, 0.06, 0))
        p.push(part(new BoxGeometry(0.86, 0.06, 0.52), C.water, 0, 0.13, 0))
        // La roue ne vit plus ici : elle TOURNE, donc elle a son propre mesh
        // (buildMillWheel). Ne restent que le bassin, les montants et la
        // goulotte — tout ce qui est fixe.
        for (const sz of [-0.44, 0.44]) p.push(part(new CylinderGeometry(0.04, 0.05, 0.7, 5), C.wood, 0, 0.35, sz))
        p.push(part(new BoxGeometry(0.18, 0.06, 1.05).rotateX(0.22), C.woodDark, 0.26, 0.8, -0.1))
        p.push(part(new BoxGeometry(0.1, 0.035, 0.95).rotateX(0.22), C.water, 0.26, 0.85, -0.1))
        // La roue tourne : il faut que ça se VOIE. Éclaboussures au point de
        // chute, écume dans le bassin, mousse sur la pierre mouillée.
        for (let i = 0; i < 5; i++) {
          const a = i * 1.3
          p.push(part(new SphereGeometry(0.035, 5, 4), C.ridge, 0.06 + Math.sin(a) * 0.08, 0.2 + (i % 3) * 0.07, 0.3 + Math.cos(a) * 0.1))
        }
        p.push(part(new BoxGeometry(0.6, 0.02, 0.3), C.ridge, -0.1, 0.16, 0.02))
        p.push(part(new BoxGeometry(0.9, 0.05, 0.1), new Color('#5d7a48'), 0, 0.1, 0.3))
        // Le meunier a laissé ses sacs sur la berge.
        for (const [gx, gz] of [[-0.5, -0.3], [-0.36, -0.4]] as const)
          p.push(part(new SphereGeometry(0.08, 6, 5).scale(1, 0.85, 1), C.hideLight, gx, 0.1, gz))
        // ×2.5 : une roue à aubes réelle fait ~3.5 m — la roue de Ø 0.78 u
        // tournait sous la ceinture du colon.
        for (const g of p) g.scale(2.5, 2.5, 2.5)
        return p
      }
      case 'glassworks': {
        // Verre CLAIR translucide (légère émissive) et gueule de four
        // rougeoyante — C.glass ardoise faisait lire les pièces comme des
        // cailloux et le four ocre comme une citrouille.
        const blown = new Color(0.85, 1.2, 1.32)
        p.push(part(new SphereGeometry(0.3, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.6), tint(C.soil, 3, 0.05), 0, 0.09, 0))
        p.push(part(new CylinderGeometry(0.08, 0.11, 0.3, 6), C.soilDark, 0, 0.44, 0))
        p.push(part(new BoxGeometry(0.18, 0.15, 0.08), C.emberCore, 0, 0.14, 0.26))
        p.push(part(new CylinderGeometry(0.015, 0.015, 0.7, 4).rotateZ(1.2), C.stoneDark, 0.3, 0.22, 0.1))
        p.push(part(new SphereGeometry(0.11, 8, 6).scale(1, 1.25, 1), blown, 0.45, 0.13, -0.15))
        p.push(part(new SphereGeometry(0.085, 8, 6), blown, 0.62, 0.09, 0.08))
        return p
      }
      case 'datacenter': {
        // Centre de données : ce n'est pas un bureau, c'est une HALLE avec ses
        // groupes froids sur le toit — le refroidissement est le vrai sujet.
        p.push(part(new BoxGeometry(2.4, 0.16, 1.7), C.stoneDark, 0, 0.08, 0))
        p.push(part(new BoxGeometry(2.2, 1.0, 1.5), C.stoneLight, 0, 0.66, 0))
        p.push(part(new BoxGeometry(2.24, 0.1, 1.54), C.stone, 0, 1.2, 0))
        // Bandeau de LED : la salle veille jour et nuit.
        for (let i = 0; i < 5; i++)
          p.push(part(new BoxGeometry(0.22, 0.1, 0.04), C.emberCore, -0.88 + i * 0.44, 0.86, 0.76))
        // Quatre groupes froids et leurs gaines.
        for (const gx of [-0.62, 0.62])
          for (const gz of [-0.4, 0.4]) {
            p.push(part(new BoxGeometry(0.5, 0.26, 0.5), iron, gx, 1.36, gz))
            p.push(part(new CylinderGeometry(0.17, 0.17, 0.06, 10), C.stoneLight, gx, 1.52, gz))
          }
        p.push(part(new CylinderGeometry(0.1, 0.13, 0.9, 6), C.stoneDark, 1.24, 1.6, -0.62))
        return p
      }
      case 'battery': {
        // Stockage réseau : des conteneurs alignés, un transformateur, des
        // câbles. C'est la forme réelle d'une batterie de réseau.
        p.push(part(new BoxGeometry(2.5, 0.14, 1.5), C.stoneDark, 0, 0.07, 0))
        for (let i = 0; i < 3; i++) {
          const bz = -0.44 + i * 0.44
          p.push(part(new BoxGeometry(2.0, 0.52, 0.34), tint(new Color('#3f6f8f'), i * 9, 0.06), 0, 0.4, bz))
          p.push(part(new BoxGeometry(2.04, 0.06, 0.36), C.stoneLight, 0, 0.68, bz))
          p.push(part(new BoxGeometry(0.16, 0.1, 0.05), C.emberCore, 0.86, 0.44, bz + 0.19))
        }
        p.push(part(new BoxGeometry(0.5, 0.7, 0.5), iron, -1.45, 0.49, 0))
        for (const s2 of [-1, 1])
          p.push(part(new CylinderGeometry(0.03, 0.03, 0.7, 4).rotateZ(1.2), C.char, -1.15, 0.8, s2 * 0.18))
        return p
      }
      case 'desal': {
        // Usine de dessalement : les longs tubes d'osmose inverse, la prise
        // d'eau, et le bassin de rejet — la saumure fait partie de l'ouvrage.
        p.push(part(new BoxGeometry(2.3, 0.16, 1.5), C.stoneLight, 0, 0.08, 0))
        for (let i = 0; i < 4; i++)
          p.push(
            part(
              new CylinderGeometry(0.19, 0.19, 2.0, 10).rotateZ(Math.PI / 2),
              i % 2 === 0 ? C.stone : C.stoneDark,
              0,
              0.36 + Math.floor(i / 2) * 0.4,
              -0.22 + (i % 2) * 0.44,
            ),
          )
        p.push(part(new BoxGeometry(0.44, 0.9, 0.44), C.plaster, -1.3, 0.55, 0))
        p.push(part(new CylinderGeometry(0.5, 0.55, 0.3, 10), C.stoneDark, 1.35, 0.15, 0))
        p.push(part(new CylinderGeometry(0.44, 0.44, 0.05, 10), C.water, 1.35, 0.29, 0))
        return p
      }
      case 'genlab': {
        // Laboratoire : serres vitrées et paillasse — l'édition du génome se
        // voit au champ, pas dans une éprouvette.
        p.push(part(new BoxGeometry(2.2, 0.16, 1.6), C.stoneLight, 0, 0.08, 0))
        p.push(part(new BoxGeometry(1.3, 0.8, 1.4), C.plaster, -0.42, 0.56, 0))
        p.push(part(new BoxGeometry(1.34, 0.1, 1.44), C.stoneDark, -0.42, 1.0, 0))
        for (const wz of [-0.4, 0.4]) p.push(part(new BoxGeometry(0.26, 0.3, 0.05), C.glass, -0.42, 0.66, wz + 0.7 - 0.7))
        // La serre : arceaux et vitrage.
        for (let i = 0; i < 4; i++)
          p.push(
            part(
              new CylinderGeometry(0.035, 0.035, 1.2, 5).rotateZ(Math.PI / 2),
              C.stoneLight,
              0.75,
              0.62,
              -0.45 + i * 0.3,
            ),
          )
        p.push(part(new BoxGeometry(0.9, 0.5, 1.2), new Color(0.72, 1.05, 1.12), 0.75, 0.36, 0))
        for (let i = 0; i < 3; i++)
          p.push(part(new BoxGeometry(0.1, 0.22, 0.1), C.wheat, 0.5 + i * 0.24, 0.24, -0.2 + (i % 2) * 0.3))
        return p
      }
      case 'capture': {
        // Captage direct dans l'air : des batteries de ventilateurs debout,
        // et la conduite qui descend le CO₂ sous terre.
        p.push(part(new BoxGeometry(2.2, 0.16, 1.4), C.stoneDark, 0, 0.08, 0))
        for (let i = 0; i < 3; i++) {
          const bx = -0.72 + i * 0.72
          p.push(part(new BoxGeometry(0.62, 1.1, 0.6), tint(C.stone, i * 11, 0.06), bx, 0.7, 0))
          p.push(part(new CylinderGeometry(0.23, 0.23, 0.08, 12).rotateX(Math.PI / 2), C.char, bx, 0.85, 0.32))
          for (let b = 0; b < 4; b++)
            p.push(
              part(
                new BoxGeometry(0.4, 0.07, 0.03).rotateZ((b * Math.PI) / 4),
                C.stoneLight,
                bx,
                0.85,
                0.35,
              ),
            )
        }
        p.push(part(new CylinderGeometry(0.14, 0.14, 1.1, 8), iron, 1.15, 0.55, -0.42))
        p.push(part(new CylinderGeometry(0.2, 0.24, 0.2, 8), C.stoneDark, 1.15, 0.1, -0.42))
        return p
      }
      case 'quantum': {
        // Le lustre : un cryostat suspendu, ses étages de cuivre de plus en
        // plus froids en descendant. C'est la silhouette même de la machine.
        p.push(part(new CylinderGeometry(0.95, 1.05, 0.14, 12), C.stoneLight, 0, 0.07, 0))
        p.push(part(new CylinderGeometry(0.86, 0.86, 0.1, 12), C.stoneDark, 0, 1.86, 0))
        for (const s2 of [-1, 1])
          for (const s3 of [-1, 1])
            p.push(part(new CylinderGeometry(0.05, 0.05, 1.8, 6), iron, s2 * 0.62, 0.96, s3 * 0.62))
        // Cinq plateaux de cuivre, du plus large au plus étroit.
        for (let i = 0; i < 5; i++) {
          const r = 0.74 - i * 0.12
          p.push(part(new CylinderGeometry(r, r, 0.07, 12), copper, 0, 1.62 - i * 0.28, 0))
          if (i < 4)
            for (const a of [0.4, 2.5, 4.6])
              p.push(
                part(
                  new CylinderGeometry(0.018, 0.018, 0.28, 4),
                  C.char,
                  Math.sin(a) * (r - 0.1),
                  1.48 - i * 0.28,
                  Math.cos(a) * (r - 0.1),
                ),
              )
        }
        p.push(part(new CylinderGeometry(0.13, 0.1, 0.2, 10), C.glass, 0, 0.42, 0))
        return p
      }
      case 'milestone': {
        // Borne et dalles CHAUDES en tronçon courbe : le carrelage gris froid
        // au bord de la falaise ne lisait pas comme une voie romaine.
        p.push(part(new CylinderGeometry(0.14, 0.17, 0.7, 8), tint(C.wall, 6, 0.05), -0.55, 0.35, 0.1))
        for (let i = 0; i < 3; i++) p.push(part(new BoxGeometry(0.2, 0.026, 0.02), C.tileDark, -0.55, 0.52 - i * 0.11, 0.25))
        for (let i = 0; i < 7; i++) {
          const a = -0.55 + i * 0.22
          p.push(part(new BoxGeometry(0.36, 0.06, 0.42).rotateY(a * 0.7), tint(i % 2 ? C.hidePale : C.wall, i * 3, 0.07), -0.25 + i * 0.34, 0.03, Math.sin(a) * 0.45))
        }
        return p
      }
      case 'lectern': {
        // Lutrin et codex ouvert.
        p.push(part(new CylinderGeometry(0.05, 0.09, 0.5, 6), C.woodDark, 0, 0.25, 0))
        p.push(part(new BoxGeometry(0.4, 0.04, 0.3).rotateX(-0.4), C.wood, 0, 0.53, 0))
        p.push(part(new BoxGeometry(0.17, 0.025, 0.24).rotateX(-0.4).rotateZ(0.06), C.bone, -0.09, 0.58, 0.01))
        p.push(part(new BoxGeometry(0.17, 0.025, 0.24).rotateX(-0.4).rotateZ(-0.06), C.plaster, 0.09, 0.58, 0.01))
        return p
      }
      case 'collar': {
        // Harnais complet : joug cintré, collier OVALE face caméra, traits
        // pendants — le tore de profil lisait comme un pneu sur une clôture.
        for (const sx of [-0.3, 0.3]) p.push(part(new CylinderGeometry(0.04, 0.05, 0.78, 5), C.wood, sx, 0.39, 0))
        p.push(part(new CylinderGeometry(0.035, 0.035, 0.78, 5).rotateZ(Math.PI / 2), C.wood, 0, 0.75, 0))
        for (const s of [-1, 1]) p.push(part(new CylinderGeometry(0.03, 0.03, 0.3, 5).rotateZ(s * 0.5), C.woodDark, s * 0.12, 0.62, 0.02))
        p.push(part(new TorusGeometry(0.16, 0.055, 6, 10).scale(1, 1.25, 1), C.hideDark, 0, 0.38, 0.02))
        for (const sx of [-0.24, 0.24]) p.push(part(new BoxGeometry(0.035, 0.32, 0.02), C.hideLight, sx, 0.5, 0.03))
        return p
      }
      case 'threefield': {
        // Trois soles SURÉLEVÉES et bordées de bois : les bandes de 0.08 u se
        // noyaient dans l'herbe.
        const bands: [Color, number][] = [[PALETTE.grassDark, 0.1], [C.wheat, 0.26], [C.soil, 0.06]]
        bands.forEach(([col, h], i) => {
          const x = -0.5 + i * 0.5
          p.push(part(new BoxGeometry(0.44, 0.2, 1.15), C.soilDark, x, 0.1, 0))
          p.push(part(new BoxGeometry(0.38, h, 1.05), col, x, 0.2 + h / 2, 0))
          for (const sz of [-0.58, 0.58]) p.push(part(new BoxGeometry(0.46, 0.09, 0.06), C.woodDark, x, 0.2, sz))
          for (const sx of [-0.23, 0.23]) p.push(part(new BoxGeometry(0.06, 0.09, 1.2), C.woodDark, x + sx, 0.2, 0))
        })
        return p
      }
      case 'windmill': {
        // Moulin-pivot : tour tronconique, quatre ailes croisées.
        p.push(part(new CylinderGeometry(0.2, 0.3, 0.85, 8), C.plaster, 0, 0.42, 0))
        p.push(part(new ConeGeometry(0.24, 0.3, 8), C.tileDark, 0, 0.98, 0))
        // Les ailes ne sont PLUS ici : elles tournent, donc elles vivent dans
        // leur propre mesh (buildWindmillSails). Ne reste que l'arbre.

        p.push(part(new CylinderGeometry(0.03, 0.03, 0.14, 5).rotateX(Math.PI / 2), C.woodDark, 0, 0.78, 0.2))
        // Porte, fenêtre haute, et la queue de rotation qui oriente le moulin
        // au vent — c'est elle qui dit « moulin-pivot » plutôt que « tour ».
        p.push(part(new BoxGeometry(0.16, 0.3, 0.04), C.woodDark, 0, 0.19, -0.28))
        p.push(part(new BoxGeometry(0.1, 0.1, 0.04), C.glass, 0.18, 0.6, -0.16))
        p.push(part(new BoxGeometry(0.05, 0.05, 0.6).rotateX(0.42), C.wood, 0, 0.5, -0.4))
        p.push(part(new BoxGeometry(0.24, 0.04, 0.1), C.woodDark, 0, 0.28, -0.62))
        // Deux sacs de farine au pied, et la meule usée posée à plat.
        for (const [gx, gz] of [[0.3, 0.26], [0.42, 0.12]] as const)
          p.push(part(new SphereGeometry(0.09, 6, 5).scale(1, 0.85, 1), C.hideLight, gx, 0.08, gz))
        p.push(part(new CylinderGeometry(0.15, 0.15, 0.05, 10), C.stoneDark, -0.36, 0.03, 0.22))
        // ×5.5 (round 2) : à ×4 le chapeau restait à 4,5 u (3 colons), au
        // coude à coude avec le tipi du camp. Un moulin-pivot fait ~6 m au
        // chapeau : 6,2 u (~4,1 colons), le monument domine le bâti bas.
        for (const g of p) g.scale(5.5, 5.5, 5.5)
        return p
      }
      case 'clock': {
        // Campanile : tour, cadran crème, aiguilles, cloche.
        p.push(part(new BoxGeometry(0.34, 0.95, 0.34), C.stone, 0, 0.48, 0))
        p.push(part(new ConeGeometry(0.28, 0.26, 4).rotateY(Math.PI / 4), C.tileDark, 0, 1.08, 0))
        p.push(part(new CylinderGeometry(0.12, 0.12, 0.03, 12).rotateX(Math.PI / 2), C.bone, 0, 0.78, 0.18))
        // Les aiguilles ne sont plus ici non plus : elles tournent avec
        // l'heure du jeu (buildClockHands). Reste l'axe central.
        p.push(part(new CylinderGeometry(0.012, 0.012, 0.02, 6).rotateX(Math.PI / 2), C.char, 0, 0.78, 0.195))
        p.push(part(new SphereGeometry(0.05, 6, 5), gold, 0, 0.99, 0))
        // Le beffroi : la cloche doit se VOIR, donc une baie ouverte sous le
        // toit, et la cloche dedans. Une tour pleine ne sonne pas.
        p.push(part(new BoxGeometry(0.2, 0.22, 0.04), C.char, 0, 0.93, 0.16))
        p.push(part(new ConeGeometry(0.07, 0.12, 8), gold, 0, 0.92, 0.14))
        p.push(part(new BoxGeometry(0.22, 0.03, 0.03), C.woodDark, 0, 1.0, 0.14))
        // Cadran cerclé, chiffres aux quarts, et une corniche sous le toit.
        p.push(part(new CylinderGeometry(0.14, 0.14, 0.02, 12).rotateX(Math.PI / 2), C.stoneDark, 0, 0.78, 0.175))
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2
          p.push(part(new BoxGeometry(0.02, 0.02, 0.01), C.char, Math.sin(a) * 0.09, 0.78 + Math.cos(a) * 0.09, 0.2))
        }
        p.push(part(new BoxGeometry(0.42, 0.05, 0.42), C.ridge, 0, 0.96, 0))
        // Contreforts d'angle : une tour de pierre n'est jamais un simple pilier.
        for (const [bx, bz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]] as const)
          p.push(part(new BoxGeometry(0.1, 0.5, 0.1), tint(C.stone, bx * 90, 0.05), bx, 0.25, bz))
        // ×4.5 : un campanile de ~7 m. À 1.21 u la « tour » de l'horloge
        // arrivait au menton du colon.
        for (const g of p) g.scale(4.5, 4.5, 4.5)
        return p
      }
      case 'press': {
        // Presse de Gutenberg : bâti, vis, platine, feuilles.
        for (const sx of [-0.22, 0.22]) p.push(part(new BoxGeometry(0.08, 0.7, 0.08), C.woodDark, sx, 0.35, 0))
        p.push(part(new BoxGeometry(0.56, 0.08, 0.12), C.woodDark, 0, 0.68, 0))
        p.push(part(new CylinderGeometry(0.05, 0.05, 0.3, 6), C.stoneDark, 0, 0.5, 0))
        p.push(part(new BoxGeometry(0.3, 0.05, 0.2), C.wood, 0, 0.32, 0))
        p.push(part(new BoxGeometry(0.26, 0.02, 0.16), C.bone, 0, 0.24, 0))
        p.push(part(new CylinderGeometry(0.02, 0.02, 0.3, 5).rotateZ(Math.PI / 2), C.wood, 0.3, 0.5, 0))
        return p
      }
      case 'caravel': {
        // Maquette de caravelle sur ber, à quai.
        p.push(part(new BoxGeometry(0.7, 0.16, 0.26), C.woodDark, 0, 0.24, 0))
        p.push(part(new CylinderGeometry(0.02, 0.025, 0.5, 5), C.wood, 0.06, 0.55, 0))
        p.push(part(new BoxGeometry(0.28, 0.22, 0.015), C.plaster, 0.06, 0.6, 0))
        for (const sx of [-0.2, 0.2]) p.push(part(new BoxGeometry(0.05, 0.16, 0.05).rotateZ(sx > 0 ? -0.4 : 0.4), C.wood, sx, 0.1, 0))
        // ×1.6 : à 0.7 u entre les sapins, la Renaissance était muette.
        for (const g of p) g.scale(1.6, 1.6, 1.6)
        return p
      }
      case 'easel': {
        // Chevalet et toile en cours.
        for (const s of [-1, 1]) p.push(part(new CylinderGeometry(0.02, 0.025, 0.6, 5).rotateZ(s * 0.22), C.wood, s * 0.12, 0.3, 0))
        p.push(part(new CylinderGeometry(0.02, 0.02, 0.6, 5).rotateX(0.3), C.wood, 0, 0.28, -0.06))
        p.push(part(new BoxGeometry(0.34, 0.28, 0.02), C.plaster, 0, 0.42, 0.03))
        p.push(part(new BoxGeometry(0.12, 0.09, 0.025), C.tile, -0.04, 0.44, 0.035))
        p.push(part(new BoxGeometry(0.08, 0.06, 0.025), PALETTE.grassDark, 0.07, 0.38, 0.035))
        for (const g of p) g.scale(1.6, 1.6, 1.6)
        return p
      }
      case 'observatory': {
        // Lunette sur trépied, pointée vers le ciel.
        for (let i = 0; i < 3; i++) p.push(part(new CylinderGeometry(0.02, 0.025, 0.5, 5).rotateZ(0.35).rotateY((i / 3) * Math.PI * 2), C.woodDark, 0, 0.25, 0))
        p.push(part(new CylinderGeometry(0.05, 0.07, 0.55, 7).rotateZ(0.9), copper, 0.1, 0.58, 0))
        p.push(part(new CylinderGeometry(0.075, 0.075, 0.06, 7).rotateZ(0.9), gold, 0.32, 0.68, 0))
        for (const g of p) g.scale(1.6, 1.6, 1.6)
        return p
      }
      case 'bank': {
        // Comptoir : table, registre, coffre cerclé.
        p.push(part(new BoxGeometry(0.55, 0.06, 0.35), C.woodDark, 0, 0.3, 0))
        for (const sx of [-0.22, 0.22]) p.push(part(new BoxGeometry(0.06, 0.3, 0.06), C.wood, sx, 0.15, 0))
        p.push(part(new BoxGeometry(0.16, 0.03, 0.2), C.plaster, -0.1, 0.35, 0))
        p.push(part(new BoxGeometry(0.22, 0.16, 0.16), C.woodDark, 0.35, 0.08, 0.05))
        p.push(part(new BoxGeometry(0.24, 0.03, 0.18), iron, 0.35, 0.17, 0.05))
        for (let i = 0; i < 3; i++) p.push(part(new CylinderGeometry(0.028, 0.028, 0.012, 8), gold, 0.05 + i * 0.07, 0.34, 0.1))
        for (const g of p) g.scale(1.6, 1.6, 1.6)
        return p
      }
      case 'anatomy': {
        // Table d'étude : planche anatomique et fioles.
        p.push(part(new BoxGeometry(0.55, 0.05, 0.33), C.wood, 0, 0.3, 0))
        for (const sx of [-0.22, 0.22]) p.push(part(new BoxGeometry(0.05, 0.3, 0.05), C.woodDark, sx, 0.15, 0))
        p.push(part(new BoxGeometry(0.2, 0.28, 0.02), C.plaster, -0.1, 0.55, -0.1))
        p.push(part(new BoxGeometry(0.05, 0.16, 0.025), C.meat, -0.1, 0.55, -0.085))
        for (let i = 0; i < 2; i++) p.push(part(new SphereGeometry(0.045, 6, 5), new Color(0.85, 1.2, 1.32), 0.12 + i * 0.12, 0.36, 0.05))
        for (const g of p) g.scale(1.6, 1.6, 1.6)
        return p
      }
      case 'steamengine': {
        // Machine à vapeur ×1.5 avec PANACHE de fumée : sans lui, la révolution
        // industrielle ne changeait rien à la silhouette du village.
        p.push(part(new BoxGeometry(0.55, 0.14, 0.42), C.char, 0.02, 0.07, 0))
        p.push(part(new CylinderGeometry(0.22, 0.22, 0.72, 8).rotateZ(Math.PI / 2), iron, 0, 0.32, 0))
        p.push(part(new CylinderGeometry(0.07, 0.1, 0.5, 6), C.char, -0.22, 0.8, 0))
        // Volant d'inertie et bielle : ils TOURNENT (buildEngine).
        for (let i = 0; i < 3; i++)
          p.push(part(new SphereGeometry(0.09 + i * 0.05, 6, 5), C.smoke, -0.22 + i * 0.09, 1.1 + i * 0.24, 0.02 + i * 0.05))
        return p
      }
      case 'railway': {
        // Voie de 2.5 u sur ballast SOMBRE + wagonnet : un rail lisible de loin.
        p.push(part(new BoxGeometry(2.5, 0.07, 0.62), tint(C.char, 2, 0.08), 0, 0.035, 0))
        for (let i = 0; i < 9; i++) p.push(part(new BoxGeometry(0.14, 0.04, 0.5), C.woodDark, -1.08 + i * 0.27, 0.09, 0))
        for (const sz of [-0.17, 0.17]) p.push(part(new BoxGeometry(2.4, 0.05, 0.05), iron, 0, 0.13, sz))
        p.push(part(new BoxGeometry(0.42, 0.24, 0.34), C.tileDark, 0.2, 0.3, 0))
        for (const sx of [0.04, 0.36]) for (const sz of [-0.18, 0.18]) p.push(part(new CylinderGeometry(0.07, 0.07, 0.04, 8).rotateX(Math.PI / 2), C.char, sx, 0.15, sz))
        p.push(part(new DodecahedronGeometry(0.1, 0), C.char, 0.2, 0.48, 0))
        return p
      }
      case 'gaslamp': {
        // Réverbère à gaz : lanterne CARRÉE chaude sur fût vert — nettement
        // distinct du lampadaire électrique à potence et globe froid.
        p.push(part(new CylinderGeometry(0.035, 0.055, 0.85, 6), new Color('#3c4a42'), 0, 0.42, 0))
        p.push(part(new BoxGeometry(0.2, 0.03, 0.2), new Color('#3c4a42'), 0, 0.82, 0))
        p.push(part(new BoxGeometry(0.16, 0.18, 0.16), new Color(1.9, 1.25, 0.5), 0, 0.93, 0))
        p.push(part(new ConeGeometry(0.14, 0.1, 4).rotateY(Math.PI / 4), new Color('#3c4a42'), 0, 1.07, 0))
        return p
      }
      case 'bessemer': {
        // Convertisseur ×1.5, gueule et coulée émissives larges.
        p.push(part(new CylinderGeometry(0.24, 0.18, 0.55, 8).rotateZ(0.6), iron, 0, 0.55, 0))
        p.push(part(new CylinderGeometry(0.13, 0.16, 0.1, 8).rotateZ(0.6), C.emberCore, 0.25, 0.79, 0))
        p.push(part(new CylinderGeometry(0.07, 0.07, 0.45, 6).rotateX(Math.PI / 2), C.stoneDark, 0, 0.45, 0))
        for (const sz of [-0.26, 0.26]) p.push(part(new BoxGeometry(0.12, 0.55, 0.08), C.stoneDark, 0, 0.28, sz))
        p.push(part(new CylinderGeometry(0.05, 0.08, 0.5, 5).rotateZ(0.55), C.emberCore, 0.42, 0.38, 0))
        p.push(part(new BoxGeometry(0.36, 0.06, 0.24), C.emberCore, 0.58, 0.05, 0))
        return p
      }
      case 'telegraph': {
        // DEUX poteaux reliés par un fil en caténaire : une ligne qui part
        // quelque part — le fil qui plongeait au sol lisait « poteau cassé ».
        for (const sx of [-0.62, 0.62]) {
          p.push(part(new CylinderGeometry(0.035, 0.05, 0.98, 6), C.wood, sx, 0.49, 0))
          p.push(part(new BoxGeometry(0.32, 0.035, 0.035), C.woodDark, sx, 0.88, 0))
          for (const ox of [-0.12, 0.12]) p.push(part(new SphereGeometry(0.022, 5, 4), C.bone, sx + ox, 0.91, 0))
        }
        const pts = [[-0.5, 0.91], [-0.17, 0.8], [0.17, 0.8], [0.5, 0.91]] as const
        for (let i = 0; i < 3; i++) {
          const [x0, y0] = pts[i]!
          const [x1, y1] = pts[i + 1]!
          const len = Math.hypot(x1 - x0, y1 - y0)
          p.push(part(new CylinderGeometry(0.01, 0.01, len, 3).rotateZ(Math.PI / 2 + Math.atan2(y1 - y0, x1 - x0)), C.char, (x0 + x1) / 2, (y0 + y1) / 2, 0))
        }
        return p
      }
      case 'electric': {
        // Lampadaire électrique : haut fût acier, POTENCE arquée, globe froid —
        // l'inverse exact de la lanterne carrée chaude du gaz.
        p.push(part(new CylinderGeometry(0.03, 0.05, 1.25, 6), C.stoneDark, 0, 0.62, 0))
        p.push(part(new CylinderGeometry(0.025, 0.025, 0.34, 5).rotateZ(1.1), C.stoneDark, 0.14, 1.29, 0))
        p.push(part(new SphereGeometry(0.085, 8, 6), new Color(1.5, 1.9, 2.4), 0.3, 1.32, 0))
        return p
      }
      case 'garage': {
        // Ce n'est plus l'auto : c'est le GARAGE. La voiture, elle, ROULE sur
        // la route (buildCar / tickCar) — une automobile à l'arrêt devant son
        // garage ne raconte pas l'automobile.
        const tar = new Color('#4a4f56')
        p.push(part(new BoxGeometry(2.2, 0.12, 1.7), tar, 0, 0.06, 0))
        // Le box : trois murs, un toit plat, une porte relevée.
        p.push(part(new BoxGeometry(1.7, 1.0, 0.16), tint(C.plaster, 3, 0.05), 0, 0.62, -0.72))
        for (const sx of [-0.77, 0.77])
          p.push(part(new BoxGeometry(0.16, 1.0, 1.44), tint(C.plaster, 7, 0.05), sx, 0.62, 0))
        p.push(part(new BoxGeometry(1.9, 0.12, 1.7), tint(C.stoneDark, 5, 0.05), 0, 1.18, 0))
        p.push(part(new BoxGeometry(1.62, 0.1, 0.5), C.stoneLight, 0, 1.08, 0.6))
        // La pompe à essence : c'est elle qui dit « automobile » de loin.
        p.push(part(new BoxGeometry(0.34, 0.9, 0.3), new Color('#c0392b'), 1.34, 0.51, 0.5))
        p.push(part(new BoxGeometry(0.24, 0.22, 0.04), C.glass, 1.34, 0.78, 0.66))
        p.push(part(new CylinderGeometry(0.03, 0.03, 0.5, 5).rotateZ(0.5), C.char, 1.6, 0.5, 0.5))
        // Un bidon et deux pneus posés contre le mur.
        p.push(part(new CylinderGeometry(0.12, 0.12, 0.3, 8), tint(C.stoneDark, 11, 0.06), -1.0, 0.21, 0.55))
        for (const sz of [0.2, 0.44])
          p.push(part(new CylinderGeometry(0.16, 0.16, 0.09, 10).rotateX(Math.PI / 2), C.char, -0.55, 0.17, sz))
        return p
      }
      case 'radio': {
        // Mât haubané et poste à cadran.
        p.push(part(new CylinderGeometry(0.02, 0.03, 1.05, 5), iron, 0, 0.52, 0))
        for (const s of [-1, 1]) p.push(part(new CylinderGeometry(0.006, 0.006, 0.95, 3).rotateZ(s * 0.35), C.char, s * 0.17, 0.45, 0))
        p.push(part(new SphereGeometry(0.035, 6, 5), C.tile, 0, 1.06, 0))
        p.push(part(new BoxGeometry(0.24, 0.16, 0.1), C.woodDark, 0.3, 0.08, 0.1))
        p.push(part(new CylinderGeometry(0.03, 0.03, 0.015, 8).rotateX(Math.PI / 2), C.bone, 0.34, 0.1, 0.16))
        return p
      }
      case 'plane': {
        // Ce n'est plus l'avion : c'est l'AÉRODROME. L'appareil, lui, est un
        // mobile — il décolle et se pose (buildPlane / tickPlane). Un avion
        // posé sur cales pendant qu'on traverse le monde ne racontait rien.
        const tar = new Color('#4a4f56')
        p.push(part(new BoxGeometry(2.6, 0.12, 1.6), tar, 0, 0.06, 0))
        p.push(part(new BoxGeometry(2.64, 0.03, 0.16), C.plaster, 0, 0.13, 0))
        for (let i = 0; i < 4; i++)
          p.push(part(new BoxGeometry(0.22, 0.035, 0.05), C.plaster, -0.9 + i * 0.6, 0.14, 0.62))
        // Hangar en tôle, porte ouverte côté piste.
        p.push(part(new BoxGeometry(1.0, 0.62, 1.0), tint(C.stoneLight, 4, 0.05), -1.7, 0.43, -0.1))
        p.push(part(new CylinderGeometry(0.52, 0.52, 1.04, 8, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), tint(C.stone, 7, 0.05), -1.7, 0.74, -0.1))
        p.push(part(new BoxGeometry(0.06, 0.5, 0.7), C.char, -1.22, 0.37, -0.1))
        // Manche à air : c'est elle qui dit « terrain d'aviation » de loin.
        p.push(part(new CylinderGeometry(0.035, 0.035, 1.1, 5), C.stoneDark, 1.5, 0.67, 0.6))
        p.push(part(new CylinderGeometry(0.1, 0.17, 0.5, 7).rotateZ(-Math.PI / 2), new Color('#d9552f'), 1.72, 1.12, 0.6))
        p.push(part(new CylinderGeometry(0.17, 0.17, 0.16, 7).rotateZ(-Math.PI / 2), C.plaster, 1.55, 1.12, 0.6))
        return p
      }
      case 'clinic': {
        // Dispensaire : tente blanche à croix, caisse de fioles.
        p.push(part(new BoxGeometry(0.5, 0.3, 0.4), C.plaster, 0, 0.15, 0))
        p.push(part(new ConeGeometry(0.36, 0.2, 4).rotateY(Math.PI / 4), C.bone, 0, 0.4, 0))
        p.push(part(new BoxGeometry(0.14, 0.04, 0.02), C.tile, 0, 0.24, 0.21))
        p.push(part(new BoxGeometry(0.04, 0.14, 0.02), C.tile, 0, 0.24, 0.21))
        p.push(part(new BoxGeometry(0.2, 0.1, 0.14), C.wood, 0.35, 0.05, 0.1))
        for (let i = 0; i < 2; i++) p.push(part(new SphereGeometry(0.035, 6, 5), C.glass, 0.3 + i * 0.1, 0.13, 0.1))
        return p
      }
      case 'computer': {
        // Bureau, écran qui LUIT, clavier — ×1.7 pour l'âge final.
        p.push(part(new BoxGeometry(0.5, 0.05, 0.32), C.wood, 0, 0.28, 0))
        for (const sx of [-0.2, 0.2]) p.push(part(new BoxGeometry(0.05, 0.28, 0.05), C.woodDark, sx, 0.14, 0))
        p.push(part(new BoxGeometry(0.24, 0.2, 0.06), C.bone, -0.06, 0.42, -0.04))
        p.push(part(new BoxGeometry(0.19, 0.15, 0.015), new Color(1.9, 1.5, 0.55), -0.06, 0.42, -0.002))
        p.push(part(new BoxGeometry(0.2, 0.02, 0.09), C.stoneLight, 0.02, 0.32, 0.09))
        for (const g of p) g.scale(1.7, 1.7, 1.7)
        return p
      }
      case 'dish': {
        // Parabole ×1.8, coupole claire pointée vers le ciel.
        p.push(part(new CylinderGeometry(0.045, 0.07, 0.32, 6), C.stoneDark, 0, 0.16, 0))
        // La parabole elle-même tourne (buildDish) : ne reste que le pied.
        for (const g of p) g.scale(1.8, 1.8, 1.8)
        return p
      }
      case 'server': {
        // Baie de serveurs ×1.6 : bandeaux de diodes ÉMISSIFS, pas des points.
        p.push(part(new BoxGeometry(0.32, 0.64, 0.28), C.char, 0, 0.32, 0))
        for (let i = 0; i < 5; i++) {
          p.push(part(new BoxGeometry(0.28, 0.07, 0.02), C.stoneDark, 0, 0.1 + i * 0.12, 0.14))
          p.push(part(new BoxGeometry(0.2, 0.025, 0.015), i % 2 ? new Color(0.35, 1.9, 0.6) : new Color(0.4, 1.3, 2.0), -0.02, 0.1 + i * 0.12, 0.152))
        }
        for (const g of p) g.scale(1.6, 1.6, 1.6)
        return p
      }
      case 'solar': {
        // Panneaux BLEU lumineux dressés sur châssis, ×1.6 — C.glass quasi noir
        // à plat au ras du sol disparaissait dans l'herbe.
        // Les DALLES ne sont plus ici : elles pivotent pour suivre le soleil
        // (buildSolarPanels). Restent les mâts et le coffret.
        for (const sx of [-0.24, 0.26]) {
          p.push(part(new BoxGeometry(0.04, 0.3, 0.04), C.stoneDark, sx, 0.12, 0.12))
          p.push(part(new BoxGeometry(0.04, 0.16, 0.04), C.stoneDark, sx, 0.07, -0.12))
        }
        p.push(part(new BoxGeometry(0.14, 0.12, 0.09), C.stoneLight, 0, 0.06, 0.26))
        for (const g of p) g.scale(1.6, 1.6, 1.6)
        return p
      }
      case 'phone': {
        // Round 2 : le « smartphone-monolithe » de 0,77 u dépassait le mouton
        // voisin — un objet de main n'a rien à faire posé dans l'herbe. Le
        // repère d'époque devient une antenne relais qui ASSUME l'échelle
        // monument : dalle béton, armoire technique, mât effilé de 5,6 u
        // (~3,7 colons, fin donc sans écraser le cadrage), trois panneaux,
        // faisceau hertzien et balise rouge émissive.
        p.push(part(new BoxGeometry(0.95, 0.14, 0.95), C.stoneLight, 0, 0.07, 0))
        p.push(part(new BoxGeometry(0.4, 0.34, 0.28), C.stoneDark, 0.42, 0.31, 0.3))
        p.push(part(new BoxGeometry(0.36, 0.05, 0.3), C.char, 0.42, 0.5, 0.3))
        // Mât carré effilé (4 segments = treillis lu de loin, quasi gratuit).
        p.push(part(new CylinderGeometry(0.075, 0.2, 5.3, 4), iron, 0, 2.79, 0))
        // Colliers de renfort qui suivent le fruit du mât.
        p.push(part(new BoxGeometry(0.38, 0.05, 0.38), C.char, 0, 1.5, 0))
        p.push(part(new BoxGeometry(0.31, 0.05, 0.31), C.char, 0, 2.9, 0))
        p.push(part(new BoxGeometry(0.25, 0.05, 0.25), C.char, 0, 4.2, 0))
        // Trois panneaux sectoriels à 120° en tête de mât.
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + 0.5
          p.push(part(new BoxGeometry(0.07, 0.62, 0.2).rotateY(a), C.bone, Math.sin(a) * 0.26, 5.05, Math.cos(a) * 0.26))
        }
        // Tambour de faisceau hertzien.
        p.push(part(new CylinderGeometry(0.13, 0.13, 0.09, 8).rotateZ(Math.PI / 2), iron, 0.18, 4.5, 0))
        // Balise aérienne : le point rouge qui luit la nuit, comme les diodes
        // de la baie de serveurs.
        p.push(part(new SphereGeometry(0.07, 6, 5), new Color(2.4, 0.4, 0.35), 0, 5.52, 0))

        // Ce qui manquait : le TREILLIS. Un mât lisse à quatre pans lit comme
        // un poteau ; ce sont les croisillons entre colliers qui font
        // « pylône ». Quatre diagonales par étage, alternées d'un étage à
        // l'autre — la trame en zigzag d'un vrai treillis.
        const stages: [number, number, number][] = [
          [0.35, 1.5, 0.34],
          [1.5, 2.9, 0.28],
          [2.9, 4.2, 0.22],
        ]
        stages.forEach(([y0, y1, r], k) => {
          const h = y1 - y0
          const len = Math.hypot(h, r * 1.6)
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + (k % 2 ? 0.78 : 0)
            const lean = Math.atan2(r * 1.6, h) * (i % 2 ? 1 : -1)
            p.push(
              part(
                new BoxGeometry(0.035, len, 0.035).rotateZ(lean).rotateY(a),
                C.char,
                Math.sin(a) * r * 0.72,
                (y0 + y1) / 2,
                Math.cos(a) * r * 0.72,
              ),
            )
          }
        })
        // Chemin de câbles le long du mât, du coffret jusqu'aux panneaux :
        // une antenne sans descente d'alimentation ne dessert rien.
        p.push(part(new BoxGeometry(0.05, 4.3, 0.05), C.char, 0.13, 2.6, 0.13))
        p.push(part(new BoxGeometry(0.32, 0.05, 0.05).rotateY(0.8), C.char, 0.28, 0.52, 0.22))
        // Échelle d'accès sur la face avant, jusqu'au premier collier.
        for (let i = 0; i < 6; i++)
          p.push(part(new BoxGeometry(0.16, 0.025, 0.025), iron, 0, 0.4 + i * 0.2, 0.2 - i * 0.012))
        // Garde-corps de la plateforme d'intervention, sous les panneaux.
        p.push(part(new CylinderGeometry(0.3, 0.3, 0.03, 10), C.char, 0, 4.72, 0))
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2
          p.push(part(new BoxGeometry(0.025, 0.2, 0.025), iron, Math.sin(a) * 0.28, 4.82, Math.cos(a) * 0.28))
        }
        // Grillage et petit portail au pied : un pylône est toujours clôturé.
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + 0.78
          p.push(part(new BoxGeometry(0.9, 0.42, 0.03).rotateY(a), tint(C.stoneDark, i * 7, 0.05), Math.sin(a) * 0.62, 0.28, Math.cos(a) * 0.62))
        }
        return p
      }
      // Bâtiments hérités : générés en local puis fondus comme les ateliers.
      // grain() s'applique AVANT la pose, sur la géométrie fusionnée du seul
      // bâtiment — exactement ce que faisait leur ancien mesh dédié, pour que
      // le moucheté de matière reste identique au sommet près.
      case 'hut':
      case 'field':
      case 'granary':
      case 'aqueduct': {
        const parts =
          id === 'hut' ? hutParts() : id === 'field' ? fieldParts() : id === 'granary' ? granaryParts() : aqueductParts()
        const merged = mergeGeometries(parts) ?? new BufferGeometry()
        grain(merged)
        return [merged]
      }
      default:
        return null
    }
  }

  /** Reconstruit le mesh unique des ateliers ; transformations cuites dans la
   *  géométrie, un draw call pour tous les savoirs. */
  /** Les pièces qui BOUGENT ne peuvent pas vivre dans la géométrie fusionnée
   *  des bâtiments : elles ont besoin de leur propre transformation. Deux
   *  petits meshes autonomes, créés seulement si le bâtiment est posé. */
  private windmillSails: Mesh | null = null
  private millWheel: Mesh | null = null
  private solarPanels: Mesh[] = []
  private solarPivot: Group | null = null
  private dish: Mesh | null = null
  private engineWheel: Mesh | null = null
  private engineRod: Mesh | null = null
  private enginePivot: Group | null = null
  private shuttle: Mesh | null = null
  private shuttlePivot: Group | null = null
  private forgeEmbers: Mesh | null = null
  private forgePivot: Group | null = null
  private ploughTeam: Mesh | null = null
  private ploughPivot: Group | null = null
  private moverTime = 0
  private millPivot: Group | null = null
  private clockHands: { hour: Mesh; minute: Mesh } | null = null
  private windSpin = 0

  /** Appelé chaque frame par main.ts. `dayU` est la fraction de journée du
   *  jeu (0 = minuit), la même qui pilote le soleil : le cadran de la tour
   *  affiche donc l'heure qu'il est vraiment sur l'île. */
  tickMovers(dt: number, dayU: number): void {
    if (this.windmillSails) {
      // Un moulin tourne lentement et jamais tout à fait régulièrement.
      this.windSpin += dt * (0.55 + Math.sin(this.windSpin * 0.21) * 0.13)
      this.windmillSails.rotation.z = this.windSpin
    }
    // Les dalles solaires suivent le soleil : à l'aube elles regardent l'est,
    // au zénith le ciel, au couchant l'ouest. La nuit, elles se remettent à
    // plat — c'est ce que font les vrais trackers.
    for (const panel of this.solarPanels) {
      const day = Math.min(1, Math.max(0, Math.sin(dayU * Math.PI * 2)))
      const target = day > 0.02 ? (0.5 - dayU) * Math.PI * 1.2 : 0
      panel.rotation.x += (target - panel.rotation.x) * Math.min(1, dt * 0.8)
    }
    if (this.dish) this.dish.rotation.y += dt * 0.12
    this.moverTime += dt
    if (this.engineWheel && this.engineRod) {
      // Le volant tourne, la bielle coulisse en suivant sa manivelle : c'est
      // le décalage entre les deux qui fait lire un mécanisme.
      this.engineWheel.rotation.x += dt * 3.1
      this.engineRod.position.x = (0.22 + Math.cos(this.engineWheel.rotation.x) * 0.1) * 1.5
      this.engineRod.position.z = 0.12 * 1.5
    }
    if (this.shuttle) {
      // Va-et-vient net, avec un temps d'arrêt aux extrémités : une navette
      // est LANCÉE, elle ne glisse pas d'un bord à l'autre.
      const u = Math.sin(this.moverTime * 2.2)
      this.shuttle.position.x = Math.sign(u) * Math.pow(Math.abs(u), 0.55) * 0.24
    }
    if (this.ploughTeam) {
      // Un aller-retour lent, avec le demi-tour au bout du sillon : le champ
      // fait 3,2 unités, l'attelage en parcourt 2,4 utiles.
      const per = 26
      const u = (this.moverTime % per) / per
      const aller = u < 0.5
      const k = aller ? u * 2 : (1 - u) * 2
      this.ploughTeam.position.x = -1.2 + k * 2.4
      // Le demi-tour se fait en quelques dixièmes, aux extrémités.
      const turn = Math.min(1, Math.max(0, (Math.abs(k - 0.5) - 0.42) * 12))
      this.ploughTeam.rotation.y = aller ? turn * Math.PI : Math.PI - turn * Math.PI
      // Le pas du bœuf : un tangage court, pas une glissade.
      this.ploughTeam.position.y = Math.abs(Math.sin(this.moverTime * 3.4)) * 0.02
    }
    if (this.forgeEmbers) {
      // Le lit de braises respire : le soufflet le réveille par bouffées.
      const b = 0.75 + Math.sin(this.moverTime * 1.7) * 0.2 + Math.sin(this.moverTime * 5.3) * 0.05
      this.forgeEmbers.scale.set(1, b, 1)
      this.forgeEmbers.position.y = (b - 1) * 0.02
    }
    if (this.millWheel) {
      // Une roue à aubes tourne lentement et régulièrement : c'est l'eau qui
      // la mène, pas le vent.
      this.millWheel.rotation.x += dt * 0.9
    }
    if (this.clockHands) {
      // Cadran de douze heures : la petite aiguille fait deux tours par
      // journée de jeu, la grande vingt-quatre.
      this.clockHands.hour.rotation.z = -dayU * Math.PI * 4
      this.clockHands.minute.rotation.z = -dayU * Math.PI * 48
    }
  }

  private clearMovers(): void {
    for (const m of [this.windmillSails, this.clockHands?.hour, this.clockHands?.minute]) {
      if (!m) continue
      this.group.remove(m)
      m.geometry.dispose()
    }
    if (this.solarPivot) {
      this.group.remove(this.solarPivot)
      for (const m of this.solarPanels) m.geometry.dispose()
    }
    this.solarPanels = []
    this.solarPivot = null
    if (this.dish) {
      this.group.remove(this.dish)
      this.dish.geometry.dispose()
      this.dish = null
    }
    if (this.beaconHalo) {
      this.group.remove(this.beaconHalo)
      this.beaconHalo.material.map?.dispose()
      this.beaconHalo.material.dispose()
      this.beaconHalo = null
    }
    for (const g of [this.enginePivot, this.shuttlePivot, this.forgePivot, this.ploughPivot]) if (g) this.group.remove(g)
    this.ploughTeam?.geometry.dispose()
    this.ploughTeam = null
    this.ploughPivot = null
    for (const m of [this.engineWheel, this.engineRod, this.shuttle, this.forgeEmbers]) m?.geometry.dispose()
    this.engineWheel = this.engineRod = this.shuttle = this.forgeEmbers = null
    this.enginePivot = this.shuttlePivot = this.forgePivot = null
    if (this.millPivot) {
      this.group.remove(this.millPivot)
      this.millWheel?.geometry.dispose()
    }
    this.windmillSails = null
    this.millWheel = null
    this.millPivot = null
    this.clockHands = null
  }

  /** Les ailes du moulin, hors de la fusion : quatre bras entoilés montés sur
   *  un pivot, à l'échelle et à la place du moulin réellement posé. */
  private buildWindmillSails(pl: { x: number; y: number; z: number; rot: number }): void {
    const K = 5.5
    const p: BufferGeometry[] = []
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4
      p.push(part(new BoxGeometry(0.09, 0.5, 0.02).rotateZ(a), C.wood, Math.sin(a) * -0.28, Math.cos(a) * 0.28, 0))
      p.push(part(new BoxGeometry(0.055, 0.34, 0.012).rotateZ(a), C.hidePale, Math.sin(a) * -0.34, Math.cos(a) * 0.34, 0.005))
    }
    const geo = mergeGeometries(p.map((g) => g.scale(K, K, K)))
    if (!geo) return
    grain(geo)
    const mesh = new Mesh(geo, this.solid)
    mesh.castShadow = true
    // Le pivot des ailes, dans le repère du moulin : hauteur 0,78 et 0,26
    // vers l'avant, le tout à l'échelle ×5,5 puis tourné comme le bâtiment.
    const fx = Math.sin(pl.rot) * 0.26 * K
    const fz = Math.cos(pl.rot) * 0.26 * K
    mesh.position.set(pl.x + fx, pl.y + 0.78 * K, pl.z + fz)
    mesh.rotation.y = pl.rot
    this.windmillSails = mesh
    this.group.add(mesh)
  }

  /** Le bœuf et son araire : ils remontent le champ, font demi-tour au bout,
   *  et recommencent. Un outil posé dans l'herbe ne raconte pas le labour ;
   *  c'est le mouvement qui le fait. */
  private buildPloughTeam(pl: { x: number; y: number; z: number; rot: number }): void {
    const hide = new Color('#8a6a4c')
    const hideDark = new Color('#5d452f')
    const horn = new Color('#e8dfc8')
    const p: BufferGeometry[] = []
    // Le bœuf : masse basse, garrot marqué, tête lourde et cornes écartées.
    p.push(part(new CylinderGeometry(0.17, 0.17, 0.54, 9).rotateZ(Math.PI / 2).scale(1, 1.05, 0.92), hide, 0.45, 0.34, 0))
    p.push(part(new SphereGeometry(0.16, 8, 6).scale(1, 0.9, 0.95), hide, 0.28, 0.44, 0))
    p.push(part(new SphereGeometry(0.175, 8, 6).scale(0.9, 1, 0.95), hide, 0.66, 0.34, 0))
    p.push(part(new SphereGeometry(0.16, 8, 6).scale(0.9, 1, 0.95), hide, 0.22, 0.32, 0))
    p.push(part(new CylinderGeometry(0.1, 0.085, 0.2, 7).rotateZ(Math.PI / 2), hideDark, 0.78, 0.36, 0))
    p.push(part(new SphereGeometry(0.05, 5, 4), hideDark, 0.9, 0.33, 0))
    for (const sz of [-1, 1]) {
      p.push(part(new CylinderGeometry(0.018, 0.022, 0.16, 5).rotateZ(0.5).rotateX(sz * 0.5), horn, 0.8, 0.47, sz * 0.07))
      for (const sx of [0.22, 0.62])
        p.push(part(new CylinderGeometry(0.033, 0.04, 0.34, 5), hideDark, sx, 0.17, sz * 0.11))
    }
    p.push(part(new CylinderGeometry(0.018, 0.012, 0.26, 4), hideDark, 0.2, 0.24, 0))
    // Le joug et les traits, puis l'araire derrière.
    p.push(part(new BoxGeometry(0.07, 0.05, 0.3), C.wood, 0.68, 0.5, 0))
    p.push(part(new CylinderGeometry(0.025, 0.025, 0.75, 4).rotateZ(Math.PI / 2), C.wood, 0.3, 0.44, 0.12))
    p.push(part(new CylinderGeometry(0.025, 0.025, 0.75, 4).rotateZ(Math.PI / 2), C.wood, 0.3, 0.44, -0.12))
    p.push(part(new CylinderGeometry(0.045, 0.055, 0.9, 5).rotateZ(1.1), C.wood, -0.16, 0.3, 0))
    p.push(part(new CylinderGeometry(0.035, 0.04, 0.5, 5).rotateZ(0.35), C.woodDark, -0.5, 0.5, 0))
    p.push(part(new BoxGeometry(0.2, 0.09, 0.1).rotateZ(0.5), new Color('#6b7078'), -0.5, 0.11, 0))
    const geo = mergeGeometries(p)
    if (!geo) return
    grain(geo)
    const pivot = new Group()
    pivot.position.set(pl.x, pl.y, pl.z)
    pivot.rotation.y = pl.rot
    const mesh = new Mesh(geo, this.solid)
    mesh.castShadow = true
    pivot.add(mesh)
    this.ploughTeam = mesh
    this.ploughPivot = pivot
    this.group.add(pivot)
  }

  /** Volant d'inertie de la machine à vapeur, et sa bielle. Le volant tourne,
   *  la bielle suit — c'est le geste qui dit « moteur » plutôt que « caisse
   *  de métal ». */
  private buildEngine(pl: { x: number; y: number; z: number; rot: number }): void {
    const K = 1.5
    const wheel: BufferGeometry[] = [
      part(new TorusGeometry(0.22, 0.04, 6, 12).rotateY(Math.PI / 2), C.stoneDark, 0, 0, 0),
    ]
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2
      wheel.push(part(new BoxGeometry(0.03, 0.42, 0.03).rotateX(a), C.stoneDark, 0, 0, 0))
    }
    const gw = mergeGeometries(wheel.map((g) => g.scale(K, K, K)))
    const rodGeo = mergeGeometries([part(new BoxGeometry(0.4, 0.05, 0.05), C.stoneLight, 0, 0, 0).scale(K, K, K)])
    if (!gw || !rodGeo) return
    grain(gw)
    grain(rodGeo)
    const pivot = new Group()
    pivot.position.set(pl.x, pl.y + 0.38 * K, pl.z)
    pivot.rotation.y = pl.rot
    const w = new Mesh(gw, this.solid)
    w.position.set(0.5 * K, 0, 0)
    const rod = new Mesh(rodGeo, this.solid)
    pivot.add(w, rod)
    this.engineWheel = w
    this.engineRod = rod
    this.enginePivot = pivot
    this.group.add(pivot)
  }

  /** La navette du métier à tisser : elle traverse la toile et revient. */
  private buildShuttle(pl: { x: number; y: number; z: number; rot: number }): void {
    const geo = mergeGeometries([part(new BoxGeometry(0.16, 0.045, 0.06), C.ochre, 0, 0, 0)])
    if (!geo) return
    grain(geo)
    const pivot = new Group()
    pivot.position.set(pl.x, pl.y + 0.4, pl.z)
    pivot.rotation.y = pl.rot
    const mesh = new Mesh(geo, this.solid)
    mesh.position.set(0, 0, 0.04)
    pivot.add(mesh)
    this.shuttle = mesh
    this.shuttlePivot = pivot
    this.group.add(pivot)
  }

  /** La lueur du phare. Un halo additif, comme celui du foyer : sans lui, la
   *  tour n'est qu'un tuyau de pierre. Il respire lentement — un brasier
   *  entretenu ne vacille pas comme une flamme de camp — et reste allumé de
   *  jour : c'est la SIGNATURE de l'ouvrage, pas un éclairage. */
  private buildBeacon(pl: { x: number; y: number; z: number; rot: number }): void {
    const s = new Sprite(
      new SpriteMaterial({
        map: haloTexture(new Color('#ffd08a'), new Color('#c2560f'), 2),
        blending: AdditiveBlending,
        depthWrite: false,
        transparent: true,
        fog: false,
      }),
    )
    s.scale.set(Village.BEACON_HALO, Village.BEACON_HALO, 1)
    s.position.set(pl.x, pl.y + 5.15 * Village.BEACON_K, pl.z)
    this.group.add(s)
    this.beaconHalo = s
  }

  /** L'ÉCLAIRAGE PUBLIC. Avec l'électricité, ce n'est pas seulement le foyer
   *  qui devient lampadaire : c'est TOUT LE VILLAGE qui s'allume. Des
   *  réverbères jalonnent les rues (fondus dans le mesh des ateliers, zéro
   *  appel de plus) et chaque bâtiment reçoit sa flaque de lumière. Les
   *  lueurs, elles, vivent dans un mesh additif dont l'opacité suit la nuit. */
  private lampGlow: Mesh | null = null
  /** Le pied de chaque réverbère : l'avion, qui roule hors des rues, doit les
   *  éviter (le mât monte à 3 u, la potence déborde de 0,54 u en +x). */
  private lampPosts: readonly { x: number; y: number; z: number }[] = []
  /** Autour de l'aérodrome, dans ce rayon, ni réverbère ni roulage gêné. */
  private static readonly FIELD_CLEAR = 7

  private streetLights(all: BufferGeometry[]): void {
    if (this.lampGlow) {
      this.group.remove(this.lampGlow)
      this.lampGlow.geometry.dispose()
      this.lampGlow = null
    }
    this.buildLanes()
    const iron = new Color('#3f454e')
    const glow: BufferGeometry[] = []
    const warm = new Color('#ffdba0')
    const pool = new Color('#e8a94e')
    const posts: { x: number; y: number; z: number }[] = []
    const field = this.propPlacements.find((q) => q.id === 'plane')
    for (const lane of this.lanes!) {
      // Un réverbère tous les cinq pas, alternativement d'un côté et de
      // l'autre : une rue éclairée n'a pas ses lampes en vis-à-vis.
      for (let i = 3; i < lane.pts.length; i += 5) {
        const a = lane.pts[i]!
        const b = lane.pts[Math.min(i + 1, lane.pts.length - 1)]!
        const dx = b.x - a.x
        const dz = b.z - a.z
        const len = Math.hypot(dx, dz) || 1
        const side = (i / 5) % 2 === 0 ? 1 : -1
        const x = a.x + (dz / len) * side * 1.75
        const z = a.z - (dx / len) * side * 1.75
        if (!this.island.isLand(x, z)) continue
        // Pas de réverbère sur l'aire de l'aérodrome : l'avion y roule.
        if (field && Math.hypot(x - field.x, z - field.z) < Village.FIELD_CLEAR) continue
        posts.push({ x, y: GROUND_Y, z })
      }
    }
    this.lampPosts = posts
    for (const q of posts) {
      all.push(part(new CylinderGeometry(0.11, 0.15, 0.16, 8), C.stoneDark, q.x, q.y + 0.08, q.z))
      all.push(part(new CylinderGeometry(0.05, 0.075, 2.9, 7), iron, q.x, q.y + 1.5, q.z))
      all.push(
        part(new CylinderGeometry(0.035, 0.035, 0.6, 5).rotateZ(Math.PI / 2), iron, q.x + 0.28, q.y + 2.94, q.z),
      )
      all.push(part(new ConeGeometry(0.26, 0.2, 9), iron, q.x + 0.54, q.y + 2.9, q.z))
      all.push(part(new SphereGeometry(0.11, 7, 5), C.emberFlame, q.x + 0.54, q.y + 2.76, q.z))
      // La flaque au sol et le halo debout, incliné vers l'œil : c'est le halo
      // qui fait qu'une lampe ÉCLAIRE au lieu de seulement briller.
      glow.push(glowDisc(2.4, pool, 0.42, 16).translate(q.x + 0.5, q.y + 0.03, q.z))
      glow.push(
        glowDisc(0.8, warm, 0.8, 12)
          .rotateX(Math.PI / 2 - 0.5)
          .rotateY(CAMERA_YAW)
          .translate(q.x + 0.54, q.y + 2.76, q.z),
      )
    }
    // Chaque bâtiment veille aussi : une flaque discrète à son pied, comme
    // autant de fenêtres allumées.
    for (const pl of this.propPlacements)
      glow.push(glowDisc(1.5, pool, 0.3, 12).translate(pl.x, pl.y + 0.04, pl.z))
    const geo = mergeGeometries(glow)
    if (!geo) return
    const mesh = new Mesh(
      geo,
      new MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        fog: false,
        opacity: 0,
      }),
    )
    mesh.renderOrder = 2
    this.lampGlow = mesh
    this.group.add(mesh)
  }

  /** L'AUTOMOBILE. Hors de la fusion, parce qu'elle ROULE : elle parcourt la
   *  route du village d'un bout à l'autre, marque un temps d'arrêt au ponton
   *  et au foyer, et repart. C'est la route qui lui donne son sens. */
  private buildCar(pl: { x: number; y: number; z: number; rot: number }): void {
    const p: BufferGeometry[] = []
    const body = C.tile
    p.push(part(new BoxGeometry(1.15, 0.22, 0.52), body, 0, 0.26, 0))
    p.push(part(new BoxGeometry(0.55, 0.22, 0.46), C.tileDark, -0.1, 0.47, 0))
    p.push(part(new BoxGeometry(0.44, 0.14, 0.48), new Color(0.75, 0.95, 1.1), -0.1, 0.44, 0))
    for (const sx of [-0.38, 0.38])
      for (const sz of [-0.28, 0.28])
        p.push(part(new CylinderGeometry(0.11, 0.11, 0.07, 8).rotateX(Math.PI / 2), C.char, sx, 0.13, sz))
    for (const sz of [-0.17, 0.17])
      p.push(part(new SphereGeometry(0.04, 5, 4), new Color(1.7, 1.55, 1.0), 0.58, 0.28, sz))
    for (const sz of [-0.17, 0.17])
      p.push(part(new BoxGeometry(0.04, 0.06, 0.1), new Color('#a8302a'), -0.58, 0.3, sz))
    p.push(part(new BoxGeometry(0.04, 0.1, 0.4), C.stoneDark, 0.58, 0.22, 0))
    p.push(part(new BoxGeometry(0.04, 0.08, 0.42), C.stoneDark, -0.58, 0.2, 0))
    for (const sx of [-0.38, 0.38])
      for (const sz of [-0.29, 0.29])
        p.push(part(new CylinderGeometry(0.05, 0.05, 0.03, 8).rotateX(Math.PI / 2), C.ridge, sx, 0.13, sz))
    for (const sz of [-0.24, 0.24])
      p.push(part(new BoxGeometry(0.4, 0.1, 0.02), new Color(0.75, 0.95, 1.1), -0.1, 0.46, sz))
    p.push(part(new BoxGeometry(0.05, 0.04, 0.04), C.tileDark, 0.14, 0.46, 0.26))
    const geo = mergeGeometries(p.map((g) => g.scale(2, 2, 2)))
    if (!geo) return
    grain(geo, 0.05)
    const mesh = new Mesh(geo, this.solid)
    mesh.castShadow = true
    // Taille réelle (une Ford T) : sur le mesh, pour que primitive et modèle
    // grandissent pareil ; les roues restent au ras de la route.
    const k = VEHICLE_SCALE.car
    mesh.scale.setScalar(k)
    mesh.position.y = Village.CAR_BASE * (1 - k)
    const pivot = new Group()
    pivot.add(mesh)
    this.car = pivot
    this.carHome = { x: pl.x, y: pl.y, z: pl.z }
    this.carSpan = null
    this.carPark = null
    this.carFitted = false
    this.group.add(pivot)
    this.vehicleModel(mesh, 'car', 0.05)
  }

  /** Où l'on embarque : le quai de la gare, et l'aire de l'aérodrome. Le
   *  colon s'y rend à pied avant que le véhicule ne parte. */
  get stationPoint(): { x: number; z: number } | null {
    return this.stationAt
  }

  get airfieldPoint(): { x: number; z: number } | null {
    return this.planeAt ? { x: this.planeAt.x, z: this.planeAt.z } : null
  }

  private stationAt: { x: number; z: number } | null = null

  private car: Group | null = null
  private carHome: { x: number; y: number; z: number } | null = null
  /** Le dessous des roues, dans le repère du mesh de l'auto (primitive ×2 et
   *  modèle recalé, voir vehicles.ts). */
  private static readonly CAR_BASE = 0.04
  /** Demi-longueur et demi-largeur de l'auto à taille réelle, en monde. */
  static readonly CAR_HALF = { l: 1.24 * VEHICLE_SCALE.car, w: 0.643 * VEHICLE_SCALE.car }
  /** Ce que l'auto laisse entre sa carrosserie et le premier plein, en plus
   *  de ce que le cadastre garde déjà (il sous-estime toujours, de 0,17 u). */
  static readonly CAR_MARGIN = 0
  /** La portion de route que l'auto parcourt, en abscisses : la plus longue
   *  où sa caisse entière passe. La route part du foyer et finit au ponton ;
   *  à taille réelle, l'auto entrait dans le feu, mordait la Merveille et les
   *  réverbères. Null tant que le cadastre ne l'a pas mesurée. */
  carSpan: { from: number; to: number } | null = null
  /** Sans portion de route où elle passe (un atelier posé sur la chaussée) :
   *  la place libre la plus proche du garage, où elle reste garée. */
  carPark: { x: number; z: number; yaw: number } | null = null
  /** Mesurée au moins une fois : sans portion ni place, l'auto ne se montre
   *  pas, plutôt que de traverser l'atelier posé sur la chaussée. */
  private carFitted = false
  /** En deçà, la portion de route ne vaut pas un aller-retour : elle se gare. */
  static readonly CAR_MIN_RUN = 3

  /** Mesure, sur le cadastre, où l'auto passe et où l'avion se gare :
   *  `clear` donne la distance au plein le plus proche (Ground.clearAt),
   *  `sources` les autres poseurs d'emprises du cadastre (la faune).
   *  Appelé à chaque refonte du cadastre — une pose peut fermer un bout de
   *  route. */
  fitMovers(clear: (x: number, z: number) => number, sources: readonly GroundSource[] = []): void {
    // L'avion lit aussi les emprises des autres poseurs (l'enclos de la faune).
    this.planeSources = sources
    this.fitPlane()
    if (!this.car) return
    const pts = this.roadPath
    const cum = this.roadCum
    const total = cum[cum.length - 1] ?? 0
    this.carSpan = null
    this.carPark = null
    this.carFitted = true
    const { l, w } = Village.CAR_HALF
    const need = w + Village.CAR_MARGIN
    /** La caisse posée en (x, z), capot vers `yaw` : la place qui lui reste. */
    const fitsAt = (x: number, z: number, dx: number, dz: number): number => {
      let m = Infinity
      for (let u = -l; u <= l + 1e-6; u += 0.25) m = Math.min(m, clear(x + dx * u, z + dz * u))
      return m
    }
    const park = (): void => {
      const home = this.carHome
      if (!home) return
      // Au plus près du garage d'abord, huit caps à chaque point.
      for (let r = 0; r <= 10; r += 0.5)
        for (let a = 0; a < 32; a++) {
          const x = home.x + Math.sin((a / 32) * Math.PI * 2) * r
          const z = home.z + Math.cos((a / 32) * Math.PI * 2) * r
          for (let h = 0; h < 8; h++) {
            const yaw = (h / 8) * Math.PI
            if (fitsAt(x, z, Math.sin(yaw), Math.cos(yaw)) >= need) {
              this.carPark = { x, z, yaw }
              return
            }
          }
          if (r === 0) break
        }
    }
    if (pts.length < 2 || total < 2) return park()
    // Rochers et buissons s'écartent de la chaussée, comme les sapins de la
    // route : l'auto roulait sur un rocher posé à 0,5 u de l'axe. Le cadastre
    // ne le sait qu'à sa refonte : la révision la demande, et l'auto est
    // recalée à l'image suivante.
    const lane = w + Village.CAR_MARGIN + 0.1
    if (this.island.clearUnder((x, z, r) => this.roadDistance(x, z) < r + lane) > 0) this.revision++
    let best: { from: number; to: number } | null = null
    let run: number | null = null
    const STEP = 0.25
    for (let d = 0; d <= total + 1e-6; d += STEP) {
      const q = this.roadAt(d)
      if (fitsAt(q.x, q.z, q.dx, q.dz) >= need) {
        if (run === null) run = d
        if (!best || d - run > best.to - best.from) best = { from: run, to: d }
      } else run = null
    }
    if (best && best.to - best.from >= Village.CAR_MIN_RUN) this.carSpan = best
    else park()
  }

  /** Distance en plan à l'axe de la route. */
  private roadDistance(x: number, z: number): number {
    const pts = this.roadPath
    let best = Infinity
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!
      const b = pts[i]!
      const dx = b.x - a.x
      const dz = b.z - a.z
      const L = dx * dx + dz * dz
      const u = L < 1e-12 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L))
      best = Math.min(best, Math.hypot(x - a.x - u * dx, z - a.z - u * dz))
    }
    return best
  }

  /** Le point de la route à l'abscisse d, et la direction du tronçon. */
  private roadAt(d: number): { x: number; z: number; dx: number; dz: number } {
    const pts = this.roadPath
    const cum = this.roadCum
    let i = 1
    while (i < cum.length - 1 && cum[i]! < d) i++
    const a = pts[i - 1]!
    const b = pts[i]!
    const segLen = Math.max(1e-3, cum[i]! - cum[i - 1]!)
    const t = Math.min(1, Math.max(0, (d - cum[i - 1]!) / segLen))
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dx: (b.x - a.x) / segLen, dz: (b.z - a.z) / segLen }
  }

  /** Le va-et-vient de l'auto sur la route du village, entre les deux bouts
   *  de `carSpan`, cinq secondes d'arrêt à chaque bout. Sans portion où elle
   *  passe, elle reste garée (`carPark`). Au passage à niveau, elle attend
   *  avant la barrière tant que la rame occupe la traversée (la rame, elle,
   *  ne s'arrête qu'en gare). */
  private tickCar(dt: number): void {
    const pivot = this.car
    if (!pivot) return
    const total = this.roadCum[this.roadCum.length - 1] ?? 0
    const park = this.carPark
    if (this.carFitted && !this.carSpan) {
      pivot.visible = park !== null
      if (!park) return
      pivot.position.set(park.x, GROUND_Y + 0.1, park.z)
      pivot.rotation.y = headingYaw(Math.sin(park.yaw), Math.cos(park.yaw))
      return
    }
    pivot.visible = true
    if (this.roadPath.length < 2 || total < 2) {
      if (this.carHome) pivot.position.set(this.carHome.x, this.carHome.y, this.carHome.z)
      return
    }
    // Avant la première mesure du cadastre : toute la route, comme avant.
    const span = this.carSpan ?? { from: 0, to: total }
    if (this.carD < span.from || this.carD > span.to) this.carD = Math.min(span.to, Math.max(span.from, this.carD))
    if (this.carWait > 0) {
      this.carWait -= dt
    } else {
      let next = this.carD + this.carDir * Village.CAR_SPEED * dt
      const c = this.crossing
      const zone = c && this.train ? this.crossZone() : null
      if (zone) {
        const { lo, hi } = zone
        const inside = this.carD > lo && this.carD < hi
        // La rame est annoncée : sa présence à 8 u de l'arc de voie que borde
        // la zone ferme la barrière (le temps pour l'auto déjà engagée de
        // dégager).
        const mid = (zone.s0 + zone.s1) / 2
        if (!inside && this.trainCovers(mid, Village.CROSSING_WARN + (zone.s1 - zone.s0) / 2)) {
          if (this.carDir > 0 && this.carD <= lo && next > lo) next = lo
          if (this.carDir < 0 && this.carD >= hi && next < hi) next = hi
        }
      }
      if (next >= span.to) {
        next = span.to
        this.carDir = -1
        this.carWait = 5
      } else if (next <= span.from) {
        next = span.from
        this.carDir = 1
        this.carWait = 5
      }
      this.carD = next
    }
    const { x, z, dx, dz } = this.roadAt(this.carD)
    pivot.position.set(x, GROUND_Y + 0.1, z)
    // Le capot (+X local) dans le sens de la marche : au retour, le trajet
    // s'inverse, le cap aussi — voir headingYaw. À l'arrêt au bout, il garde
    // le cap de l'arrivée jusqu'au départ.
    const s = this.carWait > 0 ? -this.carDir : this.carDir
    pivot.rotation.y = headingYaw(dx * s, dz * s)
  }

  /** La zone de la traversée, mesurée sur la géométrie et non le long de la
   *  route : les abscisses de route [lo, hi] où l'emprise de l'auto entre dans
   *  le gabarit de la rame (0,72 u de part et d'autre de l'axe, plus 0,3 de
   *  jour), et l'arc de voie [s0, s1] qui la borde. Une route qui longe la
   *  voie après la traversée (graine 31337, douze parcelles : l'auto attendait
   *  à 2,3 u de la traversée sur la route, mais à 0,5 u de l'axe) allonge la
   *  zone d'autant. Refaite quand l'auto change de taille. */
  private crossZone(): { lo: number; hi: number; s0: number; s1: number } | null {
    const c = this.crossing
    const pts = this.roadPath
    if (!c || pts.length < 2) return null
    const { half, width } = this.carSize()
    const key = `${half.toFixed(3)},${width.toFixed(3)}`
    if (this.zoneKey === key) return this.zone
    const track = this.beltTrack
    const L = this.beltLength
    const total = this.roadCum[this.roadCum.length - 1]!
    const clear = 0.72 + 0.3
    let lo = c.sRoad
    let hi = c.sRoad
    let s0 = 0
    let s1 = 0
    let i = 1
    for (let d = 0; d <= total + 1e-9; d += 0.1) {
      while (i < this.roadCum.length - 1 && this.roadCum[i]! < d) i++
      const a = pts[i - 1]!
      const b = pts[i]!
      const seg = Math.max(1e-3, this.roadCum[i]! - this.roadCum[i - 1]!)
      const u = Math.min(1, Math.max(0, (d - this.roadCum[i - 1]!) / seg))
      const x = a.x + (b.x - a.x) * u
      const z = a.z + (b.z - a.z) * u
      const fx = (b.x - a.x) / seg
      const fz = (b.z - a.z) / seg
      // L'emprise de l'auto : son axe et ses deux flancs, tous les 0,2 u.
      let hit = false
      for (let l = -half; l <= half + 1e-9; l += Math.max(0.2, half / 4))
        for (const w of [-width, 0, width]) {
          const q = nearestOnLoop(track, { x: x + fx * l + fz * w, z: z + fz * l - fx * w })
          if (q.d >= clear) continue
          hit = true
          const ds = ((((q.s - c.sTrack) % L) + L * 1.5) % L) - L / 2
          s0 = Math.min(s0, ds)
          s1 = Math.max(s1, ds)
        }
      // Le pas d'échantillonnage en marge : l'auto s'arrête AVANT le premier
      // point touché.
      if (hit) {
        lo = Math.min(lo, d - 0.1)
        hi = Math.max(hi, d + 0.1)
      }
    }
    this.zoneKey = key
    this.zone = { lo, hi, s0: c.sTrack + s0, s1: c.sTrack + s1 }
    return this.zone
  }
  private zoneKey = ''
  private zone: { lo: number; hi: number; s0: number; s1: number } | null = null

  /** Demi-longueur et demi-largeur de l'auto à taille réelle (le mesh est
   *  mis à l'échelle, sa géométrie non : voir CAR_HALF). */
  private carSize(): { half: number; width: number } {
    return { half: Village.CAR_HALF.l, width: Village.CAR_HALF.w }
  }

  private carD = 0
  private carDir: 1 | -1 = 1
  private carWait = 0
  private static readonly CAR_SPEED = 3.4
  /** La rame ferme la barrière à 8 u de la traversée. */
  private static readonly CROSSING_WARN = 8

  /** L'APPAREIL. Hors de la fusion, parce qu'il doit décoller et se poser :
   *  il roule sur l'aire, prend l'air vers le large, et refait le chemin en
   *  sens inverse au retour de l'expédition. */
  private buildPlane(pl: { x: number; y: number; z: number; rot: number }): void {
    const body = new Color('#dfe6ec')
    const trim = new Color('#2f6fb5')
    const p: BufferGeometry[] = []
    p.push(part(new CylinderGeometry(0.17, 0.12, 1.5, 8).rotateZ(Math.PI / 2), body, 0, 0, 0))
    p.push(part(new CylinderGeometry(0.17, 0.17, 0.24, 8).rotateZ(Math.PI / 2), trim, -0.1, 0, 0))
    // Aile haute et ses mâts, empennage, dérive.
    p.push(part(new BoxGeometry(0.42, 0.05, 2.2), body, 0.02, 0.2, 0))
    p.push(part(new BoxGeometry(0.42, 0.02, 2.24), trim, 0.02, 0.17, 0))
    for (const sz of [-0.34, 0.34])
      p.push(part(new BoxGeometry(0.04, 0.2, 0.04), C.stoneDark, 0.02, 0.1, sz))
    p.push(part(new BoxGeometry(0.3, 0.04, 0.8), body, -0.62, 0.06, 0))
    p.push(part(new BoxGeometry(0.28, 0.36, 0.04), trim, -0.66, 0.22, 0))
    // Verrière, hélice, train fixe.
    p.push(part(new BoxGeometry(0.4, 0.16, 0.26), C.glass, 0.16, 0.14, 0))
    p.push(part(new BoxGeometry(0.03, 0.62, 0.06), C.stoneDark, 0.78, 0.02, 0))
    p.push(part(new CylinderGeometry(0.05, 0.05, 0.06, 8).rotateZ(Math.PI / 2), C.char, 0.74, 0.02, 0))
    for (const sz of [-0.22, 0.22]) {
      p.push(part(new CylinderGeometry(0.025, 0.025, 0.22, 5), C.stoneDark, 0.16, -0.15, sz))
      p.push(part(new CylinderGeometry(0.08, 0.08, 0.05, 8).rotateX(Math.PI / 2), C.char, 0.16, -0.26, sz))
    }
    const geo = mergeGeometries(p)
    if (!geo) return
    grain(geo, 0.05)
    const mesh = new Mesh(geo, this.solid)
    mesh.castShadow = true
    // Le village se reconstruit à chaque pose : sur la même aire, l'avion
    // reprend la place qu'il avait (fitPlane la revérifie). Sans quoi chaque
    // atelier posé, même à l'autre bout de l'île, relançait toute la recherche.
    const prev =
      this.planeFit && this.planeAt && this.planeBase && this.planeBase.x === pl.x && this.planeBase.z === pl.z
        ? { k: this.planeK, rot: this.planeAt.rot, off: this.planeOff }
        : null
    if (!prev) this.planeFit = null
    // Taille réelle plafonnée (voir vehicles.ts), sur le mesh comme l'auto.
    const k = prev?.k ?? VEHICLE_SCALE.plane
    mesh.scale.setScalar(k)
    const pivot = new Group()
    pivot.add(mesh)
    // Le cap d'abord, puis le tangage autour de l'envergure (z local) et le
    // roulis autour du fuselage (x local) : dans l'ordre par défaut (XYZ), le
    // tangage se faisait autour de l'axe x du MONDE, quel que soit le cap.
    pivot.rotation.order = 'YZX'
    // Cap de décollage : vers le large, dos à l'île.
    // Les roues (0,34 sous le pivot, ×k) restent où elles touchaient l'aire.
    // L'appareil avance d'abord de ce que sa queue a gagné ; le cadastre
    // l'avance ensuite jusqu'à ce qu'il ait sa marge (fitPlane).
    const rot = prev?.rot ?? Math.atan2(pl.x, pl.z)
    this.planeBase = { x: pl.x, z: pl.z }
    this.planeK = k
    this.planeY0 = pl.y + 0.4
    this.planeAt = { x: pl.x, y: this.planeY0 + Village.PLANE_WHEEL * (k - 1), z: pl.z, rot }
    this.planeOff = prev?.off ?? Village.PLANE_TAIL * (k - 1)
    this.planeSig = ''
    this.placePlane(this.planeOff)
    this.plane = pivot
    this.planeRest()
    this.group.add(pivot)
    this.vehicleModel(mesh, 'plane', 0.05)
  }

  private planeRest(): void {
    const a = this.planeAt
    if (!this.plane || !a) return
    this.plane.position.set(a.x, a.y, a.z)
    // Au repos, le nez (+X local) face à la piste, vers le large. Le code
    // d'avant tournait l'appareil du cap brut : nez à 90° de la piste.
    this.plane.rotation.set(0, headingYaw(Math.sin(a.rot), Math.cos(a.rot)), 0)
    this.plane.visible = true
  }

  /** Le colon embarque : roulage, puis montée vers le large. */
  planeDepart(): void {
    if (!this.plane) return
    this.flightDir = 1
    this.flight = 0
  }

  /** Il revient : même trajectoire, à l'envers, jusqu'à l'arrêt sur l'aire. */
  planeArrive(): void {
    if (!this.plane) return
    this.flightDir = -1
    this.flight = 0
  }

  /** Le dessous des roues sous le pivot de l'avion, avant mise à l'échelle. */
  private static readonly PLANE_WHEEL = 0.34
  /** La queue derrière le pivot de l'avion, avant mise à l'échelle. */
  private static readonly PLANE_TAIL = 0.88
  /** Demi-envergure de l'avion à sa taille 3.61.0, en monde. */
  private static readonly PLANE_HALF_SPAN = 1.12
  /** Les tailles essayées, de la plus grande à celle de la 3.62.0 : là où
   *  l'aérodrome est trop serré pour ses 4,3 m d'envergure, l'avion rapetisse
   *  jusqu'à tenir plutôt que de traverser la manche à air ou un atelier. */
  private static readonly PLANE_SIZES = [1, 0.8, 0.6, 0.4].map((f) => Math.max(1, VEHICLE_SCALE.plane * f))
  /** Le facteur retenu pour ce bourg (VEHICLE_SCALE.plane si la place y est). */
  planeK = VEHICLE_SCALE.plane
  /** La hauteur du pivot à la taille 3.61.0, roues sur l'aire. */
  private planeY0 = 0
  /** Ce que les ailes laissent aux houppiers : rayon de cime et marge. */
  private static readonly PLANE_TREE_CLEAR = 1.6
  /** Sous cette hauteur (au-dessus du sol), l'avion peut toucher un sapin. */
  static readonly PLANE_LOW = 7.5

  /** La position de l'avion à l'avancement t (0 : à l'arrêt, 1 : parti), pour
   *  un départ. Le retour refait la même courbe à l'envers. */
  planePose(t: number): { x: number; y: number; z: number } | null {
    const a = this.planeAt
    if (!a) return null
    const roll = Math.min(1, t / 0.25)
    const climb = Math.max(0, (t - 0.25) / 0.75)
    const d = roll * 3 + climb * climb * 52
    return { x: a.x + Math.sin(a.rot) * d, y: a.y + climb * climb * 26, z: a.z + Math.cos(a.rot) * d }
  }

  /** Les points du trajet où l'avion vole encore sous la cime des arbres. */
  private planeLowPath(): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = []
    for (let t = 0; t <= 1; t += 0.01) {
      const q = this.planePose(t)!
      if (q.y - GROUND_Y > Village.PLANE_LOW) break
      out.push({ x: q.x, z: q.z })
    }
    return out
  }

  /** Le centre de l'aérodrome, d'où l'on compte l'avancée de l'appareil. */
  private planeBase: { x: number; z: number } | null = null
  /** Ce que l'avion laisse, en plan, entre lui et le premier plein. */
  static readonly PLANE_MARGIN = 0.5
  /** L'avancée retenue, depuis le centre de l'aérodrome. */
  private planeOff = 0

  /** L'appareil à `off` u en avant du centre de l'aérodrome, dans l'axe de
   *  décollage, et la pinède écartée de son couloir tant qu'il vole sous la
   *  cime des sapins : à taille réelle, ses ailes y passaient. */
  private placePlane(off: number): void {
    const a = this.planeAt
    const b = this.planeBase
    if (!a || !b) return
    a.x = b.x + Math.sin(a.rot) * off
    a.z = b.z + Math.cos(a.rot) * off
    this.island.clearCorridor(this.planeLowPath(), Village.PLANE_HALF_SPAN * this.planeK + Village.PLANE_TREE_CLEAR)
  }

  /** L'avion, en quelques disques : fuselage, aile, empennage, train — repère
   *  de l'appareil à sa taille de jeu 3.61.0 (u vers le nez, v vers l'aile
   *  gauche, y depuis le pivot, `top` le haut de la colonne), rayon en plan. */
  private static readonly PLANE_PROXY: readonly PlaneCell[] = (() => {
    const out: PlaneCell[] = []
    for (let u = -0.88; u <= 0.88 + 1e-6; u += 0.11) out.push({ u, v: 0, y: -0.17, top: 0.17, r: 0.17 })
    for (let v = -1.12; v <= 1.12 + 1e-6; v += 0.112) out.push({ u: 0.02, v, y: 0.15, top: 0.2, r: 0.21 })
    for (let v = -0.4; v <= 0.4 + 1e-6; v += 0.1) out.push({ u: -0.62, v, y: 0.04, top: 0.4, r: 0.15 })
    for (const v of [-0.22, 0.22]) out.push({ u: 0.16, v, y: -0.34, top: -0.04, r: 0.08 })
    return out
  })()

  /** Le même relevé, tiré de la géométrie affichée (primitive ou modèle) : une
   *  case de 0,12 u en plan par morceau de surface, au plus bas de ce qui la
   *  couvre. Les disques ci-dessus manquaient l'empennage et le bout des
   *  ailes du modèle : 0,2 u de marge réelle là où ils en voyaient 0,5. */
  private planeProxyFor: BufferGeometry | null = null
  private planeProxyCells: readonly PlaneCell[] = Village.PLANE_PROXY
  /** Les cases du bord et les colonnes hautes : le balayage du vol penche
   *  l'appareil (tangage, roulis), et le haut d'une colonne (dérive,
   *  verrière) glisse alors en plan. */
  private planeProxyTilt: readonly PlaneCell[] = Village.PLANE_PROXY
  /** Une case du bord sur trois : le premier tri de la recherche. Moins de
   *  cases ne voient jamais moins de place que toutes : ce qui échoue ici
   *  échouerait aussi avec toutes les cases. */
  private planeProxySparse: readonly PlaneCell[] = Village.PLANE_PROXY
  private readonly roomLamps: { x: number; y: number; z: number }[] = []
  /** Le rayon en plan du relevé autour du pivot, et son point le plus bas. */
  private planeProxyExtent = { reach: 1.33, low: -0.42 }

  private planeProxy(): readonly PlaneCell[] {
    const mesh = this.plane?.children[0] as Mesh | undefined
    const geo = mesh?.geometry
    if (!geo || geo === this.planeProxyFor) return this.planeProxyCells
    const C = 0.12
    const cells = new Map<number, PlaneCell>()
    const pos = geo.getAttribute('position')
    const idx = geo.index
    const n = idx ? idx.count / 3 : pos.count / 3
    const P = [new Vector3(), new Vector3(), new Vector3()]
    for (let t = 0; t < n; t++) {
      for (let c = 0; c < 3; c++) P[c]!.fromBufferAttribute(pos, idx ? idx.getX(t * 3 + c) : t * 3 + c)
      const [A, B, D] = P as [Vector3, Vector3, Vector3]
      const len = Math.max(A.distanceTo(B), B.distanceTo(D), D.distanceTo(A))
      const steps = Math.max(1, Math.ceil(len / (C * 0.5)))
      for (let i = 0; i <= steps; i++)
        for (let j = 0; j <= steps - i; j++) {
          const wa = i / steps
          const wb = j / steps
          const wd = 1 - wa - wb
          const x = A.x * wa + B.x * wb + D.x * wd
          const y = A.y * wa + B.y * wb + D.y * wd
          const z = A.z * wa + B.z * wb + D.z * wd
          // u vers le nez (+X local), v vers l'aile gauche (−Z local).
          const gu = Math.round(x / C)
          const gv = Math.round(-z / C)
          const key = gu * 4096 + gv
          const cell = cells.get(key)
          if (!cell) cells.set(key, { u: gu * C, v: gv * C, y, top: y, r: C * 0.71 })
          else {
            cell.y = Math.min(cell.y, y)
            cell.top = Math.max(cell.top, y)
          }
        }
    }
    this.planeProxyFor = geo
    // Seules comptent les cases du bord, et celles plus basses que leurs
    // voisines (le train sous l'aile) : une case intérieure n'est jamais la
    // plus proche d'un plein. Trois fois moins de cases à chaque essai.
    const at = (gu: number, gv: number) => cells.get(gu * 4096 + gv)
    const edge = new Set(
      [...cells.values()].filter((q) => {
        const gu = Math.round(q.u / C)
        const gv = Math.round(q.v / C)
        const ns = [at(gu + 1, gv), at(gu - 1, gv), at(gu, gv + 1), at(gu, gv - 1)]
        return ns.some((n) => !n || n.y > q.y + 0.02)
      }),
    )
    this.planeProxyCells = [...edge]
    this.planeProxySparse = this.planeProxyCells.filter((q) => (((Math.round(q.u / C) + Math.round(q.v / C)) % 3) + 3) % 3 === 0)
    // Penché, le haut d'une colonne haute (dérive, verrière) glisse en plan :
    // le balayage garde aussi ces colonnes-là.
    this.planeProxyTilt = [...cells.values()].filter((q) => edge.has(q) || q.top - q.y > 0.04)
    let reach = 0
    let low = Infinity
    for (const q of this.planeProxyCells) {
      reach = Math.max(reach, Math.hypot(q.u, q.v) + q.r)
      low = Math.min(low, q.y)
    }
    this.planeProxyExtent = { reach, low }
    return this.planeProxyCells
  }

  /** Les pleins que l'avion doit éviter, relevés sur les emprises du cadastre
   *  au sol (`groundFootprints`) du village ET de la faune — palissade de
   *  l'enclos, poulailler —, triangle par triangle, avec leur sommet. Avant
   *  (v3.66.0 première version), il lisait des disques de parcelle et deux
   *  boîtes pour l'aérodrome : ni l'enclos, ni le coin d'un atelier qui
   *  déborde de sa parcelle. Sur 16 bourgs, il se disait « à l'aise » dans 4
   *  où il touchait. Onze nombres par triangle : les trois sommets en plan,
   *  la boîte en plan, le sommet. */
  private planeTris: number[] = []
  /** Grille de SOLID_CELL u : chaque case connaît les triangles à moins de
   *  SOLID_PAD d'elle. */
  private readonly planeGrid = new Map<number, number[]>()
  /** Le plus haut des pleins relevés (monde) : au-dessus, plus rien ne gêne. */
  private planeTop = -Infinity
  /** Les pièces animées hors de la géométrie fixe (ailes du moulin,
   *  attelage) : un disque plein jusqu'au ciel, comme le cadastre des
   *  parcelles les comptait. */
  private planeDiscs: { x: number; z: number; r: number }[] = []
  private static readonly SOLID_CELL = 0.5
  /** La même chose en gros (cases de 2 u) : le plus haut sommet qui
   *  approche chaque case. Le balayage y saute les poses loin de tout. */
  private readonly planeCoarse = new Map<number, number>()
  private static readonly COARSE_CELL = 2
  /** Au-delà, la distance exacte ne compte plus : marge (0,5) et rayon d'une
   *  case à ×2,5 (0,21) y tiennent. */
  private static readonly SOLID_PAD = 1
  /** Ce qui, hors du village, pose des emprises au sol (la faune). */
  private planeSources: readonly GroundSource[] = []

  /** Relève les pleins à moins de 40 u de l'aérodrome. */
  private buildPlaneSolids(fps: readonly Footprint[]): void {
    const b = this.planeBase!
    const C = Village.SOLID_CELL
    const PAD = Village.SOLID_PAD
    const WIN = 40
    const tris: number[] = []
    const grid = this.planeGrid
    grid.clear()
    const coarse = this.planeCoarse
    coarse.clear()
    const G = Village.COARSE_CELL
    let topMax = -Infinity
    const p = [0, 0, 0, 0, 0, 0]
    for (const f of fps) {
      const k = f.scale ?? 1
      const ox = f.ox ?? 0
      const oy = f.oy ?? 0
      const oz = f.oz ?? 0
      const pos = f.geo?.getAttribute('position')
      const raw = f.tris
      const idx = f.geo?.index ?? null
      const n = pos ? (idx ? idx.count : pos.count) / 3 : (raw?.length ?? 0) / 9
      // Comme le cadastre : une dalle au ras du sol (tarmac, rue) se roule.
      const min = Math.max(f.minY, GROUND_Y + 0.2)
      for (let t = 0; t < n; t++) {
        let top = -Infinity
        for (let c = 0; c < 3; c++) {
          const i = idx ? idx.getX(t * 3 + c) : t * 3 + c
          const x = pos ? pos.getX(i) : raw![i * 3]!
          const y = pos ? pos.getY(i) : raw![i * 3 + 1]!
          const z = pos ? pos.getZ(i) : raw![i * 3 + 2]!
          top = Math.max(top, oy + y * k)
          p[c * 2] = ox + x * k
          p[c * 2 + 1] = oz + z * k
        }
        if (top < min) continue
        const x0 = Math.min(p[0]!, p[2]!, p[4]!)
        const x1 = Math.max(p[0]!, p[2]!, p[4]!)
        const z0 = Math.min(p[1]!, p[3]!, p[5]!)
        const z1 = Math.max(p[1]!, p[3]!, p[5]!)
        if (x1 < b.x - WIN || x0 > b.x + WIN || z1 < b.z - WIN || z0 > b.z + WIN) continue
        const o = tris.length
        tris.push(p[0]!, p[1]!, p[2]!, p[3]!, p[4]!, p[5]!, x0, x1, z0, z1, top)
        topMax = Math.max(topMax, top)
        for (let i = Math.floor((x0 - PAD) / C); i <= Math.floor((x1 + PAD) / C); i++)
          for (let j = Math.floor((z0 - PAD) / C); j <= Math.floor((z1 + PAD) / C); j++) {
            const key = i * 100003 + j
            const list = grid.get(key)
            if (list) list.push(o)
            else grid.set(key, [o])
          }
        for (let i = Math.floor((x0 - PAD) / G); i <= Math.floor((x1 + PAD) / G); i++)
          for (let j = Math.floor((z0 - PAD) / G); j <= Math.floor((z1 + PAD) / G); j++) {
            const key = i * 100003 + j
            coarse.set(key, Math.max(coarse.get(key) ?? -Infinity, top))
          }
      }
    }
    this.planeTris = tris
    this.planeDiscs = this.propPlacements
      .filter((q) => (q.id === 'windmill' || q.id === 'plough') && Math.hypot(q.x - b.x, q.z - b.z) < WIN)
      .map((q) => ({ x: q.x, z: q.z, r: this.reach(q.id) }))
    this.planeTop = this.planeDiscs.length ? Infinity : topMax
  }

  /** Un plein relevé plus haut que `lowest` approche-t-il le disque de rayon
   *  `R` autour de (x, z) ? Tri grossier, sur les cases de 2 u. */
  private solidsNear(x: number, z: number, R: number, lowest: number): boolean {
    const G = Village.COARSE_CELL
    for (const q of this.planeDiscs) if (Math.hypot(q.x - x, q.z - z) < q.r + R + Village.SOLID_PAD) return true
    for (let i = Math.floor((x - R) / G); i <= Math.floor((x + R) / G); i++)
      for (let j = Math.floor((z - R) / G); j <= Math.floor((z + R) / G); j++)
        if ((this.planeCoarse.get(i * 100003 + j) ?? -Infinity) > lowest) return true
    return false
  }

  /** La distance en plan de (x, z) au premier plein relevé qui monte plus
   *  haut que `y` (monde) ; −1 dedans, SOLID_PAD au-delà. */
  private solidRoom(x: number, z: number, y: number): number {
    let best = Village.SOLID_PAD
    if (this.planeDiscs.length) for (const d of this.planeDiscs) best = Math.min(best, Math.hypot(x - d.x, z - d.z) - d.r)
    const C = Village.SOLID_CELL
    const list = this.planeGrid.get(Math.floor(x / C) * 100003 + Math.floor(z / C))
    if (!list) return best
    const T = this.planeTris
    for (const o of list) {
      if (T[o + 10]! <= y) continue
      if (x < T[o + 6]! - best || x > T[o + 7]! + best || z < T[o + 8]! - best || z > T[o + 9]! + best) continue
      const ax = T[o]!
      const az = T[o + 1]!
      const bx = T[o + 2]!
      const bz = T[o + 3]!
      const cx = T[o + 4]!
      const cz = T[o + 5]!
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
      if (Math.abs(d) > 1e-12) {
        const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d
        const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d
        if (l1 >= 0 && l2 >= 0 && 1 - l1 - l2 >= 0) return -1
      }
      best = Math.min(best, segDist(x, z, ax, az, bx, bz), segDist(x, z, bx, bz, cx, cz), segDist(x, z, cx, cz, ax, az))
    }
    return best
  }

  /** La place qui reste à l'appareil, à plat, pivot en (x, z), `lift`
   *  au-dessus de l'aire, cap `rot` : la distance en plan de son bord au
   *  premier plein qui monte plus haut que lui (pleins relevés, réverbères).
   *  `land` : fuselage et train (y < 0) doivent rouler sur la terre. Rend dès
   *  que la place tombe sous `floor`. `cells` : le relevé à lire (toutes les
   *  cases du bord, ou une sur trois). C'est le tri rapide de la recherche ;
   *  `planeSweep` rejoue ensuite le vol exact. */
  private planeRoom(
    x: number,
    z: number,
    lift: number,
    rot: number,
    land: boolean,
    floor: number,
    cells: readonly PlaneCell[] = this.planeProxy(),
  ): number {
    const a = this.planeAt
    if (!a) return -Infinity
    const k = this.planeK
    const dx = Math.sin(rot)
    const dz = Math.cos(rot)
    const { reach, low } = this.planeProxyExtent
    const R = reach * k
    const lowY = a.y + lift + low * k
    // Au-delà de la marge, la place exacte ne compte plus.
    const cap = Village.PLANE_MARGIN + 0.01
    const lamps = this.roomLamps
    lamps.length = 0
    if (lowY - GROUND_Y < 3.05)
      for (const q of this.lampPosts) if (Math.hypot(q.x + 0.27 - x, q.z - z) - R - 0.55 < cap) lamps.push(q)
    const solids = lowY < this.planeTop && this.solidsNear(x, z, R, lowY)
    // Au sol et au ras du sol, fuselage et train (y < 0) roulent sur la
    // terre : avancé de 5 u sans ce garde-fou, l'appareil se garait au-delà
    // de la plage, sur l'eau. Les ailes et l'empennage peuvent déborder.
    const ground = land && lift < 0.3
    if (!ground && !solids && !lamps.length) return Infinity
    let room = Infinity
    for (const q of cells) {
      const px = x + (dx * q.u + dz * q.v) * k
      const pz = z + (dz * q.u - dx * q.v) * k
      const py = a.y + lift + q.y * k
      const r = q.r * k
      if (ground && q.y < 0 && !this.island.isLand(px, pz)) return -Infinity
      if (solids) room = Math.min(room, this.solidRoom(px, pz, py) - r)
      // Les réverbères : un disque qui couvre mât et potence, jusqu'au chapeau.
      if (py - GROUND_Y < 3.05) for (const l of lamps) room = Math.min(room, Math.hypot(px - l.x - 0.27, pz - l.z) - 0.55 - r)
      if (room < floor) return room
    }
    return room
  }

  private readonly sweepEuler = new Euler(0, 0, 0, 'YZX')
  private readonly sweepM = new Matrix4()
  private readonly sweepQ = new Quaternion()
  private readonly sweepV = new Vector3()
  private readonly sweepP = new Vector3()
  private readonly sweepS = new Vector3()

  /** Le vol réel, pose par pose, comme `tickPlane` le joue : repos, roulage
   *  et montée au départ ; au retour, le même chemin nez vers l'aire, puis le
   *  demi-tour sur place. Appareil penché (tangage, roulis), chaque case au
   *  bas de sa colonne, son rayon élargi de ce que le haut de la colonne
   *  glisse en plan. Les poses sont assez serrées pour qu'un point de
   *  l'appareil ne bouge pas de plus de 0,05 u de l'une à l'autre (marge
   *  ajoutée). Rend la place minimale en plan, ou dès qu'elle tombe sous
   *  `floor`. Le placement essayé : cap `rot`, à `off` du centre. */
  private planeSweep(rot: number, off: number, floor: number): number {
    const a = this.planeAt
    const b = this.planeBase
    if (!a || !b) return -Infinity
    this.planeProxy()
    const cells = this.planeProxyTilt
    const k = this.planeK
    const R = this.planeProxyExtent.reach * k
    const sx = Math.sin(rot)
    const sz = Math.cos(rot)
    const x0 = b.x + sx * off
    const z0 = b.z + sz * off
    const out = headingYaw(sx, sz)
    const SLACK = 0.05
    const PAD = Village.SOLID_PAD
    // Au-dessus des pleins et des réverbères, plus rien ne gêne.
    const ceiling = Math.max(this.planeTop, this.lampPosts.length ? GROUND_Y + 3.05 : -Infinity)
    const e = this.sweepEuler
    const m = this.sweepM
    const v = this.sweepV
    const p = this.sweepP
    this.sweepS.setScalar(k)
    let room = Infinity
    for (const dir of [1, -1] as const) {
      let t = 0
      while (t <= 1) {
        const roll = dir === 1 ? Math.min(1, t / 0.25) : Math.min(1, Math.max(0, (t - 0.1) / 0.15))
        const climb = Math.max(0, (t - 0.25) / 0.75)
        const d = roll * 3 + climb * climb * 52
        p.set(x0 + sx * d, a.y + climb * climb * 26, z0 + sz * d)
        // L'appareil tient dans une boule de rayon R (penché, un peu plus bas).
        const lowest = p.y - R - 0.5 * k
        if (lowest > ceiling) break
        // Pas de temps : le demi-tour (π en 0,1) avance par 0,002, le roulage
        // par 0,005, la montée selon sa vitesse — 0,05 u au plus par pose.
        const speed = dir === -1 && t < 0.1 ? Math.PI * R * 10 : t < 0.25 ? 12 : 1 + (104 * climb) / 0.75
        const tNext = t + Math.min(0.005, 0.05 / speed)
        // Tri grossier : rien d'assez haut à portée, la pose est libre.
        let near = this.solidsNear(p.x, p.z, R, lowest)
        const lamps = this.roomLamps
        lamps.length = 0
        if (lowest - GROUND_Y < 3.05)
          for (const l of this.lampPosts) if (Math.hypot(l.x + 0.27 - p.x, l.z - p.z) < 0.55 + R + PAD) lamps.push(l)
        if (lamps.length) near = true
        if (!near) {
          t = tNext
          continue
        }
        const pitch = climb * 0.22
        const bank = Math.sin(t * Math.PI) * 0.12
        e.set(bank, dir === 1 ? out : out + Math.PI * Math.min(1, t / 0.1), pitch * dir)
        this.sweepQ.setFromEuler(e)
        m.compose(p, this.sweepQ, this.sweepS)
        const lean = Math.sin(pitch) + Math.sin(bank)
        for (const q of cells) {
          const r = (q.r + (q.top - q.y) * lean) * k + SLACK
          v.set(q.u, q.y, -q.v).applyMatrix4(m)
          room = Math.min(room, this.solidRoom(v.x, v.z, v.y) - r)
          if (v.y - GROUND_Y < 3.05)
            for (const l of lamps) room = Math.min(room, Math.hypot(v.x - l.x - 0.27, v.z - l.z) - 0.55 - r)
          if (room < floor) return room
        }
        t = tNext
      }
    }
    return room
  }

  /** Comment l'avion s'est garé : avec sa marge, vérifiée sur le vol entier
   *  (« clear »), ou, faute de place, au placement qui lui en laisse le plus
   *  (« tight »). */
  planeFit: 'clear' | 'tight' | null = null
  /** La place minimale du vol retenu, mesurée par `planeSweep`. */
  planeClearance = -Infinity
  private planeSig = ''

  /** Une signature des emprises : un plein posé, déplacé ou retiré la change. */
  private static footprintSig(fps: readonly Footprint[]): string {
    return fps
      .map((f) => {
        if (f.geo) {
          const pos = f.geo.getAttribute('position')
          return `${f.geo.uuid}.${'version' in pos ? pos.version : 0}.${pos.count}.${f.ox ?? 0}.${f.oz ?? 0}.${f.scale ?? 1}`
        }
        let h = 0
        for (const x of f.tris ?? []) h = (h * 31 + Math.round(x * 1000)) | 0
        return `t${h}`
      })
      .join(',')
  }

  /** Avance l'avion dans son axe de décollage jusqu'au premier point où il
   *  a sa marge, à l'arrêt comme pendant son roulage, sa montée, son retour
   *  et son demi-tour : à sa place d'avant, déjà à sa taille 3.61.0, sa queue
   *  frôlait le hangar (0,3 u) et il traversait la manche à air en roulant. */
  private fitPlane(): void {
    const a = this.planeAt
    const b = this.planeBase
    if (!this.plane || !a || !b) return
    // Rien n'a bougé autour de l'aire depuis le dernier calage (le cadastre se
    // refait pour un sapin abattu, une récolte) : la place est la même.
    this.planeProxy()
    const fps = [this, ...this.planeSources].flatMap((s) => s.groundFootprints())
    const sig = [b.x, b.z, this.lampPosts.length, this.planeProxyFor?.uuid, Village.footprintSig(fps)].join('|')
    if (sig === this.planeSig) return
    this.planeSig = sig
    this.buildPlaneSolids(fps)
    const M = Village.PLANE_MARGIN
    // Un plein de plus ne peut que retirer des places : si celle qu'on avait
    // garde sa marge sur le vol entier, la recherche (ordre fixe) y
    // retomberait. On la garde sans tout refaire — une construction loin de
    // l'aire ne coûte plus que ce balayage.
    // Le calage d'avant, sur la même aire : les tailles plus grandes que la
    // sienne ne tenaient pas, et ne tiennent toujours pas.
    const startK = this.planeFit ? this.planeK : Infinity
    if (this.planeFit === 'clear') {
      const kept = this.planeSweep(a.rot, this.planeOff, M)
      if (kept >= M) {
        this.planeClearance = kept
        return
      }
    } else if (this.planeFit === 'tight') {
      // Serré (taille 3.62.0, rien ne laisse la marge, et un plein de plus
      // n'en laissera pas) : la place d'avant reste tant que rien de neuf
      // n'approche son vol. Elle peut différer de celle qu'un rechargement
      // choisirait, jamais en moins bien.
      const kept = this.planeSweep(a.rot, this.planeOff, this.planeClearance)
      if (kept >= this.planeClearance) return
    }
    /** Le tri rapide d'un placement : départ à plat et retour nez vers
     *  l'aire jusqu'à 0,6, puis le demi-tour sur place. */
    const pathRoom = (rot: number, off: number, floor: number, cells: readonly PlaneCell[]): number => {
      const dx = Math.sin(rot)
      const dz = Math.cos(rot)
      // Le repos et le demi-tour d'abord : c'est là que la plupart des
      // placements échouent, et la recherche s'arrête au premier échec.
      let room = this.planeRoom(b.x + dx * off, b.z + dz * off, 0, rot, true, floor, cells)
      for (let s = 1; s <= 12 && room >= floor; s++)
        room = Math.min(room, this.planeRoom(b.x + dx * off, b.z + dz * off, 0, rot + (Math.PI * s) / 12, false, floor, cells))
      if (room < floor) return room
      for (let t = 0.02; t <= 0.6; t += 0.02) {
        const roll = Math.min(1, t / 0.25)
        const climb = Math.max(0, (t - 0.25) / 0.75)
        const d = off + roll * 3 + climb * climb * 52
        const lift = climb * climb * 26
        room = Math.min(room, this.planeRoom(b.x + dx * d, b.z + dz * d, lift, rot, true, floor, cells))
        if (room < floor) return room
        room = Math.min(room, this.planeRoom(b.x + dx * d, b.z + dz * d, lift, rot + Math.PI, false, floor, cells))
        if (room < floor) return room
      }
      return room
    }
    // Droit vers le large d'abord ; si l'axe est barré (un quai posé en
    // travers), le cap s'écarte peu à peu, jusqu'à longer la côte (±1,5 rad) :
    // l'aire est au bord de l'eau, et le roulage doit rester sur la terre. Un
    // placement qui passe le tri rapide est rejoué en entier (planeSweep) :
    // seul celui-là peut se dire « clear ». Si rien ne laisse la marge, à la
    // taille 3.62.0, le placement qui laisse le plus de place.
    const radial = Math.atan2(b.x, b.z)
    const DRIFT = [0, 0.25, -0.25, 0.5, -0.5, 0.75, -0.75, 1, -1, 1.25, -1.25, 1.5, -1.5]
    const k0 = this.planeK
    const sizes = Village.PLANE_SIZES
    let found: { rot: number; off: number } | null = null
    let best = { rot: radial, off: this.planeOff, room: -Infinity }
    const tight: { rot: number; off: number; room: number }[] = []
    const sparse = this.planeProxySparse
    const full = this.planeProxyCells
    for (const k of sizes) {
      // Un plein de plus ne rend pas la place à une taille qui ne tenait pas.
      if (k > startK) continue
      this.planeK = k
      a.y = this.planeY0 + Village.PLANE_WHEEL * (k - 1)
      const last = k === sizes[sizes.length - 1]
      best = { rot: radial, off: Village.PLANE_TAIL * (k - 1), room: -Infinity }
      for (const dr of DRIFT) {
        for (let off = -3; off <= 8 && !found; off += 0.25) {
          // Une case sur trois d'abord, toutes ensuite, le vol entier enfin.
          // À la dernière taille, on garde aussi les huit placements les plus
          // larges au premier tri (le vol entier n'est rejoué que pour eux).
          const floor = last && tight.length === 8 ? Math.min(M, tight[7]!.room) : last ? -Infinity : M
          const room = pathRoom(radial + dr, off, floor, sparse)
          if (room >= M && pathRoom(radial + dr, off, M, full) >= M && this.planeSweep(radial + dr, off, M) >= M)
            found = { rot: radial + dr, off }
          else if (last && room > floor && room > -Infinity) {
            tight.push({ rot: radial + dr, off, room })
            tight.sort((p, q) => q.room - p.room)
            if (tight.length > 8) tight.pop()
          }
        }
        if (found) break
      }
      if (found) break
    }
    if (!found) {
      // Les huit plus larges au tri rapide, rejouées en entier : la plus
      // large en vol l'emporte.
      for (const c of tight) {
        const room = this.planeSweep(c.rot, c.off, best.room)
        if (room > best.room) best = { ...c, room }
      }
    }
    this.planeFit = found ? 'clear' : 'tight'
    const pick = found ?? best
    this.planeClearance = this.planeSweep(pick.rot, pick.off, -Infinity)
    ;(this.plane.children[0] as Mesh).scale.setScalar(this.planeK)
    if (this.planeK === k0 && Math.abs(pick.off - this.planeOff) < 1e-6 && Math.abs(pick.rot - a.rot) < 1e-6) return
    a.rot = pick.rot
    this.planeOff = pick.off
    this.placePlane(pick.off)
    if (this.flight < 0) this.planeRest()
    // Des sapins ont pu tomber : le cadastre se refait à l'image suivante.
    this.revision++
  }

  private plane: Group | null = null
  private planeAt: { x: number; y: number; z: number; rot: number } | null = null
  private flight = -1
  private flightDir: 1 | -1 = 1

  private tickPlane(dt: number): void {
    const a = this.planeAt
    if (!this.plane || !a || this.flight < 0) return
    this.flight += dt / 5.5
    if (this.flight >= 1) {
      this.flight = -1
      // Parti : l'appareil n'est plus là. Revenu : il est à sa place.
      if (this.flightDir === 1) this.plane.visible = false
      else this.planeRest()
      return
    }
    const t = this.flightDir === 1 ? this.flight : 1 - this.flight
    // Roulage sur le premier quart, puis montée : un avion prend son élan
    // avant de quitter le sol.
    // Au retour, le roulage s'arrête un peu avant le bout (t = 0,1) : le
    // demi-tour se fait ensuite sur place, pas en reculant.
    const roll = this.flightDir === 1 ? Math.min(1, t / 0.25) : Math.min(1, Math.max(0, (t - 0.1) / 0.15))
    const climb = Math.max(0, (t - 0.25) / 0.75)
    const d = roll * 3 + climb * climb * 52
    this.plane.visible = true
    this.plane.position.set(
      a.x + Math.sin(a.rot) * d,
      a.y + climb * climb * 26,
      a.z + Math.cos(a.rot) * d,
    )
    // Au retour, l'appareil refait le chemin à l'envers : il arrive donc nez
    // vers l'aérodrome, et pique au lieu de cabrer. Sur le roulage final, il
    // fait demi-tour pour finir face à la piste, comme au départ : sans quoi
    // planeRest le retournerait d'un coup, sous les yeux du joueur.
    const dir = this.flightDir
    const out = headingYaw(Math.sin(a.rot), Math.cos(a.rot))
    const yaw = dir === 1 ? out : out + Math.PI * Math.min(1, t / 0.1)
    this.plane.rotation.set(Math.sin(t * Math.PI) * 0.12, yaw, climb * 0.22 * dir)
  }

  /** Le lit de braises de la forge : il respire au rythme du soufflet. */
  private buildEmbers(pl: { x: number; y: number; z: number; rot: number }): void {
    // Dans la gueule du bas foyer, à hauteur de forgeron — l'ancien lit était
    // calé sur la forge miniature, il flottait maintenant dans le vide.
    const geo = mergeGeometries([part(new BoxGeometry(0.52, 0.16, 0.12), C.emberCore, 0, 0, 0)])
    if (!geo) return
    const pivot = new Group()
    pivot.position.set(pl.x, pl.y + 0.5, pl.z)
    pivot.rotation.y = pl.rot
    const mesh = new Mesh(geo, this.solid)
    mesh.position.set(-0.5, 0, -0.06)
    pivot.add(mesh)
    this.forgeEmbers = mesh
    this.forgePivot = pivot
    this.group.add(pivot)
  }

  /** Les dalles solaires, montées sur leur mât : elles suivent la course du
   *  soleil au lieu de fixer un point du ciel. Un panneau qui ne suit pas est
   *  un panneau mal posé — et le mouvement, ici, RACONTE la technologie. */
  private buildSolarPanels(pl: { x: number; y: number; z: number; rot: number }): void {
    const K = 1.6
    const cell = new Color(0.5, 0.95, 1.6)
    const pivot = new Group()
    pivot.position.set(pl.x, pl.y, pl.z)
    pivot.rotation.y = pl.rot
    // Les DEUX dalles dans un seul mesh : elles pivotent ensemble, donc rien
    // ne justifie de payer deux appels de rendu pour elles.
    const p: BufferGeometry[] = []
    for (const sx of [-0.24, 0.26]) {
      p.push(part(new BoxGeometry(0.44, 0.035, 0.4), C.stoneLight, sx, 0, 0))
      p.push(part(new BoxGeometry(0.4, 0.015, 0.34), cell, sx, 0.02, -0.02))
    }
    const geo = mergeGeometries(p.map((g) => g.scale(K, K, K)))
    if (geo) {
      grain(geo)
      const panel = new Mesh(geo, this.solid)
      panel.position.set(0, 0.3 * K, 0)
      pivot.add(panel)
      this.solarPanels.push(panel)
    }
    this.solarPivot = pivot
    this.group.add(pivot)
  }

  /** La parabole : elle balaie lentement le ciel, comme une antenne qui
   *  cherche. Le pied, lui, reste dans la géométrie fusionnée. */
  private buildDish(pl: { x: number; y: number; z: number; rot: number }): void {
    const K = 1.8
    const p: BufferGeometry[] = []
    p.push(part(new SphereGeometry(0.26, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.35).rotateX(-0.9).scale(1, 1, 0.5), C.bone, 0, 0, -0.08))
    p.push(part(new CylinderGeometry(0.014, 0.014, 0.24, 4).rotateX(-0.9), new Color('#6b7078'), 0, 0.08, 0.05))
    p.push(part(new SphereGeometry(0.03, 5, 4), C.tile, 0, 0.16, 0.13))
    const geo = mergeGeometries(p.map((g) => g.scale(K, K, K)))
    if (!geo) return
    grain(geo)
    const mesh = new Mesh(geo, this.solid)
    mesh.position.set(pl.x, pl.y + 0.44 * K, pl.z)
    this.dish = mesh
    this.group.add(mesh)
  }

  /** La roue à aubes, hors de la fusion. Un pivot porte l'orientation du
   *  bâtiment, la roue tourne dedans autour de son axe : ainsi l'ordre des
   *  rotations d'Euler ne peut pas s'emmêler. */
  private buildMillWheel(pl: { x: number; y: number; z: number; rot: number }): void {
    const K = 2.5
    const p: BufferGeometry[] = []
    p.push(part(new TorusGeometry(0.34, 0.05, 5, 10).rotateY(Math.PI / 2), C.woodDark, 0, 0, 0))
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      p.push(part(new BoxGeometry(0.06, 0.18, 0.12), C.wood, 0, Math.cos(a) * 0.34, Math.sin(a) * 0.34))
    }
    p.push(part(new CylinderGeometry(0.06, 0.06, 0.2, 8).rotateY(Math.PI / 2), C.woodDark, 0, 0, 0))
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4
      p.push(part(new BoxGeometry(0.05, 0.62, 0.04).rotateX(a), C.wood, 0, 0, 0))
    }
    const geo = mergeGeometries(p.map((g) => g.scale(K, K, K)))
    if (!geo) return
    grain(geo)
    const wheel = new Mesh(geo, this.solid)
    const pivot = new Group()
    pivot.position.set(pl.x, pl.y + 0.46 * K, pl.z)
    pivot.rotation.y = pl.rot
    pivot.add(wheel)
    this.millWheel = wheel
    this.millPivot = pivot
    this.group.add(pivot)
  }

  /** Les deux aiguilles du campanile, montées sur le cadran. */
  private buildClockHands(pl: { x: number; y: number; z: number; rot: number }): void {
    const K = 4.5
    const make = (w: number, h: number, off: number): Mesh => {
      const g = new BoxGeometry(w, h, 0.015).translate(0, h / 2 - off, 0).scale(K, K, K)
      const col = new Float32Array(g.attributes.position!.count * 3)
      const c = C.char
      for (let i = 0; i < col.length; i += 3) { col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b }
      g.setAttribute('color', new BufferAttribute(col, 3))
      const m = new Mesh(g, this.solid)
      const fx = Math.sin(pl.rot) * 0.205 * K
      const fz = Math.cos(pl.rot) * 0.205 * K
      m.position.set(pl.x + fx, pl.y + 0.78 * K, pl.z + fz)
      m.rotation.y = pl.rot
      return m
    }
    const hour = make(0.022, 0.075, 0.012)
    const minute = make(0.016, 0.105, 0.012)
    this.clockHands = { hour, minute }
    this.group.add(hour, minute)
  }

  private rebuildProps(): void {
    this.propsGeo?.dispose()
    this.propsGeo = null
    this.clearMovers()
    if (this.propPlacements.length === 0) return this.restack()
    const all: BufferGeometry[] = []
    for (const pl of this.propPlacements) {
      const parts = this.propGeo(pl.id)
      if (!parts) continue
      for (const g of parts) all.push(g.rotateY(pl.rot).translate(pl.x, pl.y, pl.z))
    }
    // Le bâti dégage sa propre parcelle : on n'habite pas SOUS un sapin, et
    // c'est ce qui rend le village lisible et « accessible » depuis la caméra
    // — le dégagement des rues seul laissait des troncs plantés devant les
    // façades.
    this.island.clearCorridor(
      this.propPlacements.map((q) => ({ x: q.x, z: q.z })),
      2.7,
    )
    this.lampPosts = []
    if (this.electric) this.streetLights(all)
    this.propsGeo = mergeGeometries(all)
    this.restack()

    for (const pl of this.propPlacements) {
      if (pl.id === 'windmill') this.buildWindmillSails(pl)
      if (pl.id === 'clock') this.buildClockHands(pl)
      if (pl.id === 'watermill') this.buildMillWheel(pl)
      if (pl.id === 'solar') this.buildSolarPanels(pl)
      if (pl.id === 'dish') this.buildDish(pl)
      if (pl.id === 'steamengine') this.buildEngine(pl)
      if (pl.id === 'loom') this.buildShuttle(pl)
      if (pl.id === 'forge') this.buildEmbers(pl)
      if (pl.id === 'plough') this.buildPloughTeam(pl)
      if (pl.id === 'lighthouse') this.buildBeacon(pl)
      if (pl.id === 'plane') this.buildPlane(pl)
      if (pl.id === 'garage') this.buildCar(pl)
    }
  }

  // ── Le cadastre au sol (ground.ts) ───────────────────────────────────────
  /** Change à chaque pose : le cadastre au sol se refait alors. */
  revision = 0
  /** La géométrie du campement, repère du foyer (×1,2) : sa forme réelle. */
  private campGeo: BufferGeometry | null = null
  /** Quai et abri de la gare, en triangles monde, relevés à leur pose. */
  private stationTris: number[] | null = null

  /** Tout ce que le village pose au sol et que l'on ne traverse pas : les
   *  ateliers (phare compris), la Merveille, le musée, le quai du marchand,
   *  la gare, les abris du campement, le ponton et l'attelage qui laboure.
   *  Les seuils de hauteur sont ceux de l'audit des collisions : une dalle
   *  au ras du sol (rue, voie, dallage du camp) se piétine, un mur non. */
  groundFootprints(): Footprint[] {
    const out: Footprint[] = []
    const knee = GROUND_Y + 0.12
    if (this.propsGeo) out.push({ geo: this.propsGeo, minY: knee })
    if (this.wonderGeo) out.push({ geo: this.wonderGeo, minY: knee })
    // L'esplanade du musée et la terre battue du quai comptent : on ne
    // traverse ni une vitrine ni un tas de caisses.
    if (this.museumGeo) out.push({ geo: this.museumGeo, minY: GROUND_Y + 0.05 })
    if (this.goodsGeo) out.push({ geo: this.goodsGeo, minY: -Infinity })
    if (this.campGeo)
      out.push({ geo: this.campGeo, minY: GROUND_Y + 0.12 * SCALE, scale: SCALE, ox: HEARTH.x, oy: GROUND_Y, oz: HEARTH.z })
    if (this.stationTris) out.push({ tris: this.stationTris, minY: -Infinity })
    const head = this.jettyHead
    const end = this.jettyEnd
    if (head && end) out.push({ tris: flatQuad(head.x, head.z, end.x, end.z, 0.675), minY: -Infinity })
    // L'attelage fait l'aller-retour sur ±1,2 : tout le sillon est à lui.
    for (const pl of this.propPlacements) {
      if (pl.id !== 'plough') continue
      const c = Math.cos(pl.rot)
      const sn = Math.sin(pl.rot)
      const at = (x: number, z: number): [number, number] => [pl.x + x * c + z * sn, pl.z - x * sn + z * c]
      const a = at(-1.85, -0.25)
      const b = at(2.2, -0.25)
      const d = at(2.2, 0.25)
      const e = at(-1.85, 0.25)
      out.push({ tris: [a[0], 0, a[1], b[0], 0, b[1], d[0], 0, d[1], a[0], 0, a[1], d[0], 0, d[1], e[0], 0, e[1]], minY: -Infinity })
    }
    return out
  }

  /** Emprises au sol des bâtiments — la faune les évite. Le rayon suit
   *  l'emprise réelle du bâtiment : depuis les remises à l'échelle, un rayon
   *  uniforme laissait les moutons traverser l'aqueduc. Le quai du marchand
   *  n'y est pas : il peut apparaître après coup, et se lit dans `blockers`. */
  get obstaclePoints(): { x: number; z: number; r: number }[] {
    return this.propPlacements.map((p) => ({
      x: p.x,
      z: p.z,
      r: Math.max(0.9, (Village.FOOTPRINT[p.id] ?? 0.5) + 0.45),
    }))
  }

  /** Quel savoir vit ici ? Le plus proche du point touché, feu compris. */
  identifyAt(x: number, z: number): string | null {
    let best: string | null = null
    let bestD = 2.6 * 2.6
    for (const pl of this.propPlacements) {
      const d = (pl.x - x) ** 2 + (pl.z - z) ** 2
      if (d < bestD) {
        bestD = d
        best = pl.id
      }
    }
    const df = (HEARTH.x - x) ** 2 + (HEARTH.z - z) ** 2
    if (df < bestD && df < 4) best = 'campfire'
    if (this.wonderPos && this.wonderKey) {
      const dw = (this.wonderPos.x - x) ** 2 + (this.wonderPos.z - z) ** 2
      if (dw < bestD && dw < 3.4 * 3.4) best = 'wonder'
    }
    if (this.museumPos) {
      const dm = (this.museumPos.x - x) ** 2 + (this.museumPos.z - z) ** 2
      if (dm < bestD && dm < 2.4 * 2.4) best = 'museum'
    }
    return best
  }

  // ── La Merveille ──────────────────────────────────────────────────────────
  private wonderGeo: BufferGeometry | null = null
  private wonderPos: { x: number; y: number; z: number } | null = null
  private wonderKey = ''
  private wonderShown: { age: number; stage: number } | null = null

  setWonder(age: number | null, stage: number): void {
    const id = age === null ? undefined : WONDER_BY_AGE.get(age)?.id
    // Le modèle fait partie de la clé : quand il arrive, le même stade se
    // redessine — sinon la primitive resterait jusqu'au stade suivant.
    const modelled = id !== undefined && modelGeometryReady(id)
    const key = age === null ? '' : `${age}-${stage}-${modelled ? 'm' : 'p'}`
    if (key === this.wonderKey) return
    this.wonderKey = key
    this.wonderGeo?.dispose()
    this.wonderGeo = null
    if (age === null) {
      this.wonderShown = null
      return this.restack()
    }
    if (!this.wonderPos) {
      // La place gardée dans la sauvegarde, si elle tient toujours ; sinon la
      // première parcelle libre, qui sera gardée à son tour.
      const saved = this.plan.wonderAt
      if (saved && this.spotFree(saved, Village.WONDER_R)) {
        this.wonderPos = { x: saved.x, y: GROUND_Y, z: saved.z }
        this.lots.push({ x: saved.x, z: saved.z, r: Village.WONDER_R })
      } else {
        const slot = this.nextSlot(Village.WONDER_R, 2.4, 4.2, true)
        this.wonderPos = { x: slot.x, y: slot.y, z: slot.z }
      }
    }
    // Seule la Merveille affichée se télécharge : celle du chantier en cours,
    // ou la dernière achevée. Les dix autres ne coûtent rien.
    const parts = (id && wonderModelParts(id, age, stage)) || wonderParts(age, stage)
    const geo = mergeGeometries(parts) ?? new BufferGeometry()
    grain(geo, 0.08)
    geo.rotateY(Math.atan2(-this.wonderPos.x, -this.wonderPos.z))
    geo.translate(this.wonderPos.x, this.wonderPos.y, this.wonderPos.z)
    this.wonderGeo = geo
    this.restack()
    // Le redessin relit l'état COURANT : si le chantier a changé de stade (ou
    // de Merveille) pendant le téléchargement, c'est lui qu'on dessine.
    this.wonderShown = { age, stage }
    if (id && !modelled)
      this.fetchModels([id], () => {
        if (this.wonderShown) this.setWonder(this.wonderShown.age, this.wonderShown.stage)
      })
  }

  /** Une place gardée (Merveille, musée) tient-elle toujours ? */
  private spotFree(p: { x: number; z: number }, r: number): boolean {
    return (
      this.island.isLand(p.x, p.z) &&
      this.clearOfLots(p.x, p.z, r) &&
      this.beltClear(p.x, p.z, r + Village.BELT_CLEAR)
    )
  }

  /** Les places réservées de la Merveille et du musée, pour la sauvegarde. */
  get wonderSpot(): { x: number; z: number } | null {
    return this.wonderPos ? { x: this.wonderPos.x, z: this.wonderPos.z } : null
  }
  get museumSpot(): { x: number; z: number } | null {
    return this.museumPos ? { x: this.museumPos.x, z: this.museumPos.z } : null
  }

  get wonderAt(): { x: number; z: number } | null {
    return this.wonderPos && this.wonderKey ? { x: this.wonderPos.x, z: this.wonderPos.z } : null
  }

  // ── Le musée de la tribu ──────────────────────────────────────────────────
  // Chaque relique rapportée d'expédition devient un objet sur son socle :
  // une esplanade dallée qui se remplit au fil des voyages. Un seul mesh,
  // reconstruit à chaque nouvelle pièce.

  private museumGeo: BufferGeometry | null = null
  private museumPos: { x: number; y: number; z: number } | null = null
  private relicIds: readonly string[] = []

  /** Une relique sur son socle : la taille d'une pièce de vitrine, pas celle
   *  de l'objet réel. Les fichiers arrivent de 0,67 à 1,5 de haut, support
   *  compris, et de 0,6 à 1 de large : une seule échelle aurait fait d'un
   *  astrolabe un monument et d'une plaque photographique une miette. Chaque
   *  pièce est donc ramenée à la même hauteur de vitrine, SAUF si sa largeur
   *  la ferait déborder sur le socle voisin (entraxe 0,68) : c'est alors la
   *  largeur qui commande. L'amphore et le disque de Nebra retombent sur les
   *  tailles réglées à l'œil en v3.52 (0,42 et ~0,35 de haut). */
  static readonly RELIC_H = 0.42
  static readonly RELIC_W = 0.38
  static relicScale(geo: BufferGeometry): number {
    const h = Math.max(0.01, heightOf(geo))
    const w = Math.max(0.01, halfSpanOf(geo) * 2)
    return Math.min(Village.RELIC_H / h, Village.RELIC_W / w)
  }

  setRelics(ids: readonly string[]): void {
    this.relicIds = [...ids]
    this.museumGeo?.dispose()
    this.museumGeo = null
    if (ids.length <= 0) return this.restack()
    if (!this.museumPos) {
      const saved = this.plan.museumAt
      if (saved && this.spotFree(saved, Village.MUSEUM_R)) {
        this.museumPos = { x: saved.x, y: GROUND_Y, z: saved.z }
        this.lots.push({ x: saved.x, z: saved.z, r: Village.MUSEUM_R })
      } else {
        const slot = this.nextSlot(Village.MUSEUM_R, 1.4, 2.4)
        this.museumPos = { x: slot.x, y: slot.y, z: slot.z }
      }
    }
    const n = Math.min(ids.length, 14)
    const p: BufferGeometry[] = []
    // L'esplanade : un dallage clair qui dit « ici, on garde ».
    p.push(part(new BoxGeometry(3.6, 0.22, 2.4), C.stoneLight, 0, 0.11, 0))
    p.push(part(new BoxGeometry(3.8, 0.1, 2.6), C.stoneDark, 0, 0.03, 0))
    // Une stèle en fond, pour la silhouette.
    p.push(part(new BoxGeometry(1.1, 1.15, 0.18), tint(C.stone, 3, 0.05), -1.05, 0.75, -0.95))
    const tops = [
      (): BufferGeometry => new SphereGeometry(0.11, 7, 5),
      (): BufferGeometry => new ConeGeometry(0.1, 0.24, 6),
      (): BufferGeometry => new BoxGeometry(0.16, 0.16, 0.16),
      (): BufferGeometry => new IcosahedronGeometry(0.11, 0),
      (): BufferGeometry => new CylinderGeometry(0.07, 0.1, 0.2, 7),
      (): BufferGeometry => new DodecahedronGeometry(0.11, 0),
      (): BufferGeometry => new SphereGeometry(0.1, 6, 4).scale(1.4, 0.7, 1),
    ]
    const hues = [C.bone, C.ochre, new Color('#d9b23f'), new Color('#c47a3f'), C.glass, C.stoneLight, new Color('#6b7078')]
    for (let i = 0; i < n; i++) {
      const px = -1.35 + (i % 5) * 0.68
      const pz = 0.62 - Math.floor(i / 5) * 0.72
      p.push(part(new CylinderGeometry(0.13, 0.17, 0.42, 6), tint(C.stone, i * 7, 0.06), px, 0.42, pz))
      // La vraie pièce quand elle est arrivée, la primitive sinon : le musée
      // ne reste jamais avec un socle vide le temps d'un téléchargement.
      const id = ids[i]!
      const model = modelGeometry(id)
      if (model) {
        const k = Village.relicScale(model)
        // Posée sur le plateau du socle (0,63), face tournée vers l'allée.
        p.push(model.scale(k, k, k).translate(px, 0.63, pz))
      } else p.push(part(tops[i % tops.length]!(), tint(hues[i % hues.length]!, i * 13, 0.05), px, 0.72, pz))
    }
    const geo = mergeGeometries(p) ?? new BufferGeometry()
    grain(geo, 0.07)
    const rot = Math.atan2(-this.museumPos.x, -this.museumPos.z)
    geo.rotateY(rot)
    geo.translate(this.museumPos.x, this.museumPos.y, this.museumPos.z)
    this.museumGeo = geo
    this.restack()
    this.fetchModels(ids, () => this.setRelics(this.relicIds))
  }

  /** Va chercher les modèles manquants puis redessine — une seule fois, et
   *  seulement si ce village est encore à l'écran : une île reconstruite
   *  entre-temps a déjà son propre village. */
  private fetchModels(ids: readonly string[], redraw: () => void): void {
    void loadModels(ids).then((fresh) => {
      if (fresh && this.group.parent) redraw()
    })
  }

  // ── Ce que le marchand a laissé ───────────────────────────────────────────
  // Le lot d'étain est posé entre le foyer et le paravent, du côté du camp
  // que le colon ne traverse jamais : simulé sur 1 440 allers-retours vers
  // tout le pourtour de l'île, son chemin passe au plus près à 0,45 du
  // centre du lot — qui en fait 0,36 de demi-largeur à cette échelle.
  //
  // Les huit lots suivants n'ont PAS leur place au camp. La même simulation,
  // refaite pour eux (v3.55), le dit sans appel : hors des emprises de la
  // tente, de l'appentis, du séchoir, du bois, du cadre, du paravent et du
  // feu, il ne reste dans le rayon du camp aucun carré de 1 × 1 que le colon
  // ne traverse pas — et au-delà commencent les rues et les parcelles. Neuf
  // lots autour de l'étain, c'était marcher dessus à chaque tournée.
  //
  // Ils vont donc sur un QUAI DU MARCHAND, une parcelle à eux tirée comme
  // celle du musée (règle de la ruelle comprise), à l'écart des nœuds de
  // ressource, du rivage de pêche et des rues : le colon n'a aucune raison
  // d'y aller, et il en contourne l'emprise comme celles du camp. Chaque
  // outil y a sa case FIXE, dans l'ordre du catalogue et non de l'achat : le
  // sel est toujours en tête, les terres rares toujours au bout. La parcelle
  // est choisie une fois, à la première marchandise, puis gardée dans la
  // sauvegarde (`goods`) et reprise AVANT tout nouveau bâtiment : elle ne
  // bouge plus, et les bâtiments déjà posés non plus.

  private goodsGeo: BufferGeometry | null = null
  private toolIds: readonly string[] = []
  /** Coordonnées locales au foyer, comme CAMP, et échelle propre au lot. */
  private static readonly TIN_SPOT = { x: -1.3, z: -2.02, scale: 0.85 }
  /** Les lots du quai, dans l'ordre du catalogue : la case ne dépend que de
   *  l'outil. */
  static readonly CARGO: readonly string[] = TOOLS.map((t) => t.id).filter((id) => id !== 'etain')
  /** Entraxe des cases : 1,15 en largeur laisse au moins 0,13 entre deux lots
   *  voisins (le gouvernail fait 0,98, le conteneur couché 1,17) ; 1,05 en
   *  profondeur, pour les deux rangées. */
  private static readonly CARGO_DX = 1.15
  private static readonly CARGO_DZ = 1.05
  /** La terre battue du quai, et le rayon qui la couvre (demi-diagonale). */
  private static readonly QUAY = { w: 4.7, d: 1.95 }
  static readonly GOODS_R = Math.hypot(Village.QUAY.w / 2, Village.QUAY.d / 2) + 0.05
  /** Même échelle que l'étain : les lots sont modelés à l'échelle brute
   *  d'etain.glb, et se lisent ensemble comme une même cargaison. */
  private static readonly CARGO_K = 0.85 * SCALE
  private goodsPos: { x: number; z: number; rot: number } | null = null
  /** Le quai relu était sur la ceinture : il est reposé au prochain lot —
   *  ou, faute de place, laissé où il était (`goodsPrior`). */
  goodsMoved = false
  private goodsPrior: { x: number; z: number } | null = null
  /** Emprise de chaque lot posé, en monde : un rectangle orienté. Lu par les
   *  tests (chemin du colon, chevauchements). */
  goodsLots: { id: string; x: number; z: number; yaw: number; hx: number; hz: number }[] = []

  /** Où sont les marchandises du quai — à écrire dans la sauvegarde. */
  get goodsAt(): { x: number; z: number } | null {
    return this.goodsPos ? { x: this.goodsPos.x, z: this.goodsPos.z } : null
  }

  /** Ce que le colon contourne en plus du camp : le quai, s'il existe. */
  get blockers(): { x: number; z: number; r: number }[] {
    return this.goodsPos ? [{ x: this.goodsPos.x, z: this.goodsPos.z, r: Village.GOODS_R }] : []
  }

  /** Reprend le quai de la sauvegarde. À appeler juste après `adoptLayout`,
   *  AVANT la Merveille, le musée et les nouveaux bâtiments : ils le
   *  contournent comme n'importe quelle parcelle. Un quai qui ne tiendrait
   *  plus (île retracée) est oublié : il sera retiré au sort au prochain
   *  `setTools`. */
  adoptGoods(saved: { x: number; z: number } | null | undefined): void {
    if (!saved || this.goodsPos) return
    const r = Village.GOODS_R
    if (!this.island.isLand(saved.x, saved.z) || !this.clearOfLots(saved.x, saved.z, r)) return
    // Sur la ceinture : il sera reposé ailleurs (grand tracé).
    if (!this.beltClear(saved.x, saved.z, r + Village.BELT_CLEAR)) {
      this.goodsMoved = true
      this.goodsPrior = { x: saved.x, z: saved.z }
      return
    }
    this.goodsPos = { x: saved.x, z: saved.z, rot: Math.atan2(HEARTH.x - saved.x, HEARTH.z - saved.z) }
    this.lots.push({ x: saved.x, z: saved.z, r })
  }

  /** Rien de ce qui attire le colon ne doit tomber sur le quai : ni arbre,
   *  ni bloc, ni buisson, ni plage de pêche, ni rue. Sinon il irait
   *  chercher sa ressource au milieu des caisses. */
  private goodsClear(x: number, z: number, strict = true, gap = 1.0): boolean {
    const r = Village.GOODS_R + 0.3
    if (strict && !this.nodeXZ) {
      this.nodeXZ = []
      // Les sapins ne comptent pas : le quai les abat comme une parcelle
      // (`clearCorridor`), et un arbre abattu n'est plus un nœud de bois.
      // Blocs et buissons, eux, ne s'abattent pas — un buisson au milieu des
      // caisses enverrait le colon cueillir sur le quai.
      for (const m of this.island.pickables) {
        if (this.island.kindFor(m) === 'wood') continue
        for (let i = 0; i < m.count; i++) {
          const p = this.island.instancePosition(m, i)
          this.nodeXZ.push(p.x, p.z)
        }
      }
    }
    if (strict)
      for (let i = 0; i < this.nodeXZ!.length; i += 2)
        if (Math.hypot(this.nodeXZ![i]! - x, this.nodeXZ![i + 1]! - z) < r) return false
    for (const c of this.island.cells) if (c.beach && Math.hypot(c.x - x, c.z - z) < r) return false
    for (const a of this.goodsAvoid) if (Math.hypot(a.x - x, a.z - z) < Village.GOODS_R + a.r) return false
    this.buildLanes()
    for (const lane of this.lanes!)
      for (const q of lane.pts) if (Math.hypot(q.x - x, q.z - z) < Village.GOODS_R + gap) return false
    for (const q of this.roadPath)
      if (Math.hypot(q.x - x, q.z - z) < Village.GOODS_R + gap) return false
    return true
  }
  private nodeXZ: number[] | null = null

  /** Aucun rocher ni buisson sous le disque (les sapins s'abattent). */
  private bare(x: number, z: number, r: number): boolean {
    if (!this.nodeXZ) {
      this.nodeXZ = []
      for (const m of this.island.pickables) {
        if (this.island.kindFor(m) === 'wood') continue
        for (let i = 0; i < m.count; i++) {
          const p = this.island.instancePosition(m, i)
          this.nodeXZ.push(p.x, p.z)
        }
      }
    }
    for (let i = 0; i < this.nodeXZ.length; i += 2)
      if (Math.hypot(this.nodeXZ[i]! - x, this.nodeXZ[i + 1]! - z) < r + 0.5) return false
    return true
  }
  /** Zones que le quai ne doit pas couvrir, hors du village : l'enclos à
   *  moutons de la faune, tiré au hasard à chaque chargement. */
  goodsAvoid: readonly { x: number; z: number; r: number }[] = []

  /** La parcelle du quai : d'abord le long des rues, comme un bâtiment,
   *  sinon n'importe où sur l'île en partant du feu. Jamais de repli SUR le
   *  feu, contrairement aux bâtiments : faute de place, les marchandises
   *  restent dans la cale plutôt que de couvrir le foyer. */
  private goodsSlot(): { x: number; z: number; rot: number } | null {
    const r = Village.GOODS_R
    // 2,4 et non la demi-largeur du quai : la parcelle recule alors de la rue
    // de 2,4 + 1,25 (voir `laneSlot`), juste au-delà des 3,6 qu'exige
    // `goodsClear` — sinon aucune parcelle de rue ne passait jamais.
    const fp = 2.4
    const cells = [...this.island.cells].sort(
      (a, b) => Math.hypot(a.x - HEARTH.x, a.z - HEARTH.z) - Math.hypot(b.x - HEARTH.x, b.z - HEARTH.z),
    )
    let s: { x: number; z: number } | null = null
    // Deux passes. D'abord une parcelle sans bloc ni buisson. Sur six îles
    // témoins sur quinze il n'y en a aucune : on tolère alors blocs et
    // buissons — `placeGoods` (main.ts) les retire des cibles du colon, qui
    // n'a donc toujours aucune raison d'aller sur le quai. Rivage et rues
    // restent interdits dans les deux passes.
    // Troisième passe, pour les îles les plus serrées (4 sur 15) : le quai
    // peut border une rue à 0,5 près au lieu de 1 — la chaussée reste libre,
    // le colon passe à côté sans le traverser — et son emprise ne réserve
    // plus de marge de parcelle (empreinte 1,6 au lieu de 2,4).
    // Passes suivantes, depuis la ceinture. Avant l'âge 7, sur l'île de base,
    // le quai peut border le sentier (relax 1), puis le tracé de la future
    // voie (relax 2) — comme un bâtiment, voir `slotOrNull`. Après, le bourg
    // plein jusqu'à la voie : la bande côtière, sur un cap assez large.
    const early = this.railRadii !== this.beltRadii
    for (const [strict, gap, foot, coast, relax] of [
      [true, 1.0, fp, false, 0],
      [false, 1.0, fp, false, 0],
      [false, 0.5, 1.6, false, 0],
      [false, 0.5, 1.6, false, early ? 1 : -1],
      [false, 0.5, 1.6, false, early ? 2 : -1],
      [false, 0.5, 1.6, true, 0],
    ] as const) {
      if (relax < 0) continue
      const accept = (x: number, z: number): boolean => this.goodsClear(x, z, strict, gap)
      if (!coast && relax === 0) s = this.laneSlot(r, foot, 0, accept)
      if (s) break
      this.relaxBelt = relax
      for (const c of cells) {
        if (!this.fits(new Vector3(c.x, GROUND_Y, c.z), r, foot, 0, false, accept, coast)) continue
        this.lots.push({ x: c.x, z: c.z, r })
        s = { x: c.x, z: c.z }
        break
      }
      this.relaxBelt = 0
      if (s) break
    }
    // Les lots regardent le feu : le village voit ce que le marchand a laissé.
    return s ? { x: s.x, z: s.z, rot: Math.atan2(HEARTH.x - s.x, HEARTH.z - s.z) } : null
  }

  setTools(ids: readonly string[]): void {
    this.toolIds = [...ids]
    this.goodsGeo?.dispose()
    this.goodsGeo = null
    this.goodsLots = []
    const parts: BufferGeometry[] = []
    if (ids.includes('etain')) {
      const tin = modelGeometry('etain')
      if (tin) {
        const { x, z, scale } = Village.TIN_SPOT
        // Construit dans le repère du campement (orienté vers le feu), puis
        // porté en monde. PAS de lueur du feu peinte dessus, contrairement aux
        // peaux voisines : à 2,9 u du foyer, elle virait le métal gris en jaune
        // pâle, et le lot disparaissait dans la terre battue déjà blanchie par
        // le halo (mesuré : luminance 200 contre 237 pour le sol). L'étain doit
        // rester froid pour se lire comme du métal.
        // Mesuré AVANT la mise à l'échelle : three recalcule la boîte en place.
        const hx = halfX(tin) * scale * SCALE
        const hz = halfZ(tin) * scale * SCALE
        const yaw = facingFire(x, z)
        tin.scale(scale, scale, scale).rotateY(yaw).translate(x, 0, z)
        grain(tin, 0.07)
        const wx = HEARTH.x + x * SCALE
        const wz = HEARTH.z + z * SCALE
        tin.translate(-x, 0, -z).scale(SCALE, SCALE, SCALE)
        tin.translate(wx, GROUND_Y, wz)
        parts.push(tin)
        this.goodsLots.push({ id: 'etain', x: wx, z: wz, yaw, hx, hz })
      }
    }
    const cargo = Village.CARGO.filter((id) => ids.includes(id))
    if (cargo.length > 0) {
      if (!this.goodsPos) this.goodsPos = this.goodsSlot()
      const prior = this.goodsPrior
      if (!this.goodsPos && prior) {
        // Délogé par la ceinture, sans place ailleurs : il ne disparaît pas.
        this.goodsPos = { x: prior.x, z: prior.z, rot: Math.atan2(HEARTH.x - prior.x, HEARTH.z - prior.z) }
        this.lots.push({ x: prior.x, z: prior.z, r: Village.GOODS_R })
        this.goodsMoved = false
      }
      this.goodsPrior = null
      if (this.goodsPos) {
        parts.push(this.quay(cargo, this.goodsPos))
        // Un sapin qui a poussé depuis (l'île grandit d'âge en âge) ne
        // traverse pas les caisses.
        this.island.clearCorridor([this.goodsPos], Village.GOODS_R + 0.6)
      }
    }
    this.goodsGeo = parts.length === 0 ? null : parts.length === 1 ? parts[0]! : mergeGeometries(parts)
    this.restack()
    // Seuls les outils possédés se téléchargent ; déjà là, rien ne part.
    this.fetchModels(ids, () => this.setTools(this.toolIds))
  }

  /** Le quai : une aire de terre battue bordée, et chaque lot sur sa case.
   *  Pas de lueur du feu ici non plus — le quai est loin du foyer, et le
   *  laiton, le fer et l'argent doivent garder leur froid de métal. */
  private quay(cargo: readonly string[], at: { x: number; z: number; rot: number }): BufferGeometry {
    const { w, d } = Village.QUAY
    const p: BufferGeometry[] = [
      part(new BoxGeometry(w + 0.2, 0.03, d + 0.2), C.soilDark, 0, 0.015, 0),
      part(new BoxGeometry(w, 0.05, d), C.soil, 0, 0.025, 0),
    ]
    const k = Village.CARGO_K
    const local: { id: string; x: number; z: number; yaw: number; hx: number; hz: number }[] = []
    for (const id of cargo) {
      const i = Village.CARGO.indexOf(id)
      const lx = ((i % 4) - 1.5) * Village.CARGO_DX
      // Première rangée côté feu (+z local) : les quatre premiers venus.
      const lz = (0.5 - Math.floor(i / 4)) * Village.CARGO_DZ
      // Le conteneur, long de 1,15, est couché en travers : debout dans le
      // sens de la profondeur, il mordait sur la rangée de devant.
      const yaw = id === 'conteneur' ? Math.PI / 2 : 0
      const g = modelGeometry(id)
      let hx: number
      let hz: number
      if (g) {
        const ex = halfX(g) * k
        const ez = halfZ(g) * k
        hx = yaw ? ez : ex
        hz = yaw ? ex : ez
        g.scale(k, k, k).rotateY(yaw).translate(lx, 0.05, lz)
        grain(g, 0.06)
        p.push(g)
      } else {
        // Le temps du téléchargement : une caisse, pas une case vide.
        hx = 0.3
        hz = 0.25
        p.push(part(new BoxGeometry(0.6, 0.4, 0.5), tint(C.wood, i * 11, 0.06), lx, 0.25, lz))
      }
      local.push({ id, x: lx, z: lz, yaw, hx, hz })
    }
    const geo = mergeGeometries(p) ?? new BufferGeometry()
    geo.rotateY(at.rot)
    geo.translate(at.x, GROUND_Y, at.z)
    const c = Math.cos(at.rot)
    const sn = Math.sin(at.rot)
    for (const l of local)
      this.goodsLots.push({
        ...l,
        // rotateY(θ) : x' = x cos θ + z sin θ, z' = −x sin θ + z cos θ.
        x: at.x + l.x * c + l.z * sn,
        z: at.z - l.x * sn + l.z * c,
        yaw: l.yaw + at.rot,
      })
    return geo
  }

  /** Ateliers, Merveille, musée et marchandises sont immobiles et partagent le
   *  même matériau : UN mesh pour tous, refait quand l'un d'eux change. Trois
   *  meshes, c'étaient six draw calls par image, ombre comprise. Si la fusion
   *  échoue (attributs qui divergent), chacun garde le sien — rien ne
   *  disparaît. */
  private restack(): void {
    // Toute pose (atelier, Merveille, musée, quai) passe par ici : le
    // cadastre au sol apprend qu'il doit se refaire.
    this.revision++
    const sources = [this.propsGeo, this.wonderGeo, this.museumGeo, this.goodsGeo]
    for (const m of this.statics) {
      this.group.remove(m)
      // La géométrie fusionnée est une copie : les sources restent à nous.
      if (!sources.includes(m.geometry)) m.geometry.dispose()
    }
    this.statics = []
    const parts = sources.filter((g): g is BufferGeometry => !!g)
    if (parts.length === 0) return
    const merged = parts.length === 1 ? null : mergeGeometries(parts)
    for (const geo of merged ? [merged] : parts) {
      const mesh = new Mesh(geo, this.solid)
      mesh.castShadow = true
      // Les bâtiments hérités recevaient les ombres (avant-toits, arches,
      // nuages) quand ils étaient des meshes séparés : le mesh fusionné doit
      // continuer, sinon leurs murs sous corniche s'éclaircissent.
      mesh.receiveShadow = true
      this.group.add(mesh)
      this.statics.push(mesh)
    }
  }

  update(dt: number, t: number, daylight = 1): void {
    this.tickTrain(dt)
    if (this.scaffold) {
      this.scaffoldLeft -= dt
      // La dernière seconde, l'échafaudage s'enfonce : il ne disparaît pas
      // d'un coup.
      this.scaffold.scale.y = Math.min(1, Math.max(0.001, this.scaffoldLeft))
      if (this.scaffoldLeft <= 0) {
        this.group.remove(this.scaffold)
        this.scaffold.geometry.dispose()
        this.scaffold = null
      }
    }
    this.tickPlane(dt)
    this.tickCar(dt)
    // L'éclairage public s'allume au crépuscule et s'éteint à l'aube — c'est
    // la part de jour qui commande, pas une minuterie.
    if (this.lampGlow) {
      const k = 1 - Math.min(1, Math.max(0, (daylight - 0.08) / 0.42))
      const m = this.lampGlow.material as MeshBasicMaterial
      m.opacity = k * (0.92 + Math.sin(t * 2.3) * 0.03)
      this.lampGlow.visible = k > 0.02
    }
    if (this.beaconHalo) {
      // Respiration lente : un brasier entretenu par un veilleur, pas un feu
      // de camp. Avant le test d'électricité — le phare vit à tous les âges.
      const b = 0.78 + Math.sin(t * 1.35) * 0.13 + Math.sin(t * 3.7) * 0.04
      this.beaconHalo.material.opacity = b
      this.beaconHalo.scale.setScalar(Village.BEACON_HALO * (0.94 + (b - 0.78) * 0.55))
    }
    if (this.electric) {
      // Une ampoule ne vacille pas : halos stables, juste un souffle
      // imperceptible pour que la lampe reste vivante à l'œil.
      this.fireLight.intensity = 1.5 + Math.sin(t * 3.1) * 0.03
      this.glowMat.opacity = 0.85
      this.halo.material.opacity = 0.6
      this.haloCore.material.opacity = 0.5
      return
    }
    // Flame flicker — cheap, and the only thing moving when the settler is away.
    const f = 1 + Math.sin(t * 11) * 0.12 + Math.sin(t * 6.3) * 0.08
    const fk = this.flameK
    this.flame.scale.set(fk, f * fk, fk)
    this.flame.rotation.y = t * 1.6
    this.core.scale.set(fk, (2 - f) * fk, fk)
    this.core.rotation.y = -t * 2.3
    this.fireLight.intensity = 1.45 + Math.sin(t * 9) * 0.35
    // La flaque de lumière bat avec la flamme: une nappe orange immobile se lit
    // comme un autocollant peint sur l'herbe.
    const pulse = 0.9 + Math.sin(t * 7.4) * 0.1 + Math.sin(t * 3.1) * 0.05
    this.glowMat.opacity = pulse
    this.halo.material.opacity = pulse * 0.8
    this.halo.scale.setScalar(this.haloBase * (0.94 + (f - 1) * 0.6))
    this.haloCore.material.opacity = pulse * 0.62
    this.haloCore.scale.setScalar(this.haloCoreBase * f)

    for (let i = 0; i < 7; i++) {
      const u = (t * 0.75 + i * 0.143) % 1
      const a = i * 2.4 + t
      this.dummy.position.set(
        Math.sin(a) * 0.18 * u,
        0.55 + this.fireLift + u * 1.5,
        Math.cos(a) * 0.18 * u,
      )
      this.dummy.scale.setScalar(Math.max(0.001, 1 - u))
      this.dummy.updateMatrix()
      this.embers.setMatrixAt(i, this.dummy.matrix)
    }
    this.embers.instanceMatrix.needsUpdate = true

    for (let i = 0; i < 9; i++) {
      const u = (t * 0.2 + i / 9) % 1
      const a = i * 1.9 + t * 0.4
      // La colonne dérive vers la caméra: droite, elle passait devant la tente
      // et effaçait le seul volume construit de l'île.
      this.dummy.position.set(
        Math.sin(a) * 0.4 * u + u * 0.75,
        1.15 + this.fireLift + u * 3.2,
        Math.cos(a) * 0.4 * u + u * 0.75,
      )
      this.dummy.scale.setScalar(0.42 + u * 1.25)
      this.dummy.rotation.set(a, a * 0.7, 0)
      this.dummy.updateMatrix()
      this.smoke.setMatrixAt(i, this.dummy.matrix)
      // La fumée se dissout en virant vers le ciel, faute d'alpha par instance.
      // Sa base prend la flamme: une colonne grise dès le premier bouffée dit
      // que le feu est éteint.
      this.scratch.copy(C.emberSmoke).lerp(C.smoke, smoothstep(0, 0.3, u))
      this.smoke.setColorAt(i, this.scratch.lerp(C.sky, u))
    }
    this.smoke.instanceMatrix.needsUpdate = true
    if (this.smoke.instanceColor) this.smoke.instanceColor.needsUpdate = true
  }
}
