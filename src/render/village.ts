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
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  Object3D,
  PointLight,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PALETTE, smoothstep, tint } from './palette'
import type { Island } from './island'

interface Pending {
  object: Object3D
  age: number
}

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
} as const

/** Le colon rentre au feu, pas au centre géométrique de l'île: c'est ce qui
 *  fait du foyer un lieu où l'on revient, et non un décor à côté duquel on
 *  dépose. Lu par settler.ts. */
export const CAMP_HOME = { x: HEARTH.x + 1.49, z: HEARTH.z + 0.07 }

/** Position du foyer, pour que le colon sache vers quoi se tourner en rentrant. */
export const CAMP_FIRE = { x: HEARTH.x, z: HEARTH.z }

/** Emprise au sol de ce qui est plein, en monde: le colon la contourne. Un
 *  homme qui ressort par la peau d'une tente ruine le peu de solidité qu'on
 *  vient de donner au campement. */
export const CAMP_BLOCKERS: readonly { x: number; z: number; r: number }[] = [
  { x: HEARTH.x + CAMP.tent.x, z: HEARTH.z + CAMP.tent.z, r: 2.15 },
  { x: HEARTH.x + CAMP.lean.x, z: HEARTH.z + CAMP.lean.z, r: 1.4 },
  { x: HEARTH.x + CAMP.rack.x, z: HEARTH.z + CAMP.rack.z, r: 0.95 },
  { x: HEARTH.x + CAMP.wood.x, z: HEARTH.z + CAMP.wood.z, r: 1.0 },
  { x: HEARTH.x + CAMP.frame.x, z: HEARTH.z + CAMP.frame.z, r: 0.75 },
  { x: HEARTH.x, z: HEARTH.z, r: 1.35 },
]

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
  smoke: new Color('#8d9aa0'),
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

const FIRE_GLOW = new Color('#ff8a3c')

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
    const dx = -pos.getX(i)
    const dy = 0.75 - pos.getY(i)
    const dz = -pos.getZ(i)
    const d = Math.max(0.05, Math.hypot(dx, dy, dz))
    const facing = (dx * nor.getX(i) + dy * nor.getY(i) + dz * nor.getZ(i)) / d
    const k = Math.max(0, facing) * smoothstep(4.2, 1.1, d) * 0.5
    if (k < 0.005) continue
    c.setRGB(col.getX(i), col.getY(i), col.getZ(i)).lerp(FIRE_GLOW, k)
    col.setXYZ(i, c.r, c.g, c.b)
  }
  col.needsUpdate = true
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
): void {
  for (let k = 0; k < courses; k++) {
    const shift = k % 2 === 0 ? 0.03 : -0.03
    p.push(
      part(
        new BoxGeometry(w + shift, h * 0.92, d + shift),
        tint(k % 3 === 0 ? C.stoneDark : C.stone, seed + k * 5, 0.07),
        x,
        y + h * (k + 0.5),
        z,
      ),
    )
  }
}

/** Everything the tribe builds. Buildings pop in when their technology lands, so
 *  research has an immediate, physical consequence on screen. */
export class Village {
  readonly group = new Group()
  private readonly solid = new MeshToonMaterial({ vertexColors: true })
  private readonly placed = new Set<string>()
  private readonly growing: Pending[] = []
  private readonly taken: Vector3[] = []
  private readonly dummy = new Object3D()
  private readonly scratch = new Color()
  private flame!: Mesh
  private core!: Mesh
  private embers!: InstancedMesh
  private smoke!: InstancedMesh
  private fireLight!: PointLight
  private glowMat!: MeshBasicMaterial

  constructor(private island: Island) {
    this.buildCampfire()
  }

  private mesh(p: BufferGeometry[]): Mesh {
    const m = new Mesh(mergeGeometries(p) ?? new BufferGeometry(), this.solid)
    m.castShadow = true
    m.receiveShadow = true
    return m
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
      new MeshBasicMaterial({ transparent: true, opacity: 0.26, depthWrite: false }),
      9,
    )
    this.smoke.frustumCulled = false
    this.smoke.renderOrder = 3

    // Décroissance adoucie et portée longue: il faut que la chaleur atteigne la
    // tente et le colon. Une décroissance quadratique brûle le foyer avant
    // d'avoir éclairé quoi que ce soit à deux mètres.
    this.fireLight = new PointLight(0xff9d4e, 1.5, 10, 1.7)
    this.fireLight.position.y = 1.0

    fire.add(hearth, this.flame, this.core, this.embers, this.smoke, this.fireLight)
    this.addDecals(fire, fireY)
    // Le colon rentre "au feu", c'est-à-dire au point (0,0,0) que lui fixe la
    // boucle: si le foyer y était aussi, il passerait sa vie dans les flammes.
    fire.position.set(HEARTH.x, fireY, HEARTH.z)
    this.group.add(fire)
  }

  /** Deux nappes posées au sol: la flaque de lumière du feu, qui déborde sur
   *  deux tuiles et bat avec la flamme, et les ombres de contact qui posent les
   *  abris sur la terre. Sans elles, tout le campement lévite. */
  private addDecals(fire: Group, fireY: number): void {
    const at = (x: number, z: number): number =>
      this.island.heightAt(HEARTH.x + x, HEARTH.z + z) - fireY + 0.03

    const warm = new Color('#ef8a3a')
    const glow = [
      glowDisc(3.15, warm, 0.5, 22).translate(0, at(0, 0), 0),
      glowDisc(1.5, new Color('#ffb45c'), 0.34, 16).translate(0, at(0, 0) + 0.005, 0),
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

    const dark = new Color('#2a2419')
    const shade: [number, number, number, number][] = [
      [CAMP.tent.x, CAMP.tent.z, 1.95, 0.36],
      [CAMP.lean.x, CAMP.lean.z, 1.35, 0.3],
      [CAMP.rack.x, CAMP.rack.z, 0.95, 0.24],
      [CAMP.wood.x, CAMP.wood.z, 1.1, 0.28],
      [CAMP.frame.x, CAMP.frame.z, 0.85, 0.22],
      [CAMP.knap.x, CAMP.knap.z, 0.8, 0.18],
    ]
    const contact = shade.map(([x, z, r, a]) =>
      glowDisc(r, dark, a, 14).translate(x, at(x, z) - 0.005, z),
    )

    this.glowMat = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
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
    put(hideTent(1.9, 3.6), CAMP.tent, TENT_YAW)
    put(hideTent(1.15, 2.15), CAMP.lean, facingFire(CAMP.lean.x, CAMP.lean.z) - 0.4)
    put(dryingRack(1.85, 1.7), CAMP.rack, CAMERA_YAW + 0.3)
    put(woodPile(1.75), CAMP.wood)
    put(hideFrame(1.15, 1.4), CAMP.frame, CAMERA_YAW - 0.2)
    put(knappingSpot(), CAMP.knap)

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
  }

  /** Le village se construit derrière le feu, jamais devant. Un bâtiment qui se
   *  glisse entre la caméra et le colon coûte plus cher que tous les défauts
   *  qu'on pourrait lui trouver par ailleurs; le reste (écart minimal, rayon de
   *  dégagement) empêche seulement les toits de s'interpénétrer. */
  private nextSlot(): Vector3 {
    let best: Vector3 | null = null
    let bestScore = Infinity
    for (const slot of this.island.buildSlots) {
      const r = Math.hypot(slot.x, slot.z)
      if (r < 4) continue
      if (this.taken.some((t) => t.distanceToSquared(slot) < 3.4 * 3.4)) continue
      // Le campement de départ tient sa place, chacun selon son emprise: un
      // écart uniforme aurait soit laissé une hutte dans la tente, soit épuisé
      // les emplacements et renvoyé le quatrième bâtiment sur le tas de bois.
      if (
        CAMP_BLOCKERS.some(
          (b) => Math.hypot(slot.x - b.x, slot.z - b.z) < b.r + 1.9,
        )
      ) {
        continue
      }
      // L'axe (+x, +z) est celui de la caméra au premier chargement.
      const toward = (slot.x + slot.z) / (Math.SQRT2 * r)
      const score = r + Math.max(0, toward) * 7 + (r > 6.2 ? 40 : 0)
      if (score < bestScore) {
        bestScore = score
        best = slot
      }
    }
    const picked = best ? best.clone() : new Vector3(-4.6, this.island.heightAt(-4.6, 0), 0)
    this.taken.push(picked)
    return picked
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
    return this.mesh(p)
  }

  private makeField(): Object3D {
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
    return this.mesh(p)
  }

  private makeGranary(): Object3D {
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
    return this.mesh(p)
  }

  private makeAqueduct(): Object3D {
    const p: BufferGeometry[] = []
    // Naissance de l'arc à mi-hauteur: si la pile monte trop haut, il ne reste
    // qu'un trou de souris et l'aqueduc redevient un mur.
    const spring = 0.95
    const radius = 0.52
    for (let i = 0; i < 3; i++) {
      const x = -1.32 + i * 1.32
      masonry(p, 0.5, 0.62, 7, 0.226, x, 0, 0, i * 11)
      if (i < 2) {
        // Claveaux: neuf blocs le long de l'arc, c'est ce qui fait "taillé" plutôt
        // que "moulé".
        for (let k = 0; k <= 8; k++) {
          const a = (k / 8) * Math.PI
          p.push(
            part(
              new BoxGeometry(0.21, 0.22, 0.64).rotateZ(Math.PI / 2 - a),
              tint(k % 2 === 0 ? C.stone : C.stoneLight, k * 7 + i, 0.06),
              x + 0.66 - Math.cos(a) * radius,
              spring + Math.sin(a) * radius,
              0,
            ),
          )
        }
      }
    }
    masonry(p, 3.14, 0.56, 2, 0.22, 0, 1.58, 0, 21)
    p.push(part(new BoxGeometry(3.34, 0.12, 0.92), C.stone, 0, 2.08, 0))
    p.push(part(new BoxGeometry(3.18, 0.14, 0.78), C.stone, 0, 2.21, 0))
    p.push(part(new BoxGeometry(3.18, 0.3, 0.2), C.stoneDark, 0, 2.43, 0.29))
    p.push(part(new BoxGeometry(3.18, 0.3, 0.2), C.stoneDark, 0, 2.43, -0.29))
    p.push(part(new BoxGeometry(3.06, 0.16, 0.38), C.water, 0, 2.4, 0))
    p.push(part(new BoxGeometry(3.26, 0.07, 0.26), C.stoneLight, 0, 2.62, 0.29))
    p.push(part(new BoxGeometry(3.26, 0.07, 0.26), C.stoneLight, 0, 2.62, -0.29))
    return this.mesh(p)
  }

  update(dt: number, t: number): void {
    // Flame flicker — cheap, and the only thing moving when the settler is away.
    const f = 1 + Math.sin(t * 11) * 0.12 + Math.sin(t * 6.3) * 0.08
    this.flame.scale.set(1, f, 1)
    this.flame.rotation.y = t * 1.6
    this.core.scale.set(1, 2 - f, 1)
    this.core.rotation.y = -t * 2.3
    this.fireLight.intensity = 1.45 + Math.sin(t * 9) * 0.35
    // La flaque de lumière bat avec la flamme: une nappe orange immobile se lit
    // comme un autocollant peint sur l'herbe.
    this.glowMat.opacity = 0.9 + Math.sin(t * 7.4) * 0.1 + Math.sin(t * 3.1) * 0.05

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
      this.smoke.setColorAt(i, this.scratch.copy(C.smoke).lerp(C.sky, u))
    }
    this.smoke.instanceMatrix.needsUpdate = true
    if (this.smoke.instanceColor) this.smoke.instanceColor.needsUpdate = true

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
