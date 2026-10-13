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
  type Material,
  IcosahedronGeometry,
  InstancedBufferAttribute,
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
import { GROUND_Y, type Island } from './island'
import { follow, type Footprint, type Ground, type GroundSource, type Pt } from './ground'
import { DEER_GAIT, GULL_WING, PART, gaitUniform, rigMaterial, wingUniform, type Gait } from './fauna-rig'

/** Pièce animée : identifiant (`PART`) et pivot (x, y, z) en espace objet. */
type Rig = readonly [number, number, number, number]

/** Une pièce teintée puis posée — même recette que le village : tout un animal
 *  finit fondu en une seule géométrie, une espèce entière en un seul call.
 *  `rig` marque une pièce animée (patte, cou, aile) et le pivot où elle
 *  s'articule : c'est l'attribut `aPivot` que lit le vertex shader. */
function part(source: BufferGeometry, color: Color, x = 0, y = 0, z = 0, rig?: Rig): BufferGeometry {
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
  if (rig) geo.setAttribute('aPivot', new BufferAttribute(pivots(n, rig), 4))
  return geo
}

function pivots(n: number, rig: Rig): Float32Array {
  const out = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    out[i * 4] = rig[1]
    out[i * 4 + 1] = rig[2]
    out[i * 4 + 2] = rig[3]
    out[i * 4 + 3] = rig[0]
  }
  return out
}

const RIGID: Rig = [PART.RIGID, 0, 0, 0]

/** Soude les pièces. Dès qu'une pièce est animée, les autres reçoivent un
 *  `aPivot` nul (pièce 0, rigide) : la fusion exige les mêmes attributs
 *  partout. Une espèce sans pièce animée (mouton, poule, cheval en 3.61.0)
 *  n'en porte aucun — pas un octet de plus sur ce qui ne bouge pas. */
function weld(parts: BufferGeometry[]): BufferGeometry {
  if (parts.some((g) => g.getAttribute('aPivot')))
    for (const g of parts)
      if (!g.getAttribute('aPivot')) g.setAttribute('aPivot', new BufferAttribute(pivots(g.attributes.position!.count, RIGID), 4))
  return mergeGeometries(parts) ?? new BufferGeometry()
}

// ── Silhouettes ────────────────────────────────────────────────────────────
// Toutes construites face à +z. À quarante pixels, seul le profil compte : un
// cerf, c'est un cou dressé et des bois ; un mouton, une boule sur pattes.

/** Le corps du chevreuil (capsule couchée sur z, aplatie en y) : la référence
 *  des jonctions. Hanches et garrot doivent rester DEDANS (test A5). */
export const DEER_BODY = { y: 0.64, z: -0.04, r: 0.15, half: 0.23, sy: 1.14 } as const

export function deerGeo(): BufferGeometry {
  const coat = new Color('#a97a4e')
  // Le dos d'un chevreuil est nettement plus sombre que ses flancs, et son
  // ventre presque crème : c'est ce dégradé qui l'empêche de lire comme un
  // jouet en plastique d'une seule teinte.
  const back = new Color('#8a6238')
  const belly = new Color('#d8bd96')
  const dark = new Color('#6e4d2e')
  const hoof = new Color('#3b2b1d')
  const bone = new Color('#e8dfc8')
  const eye = new Color('#241a12')
  const p: BufferGeometry[] = []

  // Corps fuselé, un peu plus haut que large.
  const B = DEER_BODY
  p.push(part(new CapsuleGeometry(B.r, B.half * 2, 2, 8).rotateX(Math.PI / 2).scale(1, B.sy, 1), coat, 0, B.y, B.z))
  // Selle dorsale et ventre clair : deux calottes posées sur le corps.
  p.push(part(new CapsuleGeometry(0.128, 0.4, 2, 7).rotateX(Math.PI / 2).scale(1, 0.66, 1), back, 0, 0.75, -0.03))
  p.push(part(new CapsuleGeometry(0.118, 0.34, 2, 7).rotateX(Math.PI / 2).scale(1, 0.5, 1), belly, 0, 0.53, -0.02))
  // Le MIROIR : la tache blanche de la croupe, signature du chevreuil de dos.
  p.push(part(new SphereGeometry(0.115, 8, 6).scale(1, 1.1, 0.5), bone, 0, 0.68, -0.42))
  p.push(part(new SphereGeometry(0.05, 5, 4), bone, 0, 0.78, -0.44))

  // Cou dressé — c'est lui qui distingue le chevreuil du mouton à distance.
  p.push(part(new CylinderGeometry(0.05, 0.085, 0.42, 6).rotateX(0.38), coat, 0, 0.9, 0.28, DEER_NECK))
  p.push(part(new CylinderGeometry(0.035, 0.05, 0.2, 6).rotateX(0.38), belly, 0, 0.86, 0.33, DEER_NECK))
  p.push(part(new CapsuleGeometry(0.06, 0.12, 1, 6).rotateX(Math.PI / 2 - 0.25), coat, 0, 1.09, 0.38, DEER_NECK))
  // Chanfrein sombre, museau noir et bavette claire : le masque du chevreuil.
  p.push(part(new ConeGeometry(0.042, 0.12, 5).rotateX(Math.PI / 2), dark, 0, 1.07, 0.52, DEER_NECK))
  p.push(part(new SphereGeometry(0.028, 6, 5), eye.clone(), 0, 1.07, 0.57, DEER_NECK))
  p.push(part(new SphereGeometry(0.035, 6, 5).scale(1.2, 0.7, 1), bone, 0, 1.02, 0.5, DEER_NECK))
  for (const s of [-1, 1]) {
    // Œil sur le côté du chanfrein, comme chez tous les herbivores.
    p.push(part(new SphereGeometry(0.019, 5, 4), eye, s * 0.05, 1.11, 0.44, DEER_NECK))
    // Grandes oreilles en cuillère : chez le chevreuil elles font la moitié
    // de la tête. Doublées d'un intérieur clair.
    p.push(part(new ConeGeometry(0.045, 0.14, 5).rotateZ(s * 1.05).rotateX(-0.2), coat, s * 0.085, 1.17, 0.3, DEER_NECK))
    p.push(part(new ConeGeometry(0.028, 0.1, 4).rotateZ(s * 1.05).rotateX(-0.2), belly, s * 0.095, 1.17, 0.315, DEER_NECK))
    // Bois : merrain incliné, andouiller, et la pointe pâle du bout.
    p.push(part(new CylinderGeometry(0.014, 0.018, 0.24, 4).rotateZ(s * 0.55).rotateX(-0.35), bone, s * 0.06, 1.26, 0.32, DEER_NECK))
    p.push(part(new CylinderGeometry(0.01, 0.014, 0.14, 4).rotateZ(s * 1.25), bone, s * 0.12, 1.3, 0.36, DEER_NECK))
    p.push(part(new SphereGeometry(0.016, 5, 4), bone, s * 0.16, 1.34, 0.36, DEER_NECK))
  }

  // Pattes : un fuseau qui s'affine, et un sabot sombre au bout — une patte
  // d'une seule teinte se lisait comme un bâton planté sous le corps.
  // Chaque patte pivote à la hanche (y 0,60), DANS le corps : à 0,02 u au
  // moins de sa surface, la jonction ne s'ouvre jamais quand elle tourne. Le
  // fût monte jusqu'à la hanche (0,60 au lieu de 0,54), caché dans le corps
  // au repos, pour qu'une patte en arrière ne montre pas de jour sous le
  // ventre. Même nombre de triangles.
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const rig: Rig = [sz > 0 ? (sx > 0 ? PART.FL : PART.FR) : sx > 0 ? PART.HL : PART.HR, sx * 0.1, DEER_HIP_Y, sz * 0.26]
      p.push(part(new CylinderGeometry(0.026, 0.034, 0.5, 5), coat, sx * 0.1, 0.35, sz * 0.26, rig))
      p.push(part(new CylinderGeometry(0.022, 0.026, 0.12, 5), dark, sx * 0.1, 0.11, sz * 0.26, rig))
      p.push(part(new CylinderGeometry(0.026, 0.022, 0.05, 5), hoof, sx * 0.1, 0.035, sz * 0.26, rig))
    }
  return weld(p)
}

/** La hanche du chevreuil, et la base de son cou (au garrot, dans le corps). */
export const DEER_HIP_Y = 0.6
export const DEER_NECK: Rig = [PART.NECK, 0, 0.7, 0.18]

function sheepGeo(): BufferGeometry {
  const fleece = new Color('#e9e2cf')
  // Une toison n'est pas blanche : elle est crème sur le dessus et grise
  // dessous, là où elle traîne. Sans cet écart, la bête lisait comme un galet.
  const fleeceShade = new Color('#cfc6b0')
  const dark = new Color('#3a332c')
  const face = new Color('#4c4238')
  const hoof = new Color('#241f1a')
  const eye = new Color('#15110d')
  const p: BufferGeometry[] = []

  // Toison : un gros icosaèdre bosselé, ET des flocons qui débordent de sa
  // silhouette. C'est ce contour irrégulier qui fait « laine » plutôt que
  // « caillou » — un seul volume lisse ne suffisait pas.
  p.push(part(new IcosahedronGeometry(0.24, 1).scale(1.28, 0.95, 1), fleece, 0, 0.4, -0.02))
  p.push(part(new IcosahedronGeometry(0.2, 1).scale(1.2, 0.6, 0.95), fleeceShade, 0, 0.31, -0.02))
  const flock: [number, number, number, number][] = [
    [0.2, 0.52, 0.08, 0.1],
    [-0.22, 0.47, -0.12, 0.095],
    [0.16, 0.36, -0.26, 0.105],
    [-0.14, 0.5, 0.2, 0.085],
    [0.26, 0.4, -0.06, 0.08],
    [-0.24, 0.36, 0.06, 0.09],
  ]
  for (const [x, y, z, r] of flock) p.push(part(new IcosahedronGeometry(r, 0), fleece, x, y, z))
  // La queue, courte et laineuse.
  p.push(part(new IcosahedronGeometry(0.07, 0), fleece, 0, 0.4, -0.34))

  // Tête noire — le mouton de face n'est PAS de la même couleur que sa laine,
  // et c'est le contraste qui le rend lisible de loin.
  p.push(part(new CapsuleGeometry(0.055, 0.09, 1, 6).rotateX(Math.PI / 2 - 0.35), face, 0, 0.46, 0.3))
  p.push(part(new SphereGeometry(0.042, 6, 5).scale(1, 0.9, 1.1), dark, 0, 0.44, 0.37))
  p.push(part(new IcosahedronGeometry(0.075, 0), fleece, 0, 0.56, 0.24))
  // Toupet de laine entre les oreilles : le détail qui dit « mouton » d'un trait.
  p.push(part(new IcosahedronGeometry(0.05, 0), fleece, 0, 0.56, 0.31))
  for (const s of [-1, 1]) {
    // Oreilles tombantes, et un œil sombre de part et d'autre du chanfrein.
    p.push(part(new BoxGeometry(0.09, 0.03, 0.055).rotateZ(s * -0.35), face, s * 0.085, 0.475, 0.28))
    p.push(part(new SphereGeometry(0.014, 5, 4), eye, s * 0.04, 0.485, 0.35))
  }

  // Pattes fines, sabot plus sombre encore : quatre bâtons identiques
  // faisaient un tabouret, pas une bête.
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      p.push(part(new CylinderGeometry(0.024, 0.028, 0.24, 5), face, sx * 0.1, 0.16, sz * 0.15))
      p.push(part(new CylinderGeometry(0.028, 0.024, 0.05, 5), hoof, sx * 0.1, 0.03, sz * 0.15))
    }
  // Round 2 : à 0,63 u la toison arrivait à la taille du colon — un mouton
  // s'arrête au genou. ×0.62 → ~0,39 u, et le troupeau redevient du bétail.
  return weld(p).scale(0.62, 0.62, 0.62)
}

function henGeo(): BufferGeometry {
  const body = new Color('#f2efe4')
  // Une poule blanche n'est pas uniforme : son dos est plus chaud, ses
  // rémiges plus grises, et sa queue franchement plus sombre. À quarante
  // pixels, ce sont ces trois valeurs qui la font lire comme un animal.
  const backWarm = new Color('#e2d6bd')
  const wing = new Color('#cfc4ae')
  const tail = new Color('#9c8f7c')
  const red = new Color('#c8402f')
  const redDark = new Color('#9c2f22')
  const beak = new Color('#d99a3c')
  const leg = new Color('#c8862f')
  const eye = new Color('#211a13')
  const p: BufferGeometry[] = []

  // Corps ovoïde, un peu penché en avant comme une poule qui picore.
  p.push(part(new SphereGeometry(0.085, 7, 5).scale(1, 0.95, 1.25), body, 0, 0.13, 0))
  p.push(part(new SphereGeometry(0.07, 7, 5).scale(1, 0.6, 1.1), backWarm, 0, 0.18, -0.01))
  // Ailes plaquées : deux écailles sur les flancs, la marque la plus lisible
  // d'un oiseau posé.
  for (const s of [-1, 1])
    p.push(part(new SphereGeometry(0.055, 6, 5).scale(0.45, 0.85, 1.35).rotateY(s * 0.18), wing, s * 0.07, 0.14, -0.01))

  // Queue relevée : le triangle qui fait « poule » de profil, plus deux
  // rectrices qui en débordent.
  p.push(part(new ConeGeometry(0.05, 0.12, 4).rotateX(-1.15), tail, 0, 0.2, -0.12))
  for (const s of [-1, 1])
    p.push(part(new BoxGeometry(0.012, 0.075, 0.035).rotateX(-1.0).rotateZ(s * 0.25), tail, s * 0.022, 0.235, -0.155))

  // Tête, crête dentelée, barbillon et bec.
  p.push(part(new SphereGeometry(0.045, 6, 4), body, 0, 0.24, 0.08))
  p.push(part(new CylinderGeometry(0.028, 0.032, 0.05, 6), body, 0, 0.205, 0.06))
  for (let i = 0; i < 3; i++)
    p.push(part(new BoxGeometry(0.013, 0.03 + i * 0.012, 0.016), red, 0, 0.295 + i * 0.004, 0.095 - i * 0.028))
  p.push(part(new SphereGeometry(0.016, 4, 3), redDark, 0, 0.21, 0.11))
  p.push(part(new ConeGeometry(0.015, 0.05, 4).rotateX(Math.PI / 2), beak, 0, 0.24, 0.13))
  for (const s of [-1, 1]) p.push(part(new SphereGeometry(0.009, 4, 3), eye, s * 0.03, 0.253, 0.105))

  // Pattes : le tarse orange, et trois doigts posés au sol — sans eux la
  // poule flottait au-dessus de son ombre.
  for (const s of [-1, 1]) {
    p.push(part(new CylinderGeometry(0.008, 0.008, 0.09, 4), leg, s * 0.03, 0.045, 0.01))
    for (const [tx, tz] of [[0, 0.035], [0.022, 0.018], [-0.022, 0.018]] as [number, number][])
      p.push(part(new BoxGeometry(0.009, 0.007, 0.03).rotateY(tx * 8), leg, s * 0.03 + tx, 0.006, 0.01 + tz))
  }
  return weld(p)
}

function horseGeo(): BufferGeometry {
  const coat = new Color('#6b4630')
  // Un cheval bai : robe brune, extrémités et crinière noires, ventre plus
  // clair. Sans ces trois valeurs, la bête lisait comme une caisse sur pieds.
  const coatLight = new Color('#8a5d40')
  const belly = new Color('#a67a56')
  const mane = new Color('#241811')
  const hoof = new Color('#17110c')
  const sock = new Color('#e6dccb')
  const eye = new Color('#120d09')
  const p: BufferGeometry[] = []

  // Tronc : une masse haute et courte, encolure puissante.
  p.push(part(new CapsuleGeometry(0.22, 0.62, 2, 8).rotateX(Math.PI / 2).scale(1, 1.05, 1), coat, 0, 0.95, -0.02))
  p.push(part(new CapsuleGeometry(0.19, 0.5, 2, 7).rotateX(Math.PI / 2).scale(1, 0.55, 1), coatLight, 0, 1.08, -0.02))
  p.push(part(new CapsuleGeometry(0.17, 0.44, 2, 7).rotateX(Math.PI / 2).scale(1, 0.45, 1), belly, 0, 0.8, -0.02))
  // Croupe arrondie et queue tombante.
  p.push(part(new SphereGeometry(0.22, 8, 6).scale(1, 1, 0.85), coat, 0, 0.97, -0.34))
  p.push(part(new CapsuleGeometry(0.045, 0.36, 1, 5).rotateX(0.25), mane, 0, 0.82, -0.5))

  // Encolure, tête et chanfrein — c'est le profil qui fait le cheval.
  p.push(part(new CylinderGeometry(0.1, 0.16, 0.5, 7).rotateX(0.42), coat, 0, 1.24, 0.3))
  p.push(part(new CapsuleGeometry(0.085, 0.2, 1, 6).rotateX(Math.PI / 2 - 0.5), coat, 0, 1.5, 0.46))
  p.push(part(new CapsuleGeometry(0.06, 0.14, 1, 6).rotateX(Math.PI / 2 - 0.6), coatLight, 0, 1.44, 0.56))
  p.push(part(new SphereGeometry(0.055, 6, 5).scale(1.1, 0.9, 1), mane, 0, 1.38, 0.64))
  // Liste blanche sur le chanfrein : la marque la plus reconnaissable.
  p.push(part(new BoxGeometry(0.045, 0.02, 0.2).rotateX(-0.55), sock, 0, 1.47, 0.55))
  // Crinière en épis le long de l'encolure.
  for (let i = 0; i < 5; i++)
    p.push(part(new BoxGeometry(0.045, 0.12 - i * 0.012, 0.09), mane, 0, 1.28 + i * 0.06, 0.2 + i * 0.075))
  for (const s of [-1, 1]) {
    p.push(part(new ConeGeometry(0.032, 0.11, 5).rotateZ(s * 0.3), coat, s * 0.055, 1.58, 0.42))
    p.push(part(new SphereGeometry(0.02, 5, 4), eye, s * 0.065, 1.5, 0.5))
  }

  // Jambes : avant-bras épais, canon fin, un balzane blanche et un sabot noir.
  const legs: [number, number][] = [[-0.13, 0.26], [0.13, 0.26], [-0.13, -0.24], [0.13, -0.24]]
  legs.forEach(([lx, lz], i) => {
    p.push(part(new CylinderGeometry(0.055, 0.04, 0.42, 6), coat, lx, 0.62, lz))
    p.push(part(new CylinderGeometry(0.035, 0.032, 0.34, 5), coat, lx, 0.27, lz))
    if (i % 3 === 0) p.push(part(new CylinderGeometry(0.037, 0.037, 0.1, 5), sock, lx, 0.14, lz))
    p.push(part(new CylinderGeometry(0.042, 0.036, 0.08, 6), hoof, lx, 0.05, lz))
  })
  return weld(p)
}

export function gullGeo(): BufferGeometry {
  const body = new Color('#f4f6f4')
  const wing = new Color('#d9dfe0')
  const wingDark = new Color('#b9c2c6')
  const tip = new Color('#4a5054')
  const beak = new Color('#d9a13c')
  const eye = new Color('#1a1d20')
  const p: BufferGeometry[] = []

  // Corps fuselé, tête ronde, bec crochu — une mouette de dessous, c'est
  // surtout une croix blanche à bouts sombres.
  p.push(part(new CapsuleGeometry(0.05, 0.16, 1, 6).rotateX(Math.PI / 2), body, 0, 0, 0))
  p.push(part(new SphereGeometry(0.04, 5, 4), body, 0, 0.03, 0.14))
  p.push(part(new ConeGeometry(0.013, 0.06, 4).rotateX(Math.PI / 2), beak, 0, 0.03, 0.2))
  // Tache rouge du bec adulte, et l'œil.
  p.push(part(new SphereGeometry(0.008, 4, 3), new Color('#c2412c'), 0, 0.022, 0.215))
  for (const s of [-1, 1]) p.push(part(new SphereGeometry(0.008, 4, 3), eye, s * 0.022, 0.045, 0.155))

  // Queue en éventail, échancrée : sans elle l'oiseau lisait comme une croix.
  p.push(part(new BoxGeometry(0.1, 0.01, 0.12), wing, 0, 0, -0.16))
  for (const s of [-1, 1])
    p.push(part(new BoxGeometry(0.045, 0.009, 0.09).rotateY(s * 0.22), wing, s * 0.035, 0, -0.2))

  // Ailes en dièdre, bouts sombres : la signature de la mouette vue de loin.
  // Trois segments par aile — l'épaule, le bras, la main — pour que le profil
  // s'incurve au lieu de faire une planche.
  // Squelette (v3.61.0) : le premier segment tourne à l'épaule, DANS le corps ;
  // le reste de l'aile (bras, main, rémiges) tourne au coude, là où les deux
  // segments se touchent, puis suit l'épaule. Gauche de l'oiseau = +x.
  const [shx, shy, shz] = GULL_WING.shoulderAt
  const [elx, ely, elz] = GULL_WING.elbowAt
  for (const s of [-1, 1]) {
    const arm: Rig = [s > 0 ? PART.ARM_L : PART.ARM_R, s * shx, shy, shz]
    const hand: Rig = [s > 0 ? PART.HAND_L : PART.HAND_R, s * elx, ely, elz]
    p.push(part(new BoxGeometry(0.2, 0.014, 0.15).rotateZ(s * 0.1), wing, s * 0.12, 0.01, -0.01, arm))
    p.push(part(new BoxGeometry(0.24, 0.012, 0.13).rotateZ(s * 0.2), wingDark, s * 0.33, 0.045, -0.02, hand))
    p.push(part(new BoxGeometry(0.14, 0.011, 0.1).rotateZ(s * 0.32), tip, s * 0.51, 0.09, -0.03, hand))
    // Rémiges du bout, écartées comme des doigts.
    for (let k = 0; k < 3; k++)
      p.push(part(new BoxGeometry(0.07, 0.009, 0.022).rotateZ(s * 0.34).rotateY(s * (0.1 + k * 0.12)), tip, s * 0.6, 0.11, -0.05 + k * 0.03, hand))
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
  /** Le chemin du cadastre jusqu'à (tx, tz) ; vide hors cadastre. */
  path: Pt[]
  /** Opacité de repositionnement : 1 visible, 0 effacée (voir `rehome`). */
  fade: number
  /** Où la bête réapparaît une fois effacée ; null hors repositionnement. */
  warp: Pt | null
  /** Tirages d'étape ratés d'affilée. */
  miss: number
  /** Poids lissés du squelette (espèces riguées) : allure 0–1, broutage du
   *  cou 0–1, trot 0–1. Ils deviennent `aAnim.yzw` ; la phase, `aAnim.x`. */
  amp: number
  graze: number
  trot: number
}

/** Vitesse du fondu de repositionnement : un quart de seconde pour
 *  s'effacer, autant pour revenir — assez court pour ne pas laisser la bête
 *  plantée, assez long pour qu'on ne la voie pas sauter. */
const FADE = 4

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
  /** De combien la bête s'enfonce dans l'herbe quand elle broute ou dort.
   *  DOIT être proportionnel à sa taille : un décalage fixe de 0,1 unité, ce
   *  n'est rien sous un cheval et c'est le quart d'un mouton — la nuit, le
   *  troupeau disparaissait sous le sol, ne laissant que le dessus de la
   *  toison à ras de terre. */
  sink: number
  /** Demi-largeur du corps au sol : ce que le cadastre garde hors des murs. */
  body: number
  /** Espèce riguée (v3.61.0) : la phase avance avec la DISTANCE parcourue, à
   *  la cadence de l'allure, et le cou broute à la place du corps entier.
   *  Absente : l'ancien rebond à l'horloge, corps rigide. */
  gait?: Gait
}

/** Lissage exponentiel vers `want`, τ en secondes (63 % du chemin). */
function ease(v: number, want: number, dt: number, tau: number): number {
  return v + (want - v) * Math.min(1, dt / tau)
}

const TAU = Math.PI * 2

/** Avance la phase de marche. Espèce riguée : à la DISTANCE réellement
 *  parcourue (`d`), à la cadence de l'allure en cours — c'est ce qui garde le
 *  sabot planté, quel que soit `gait` ou la fuite. Ramenée dans [0, 2π) : le
 *  shader la lit en flottant 32 bits. Sinon : l'ancien rebond à l'horloge. */
function stride(b: Beast, cfg: LandCfg, d: number, dt: number, flee: boolean): void {
  const g = cfg.gait
  if (!g) {
    b.phase += dt * cfg.bobFreq * (flee ? 1.8 : 1)
    return
  }
  b.phase += d * (g.kWalk + (g.kTrot - g.kWalk) * b.trot)
  if (b.phase >= TAU) b.phase -= TAU * Math.floor(b.phase / TAU)
}

interface Gull {
  cx: number
  cz: number
  r: number
  a: number
  w: number
  alt: number
  phase: number
  /** Battement (v3.61.0) : phase de l'aile à l'horloge, poids du battu 0–1
   *  (0 = plané), état visé, temps restant dans cet état, combien d'états
   *  déjà enchaînés, et altitude perdue en plané (≤ 0). */
  wing: number
  flap: number
  flapping: boolean
  left: number
  laps: number
  drop: number
}

/** Durée d'un battu (2–3 s) ou d'un plané (3–5 s). Tirée de la graine de la
 *  mouette et du rang de l'épisode, pas de `Math.random` : le hasard de la
 *  faune (étapes, trajets) reste celui de la 3.59.0. */
function gullSpell(g: Gull): number {
  const r = Math.abs(Math.sin(g.phase * 12.9898 + g.laps * 78.233) * 43758.5453) % 1
  return g.flapping ? 2 + r : 3 + 2 * r
}

interface Spot {
  x: number
  z: number
}

type Zone = { x: number; z: number; r: number }

/** Recul entre le bord d'une emprise posée après coup (le quai du marchand)
 *  et un point d'habitat : une bête s'y ARRÊTE, et la demi-longueur d'un
 *  cheval (~0,6), le flou de sa cible (±0,2) et un pas de marge doivent rester
 *  hors des caisses. C'est aussi le recul que réclame le cheval au bâti. */
const BLOCKER_SPOT = 1.2
/** L'enclos palissade comprise (piquets à 3,1) : le rayon que `pen` publie
 *  au quai, et celui que l'enclos garde face à lui. */
const PEN_R = 3.3
/** Recul du centre de l'enclos au bord d'un obstacle du BÂTI. L'obstacle vaut
 *  emprise réelle + 0,45 (`Village.obstaclePoints`) ; la palissade est à 3,1
 *  et un piquet a 0,07 de rayon. 3,1 + 0,2 − 0,45 : les piquets restent à
 *  0,2 au moins de l'emprise réelle. Pas les 3,3 du quai : la marge de
 *  l'obstacle compte déjà, et un recul plus large déplacerait sans raison
 *  des enclos qui tenaient. */
const PEN_WALL = 3.1 + 0.2 - 0.45
/** La cabane à poules, rampe comprise. */
const COOP_R = 1.0

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
      path: [],
      fade: 1,
      warp: null,
      miss: 0,
      amp: 0,
      graze: 0,
      trot: 0,
    })
  }
  return herd
}

/** La faune ambiante : cinq espèces, une InstancedMesh chacune, cinq draw calls
 *  en tout. Elle ne produit rien — elle est là pour que l'île ait l'air de
 *  vivre sans le joueur, et pour dater chaque époque (gibier, puis troupeaux,
 *  puis basse-cour, chevaux, mouettes des ports). */
export class Fauna implements GroundSource {
  readonly group = new Group()
  private readonly skin = new MeshToonMaterial({ vertexColors: true })

  private readonly deerMesh: InstancedMesh
  private readonly sheepMesh: InstancedMesh
  private readonly henMesh: InstancedMesh
  private readonly horseMesh: InstancedMesh
  private readonly gullMesh: InstancedMesh
  /** Centre de l'enclos et du poulailler, déduits des zones d'habitat. */
  private penCenter: { x: number; z: number } | null = null
  /** L'enclos à moutons, palissade comprise (rayon 3,1), pour que le quai du
   *  marchand ne s'y pose pas. */
  get pen(): { x: number; z: number; r: number } | null {
    return this.penCenter ? { ...this.penCenter, r: PEN_R } : null
  }
  private coopAt: { x: number; z: number } | null = null
  /** Décor fixe des zones : la clôture du pré et la cabane à poules. La faune
   *  bouge, ses lieux non — un seul mesh fusionné pour les deux. */
  private pens: Mesh | null = null

  private readonly deer: Beast[]
  private readonly sheep: Beast[]
  private readonly hens: Beast[]
  private readonly horses: Beast[]
  private readonly gulls: Gull[] = []

  // Les zones d'habitat en vigueur : celles du relevé, moins ce que le quai
  // couvre (`setBlockers`).
  private deerSpots: Spot[]
  private sheepSpots: Spot[]
  private henSpots: Spot[]
  private horseSpots: Spot[]
  /** Les zones telles que relevées à la construction, avant tout quai : le
   *  quai peut apparaître en cours de partie, et chaque `setBlockers` repart
   *  d'elles plutôt que de filtrer un filtrage. `sheep` est le pré ENTIER,
   *  avant le resserrement autour de l'enclos. */
  private readonly home: { deer: Spot[]; sheep: Spot[]; hen: Spot[]; horse: Spot[] }
  /** Tout ce que les bêtes contournent : le bâti, et le quai dès qu'il existe. */
  private solid: Zone[]

  // Les allures sont figées ici plutôt qu'en littéraux dans update : zéro objet
  // construit par frame.
  private readonly deerCfg: LandCfg = { speed: 0.55, turn: 2.4, step: 3.4, grazeBias: 0.6, grazePitch: 0.3, pauseMin: 2, pauseMax: 5, bobAmp: 0.03, bobFreq: 6.5, sink: 0.05, body: 0.3, gait: DEER_GAIT }
  private readonly sheepCfg: LandCfg = { speed: 0.32, turn: 1.8, step: 1.7, grazeBias: 0.8, grazePitch: 0.26, pauseMin: 2.5, pauseMax: 6, bobAmp: 0.02, bobFreq: 5, sink: 0.02, body: 0.28 }
  private readonly henCfg: LandCfg = { speed: 0.85, turn: 9, step: 1.5, grazeBias: 0.75, grazePitch: 0.5, pauseMin: 0.6, pauseMax: 1.8, bobAmp: 0.014, bobFreq: 16, sink: 0.008, body: 0.12 }
  private readonly horseCfg: LandCfg = { speed: 0.48, turn: 1.3, step: 4.5, grazeBias: 0.7, grazePitch: 0.24, pauseMin: 3, pauseMax: 7, bobAmp: 0.035, bobFreq: 3.8, sink: 0.07, body: 0.35 }

  /** Un trajet est-il dégagé ? Vrai si le segment ne coupe l'emprise d'aucun
   *  bâtiment ni du camp : les bêtes contournent, elles ne traversent plus. */
  private readonly segClear: (x0: number, z0: number, x1: number, z1: number) => boolean

  private readonly island: Island
  /** Le cadastre au sol (ground.ts) : sans lui, l'ancienne poussée radiale. */
  private ground: Ground | null = null
  private groundRev = -1
  /** Change quand l'enclos ou le poulailler se (re)pose : le cadastre se refait. */
  revision = 0
  /** Les emprises du bâti, relevées à la construction. */
  private readonly obstacles: Zone[]

  // Champs déclarés à la main et non en propriétés de paramètre : Node, qui
  // ne fait que retirer les types, charge ainsi la faune dans les tests.
  constructor(island: Island, obstacles: Zone[] = []) {
    this.island = island
    this.obstacles = obstacles
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
      for (const o of this.solid) if (hits(o.x, o.z, o.r + 0.25)) return false
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

    this.home = { deer: this.deerSpots, sheep: this.sheepSpots, hen: this.henSpots, horse: this.horseSpots }
    this.solid = this.obstacles

    // Le troupeau de moutons reste groupé : ses cibles se limitent au voisinage
    // d'une ancre, tirée là où les prés sont les plus denses. Un point du pré
    // ne garde que ~1 u du bâti, et la palissade en fait 3,1 : l'ancre tirée
    // peut planter la clôture dans un moulin. Elle se pose alors au plus près
    // dans le pré, sans second tirage — la suite des tirages (troupeaux,
    // mouettes) ne bouge pas, et une île dont l'enclos tenait déjà reste
    // identique au tirage près.
    const drawn = this.sheepSpots[(Math.random() * this.sheepSpots.length) | 0]!
    const anchor = this.penSite(drawn, this.sheepSpots, [])
    if (anchor) {
      this.sheepSpots = this.flock(anchor, this.sheepSpots)
      this.penCenter = { x: anchor.x, z: anchor.z }
    }
    const coop = this.henSpots.reduce(
      (a, s) => ({ x: a.x + s.x / this.henSpots.length, z: a.z + s.z / this.henSpots.length }),
      { x: 0, z: 0 },
    )
    this.coopAt = { x: coop.x, z: coop.z }

    const build = (geo: BufferGeometry, n: number, spread: number, skin: Material = this.skin): InstancedMesh => {
      // Espèce riguée : quatre nombres d'état par bête (`aAnim`), réécrits à
      // chaque image comme la matrice.
      if (geo.getAttribute('aPivot'))
        geo.setAttribute('aAnim', new InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(DynamicDrawUsage))
      const mesh = new InstancedMesh(geo, skin, n)
      mesh.instanceMatrix.setUsage(DynamicDrawUsage)
      // Les instances vivent loin de la géométrie d'origine : le culling par
      // boîte de la géométrie les ferait clignoter.
      mesh.frustumCulled = false
      for (let i = 0; i < n; i++) mesh.setColorAt(i, tint(new Color('#ffffff'), i * 17 + n, spread))
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      this.group.add(mesh)
      return mesh
    }
    this.deerMesh = build(deerGeo(), 3, 0.07, rigMaterial(gaitUniform(DEER_GAIT)))
    this.sheepMesh = build(sheepGeo(), 4, 0.05)
    this.henMesh = build(henGeo(), 3, 0.04)
    this.horseMesh = build(horseGeo(), 2, 0.09)
    this.gullMesh = build(gullGeo(), 3, 0.03, rigMaterial(wingUniform(GULL_WING)))
    this.sheepMesh.visible = false
    this.henMesh.visible = false
    this.horseMesh.visible = false
    this.gullMesh.visible = false

    this.buildPens()

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
        wing: Math.PI / 2,
        flap: i === 1 ? 0 : 1,
        flapping: i !== 1,
        left: 0,
        laps: i,
        drop: 0,
      })
      const g = this.gulls[i]!
      // Pas toutes au même instant du cycle.
      g.left = gullSpell(g) * (0.3 + 0.7 * (g.phase / TAU))
    }
  }


  /** LA règle de l'enclos, au tirage comme au passage du quai : sa
   *  palissade ne touche ni un bâtiment ni le quai. Centre à PEN_WALL au
   *  moins du bord de chaque obstacle du bâti, et à PEN_R de chaque emprise
   *  posée après coup (`zones`, le quai à GOODS_R — la même distance que le
   *  quai garde à l'enclos dans `goodsAvoid`, pour que l'un n'en chasse
   *  jamais l'autre). */
  private penFits(p: Spot, zones: readonly Zone[]): boolean {
    for (const o of this.obstacles) if (Math.hypot(p.x - o.x, p.z - o.z) < o.r + PEN_WALL) return false
    for (const b of zones) if (Math.hypot(p.x - b.x, p.z - b.z) < b.r + PEN_R) return false
    return true
  }

  /** Où planter l'enclos voulu en `at` : là s'il y tient, sinon au point du
   *  pré le plus proche qui tient — sans tirage, la partie reste
   *  reproductible. Faute de place, pas d'enclos du tout plutôt qu'une
   *  palissade à travers un mur ou des caisses. */
  private penSite(at: Spot, meadow: Spot[], zones: readonly Zone[]): Spot | null {
    if (this.penFits(at, zones)) return at
    let best: Spot | null = null
    let bd = Infinity
    for (const s of meadow) {
      if (!this.penFits(s, zones)) continue
      const d = Math.hypot(s.x - at.x, s.z - at.z)
      if (d < bd) {
        bd = d
        best = s
      }
    }
    return best
  }

  /** Les moutons de l'enclos : le pré dans un rayon de 2,6 autour de l'ancre,
   *  sauf s'il en reste trop peu pour un troupeau. */
  private flock(anchor: Spot, meadow: Spot[]): Spot[] {
    const near = meadow.filter((s) => Math.hypot(s.x - anchor.x, s.z - anchor.z) < 2.6)
    return near.length >= 3 ? near : meadow
  }

  /** Les emprises posées APRÈS le relevé des habitats : le quai du marchand.
   *  Il apparaît au chargement d'une sauvegarde comme au premier achat en
   *  cours de partie, et la faune construite avant lui l'ignorait — un cheval
   *  restait brouter entre les caisses. Un seul chemin pour les deux cas :
   *  `placeGoods` (main.ts) appelle ceci à chaque pose du quai.
   *
   *  Sans emprise, rien ne change : ni zone, ni enclos, ni bête, et aucun
   *  tirage aléatoire. Avec, les points d'habitat couverts sont retirés,
   *  l'enclos et le poulailler ne bougent que s'ils touchent le quai, et une
   *  bête prise dessous est reconduite au point libre le plus proche. */
  setBlockers(zones: readonly Zone[]): void {
    // Le quai s'ajoute au bâti que contournent les trajets et que repousse
    // `stepLand`, élargi de 0,6 : la bordure de terre battue déborde de 0,08
    // le cercle `GOODS_R` aux quatre coins, et la poussée (o.r + 0,3) doit
    // tenir le CORPS d'un cheval (~0,6 de demi-longueur), pas son seul centre.
    this.solid = this.obstacles.concat(zones.map((b) => ({ ...b, r: b.r + 0.6 })))
    const clear = (s: Spot, m: number): boolean =>
      zones.every((b) => Math.hypot(s.x - b.x, s.z - b.z) >= b.r + m)
    /** Les points d'une zone hors du quai. Si le quai les couvrait tous (zone
     *  minuscule), on garde les quatre plus éloignés plutôt qu'une zone vide :
     *  la poussée tient alors les bêtes au bord. */
    const keep = (spots: Spot[]): Spot[] => {
      const k = spots.filter((s) => clear(s, BLOCKER_SPOT))
      if (k.length > 0 || spots.length === 0) return k
      const gap = (s: Spot): number => Math.min(...zones.map((b) => Math.hypot(s.x - b.x, s.z - b.z) - b.r))
      return [...spots].sort((a, b) => gap(b) - gap(a)).slice(0, 4)
    }
    const nearest = (spots: Spot[], p: Spot): Spot | null => {
      let best: Spot | null = null
      let bd = Infinity
      for (const s of spots) {
        const d = Math.hypot(s.x - p.x, s.z - p.z)
        if (d < bd) {
          bd = d
          best = s
        }
      }
      return best
    }

    // L'enclos : en cours de partie, le quai l'a déjà évité (`goodsAvoid`) ;
    // au chargement, il a été tiré sans connaître le quai. S'il le touche, il
    // se déplace par la même règle qu'au tirage (`penSite`) : le nouveau
    // point doit tenir loin du quai ET du bâti — le plus proche point du pré
    // hors du quai pouvait sinon planter la clôture dans un bâtiment.
    const meadow = keep(this.home.sheep)
    const penMoved = !!this.penCenter && !this.penFits(this.penCenter, zones)
    if (penMoved) {
      const a = this.penSite(this.penCenter!, meadow, zones)
      this.penCenter = a ? { x: a.x, z: a.z } : null
    }
    this.sheepSpots = this.penCenter ? this.flock(this.penCenter, meadow) : meadow
    this.deerSpots = keep(this.home.deer)
    this.henSpots = keep(this.home.hen)
    this.horseSpots = keep(this.home.horse)
    // Le poulailler est près du feu, que le quai n'évite pas : même règle.
    const coopMoved = !!this.coopAt && !clear(this.coopAt, COOP_R)
    if (coopMoved) {
      const c = nearest(this.henSpots.filter((s) => clear(s, COOP_R)), this.coopAt!)
      this.coopAt = c ? { x: c.x, z: c.z } : null
    }
    if (penMoved || coopMoved) this.buildPens()
    if (penMoved)
      // Le troupeau suit sa clôture : ses pas sont courts (1,7) et il ne
      // rejoindrait jamais un enclos tiré loin de lui. Ceci n'arrive qu'au
      // chargement, avant la première image : en cours de partie, le quai a
      // déjà évité l'enclos.
      this.sheep.forEach((b, i) => {
        const s = this.sheepSpots[i % this.sheepSpots.length]!
        b.x = b.tx = s.x
        b.z = b.tz = s.z
      })

    // Les bêtes déjà là. Prise sous le quai : reconduite au point libre le plus
    // proche (au chargement, avant la première image ; en direct, au moment où
    // les caisses apparaissent elles aussi). En route vers lui : elle s'arrête
    // et choisit une autre cible dans la zone filtrée.
    const herds: [Beast[], Spot[]][] = [
      [this.deer, this.deerSpots],
      [this.sheep, this.sheepSpots],
      [this.hens, this.henSpots],
      [this.horses, this.horseSpots],
    ]
    for (const [herd, spots] of herds)
      for (const b of herd) {
        if (!clear(b, 0.3)) {
          const s = nearest(spots, b)
          if (s) {
            b.x = s.x
            b.z = s.z
          }
        }
        if (!clear({ x: b.tx, z: b.tz }, BLOCKER_SPOT)) {
          b.tx = b.x
          b.tz = b.z
          b.path = []
          b.state = 2
          b.timer = 0.5
        }
      }
  }

  /** Les zones d'habitat DEVIENNENT visibles : une clôture de piquets autour
   *  du pré des moutons — ouverte côté village, c'est une barrière et pas une
   *  cage : les bêtes ne la franchissent jamais puisque toutes leurs cibles
   *  sont dedans — et une cabane à poules près du foyer. */
  private buildPens(): void {
    this.revision++
    const p: BufferGeometry[] = []
    const wood = new Color('#9a7248')
    const woodDark = new Color('#6d4f31')
    const roof = new Color('#4260c4')
    const plaster = new Color('#efe3cc')

    if (this.penCenter) {
      const { x, z } = this.penCenter
      const h = GROUND_Y
      const R = 3.1
      const N = 12
      const gate = 3
      for (let i = 0; i < N; i++) {
        if (i === gate || i === gate + 1) continue
        const a = (i / N) * Math.PI * 2
        const px = x + Math.cos(a) * R
        const pz = z + Math.sin(a) * R
        p.push(part(new CylinderGeometry(0.055, 0.07, 0.72, 5), woodDark, px, h + 0.34, pz))
        if (i === gate - 1 || i === gate + 1) continue
        const b = ((i + 1) / N) * Math.PI * 2
        const qx = x + Math.cos(b) * R
        const qz = z + Math.sin(b) * R
        const len = Math.hypot(qx - px, qz - pz)
        for (const y of [0.28, 0.52]) {
          p.push(
            part(
              new BoxGeometry(len, 0.05, 0.05).rotateY(-Math.atan2(qz - pz, qx - px)),
              wood,
              (px + qx) / 2,
              h + y,
              (pz + qz) / 2,
            ),
          )
        }
      }
    }

    if (this.coopAt) {
      const { x, z } = this.coopAt
      const h = GROUND_Y
      p.push(part(new BoxGeometry(0.95, 0.6, 0.8), plaster, x, h + 0.3, z))
      p.push(part(new BoxGeometry(1.15, 0.16, 1.0).rotateZ(0.13), roof, x, h + 0.68, z))
      p.push(part(new BoxGeometry(0.5, 0.05, 0.24).rotateZ(-0.22), wood, x + 0.66, h + 0.16, z))
      p.push(part(new CylinderGeometry(0.035, 0.035, 0.5, 5), woodDark, x - 0.62, h + 0.25, z + 0.3))
    }

    const geo = mergeGeometries(p)
    if (!geo) {
      // Plus d'enclos ni de poulailler (aucune place hors du quai) : la
      // vieille clôture ne reste pas plantée au milieu des caisses.
      if (this.pens) {
        this.group.remove(this.pens)
        this.pens.geometry.dispose()
      }
      this.pens = null
      return
    }
    // Le quai a déplacé l'enclos : le même mesh reçoit la nouvelle clôture,
    // un seul draw call pour les deux lieux comme avant. Le mesh n'est créé
    // qu'ici, APRÈS la géométrie : trois tire ses identifiants au hasard, et
    // un ordre différent décalerait le troupeau des parties sans quai.
    if (this.pens) {
      this.pens.geometry.dispose()
      this.pens.geometry = geo
      return
    }
    this.pens = new Mesh(geo, this.skin)
    this.pens.visible = false
    this.group.add(this.pens)
  }

  /** La palissade de l'enclos et la cabane à poules, pour le cadastre au
   *  sol : ce sont les seules emprises que pose la faune. La géométrie est
   *  celle que l'on voit (piquets, lisses, cabane, rampe). */
  groundFootprints(): Footprint[] {
    // Tant que la clôture est cachée (pas encore d'agriculture), elle
    // n'existe pas : le colon ne contourne pas un enclos invisible.
    return this.pens && this.pens.visible ? [{ geo: this.pens.geometry, minY: -Infinity }] : []
  }

  /** Branche le cadastre au sol : désormais toutes les bêtes le lisent. */
  setGround(ground: Ground | null): void {
    this.ground = ground
    this.groundRev = -1
  }

  /** La carte a changé : une bête prise sous une nouvelle emprise ou
   *  enfermée dans une poche est rendue à sa composante (`rehome`), et chaque
   *  marche en cours se refait sur la carte du jour. Rien n'est tiré au
   *  hasard ici. */
  private settle(): void {
    const g = this.ground
    if (!g || g.revision === this.groundRev) return
    // La première carte est lue avant la première image : personne n'a vu
    // les bêtes, elles naissent directement dans leur composante.
    const first = this.groundRev === -1
    this.groundRev = g.revision
    const herds: [Beast[], LandCfg][] = [
      [this.deer, this.deerCfg],
      [this.sheep, this.sheepCfg],
      [this.hens, this.henCfg],
      [this.horses, this.horseCfg],
    ]
    for (const [herd, cfg] of herds)
      for (const b of herd) {
        this.rehome(b, cfg, first)
        b.path = []
        if (b.state === 0 || b.state === 3) {
          b.state = 2
          b.timer = 0.3
        }
      }
  }

  /** La composante où vit une bête : l'enclos pour un mouton qui s'y
   *  trouve dès que la palissade est debout (il y est enfermé exprès), la
   *  composante principale de l'île — celle du bourg — pour tous les autres,
   *  moutons restés au pré compris : on ne les téléporte pas dans l'enclos. */
  private homeComp(b: Beast, cfg: LandCfg): number {
    const g = this.ground!
    if (cfg === this.sheepCfg && this.penCenter && this.pens?.visible) {
      const pen = g.componentAt(this.penCenter.x, this.penCenter.z, cfg.body)
      if (pen >= 0 && g.componentAt(b.x, b.z, cfg.body) === pen) return pen
    }
    return g.mainComponent(cfg.body)
  }

  /** Rend une bête à sa composante. Pourquoi : une bête née ou laissée dans
   *  une poche (un nœud libre entre un arbre et un rocher, un recoin fermé
   *  par une pose) n'a aucun chemin pour en sortir — la QA de la PR #15 a vu
   *  un cerf y rester figé 600 s. Comme la poche est une autre composante,
   *  il n'existe par définition aucun chemin : la bête est reposée sur le
   *  nœud le plus proche de sa composante, un saut de quelques dixièmes en
   *  général. Prise DANS une emprise, elle en sort à l'instant (pas une
   *  image dans le mur) et réapparaît en fondu ; libre mais enfermée, elle
   *  s'efface d'abord sur place. */
  private rehome(b: Beast, cfg: LandCfg, instant: boolean): void {
    const g = this.ground!
    const home = this.homeComp(b, cfg)
    const free = g.free(b.x, b.z, cfg.body)
    if (free && g.componentAt(b.x, b.z, cfg.body) === home) return
    const p =
      g.nearestIn(b.x, b.z, cfg.body, home, 6) ??
      g.nearestIn(b.x, b.z, cfg.body, home, 20) ??
      (free ? null : g.nearestFree(b.x, b.z, cfg.body, 10))
    if (!p) return
    b.path = []
    b.state = 1
    b.timer = 0.8
    if (instant || !free) {
      b.x = b.tx = p.x
      b.z = b.tz = p.z
      b.warp = null
      b.fade = instant ? 1 : 0
    } else b.warp = p
  }

  /** Le chemin d'une bête jusqu'au point voulu (ramené au point libre le plus
   *  proche) ; null si on n'y arrive pas, ou si le détour dépasse `maxLen`. */
  private routeTo(b: Beast, x: number, z: number, cfg: LandCfg, maxLen: number): { x: number; z: number; pts: Pt[] } | null {
    const g = this.ground!
    // La cible se prend dans la composante de la bête (`homeComp`) : un
    // point d'habitat dans une poche n'a pas de chemin, et la bête qui s'y
    // rendrait « au plus près » n'y entrerait de toute façon pas.
    const at = g.nearestIn(x, z, cfg.body, this.homeComp(b, cfg), 1.5)
    if (!at) return null
    const r = g.route(b.x, b.z, at.x, at.z, cfg.body, 6000)
    if (!r.reached || r.length > maxLen) return null
    return { x: at.x, z: at.z, pts: r.pts }
  }

  /** Le choix d'une étape, sur le cadastre : un point d'habitat proche ET
   *  joignable sans traverser quoi que ce soit, détour compris. Faute de
   *  mieux, n'importe quel point de la zone joignable — une bête ne reste
   *  jamais plantée parce que son pré est coupé en deux par un atelier. */
  private pickOnGround(b: Beast, spots: Spot[], cfg: LandCfg): void {
    for (let k = 0; k < 16; k++) {
      const c = spots[(Math.random() * spots.length) | 0]!
      const far = k >= 10
      if (!far && (c.x - b.x) ** 2 + (c.z - b.z) ** 2 > cfg.step * cfg.step) continue
      const r = this.routeTo(b, c.x + (Math.random() - 0.5) * 0.4, c.z + (Math.random() - 0.5) * 0.4, cfg, far ? 40 : cfg.step * 1.8)
      // Une étape qui ramène la bête sur place (point d'habitat ramené au
      // libre juste à côté d'elle) n'en est pas une : elle resterait figée
      // d'une pause à l'autre.
      if (!r || Math.hypot(r.x - b.x, r.z - b.z) < 0.3) continue
      b.tx = r.x
      b.tz = r.z
      b.path = r.pts
      b.state = 0
      b.miss = 0
      return
    }
    // Aucun point d'habitat joignable (pré coupé par une palissade, bête
    // repoussée hors de sa zone) : un pas de flânerie autour d'elle, sur la
    // terre libre, plutôt que de rester plantée à retenter.
    for (let k = 0; k < 8; k++) {
      const a = Math.random() * Math.PI * 2
      const d = cfg.step * (0.4 + Math.random() * 0.6)
      const r = this.routeTo(b, b.x + Math.sin(a) * d, b.z + Math.cos(a) * d, cfg, cfg.step * 2)
      if (!r || Math.hypot(r.x - b.x, r.z - b.z) < 0.3) continue
      b.tx = r.x
      b.tz = r.z
      b.path = r.pts
      b.state = 0
      b.miss = 0
      return
    }
    b.state = 2
    b.timer = 0.8 + Math.random() * 1.2
    // Trois échecs d'affilée : la bête est sans doute hors de sa composante
    // (garde-fou : `settle` l'y remet déjà à chaque pose).
    if (++b.miss >= 3) {
      b.miss = 0
      this.rehome(b, cfg, false)
    }
  }

  /** Chaque espèce apparaît avec le savoir qui la fait entrer dans la vie de la
   *  tribu. Appelé chaque frame depuis main — quatre booléens, rien de plus. */
  setKnown(agriculture: boolean, granary: boolean, horsecollar: boolean, sail: boolean): void {
    // Les lieux apparaissent avec leurs bêtes : pas de clôture sans troupeau.
    if (this.pens && this.pens.visible !== (agriculture || granary)) {
      this.pens.visible = agriculture || granary
      this.revision++
    }
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
      // Sur le cadastre, la ruée suit un chemin : elle contourne, au plus
      // près du point visé si la mer ou le bourg l'arrête.
      if (this.ground) {
        const at = this.ground.nearestFree(b.tx, b.tz, this.deerCfg.body, 12)
        const r = at ? this.ground.route(b.x, b.z, at.x, at.z, this.deerCfg.body, 12000) : null
        b.path = r ? r.pts : []
        const end = b.path[b.path.length - 1]
        if (end) {
          b.tx = end.x
          b.tz = end.z
        }
      }
    }
  }

  update(dt: number, time: number, settler: Vector3, night: boolean): void {
    this.settle()
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
    const anim = cfg.gait ? (mesh.geometry.getAttribute('aAnim') as InstancedBufferAttribute | undefined) : undefined
    for (let i = 0; i < herd.length; i++) {
      const b = herd[i]!
      b.sleep += ((night ? 1 : 0) - b.sleep) * Math.min(1, dt * 1.4)
      const awake = b.sleep < 0.4
      // Repositionnement en cours (`rehome`) : la bête s'efface sur place,
      // saute une fois invisible, puis revient.
      if (b.warp) {
        b.fade -= dt * FADE
        b.state = 1
        b.timer = Math.max(b.timer, 0.3)
        if (b.fade <= 0) {
          b.fade = 0
          b.x = b.tx = b.warp.x
          b.z = b.tz = b.warp.z
          b.warp = null
        }
      } else if (b.fade < 1) b.fade = Math.min(1, b.fade + dt * FADE)

      if (awake) {
        // Le gibier fuit : dès que le colon approche, cap sur le point
        // d'habitat le plus à l'écart de lui.
        // Une bête qui s'efface pour être reposée ne fuit pas : elle sauterait
        // ensuite au milieu de sa course.
        if (threat && b.state !== 3 && !b.warp) {
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
            if (this.ground) {
              const r = this.routeTo(b, b.tx, b.tz, cfg, 60)
              b.path = r ? r.pts : []
              if (r) {
                b.tx = r.x
                b.tz = r.z
              } else {
                // Pas d'échappée joignable : il se fige plutôt que de fuir
                // à travers un mur.
                b.state = 2
                b.timer = 1
              }
            }
            // Sursaut : il se retourne d'un coup — sinon il traverse le colon
            // pendant que son cap tourne.
            b.heading = Math.atan2(b.tx - b.x, b.tz - b.z)
          }
        }

        if ((b.state === 0 || b.state === 3) && this.ground) {
          // Sur le cadastre : la bête suit son chemin ; le cap tourne vers
          // le pas suivant, la position ne quitte jamais le chemin.
          const flee = b.state === 3
          if (b.path.length === 0) {
            b.state = Math.random() < cfg.grazeBias ? 2 : 1
            b.timer = cfg.pauseMin + Math.random() * (cfg.pauseMax - cfg.pauseMin)
          } else {
            const sp = cfg.speed * b.gait * (flee ? 2.7 : 1)
            const nx = b.path[0]!
            b.heading = turnToward(b.heading, Math.atan2(nx.x - b.x, nx.z - b.z), cfg.turn * (flee ? 2.4 : 1) * dt * 2)
            const x0 = b.x
            const z0 = b.z
            follow(b, b.path, sp * dt)
            stride(b, cfg, Math.hypot(b.x - x0, b.z - z0), dt, flee)
          }
          if (flee) {
            b.timer -= dt
            if (b.timer < 0) b.state = 0
          }
        } else if (b.state === 0 || b.state === 3) {
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
            stride(b, cfg, sp * dt, dt, flee)
          }
          if (flee) {
            b.timer -= dt
            if (b.timer < 0) b.state = 0
          }
        } else {
          b.timer -= dt
          if (b.timer < 0) {
            if (this.ground) this.pickOnGround(b, spots, cfg)
            else pickTarget(b, spots, cfg, this.segClear)
          }
        }
      }

      // Jamais dans le bâti : poussée radiale hors de l'emprise RÉELLE de
      // chaque bâtiment — le rayon uniforme laissait entrer dans les grands.
      // Sur le cadastre, les chemins sont déjà dégagés : une poussée radiale
      // sortirait la bête d'un disque pour la mettre dans un mur voisin.
      if (!this.ground) for (const o of this.solid) {
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
      if (!this.ground) for (let k = 0; k < CAMP_BLOCKERS.length; k++) {
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
      // petite houle. Une espèce riguée plonge le COU : le corps ne garde que
      // 30 % de la bascule, pour que le museau touche l'herbe.
      const g = cfg.gait
      const wantPitch = grazing ? cfg.grazePitch * (g ? g.bodyPitch : 1) * (0.82 + 0.18 * Math.sin(time * 2.2 + b.phase)) : 0
      b.pitch += (wantPitch - b.pitch) * Math.min(1, dt * 3)
      if (anim && g) {
        // Allure : 0,15 s pour partir ou s'arrêter (une bête qui dort ou
        // s'efface n'avance pas : ses pattes reviennent au repos). Trot :
        // sursaut en 0,08 s, retour au pas en 0,4 s. Cou : 0,35 s pour
        // plonger, 0,25 s pour remonter.
        b.amp = ease(b.amp, moving ? 1 : 0, dt, 0.15)
        const flee = moving && b.state === 3
        b.trot = ease(b.trot, flee ? 1 : 0, dt, flee ? 0.08 : 0.4)
        b.graze = ease(b.graze, grazing ? 1 : 0, dt, grazing ? 0.35 : 0.25)
        const a = anim.array as Float32Array
        a[i * 4] = b.phase
        a[i * 4 + 1] = b.amp
        a[i * 4 + 2] = b.graze * (1 + g.neckSwell * Math.sin(time * TAU * g.swellHz + b.phase))
        a[i * 4 + 3] = b.trot
      }

      // Deux rebonds par cycle de pattes ; au trot de fuite, plus appuyés.
      const bob = moving ? Math.abs(Math.sin(b.phase)) * cfg.bobAmp * (g ? 1 + (g.trotBob - 1) * b.trot : 1) : 0
      dummy.position.set(
        b.x,
        GROUND_Y + bob - (b.pitch + b.sleep) * cfg.sink,
        b.z,
      )
      dummy.rotation.set(b.pitch, b.heading, moving ? Math.sin(b.phase) * 0.05 : 0)
      // La nuit : couché sur place — tassé, immobile, un peu élargi.
      const k = Math.max(0.001, b.fade)
      dummy.scale.set((1 + b.sleep * 0.12) * k, (1 - b.sleep * 0.55) * k, (1 + b.sleep * 0.06) * k)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (anim) anim.needsUpdate = true
  }

  private stepGulls(dt: number, time: number): void {
    const anim = this.gullMesh.geometry.getAttribute('aAnim') as InstancedBufferAttribute
    const a = anim.array as Float32Array
    const W = GULL_WING
    for (let i = 0; i < this.gulls.length; i++) {
      const g = this.gulls[i]!
      g.a += g.w * dt
      // Battu 2–3 s, plané 3–5 s. Le plané descend doucement, le battu
      // regagne l'altitude perdue.
      g.left -= dt
      if (g.left <= 0) {
        g.flapping = !g.flapping
        g.laps++
        g.left = gullSpell(g)
        // Le battu repart toujours épaule en haut : depuis le dièdre du
        // plané, l'aile monte au lieu de tomber d'un coup.
        if (g.flapping) g.wing = Math.PI / 2
      }
      g.flap = ease(g.flap, g.flapping ? 1 : 0, dt, W.blend)
      g.wing += dt * TAU * W.hz
      if (g.wing >= TAU) g.wing -= TAU
      g.drop = g.flapping ? Math.min(0, g.drop + W.climb * dt) : Math.max(-W.maxDrop, g.drop - W.sink * dt)
      const x = g.cx + Math.cos(g.a) * g.r
      const z = g.cz + Math.sin(g.a) * g.r
      // Cap tangent au cercle, dans le sens de rotation.
      const heading = Math.atan2(-Math.sin(g.a) * g.w, Math.cos(g.a) * g.w)
      // Le corps descend quand les ailes montent (et inversement), avec un
      // soupçon de roulis : ce sont les ailes qui battent, plus le corps.
      const beat = Math.sin(g.wing) * g.flap
      dummy.position.set(x, g.alt + g.drop + Math.sin(time * 0.8 + g.phase) * 0.2 - beat * W.bodyBob, z)
      dummy.rotation.set(0.08, heading, (g.w > 0 ? -0.2 : 0.2) + beat * W.bodyRoll)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      this.gullMesh.setMatrixAt(i, dummy.matrix)
      a[i * 4] = g.wing
      a[i * 4 + 1] = 0
      a[i * 4 + 2] = 0
      a[i * 4 + 3] = g.flap
    }
    this.gullMesh.instanceMatrix.needsUpdate = true
    anim.needsUpdate = true
  }
}
