import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Vector3,
} from 'three'
import { HEX_R, Island, plotTint } from './island'

/** Le voisinage se signale en or : c'est la seule chose qui distingue une
 *  ancre d'une autre, à part sa place. */
const BOND = new Color('#ffd34d')
const WHITE = new Color('#ffffff')

export interface Anchor {
  q: number
  r: number
  bond: boolean
}

/** La surbrillance des emplacements proposés : sept hexagones à fleur d'eau
 *  par ancre, teintés comme la terre qu'on va poser, et une colonne de lumière
 *  au centre pour qu'on les trouve même de loin, de nuit comme sous la neige.
 *  Matériaux non éclairés : la lumière du jour ne les éteint pas. Deux draw
 *  calls, et seulement pendant le choix. */
export class AnchorMarks {
  readonly group = new Group()
  anchors: Anchor[] = []
  private readonly tiles: InstancedMesh
  private readonly beams: InstancedMesh
  private readonly tileMat: MeshBasicMaterial
  private readonly beamMat: MeshBasicMaterial
  private t = 0

  constructor(max = 3) {
    // Flat-top comme les cellules de l'île : un sommet sur +x (thetaStart).
    const tile = new CylinderGeometry(HEX_R * 0.9, HEX_R * 0.9, 0.1, 6, 1, false, Math.PI / 2)
    this.tileMat = new MeshBasicMaterial({ transparent: true, opacity: 0.7, depthWrite: false })
    // Deux plaques par cellule : un liseré clair dessous, la teinte dessus —
    // sur l'écume blanche du rivage, une teinte seule disparaissait.
    this.tiles = new InstancedMesh(tile, this.tileMat, max * 14)
    const beam = new CylinderGeometry(0.2, 0.42, 4.2, 6, 1, true)
    beam.translate(0, 2.1, 0)
    this.beamMat = new MeshBasicMaterial({
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: AdditiveBlending,
    })
    this.beams = new InstancedMesh(beam, this.beamMat, max)
    for (const m of [this.tiles, this.beams]) {
      m.count = 0
      m.frustumCulled = false
      m.renderOrder = 2
    }
    this.group.add(this.tiles, this.beams)
    this.group.visible = false
  }

  show(anchors: Anchor[], kind: string): void {
    this.anchors = anchors
    const m = new Matrix4()
    const tint = plotTint(kind).clone().lerp(WHITE, 0.15)
    const c = new Color()
    let i = 0
    anchors.forEach((a, n) => {
      Island.anchorCells(a.q, a.r).forEach(([x, z], k) => {
        m.makeTranslation(x, 0.1, z)
        this.tiles.setMatrixAt(i, m)
        this.tiles.setColorAt(i++, WHITE)
        m.makeScale(0.72, 1, 0.72).setPosition(x, 0.16, z)
        this.tiles.setMatrixAt(i, m)
        // Le centre plus clair : on lit la parcelle comme UN objet.
        c.copy(a.bond ? BOND : tint)
        if (k === 0) c.lerp(WHITE, 0.3)
        this.tiles.setColorAt(i++, c)
      })
      const [x, z] = Island.anchorCells(a.q, a.r)[0]!
      m.makeTranslation(x, 0, z)
      this.beams.setMatrixAt(n, m)
      this.beams.setColorAt(n, a.bond ? BOND : tint)
    })
    this.tiles.count = i
    this.beams.count = anchors.length
    for (const mesh of [this.tiles, this.beams]) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    this.group.visible = anchors.length > 0
  }

  hide(): void {
    this.anchors = []
    this.tiles.count = 0
    this.beams.count = 0
    this.group.visible = false
  }

  /** Respiration lente : une surbrillance fixe se confond avec le décor. */
  tick(dt: number): void {
    if (!this.group.visible) return
    this.t += dt
    const k = 0.5 + 0.5 * Math.sin(this.t * 3)
    this.tileMat.opacity = 0.62 + 0.3 * k
    this.beamMat.opacity = 0.4 + 0.3 * k
  }

  /** L'ancre sous un point du plan d'eau (x, z), à une demi-cellule près. */
  pick(x: number, z: number): Anchor | null {
    let best: Anchor | null = null
    let bestD = (HEX_R * 1.25) ** 2
    for (const a of this.anchors) {
      for (const [cx, cz] of Island.anchorCells(a.q, a.r)) {
        const d = (cx - x) ** 2 + (cz - z) ** 2
        if (d < bestD) {
          bestD = d
          best = a
        }
      }
    }
    return best
  }

  /** Où accrocher l'étiquette d'une ancre : au sommet de sa colonne. */
  labelPoint(a: Anchor, out = new Vector3()): Vector3 {
    const [x, z] = Island.anchorCells(a.q, a.r)[0]!
    return out.set(x, 4.4, z)
  }

  /** Le rayon qu'il faut cadrer pour voir toutes les ancres. */
  reach(): number {
    let r = 0
    for (const a of this.anchors)
      for (const [x, z] of Island.anchorCells(a.q, a.r)) r = Math.max(r, Math.hypot(x, z) + HEX_R)
    return r
  }
}
