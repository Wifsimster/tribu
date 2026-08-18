import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
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
  SphereGeometry,
  Vector3,
} from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PALETTE, tint } from './palette'
import type { Island } from './island'

interface Pending {
  object: Object3D
  age: number
}

/** Le foyer est posé à côté du point de dépôt, pas dessus, et perpendiculairement
 *  à l'axe de la caméra par défaut: sinon le colon rentre dans les flammes et sa
 *  silhouette se noie dedans. */
const HEARTH = { x: -1.15, z: 1.15 }

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
    const p: BufferGeometry[] = []
    p.push(part(new CylinderGeometry(0.8, 0.95, 0.12, 12), C.ash, 0, 0.06, 0))
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2
      const s = 0.19 + ((i * 7) % 5) * 0.032
      p.push(
        part(
          new DodecahedronGeometry(s, 0).rotateY(i * 1.7).rotateX(i * 0.4).scale(1, 0.82, 1),
          tint(i % 3 === 0 ? PALETTE.rockDark : PALETTE.rock, i * 3, 0.09),
          Math.sin(a) * 1.0,
          0.09,
          Math.cos(a) * 1.0,
        ),
      )
    }
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4
      p.push(
        part(
          new CylinderGeometry(0.07, 0.09, 1.1, 6).rotateZ(0.62).rotateY(a),
          i % 2 === 0 ? C.char : C.woodDark,
          Math.cos(a) * 0.26,
          0.3,
          -Math.sin(a) * 0.26,
        ),
      )
    }
    this.camp(p)
    const hearth = this.mesh(p)

    this.flame = new Mesh(
      new ConeGeometry(0.26, 0.9, 7),
      new MeshBasicMaterial({ color: 0xef8536 }),
    )
    this.flame.position.y = 0.66
    this.core = new Mesh(
      new ConeGeometry(0.14, 0.54, 6),
      new MeshBasicMaterial({ color: 0xffe49a }),
    )
    this.core.position.y = 0.52

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
      new MeshBasicMaterial({ transparent: true, opacity: 0.36, depthWrite: false }),
      9,
    )
    this.smoke.frustumCulled = false
    this.smoke.renderOrder = 3

    // Assez pour poser une flaque chaude sur l'herbe, pas assez pour délaver le
    // foyer lui-même: à cinquante centimètres, une décroissance quadratique brûle
    // tout ce qu'elle touche.
    this.fireLight = new PointLight(0xffa14a, 1.3, 5, 2)
    this.fireLight.position.y = 0.95

    fire.add(hearth, this.flame, this.core, this.embers, this.smoke, this.fireLight)
    // Le colon rentre "au feu", c'est-à-dire au point (0,0,0) que lui fixe la
    // boucle: si le foyer y était aussi, il passerait sa vie dans les flammes.
    fire.position.set(HEARTH.x, this.island.heightAt(HEARTH.x, HEARTH.z), HEARTH.z)
    this.group.add(fire)
  }

  /** Au premier âge le feu est le seul bâti de l'île: sans un campement autour, le
   *  centre du village est un trou. Tout est fondu dans le foyer, donc gratuit. */
  private camp(p: BufferGeometry[]): void {
    // Séchoir à peaux: deux fourches, une traverse, deux peaux tendues. C'est la
    // seule masse claire du campement, donc la première chose que l'œil accroche.
    for (const dx of [-0.62, 0.62]) {
      p.push(part(new CylinderGeometry(0.055, 0.07, 1.2, 5), C.wood, -1.15 + dx, 0.6, -1.05))
    }
    p.push(
      part(new CylinderGeometry(0.05, 0.05, 1.46, 5).rotateZ(Math.PI / 2), C.wood, -1.15, 1.18, -1.05),
    )
    p.push(part(new BoxGeometry(0.52, 0.66, 0.05), C.bone, -1.48, 0.8, -1.05))
    p.push(part(new BoxGeometry(0.44, 0.54, 0.05), C.hide, -0.85, 0.86, -1.05))

    // Deux billots pour s'asseoir, et un tas d'éclats de silex.
    p.push(
      part(new CylinderGeometry(0.15, 0.15, 0.72, 6).rotateZ(Math.PI / 2).rotateY(0.5), C.wood, 0.9, 0.15, -1.3),
    )
    p.push(
      part(new CylinderGeometry(0.14, 0.14, 0.66, 6).rotateZ(Math.PI / 2).rotateY(-0.8), C.wood, -1.35, 0.14, 0.75),
    )
    for (let i = 0; i < 5; i++) {
      p.push(
        part(
          new DodecahedronGeometry(0.1 + (i % 3) * 0.02, 0).rotateY(i * 2.1).scale(1, 0.6, 1),
          tint(PALETTE.rockDark, i * 9, 0.1),
          -1.4 + Math.sin(i * 2.3) * 0.22,
          0.07 + (i % 2) * 0.08,
          1.2 + Math.cos(i * 2.3) * 0.2,
        ),
      )
    }
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
      if (Math.hypot(slot.x - HEARTH.x, slot.z - HEARTH.z) < 3) continue
      if (this.taken.some((t) => t.distanceToSquared(slot) < 3.4 * 3.4)) continue
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
    this.fireLight.intensity = 1.25 + Math.sin(t * 9) * 0.3

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
      this.dummy.position.set(
        Math.sin(a) * 0.45 * u + u * 0.5,
        1.05 + u * 3.4,
        Math.cos(a) * 0.45 * u,
      )
      this.dummy.scale.setScalar(0.5 + u * 1.7)
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
