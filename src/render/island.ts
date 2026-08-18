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
const SEA_FLOOR = -2.9
/** Une eau calme rend une image courte : le reflet est écrasé, pas symétrique. */
const MIRROR = 0.6
const PLAZA_RADIUS = 5.1

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

  constructor(seed = 1337) {
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
        const cell: Cell = { gx, gz, x, z, height, beach, inland, ao: 1 }
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
        if (!n) continue
        const d = n.height - c.height
        if (d > 0.05) occ += w * Math.min(d / 0.9, 1)
      }
      c.ao = Math.max(0.58, 1 - occ * 0.145)
    }
  }

  private buildTerrain(): void {
    const geo = new BoxGeometry(TILE, 1, TILE)
    const mat = new MeshLambertMaterial()
    // Trois boîtes par cellule : la partie immergée, presque de la couleur du
    // fond, le socle de terre, puis une fine couche d'herbe. Une seule colonne
    // de la couleur de l'herbe donnait une masse pâle sous l'eau claire.
    const mesh = new InstancedMesh(geo, mat, this.cells.length * 3)
    mesh.castShadow = true
    mesh.receiveShadow = true

    const refl = new InstancedMesh(geo, new MeshBasicMaterial(), this.cells.length)

    const dummy = new Object3D()
    const capColor = new Color()
    const socleColor = new Color()
    const grassRamp = [
      [0, PALETTE.grassDark],
      [0.55, PALETTE.grass],
      [1, PALETTE.grassLight],
    ] as const

    const drowned = PALETTE.waterDeep.clone().multiplyScalar(0.9)

    this.cells.forEach((c, i) => {
      const capBottom = Math.max(0.06, c.height - CAP)

      dummy.position.set(c.x, SEA_FLOOR / 2, c.z)
      dummy.scale.set(1, -SEA_FLOOR, 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i * 3, dummy.matrix)

      dummy.position.set(c.x, capBottom / 2, c.z)
      dummy.scale.set(1, capBottom, 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i * 3 + 1, dummy.matrix)

      dummy.position.set(c.x, (c.height + capBottom) / 2, c.z)
      dummy.scale.set(1, Math.max(0.06, c.height - capBottom), 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i * 3 + 2, dummy.matrix)

      if (c.beach) capColor.copy(PALETTE.sand)
      else ramp(grassRamp, smoothstep(0.5, 2.6, c.height), capColor)
      // Marbrure basse fréquence en plus du bruit par tuile : un aplat de
      // couleur unique sur toute une terrasse fait carton découpé.
      const mottle = 0.93 + fbm(c.gx * 0.55, c.gz * 0.55, 7) * 0.14
      capColor.copy(tint(capColor, c.gx * 31 + c.gz, 0.06)).multiplyScalar(c.ao * mottle)

      socleColor
        .copy(PALETTE.earth)
        .lerp(PALETTE.earthDark, 0.65 - smoothstep(0.4, 1.8, c.height) * 0.3)
        .multiplyScalar(c.ao * 0.94)

      mesh.setColorAt(i * 3, drowned)
      mesh.setColorAt(i * 3 + 1, socleColor)
      mesh.setColorAt(i * 3 + 2, capColor)

      // Reflet : la colonne émergée, retournée sous la surface — écrasée, parce
      // qu'une eau calme rend une image courte, et plus sombre que le large,
      // sinon l'île semble avoir un jumeau pâle sous elle.
      const mirror = Math.max(0.06, c.height * MIRROR)
      dummy.position.set(c.x, -mirror / 2 - 0.04, c.z)
      dummy.scale.set(1, mirror, 1)
      dummy.updateMatrix()
      refl.setMatrixAt(i, dummy.matrix)
      refl.setColorAt(i, PALETTE.waterDeep.clone().lerp(capColor, 0.34).multiplyScalar(0.88))
    })

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    refl.instanceMatrix.needsUpdate = true
    if (refl.instanceColor) refl.instanceColor.needsUpdate = true
    this.group.add(mesh, refl)
  }

  /** Une seule nappe jusqu'à l'horizon, translucide au pied de l'île pour
   *  laisser voir les reflets, opaque ensuite. Deux plans à des hauteurs
   *  différentes laissaient un arc visible là où l'un recouvrait l'autre. */
  private buildWater(): void {
    const SPAN = 1600
    const shore = ISLAND_RADIUS * 2.9
    const tex = rampTexture(128, 128, (u, v, out) => {
      const r = (Math.hypot(u - 0.5, v - 0.5) * 2 * shore) / ISLAND_RADIUS
      ramp(
        [
          [0, PALETTE.waterShallow],
          [1.0, PALETTE.waterShallow],
          [1.7, PALETTE.water],
          [2.9, PALETTE.waterDeep],
        ] as const,
        r,
        out,
      )
      // L'eau s'opacifie en s'éloignant : le reflet ne survit qu'au pied de l'île.
      return 0.56 + smoothstep(1.0, 2.2, r) * 0.44
    })
    // La rampe ne couvre que le centre de la nappe ; au-delà, le bord clampé
    // donne exactement la couleur du large.
    const k = SPAN / shore
    tex.repeat.set(k, k)
    tex.offset.set((1 - k) / 2, (1 - k) / 2)

    const surface = new Mesh(
      new CircleGeometry(SPAN, 64),
      new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
    )
    surface.rotation.x = -Math.PI / 2
    surface.renderOrder = -1

    // Fond opaque sous la seule zone translucide : sans lui on verrait le ciel
    // à travers l'eau claire du rivage.
    const bed = new Mesh(
      new CircleGeometry(shore, 48),
      new MeshBasicMaterial({ color: PALETTE.waterDeep }),
    )
    bed.rotation.x = -Math.PI / 2
    bed.position.y = SEA_FLOOR - 0.3

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
    const free = solid.filter((c) => Math.hypot(c.x, c.z) > PLAZA_RADIUS + 1 && c.inland > 1.7)

    const centers: Cell[] = []
    for (let i = 0; i < 7; i++) {
      const c = free[Math.floor(rnd() * free.length)]
      if (c) centers.push(c)
    }
    // Bosquets plutôt que semis régulier : il faut des clairières pour voir le sol.
    const clustered = (spread: number): Cell[] =>
      free
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

    this.addTrees(take(56, clustered(3.4), () => true), rnd)
    this.addRocks(take(22, clustered(9), (c) => c.height > 1.2), rnd)
    this.addBushes(take(26, clustered(6), () => true), rnd)
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

      // Même écrasement que le reflet du terrain, sinon les sapins pendent
      // sous l'île au lieu de s'y raccorder.
      d.position.y = -MIRROR * (c.height + 1.65 * s)
      d.rotation.set(Math.PI, d.rotation.y, 0)
      d.scale.set(s, s * MIRROR, s)
      d.updateMatrix()
      refl.setMatrixAt(i, d.matrix)
      refl.setColorAt(i, PALETTE.waterDeep.clone().lerp(leaf, 0.3).multiplyScalar(0.88))
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
