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
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  Object3D,
  PointLight,
  RingGeometry,
  SphereGeometry,
  Sprite,
  TetrahedronGeometry,
  TorusGeometry,
  SpriteMaterial,
  Vector3,
} from 'three'
import type { DataTexture } from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PALETTE, rampTexture, smoothstep, tint } from './palette'
import type { Island } from './island'

/** Le foyer est posé à côté du point de dépôt, pas dessus, et perpendiculairement
 *  à l'axe de la caméra par défaut: sinon le colon rentre dans les flammes et sa
 *  silhouette se noie dedans. */
const HEARTH = { x: -1.15, z: 1.15 }
const tmpSlot = new Vector3()

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
  tile: new Color('#cd7358'),
  tileDark: new Color('#ab5943'),
  ridge: new Color('#f0dfc2'),
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
  for (let i = 0; i < 5; i++) {
    const z = -0.7 + i * 0.35
    p.push(part(new BoxGeometry(1.76, 0.1, 0.13), C.soilDark, -0.5, 0.22, z))
    for (let j = 0; j < 6; j++) {
      p.push(
        part(
          new ConeGeometry(0.095, 0.34, 4).rotateY(i + j),
          tint(C.wheat, i * 6 + j, 0.09),
          -1.24 + j * 0.3,
          0.37,
          z,
        ),
      )
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
  p.push(part(new BoxGeometry(0.42, 0.56, 0.08), C.woodDark, 0, 1.3, 0.7))
  p.push(part(new BoxGeometry(0.52, 0.08, 0.1), C.bone, 0, 1.62, 0.71))
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
  p.push(part(new BoxGeometry(3.26, 0.07, 0.26), warmLight, 0, 2.62, -0.29))
  // ×1.7 : un aqueduc porte son eau à ~8 m — à 2.65 u, le colon touchait le
  // canal du bout de la lance. Le slot ne bouge pas, seule la pierre grandit.
  for (const g of p) g.scale(1.7, 1.7, 1.7)
  return p
}

/** Everything the tribe builds. Buildings pop in when their technology lands, so
 *  research has an immediate, physical consequence on screen. */
export class Village {
  readonly group = new Group()
  private readonly solid = new MeshToonMaterial({ vertexColors: true })
  private readonly placed = new Set<string>()
  private readonly taken: Vector3[] = []
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

  constructor(private island: Island) {
    this.buildCampfire()
    // Les reflets miroir des loges ont vécu ici jusqu'au round 8 : une image
    // INVERSÉE des tipis sous la flottaison. Le jury les lisait — avec le
    // miroir du terrain — comme « posée sur du verre poli ». L'eau de ce round
    // ne renvoie rien : la fondation CONTINUE sous la surface (island.ts,
    // buildFoundation) et les objets posés dessus n'ont pas d'image.
  }

  private buildCampfire(): void {
    const fire = new Group()
    const fireY = this.island.heightAt(HEARTH.x, HEARTH.z)
    const p: BufferGeometry[] = []
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
    this.camp(p)
    const geo = mergeGeometries(p) ?? new BufferGeometry()
    grain(geo)
    bakeFirelight(geo)
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
    this.addDecals(fire, fireY)
    // Le colon rentre "au feu", c'est-à-dire au point (0,0,0) que lui fixe la
    // boucle: si le foyer y était aussi, il passerait sa vie dans les flammes.
    fire.position.set(HEARTH.x, fireY, HEARTH.z)
    fire.scale.setScalar(SCALE)
    this.group.add(fire)
  }

  /** Deux nappes posées au sol: la flaque de lumière du feu, qui déborde sur
   *  deux tuiles et bat avec la flamme, et les ombres de contact qui posent les
   *  abris sur la terre. Sans elles, tout le campement lévite. */
  private addDecals(fire: Group, fireY: number): void {
    // Les nappes vivent dans le repère du campement, qui est agrandi: la
    // hauteur du terrain doit être ramenée dans ce repère, sinon elles
    // s'enfoncent d'un cinquième de palier.
    const at = (x: number, z: number): number =>
      (this.island.heightAt(HEARTH.x + x * SCALE, HEARTH.z + z * SCALE) - fireY) / SCALE + 0.03

    // Nappe additive et non peinte: elle éclaircit et sature ce qu'elle
    // recouvre au lieu de le repeindre, donc la terre battue reste de la terre.
    // Et elle porte trois fois plus loin qu'avant — une flaque qui s'arrête au
    // pied de la tente n'éclaire rien, elle décore le foyer.
    const glow = [
      glowDisc(7.4, new Color('#d4621d'), 0.34, 26).translate(0, at(0, 0), 0),
      glowDisc(3.4, new Color('#ef8a3a'), 0.5, 22).translate(0, at(0, 0) + 0.004, 0),
      glowDisc(1.5, new Color('#ffb45c'), 0.46, 16).translate(0, at(0, 0) + 0.008, 0),
      // Braises visibles par la porte de la tente: quelqu'un est rentré.
      glowDisc(0.46, new Color('#ffc06a'), 0.9, 10)
        .rotateX(Math.PI / 2 - 0.42)
        .rotateY(TENT_YAW)
        .translate(
          CAMP.tent.x + Math.sin(TENT_YAW) * 1.68,
          at(CAMP.tent.x, CAMP.tent.z) + 0.6,
          CAMP.tent.z + Math.cos(TENT_YAW) * 1.68,
        ),
    ]
    // Chaque brasero a sa flaque au sol et son halo debout, incliné vers l'œil:
    // c'est le halo qui fait qu'une lanterne éclaire au lieu de seulement
    // briller, et ces deux-là signent l'habitat loin du foyer.
    const lamp = new Color('#e88a35')
    for (const [x, z] of [
      [CAMP.tent.x + 1.72, CAMP.tent.z + 1.02],
      [CAMP.frame.x - 0.95, CAMP.frame.z + 0.5],
    ] as const) {
      glow.push(glowDisc(1.4, lamp, 0.5, 14).translate(x, at(x, z) + 0.002, z))
      glow.push(
        glowDisc(0.62, new Color('#ffc275'), 0.72, 10)
          .rotateX(Math.PI / 2 - 0.55)
          .rotateY(CAMERA_YAW)
          .translate(x, at(x, z) + 0.34, z),
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
      glowDisc(r, dark, a, 14).translate(x, at(x, z) - 0.005, z),
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
  private camp(p: BufferGeometry[]): void {
    const put = (parts: BufferGeometry[], s: { x: number; z: number }, yaw?: number): void =>
      place(p, parts, yaw ?? facingFire(s.x, s.z), s.x, s.z)

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
    // décor posé plutôt qu'un lieu habité.
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

  /** L'emprise est-elle posée sur un sol d'un seul tenant ? Une ferme à cheval
   *  sur une marche de terrasse a le mur arrière noyé dans le bloc de terrain:
   *  on échantillonne le pourtour et on refuse les slots qui enjambent un
   *  dénivelé. */
  private flatEnough(slot: Vector3, footprint: number): boolean {
    if (footprint <= 0) return true
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const h = this.island.heightAt(slot.x + Math.cos(a) * footprint, slot.z + Math.sin(a) * footprint)
      if (Math.abs(h - slot.y) > 0.12) return false
    }
    return true
  }

  /** Le village se construit derrière le feu, jamais devant. Un bâtiment qui se
   *  glisse entre la caméra et le colon coûte plus cher que tous les défauts
   *  qu'on pourrait lui trouver par ailleurs; le reste (écart minimal, rayon de
   *  dégagement) empêche seulement les toits de s'interpénétrer.
   *  `central` est réservé aux monuments (campanile, moulin, aqueduc): un
   *  ouvrage urbain relégué seul en rase campagne lit comme une ruine. */
  /** Un hachage stable par rang de placement : le plan du village est
   *  déterministe pour une île donnée, mais jamais géométrique. */
  private static jitter(n: number, k: number): number {
    const s = Math.sin(n * 127.1 + k * 311.7) * 43758.5453
    return s - Math.floor(s)
  }

  /** Croissance organique en hameaux, sur toute l'île. Le verdict du joueur
   *  était sans appel : la couronne régulière autour du feu lisait comme un
   *  cercle de pierres, pas comme un village. Ici, chaque bâtiment s'installe
   *  près d'un voisin (distance de ruelle ~3,5), un nouveau hameau s'ouvre
   *  tous les cinq bâtiments un peu plus loin, et le terrain doit être dégagé
   *  (ni arbre, ni camp, ni pente). */
  private nextSlot(spacing = 3.4, footprint = 0, central = false): Vector3 {
    const n = this.taken.length
    const newHamlet = !central && n > 2 && n % 5 === 4
    let best: Vector3 | null = null
    let bestScore = Infinity
    for (const c of this.island.cells) {
      if (c.beach || c.trod) continue
      const r = Math.hypot(c.x, c.z)
      if (r < 4.2) continue
      const slot = tmpSlot.set(c.x, c.height, c.z)
      if (this.taken.some((t) => t.distanceToSquared(slot) < spacing * spacing)) continue
      // L'emprise s'ajoute au dégagement du camp : le moulin ×4 posé « central »
      // venait frôler la toile du grand tipi à un dixième d'unité.
      if (CAMP_BLOCKERS.some((b) => Math.hypot(c.x - b.x, c.z - b.z) < b.r + 1.9 + footprint * 0.5))
        continue
      // Le dégagement aux sapins suit l'emprise : depuis les remises à
      // l'échelle, une villa de 4 u posée à 1.25 u d'un tronc le prend en toit.
      if (this.treeDist(c.x, c.z) < 1.25 + footprint * 0.4) continue
      if (!this.flatEnough(slot, footprint)) continue

      let dNear = Infinity
      for (const t of this.taken) dNear = Math.min(dNear, t.distanceTo(slot))
      const j = Village.jitter(n, c.gx * 131 + c.gz) * 2.2
      let score: number
      if (central) {
        score = r * 2.2 + j
      } else if (this.taken.length === 0) {
        // Premier bâtiment : à portée du feu, sans le toucher.
        score = Math.abs(r - 6) * 2 + j
      } else if (newHamlet) {
        // Fondation d'un nouveau hameau : à l'écart des autres, pas en exil.
        score = Math.abs(dNear - 8.5) * 1.6 + Math.max(0, r - 16) * 2 + j
      } else {
        // Extension du bâti : à distance de ruelle du voisin le plus proche.
        score = Math.abs(dNear - 3.5) * 2.4 + Math.max(0, r - 15) * 1.2 + j
      }
      if (score < bestScore) {
        bestScore = score
        best = slot.clone()
      }
    }
    if (!best && footprint > 0) return this.nextSlot(spacing, 0, central)
    if (!best && spacing > 1.4) return this.nextSlot(spacing * 0.65, 0, central)
    const fr = 6 + Math.min(n * 0.4, 6)
    const fallback = new Vector3(Math.cos(n * 2.4) * fr, 0, Math.sin(n * 2.4) * fr)
    fallback.y = this.island.heightAt(fallback.x, fallback.z)
    const picked = best ?? fallback
    this.taken.push(picked)
    return picked
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

  /** Monuments urbains: ils réclament un slot proche du centre, pas la lisière. */
  private static readonly MONUMENTS = new Set(['clock', 'windmill', 'aqueduct'])
  /** Emprise au sol des gros objets: le slot doit être plat sous toute la base.
   *  Les valeurs suivent les remises à l'échelle des rounds 1 et 2 (villa ×2,
   *  aqueduc ×1.7, moulins ×2.5/×5.5, campanile ×4.5, garage ×2, antenne). */
  private static readonly FOOTPRINT: Record<string, number> = {
    hut: 1.1, field: 1.7, granary: 1.0, aqueduct: 2.2,
    railway: 1.2, villa: 1.6, threefield: 0.8, milestone: 0.8,
    clock: 0.8, windmill: 1.7, watermill: 1.2, garage: 1.0, phone: 0.6,
  }
  /** Les quatre bâtiments v1 gardent les règles d'espacement de l'époque où ils
   *  étaient des Object3D séparés : les slots choisis — donc le plan du village
   *  entier — ne bougent pas d'un centimètre. */
  private static readonly LEGACY = new Set(['hut', 'field', 'granary', 'aqueduct'])

  sync(buildings: Set<string>): void {
    let dirty = false
    for (const b of buildings) {
      if (this.placed.has(b)) continue
      // L'écart minimal suit l'emprise : depuis les remises à l'échelle, une
      // villa de 4 u posée à 2 u d'une hutte lui rentrait dans le toit — et à
      // ×2.2 d'emprise elle venait encore s'accoler aux arches de l'aqueduc.
      const fp = Village.FOOTPRINT[b] ?? 0.5
      const s = Village.LEGACY.has(b)
        ? this.nextSlot(3.4, Village.FOOTPRINT[b] ?? 0, Village.MONUMENTS.has(b))
        : this.nextSlot(Math.max(2.0, fp * 2.6), fp, Village.MONUMENTS.has(b))
      this.propPlacements.push({ id: b, x: s.x, y: s.y, z: s.z, rot: Math.atan2(-s.x, -s.z) })
      this.placed.add(b)
      dirty = true
    }
    // Une seule refonte du mesh par lot : au chargement d'une partie avancée,
    // reconstruire après chaque savoir rendait le coût quadratique.
    if (dirty) this.rebuildProps()
  }


  // ── Ateliers de savoir ────────────────────────────────────────────────────
  // Chaque technologie pose son objet dans le village : le savoir se VOIT.
  // Tous les ateliers vivent dans UN SEUL mesh fusionné (this.propsMesh) :
  // dix-sept objets pour un draw call.

  private readonly propPlacements: { id: string; x: number; y: number; z: number; rot: number }[] = []
  private propsMesh: Mesh | null = null

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
        p.push(part(new BoxGeometry(0.16, 0.045, 0.06), C.ochre, 0.08, 0.4, 0.04))
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
        // Forge : enclume, bac, charbon, lueur.
        p.push(part(new BoxGeometry(0.14, 0.18, 0.14), C.woodDark, -0.2, 0.09, 0))
        p.push(part(new BoxGeometry(0.3, 0.08, 0.12), iron, -0.2, 0.22, 0))
        p.push(part(new BoxGeometry(0.34, 0.12, 0.26), PALETTE.rockDark, 0.22, 0.06, 0))
        p.push(part(new BoxGeometry(0.26, 0.05, 0.18), C.emberCore, 0.22, 0.14, 0))
        for (let i = 0; i < 4; i++) p.push(part(new DodecahedronGeometry(0.05, 0), C.char, 0.1 + (i % 2) * 0.2, 0.2, -0.05 + (i % 3) * 0.07))
        return p
      }
      case 'plough': {
        // Araire sur sa bande de terre RETOURNÉE, sillons marqués — posée dans
        // l'herbe, elle lisait comme une branche cassée.
        p.push(part(new BoxGeometry(1.3, 0.1, 0.8).rotateY(0.1), C.soil, 0, 0.05, 0))
        for (let i = 0; i < 3; i++)
          p.push(part(new BoxGeometry(1.16, 0.07, 0.11).rotateY(0.1), C.soilDark, 0, 0.11, -0.24 + i * 0.24))
        p.push(part(new CylinderGeometry(0.045, 0.055, 0.9, 5).rotateZ(1.1), C.wood, 0, 0.3, 0))
        p.push(part(new CylinderGeometry(0.035, 0.04, 0.5, 5).rotateZ(0.35), C.woodDark, 0.4, 0.5, 0))
        p.push(part(new BoxGeometry(0.2, 0.09, 0.1).rotateZ(0.5), iron, -0.4, 0.11, 0))
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
        p.push(part(new BoxGeometry(1.82, 0.09, 0.34), C.plaster, 0, 0.98, 0.58))
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
        p.push(part(new TorusGeometry(0.34, 0.05, 5, 10).rotateY(Math.PI / 2), C.woodDark, 0, 0.46, 0))
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2
          p.push(part(new BoxGeometry(0.06, 0.18, 0.12), C.wood, 0, 0.46 + Math.cos(a) * 0.34, Math.sin(a) * 0.34))
        }
        for (const sz of [-0.44, 0.44]) p.push(part(new CylinderGeometry(0.04, 0.05, 0.7, 5), C.wood, 0, 0.35, sz))
        p.push(part(new BoxGeometry(0.18, 0.06, 1.05).rotateX(0.22), C.woodDark, 0.26, 0.8, -0.1))
        p.push(part(new BoxGeometry(0.1, 0.035, 0.95).rotateX(0.22), C.water, 0.26, 0.85, -0.1))
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
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + 0.4
          p.push(part(new BoxGeometry(0.09, 0.5, 0.02).rotateZ(a), C.wood, Math.sin(a) * -0.28, 0.78 + Math.cos(a) * 0.28, 0.26))
        }
        p.push(part(new CylinderGeometry(0.03, 0.03, 0.14, 5).rotateX(Math.PI / 2), C.woodDark, 0, 0.78, 0.2))
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
        p.push(part(new BoxGeometry(0.02, 0.09, 0.015), C.char, 0, 0.81, 0.2))
        p.push(part(new BoxGeometry(0.07, 0.02, 0.015), C.char, 0.025, 0.78, 0.2))
        p.push(part(new SphereGeometry(0.05, 6, 5), gold, 0, 0.99, 0))
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
        p.push(part(new TorusGeometry(0.22, 0.04, 6, 12).rotateY(Math.PI / 2), C.stoneDark, 0.5, 0.38, 0))
        p.push(part(new BoxGeometry(0.4, 0.05, 0.05), C.stoneLight, 0.22, 0.38, 0.12))
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
        // Auto de 1.15 u : elle était plus petite que la charrette à bras de
        // l'âge du bronze.
        p.push(part(new BoxGeometry(1.15, 0.22, 0.52), C.tile, 0, 0.26, 0))
        p.push(part(new BoxGeometry(0.55, 0.22, 0.46), C.tileDark, -0.1, 0.47, 0))
        p.push(part(new BoxGeometry(0.44, 0.14, 0.48), new Color(0.75, 0.95, 1.1), -0.1, 0.44, 0))
        for (const sx of [-0.38, 0.38]) for (const sz of [-0.28, 0.28]) p.push(part(new CylinderGeometry(0.11, 0.11, 0.07, 8).rotateX(Math.PI / 2), C.char, sx, 0.13, sz))
        for (const sz of [-0.17, 0.17]) p.push(part(new SphereGeometry(0.04, 5, 4), new Color(1.7, 1.55, 1.0), 0.58, 0.28, sz))
        // ×2 : une auto fait ~4.2 m — à 1.15 u elle était plus COURTE que le
        // cheval (1.25 u) posé deux cases plus loin.
        for (const g of p) g.scale(2, 2, 2)
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
        // Petit avion à hélice sur cales.
        p.push(part(new CylinderGeometry(0.07, 0.05, 0.6, 7).rotateZ(Math.PI / 2), C.tile, 0, 0.3, 0))
        p.push(part(new BoxGeometry(0.16, 0.02, 0.85), C.plaster, 0.05, 0.34, 0))
        p.push(part(new BoxGeometry(0.12, 0.02, 0.3), C.plaster, -0.28, 0.38, 0))
        p.push(part(new BoxGeometry(0.02, 0.12, 0.1), C.tile, -0.3, 0.42, 0))
        p.push(part(new BoxGeometry(0.02, 0.22, 0.04).rotateX(0.6), C.woodDark, 0.33, 0.3, 0))
        for (const sz of [-0.1, 0.1]) p.push(part(new CylinderGeometry(0.035, 0.035, 0.03, 8).rotateX(Math.PI / 2), C.char, 0.05, 0.12, sz))
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
        p.push(part(new SphereGeometry(0.26, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.35).rotateX(-0.9).scale(1, 1, 0.5), C.bone, 0, 0.44, -0.08))
        p.push(part(new CylinderGeometry(0.014, 0.014, 0.24, 4).rotateX(-0.9), iron, 0, 0.52, 0.05))
        p.push(part(new SphereGeometry(0.03, 5, 4), C.tile, 0, 0.6, 0.13))
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
        const cell = new Color(0.5, 0.95, 1.6)
        for (const sx of [-0.24, 0.26]) {
          p.push(part(new BoxGeometry(0.44, 0.035, 0.4).rotateX(-0.65), C.stoneLight, sx, 0.3, 0))
          p.push(part(new BoxGeometry(0.4, 0.015, 0.34).rotateX(-0.65), cell, sx, 0.32, -0.02))
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
  private rebuildProps(): void {
    if (this.propsMesh) {
      this.group.remove(this.propsMesh)
      this.propsMesh.geometry.dispose()
      this.propsMesh = null
    }
    if (this.propPlacements.length === 0) return
    const all: BufferGeometry[] = []
    for (const pl of this.propPlacements) {
      const parts = this.propGeo(pl.id)
      if (!parts) continue
      for (const g of parts) all.push(g.rotateY(pl.rot).translate(pl.x, pl.y, pl.z))
    }
    const merged = mergeGeometries(all)
    if (!merged) return
    this.propsMesh = new Mesh(merged, this.solid)
    this.propsMesh.castShadow = true
    // Les bâtiments hérités recevaient les ombres (avant-toits, arches, nuages)
    // quand ils étaient des meshes séparés : le mesh fusionné doit continuer,
    // sinon leurs murs sous corniche s'éclaircissent.
    this.propsMesh.receiveShadow = true
    this.group.add(this.propsMesh)
  }

  /** Emprises au sol de tout ce qui est posé — la faune les évite. */
  get obstaclePoints(): { x: number; z: number }[] {
    return this.propPlacements.map((p) => ({ x: p.x, z: p.z }))
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
    return best
  }

  update(_dt: number, t: number): void {
    // Flame flicker — cheap, and the only thing moving when the settler is away.
    const f = 1 + Math.sin(t * 11) * 0.12 + Math.sin(t * 6.3) * 0.08
    this.flame.scale.set(1, f, 1)
    this.flame.rotation.y = t * 1.6
    this.core.scale.set(1, 2 - f, 1)
    this.core.rotation.y = -t * 2.3
    this.fireLight.intensity = 1.45 + Math.sin(t * 9) * 0.35
    // La flaque de lumière bat avec la flamme: une nappe orange immobile se lit
    // comme un autocollant peint sur l'herbe.
    const pulse = 0.9 + Math.sin(t * 7.4) * 0.1 + Math.sin(t * 3.1) * 0.05
    this.glowMat.opacity = pulse
    this.halo.material.opacity = pulse * 0.8
    this.halo.scale.setScalar(6.4 * (0.94 + (f - 1) * 0.6))
    this.haloCore.material.opacity = pulse * 0.62
    this.haloCore.scale.setScalar(2.5 * f)

    for (let i = 0; i < 7; i++) {
      const u = (t * 0.75 + i * 0.143) % 1
      const a = i * 2.4 + t
      this.dummy.position.set(Math.sin(a) * 0.18 * u, 0.55 + u * 1.5, Math.cos(a) * 0.18 * u)
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
        1.15 + u * 3.2,
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
