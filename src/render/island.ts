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
  MeshLambertMaterial,
  MeshToonMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from 'three'
import { PALETTE, tint } from './palette'

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

/** Cheap value noise on a lattice; enough shape for a toy island. */
function noise2(x: number, y: number, rnd: () => number, cache: Map<string, number>): number {
  const key = `${Math.floor(x)},${Math.floor(y)}`
  let v = cache.get(key)
  if (v === undefined) {
    v = rnd()
    cache.set(key, v)
  }
  return v
}

export const TILE = 1.35
export const GRID = 26

export interface Cell {
  gx: number
  gz: number
  x: number
  z: number
  height: number
  beach: boolean
}

export type NodeKind = 'wood' | 'stone' | 'food'

export class Island {
  readonly group = new Group()
  readonly cells: Cell[] = []
  readonly pickables: InstancedMesh[] = []
  /** Flat ground spots reserved for buildings, ordered from the fire outwards. */
  readonly buildSlots: Vector3[] = []
  private kindOf = new Map<InstancedMesh, NodeKind>()

  constructor(seed = 1337) {
    const rnd = mulberry32(seed)
    const cache = new Map<string, number>()
    const half = GRID / 2

    for (let gx = 0; gx < GRID; gx++) {
      for (let gz = 0; gz < GRID; gz++) {
        const dx = gx - half + 0.5
        const dz = gz - half + 0.5
        const r = Math.hypot(dx, dz)
        const wobble = noise2(gx * 0.28, gz * 0.28, rnd, cache) * 2.2
        const edge = half - 1.5 + wobble - 1.1
        if (r > edge) continue
        const inland = Math.max(0, edge - r)
        const bump = noise2(gx * 0.5, gz * 0.5, rnd, cache)
        const height = 0.45 + Math.min(inland * 0.42, 1.5) + bump * 0.5
        this.cells.push({
          gx,
          gz,
          x: dx * TILE,
          z: dz * TILE,
          height,
          beach: inland < 0.9,
        })
      }
    }

    this.buildTerrain()
    this.buildWater()
    this.scatter(rnd)
  }

  private buildTerrain(): void {
    const geo = new BoxGeometry(TILE, 1, TILE)
    const mat = new MeshLambertMaterial({ vertexColors: false })
    const mesh = new InstancedMesh(geo, mat, this.cells.length)
    mesh.castShadow = true
    mesh.receiveShadow = true

    const dummy = new Object3D()
    this.cells.forEach((c, i) => {
      dummy.position.set(c.x, c.height / 2, c.z)
      dummy.scale.set(1, c.height, 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      const base = c.beach ? PALETTE.sand : c.height > 1.6 ? PALETTE.grassDark : PALETTE.grass
      mesh.setColorAt(i, tint(base, c.gx * 31 + c.gz, 0.05))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    this.group.add(mesh)
  }

  private buildWater(): void {
    const deep = new Mesh(
      new CircleGeometry(GRID * TILE * 1.6, 48),
      new MeshLambertMaterial({ color: PALETTE.waterDeep }),
    )
    deep.rotation.x = -Math.PI / 2
    deep.position.y = -0.35
    deep.receiveShadow = true

    const shallow = new Mesh(
      new CircleGeometry(GRID * TILE * 0.82, 48),
      new MeshLambertMaterial({ color: PALETTE.water, transparent: true, opacity: 0.92 }),
    )
    shallow.rotation.x = -Math.PI / 2
    shallow.position.y = 0.12
    this.group.add(deep, shallow)
  }

  /** Trees, rocks and berry bushes: three instanced draw calls for the whole map,
   *  each one also serving as the tap target that sets the settler's focus. */
  private scatter(rnd: () => number): void {
    const inland = this.cells.filter((c) => !c.beach)
    const clearRadius = 4.2
    const free = inland.filter((c) => Math.hypot(c.x, c.z) > clearRadius)

    const near = inland
      .filter((c) => Math.hypot(c.x, c.z) <= clearRadius + 1.5)
      .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))
    for (const c of near) this.buildSlots.push(new Vector3(c.x, c.height, c.z))

    const picked = new Set<Cell>()
    const take = (n: number, filter: (c: Cell) => boolean): Cell[] => {
      const pool = free.filter((c) => !picked.has(c) && filter(c))
      const out: Cell[] = []
      for (let i = 0; i < n && pool.length; i++) {
        const idx = Math.floor(rnd() * pool.length)
        const c = pool.splice(idx, 1)[0]
        if (!c) break
        picked.add(c)
        out.push(c)
      }
      return out
    }

    this.addTrees(take(90, (c) => c.height > 0.9), rnd)
    this.addRocks(take(34, (c) => c.height > 1.3), rnd)
    this.addBushes(take(40, () => true), rnd)
  }

  private addTrees(cells: Cell[], rnd: () => number): void {
    const trunkGeo = new CylinderGeometry(0.11, 0.16, 0.9, 6)
    const trunkMat = new MeshToonMaterial({ color: PALETTE.trunk })
    const trunks = new InstancedMesh(trunkGeo, trunkMat, cells.length)

    const leafGeo = new ConeGeometry(0.62, 1.5, 7)
    const leafMat = new MeshToonMaterial({ vertexColors: false })
    const leaves = new InstancedMesh(leafGeo, leafMat, cells.length)
    leaves.castShadow = true
    trunks.castShadow = true

    const d = new Object3D()
    const leafColors = [PALETTE.leafA, PALETTE.leafB, PALETTE.leafC]
    cells.forEach((c, i) => {
      const s = 0.8 + rnd() * 0.55
      d.position.set(c.x + (rnd() - 0.5) * 0.5, c.height + 0.45 * s, c.z + (rnd() - 0.5) * 0.5)
      d.rotation.set(0, rnd() * Math.PI, 0)
      d.scale.setScalar(s)
      d.updateMatrix()
      trunks.setMatrixAt(i, d.matrix)
      d.position.y = c.height + (0.9 + 0.75) * s
      d.updateMatrix()
      leaves.setMatrixAt(i, d.matrix)
      leaves.setColorAt(i, tint(leafColors[i % 3]!, i, 0.09))
    })
    trunks.instanceMatrix.needsUpdate = true
    leaves.instanceMatrix.needsUpdate = true
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true
    this.group.add(trunks, leaves)
    this.registerPickable(leaves, 'wood')
  }

  private addRocks(cells: Cell[], rnd: () => number): void {
    const geo = new DodecahedronGeometry(0.42, 0)
    const mat = new MeshToonMaterial({ vertexColors: false })
    const mesh = new InstancedMesh(geo, mat, cells.length)
    mesh.castShadow = true
    mesh.receiveShadow = true

    const d = new Object3D()
    cells.forEach((c, i) => {
      const s = 0.6 + rnd() * 0.8
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
    const mat = new MeshToonMaterial({ vertexColors: false })
    const mesh = new InstancedMesh(geo, mat, cells.length)
    mesh.castShadow = true

    const d = new Object3D()
    const berry = new Color('#4a7a3e')
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
