/** LE CADASTRE AU SOL : une seule carte de ce qui est plein, lue par tout ce
 *  qui marche (colon, villageois, faune).
 *
 *  Pourquoi une carte et pas des disques : l'audit des collisions (2026-10-13)
 *  a relevé quatre listes d'obstacles distinctes — `lots`, `obstaclePoints`,
 *  `CAMP_BLOCKERS`, le quai — chacune avec ses propres rayons, et aucun mobile
 *  ne les lisait toutes. Le colon traversait les bâtiments (42 parties sur 48),
 *  les poules la Merveille, le cerf les rochers. Ici, l'emprise est la forme
 *  RÉELLE au sol : les triangles des géométries posées, projetés en plan sur
 *  une grille de 0,1 u, plus les troncs, les rochers et l'eau. Une table de
 *  rayons ne peut pas dire qu'un aqueduc est long et étroit ; la géométrie, si.
 *
 *  La carte ne déplace rien : elle se contente de lire ce qui est posé. Une
 *  sauvegarde se charge donc à l'identique, et les mobiles s'y adaptent.
 *
 *  Les buissons, les rues et la voie ferrée n'y sont pas : on les traverse à
 *  pied. Train et auto ne la lisent pas (lots suivants). */
import type { BufferGeometry, InstancedMesh } from 'three'
import { Matrix4, Quaternion, Vector3 } from 'three'
import type { Island } from './island'

/** Une emprise : des triangles en coordonnées monde (ou locales, avec une
 *  échelle et un décalage), dont seuls ceux qui dépassent `minY` comptent —
 *  une dalle au ras du sol se piétine, un mur non. */
export interface Footprint {
  geo?: BufferGeometry
  /** Triangles bruts, x,y,z par sommet, trois sommets par triangle. */
  tris?: readonly number[]
  minY: number
  scale?: number
  ox?: number
  oy?: number
  oz?: number
}

/** Ce qui pose des choses au sol : le village, la faune (enclos, poulailler).
 *  `revision` change à chaque pose ; la carte se refait alors à la demande. */
export interface GroundSource {
  readonly revision: number
  groundFootprints(): Footprint[]
}

export interface Pt {
  x: number
  z: number
}

export interface Route {
  /** Points de passage, sans le point de départ, jusqu'au point atteint. */
  pts: Pt[]
  /** Faux si le but est inaccessible : la route mène alors au plus près. */
  reached: boolean
  length: number
}

/** Pas de la grille fine (occupation + distance). */
const RES = 0.1
/** Les nœuds de recherche de chemin : un sur deux de la grille fine. */
const STRIDE = 2
const NODE = RES * STRIDE
/** Borne basse de l'erreur de la grille : un point quelconque est à moins de
 *  0,071 du centre de sa case, un point de géométrie à moins de 0,096 du
 *  centre d'une case pleine (arêtes échantillonnées tous les 0,05). La
 *  distance vraie vaut donc au moins la distance entre centres moins 0,17 :
 *  c'est ce que rend `clearAt`, une valeur sûre, jamais optimiste. */
const SLACK = 0.17
const SQRT2 = Math.SQRT2

/** Transformée de distance exacte en 1D (Felzenszwalb & Huttenlocher). */
function dt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  const INF = 1e20
  let k = 0
  v[0] = 0
  z[0] = -INF
  z[1] = INF
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!)
    while (s <= z[k]!) {
      k--
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!)
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = INF
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++
    d[q] = (q - v[k]!) * (q - v[k]!) + f[v[k]!]!
  }
}

export class Ground {
  readonly x0: number
  readonly z0: number
  readonly nx: number
  readonly nz: number
  /** Incrémenté à chaque reconstruction : les mobiles y voient qu'une
   *  emprise est apparue et revoient leur chemin. */
  revision = 0
  /** Durée de la dernière reconstruction, en ms (mesure de coût). */
  lastBuildMs = 0

  private readonly island: Island
  private readonly sources: readonly GroundSource[]
  private seen = ''
  private readonly occ: Uint8Array
  /** L'eau ne change pas tant que l'île est la même : relevée une fois. */
  private readonly water: Uint8Array
  /** Distance sûre (borne basse) au plein le plus proche, en unités. */
  private readonly clr: Float32Array

  // Recherche de chemin : tampons alloués une fois, remis à zéro par tampon
  // de génération plutôt qu'en les effaçant — zéro allocation par requête.
  private readonly mx: number
  private readonly mz: number
  private readonly gScore: Float32Array
  private readonly parent: Int32Array
  private readonly stamp: Uint32Array
  private readonly closed: Uint32Array
  private gen = 0
  private heap: Int32Array
  private heapF: Float32Array
  private heapN = 0
  /** Les composantes connexes des nœuds, une par rayon de corps : refaites
   *  au besoin, après une pose (voir `components`). */
  private readonly comps = new Map<number, { label: Int32Array; main: number; rev: number }>()
  private stack: Int32Array

  // Champs déclarés à la main, comme l'île : Node charge le module tel quel
  // dans les tests.
  constructor(island: Island, sources: readonly GroundSource[]) {
    this.island = island
    this.sources = sources
    let minx = Infinity
    let minz = Infinity
    let maxx = -Infinity
    let maxz = -Infinity
    for (const c of island.cells) {
      minx = Math.min(minx, c.x)
      maxx = Math.max(maxx, c.x)
      minz = Math.min(minz, c.z)
      maxz = Math.max(maxz, c.z)
    }
    if (!Number.isFinite(minx)) minx = minz = maxx = maxz = 0
    // Deux unités de mer autour : la côte a de l'eau des deux côtés.
    this.x0 = minx - 2
    this.z0 = minz - 2
    this.nx = Math.ceil((maxx - minx + 4) / RES)
    this.nz = Math.ceil((maxz - minz + 4) / RES)
    this.occ = new Uint8Array(this.nx * this.nz)
    this.water = this.waterMask()
    this.clr = new Float32Array(this.nx * this.nz)
    this.mx = Math.ceil(this.nx / STRIDE)
    this.mz = Math.ceil(this.nz / STRIDE)
    const n = this.mx * this.mz
    this.gScore = new Float32Array(n)
    this.parent = new Int32Array(n)
    this.stamp = new Uint32Array(n)
    this.closed = new Uint32Array(n)
    this.heap = new Int32Array(1024)
    this.heapF = new Float32Array(1024)
    this.stack = new Int32Array(n)
    this.rebuild()
  }

  /** Refait la carte si une source a posé quelque chose. Appelé à chaque
   *  image par la boucle : une comparaison de chaîne courte, rien de plus. */
  refresh(): boolean {
    const key = this.sources.map((s) => s.revision).join(',')
    if (key === this.seen) return false
    this.rebuild()
    return true
  }

  private rebuild(): void {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
    this.seen = this.sources.map((s) => s.revision).join(',')
    this.occ.set(this.water)
    for (const s of this.sources) for (const f of s.groundFootprints()) this.stampFootprint(f)
    this.stampTrunksAndRocks()
    this.distance()
    this.revision++
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now()
    this.lastBuildMs = t1 - t0
  }

  /** L'eau : une case est mouillée dès qu'un de ses coins ou son centre
   *  l'est. La faune reste sur la terre, et la marge du corps se mesure
   *  aussi contre le rivage. */
  private waterMask(): Uint8Array {
    const { nx, nz } = this
    const out = new Uint8Array(nx * nz)
    const w = nx + 1
    const wet = new Uint8Array(w * (nz + 1))
    for (let j = 0; j <= nz; j++)
      for (let i = 0; i <= nx; i++) wet[j * w + i] = this.island.isLand(this.x0 + i * RES, this.z0 + j * RES) ? 0 : 1
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++)
        if (
          wet[j * w + i] ||
          wet[j * w + i + 1] ||
          wet[(j + 1) * w + i] ||
          wet[(j + 1) * w + i + 1] ||
          !this.island.isLand(this.x0 + (i + 0.5) * RES, this.z0 + (j + 0.5) * RES)
        )
          out[j * nx + i] = 1
    return out
  }

  /** Troncs et rochers : les instances réelles de l'île, abattus exclus. Les
   *  rayons sont ceux des maillages (tronc 0,16, rocher 0,42, à l'échelle de
   *  l'instance). Les buissons se traversent : ils ne sont pas ici. */
  private stampTrunksAndRocks(): void {
    const m = new Matrix4()
    const p = new Vector3()
    const q = new Quaternion()
    const s = new Vector3()
    for (const mesh of this.island.pickables as InstancedMesh[]) {
      const kind = this.island.kindFor(mesh)
      const k = kind === 'wood' ? 0.16 : kind === 'stone' ? 0.42 : 0
      if (k === 0) continue
      for (let i = 0; i < mesh.count; i++) {
        if (this.island.isFelled(mesh, i)) continue
        mesh.getMatrixAt(i, m)
        m.decompose(p, q, s)
        this.stampDisc(p.x, p.z, k * s.x)
      }
    }
  }

  private stampDisc(cx: number, cz: number, r: number): void {
    const { nx, nz, occ } = this
    // Une case est pleine si le disque touche le carré : on gonfle de la
    // demi-diagonale plutôt que de tester les quatre coins.
    const rr = r + RES * 0.71
    const i0 = Math.max(0, Math.floor((cx - rr - this.x0) / RES))
    const i1 = Math.min(nx - 1, Math.floor((cx + rr - this.x0) / RES))
    const j0 = Math.max(0, Math.floor((cz - rr - this.z0) / RES))
    const j1 = Math.min(nz - 1, Math.floor((cz + rr - this.z0) / RES))
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = this.x0 + (i + 0.5) * RES - cx
        const z = this.z0 + (j + 0.5) * RES - cz
        if (x * x + z * z <= rr * rr) occ[j * nx + i] = 1
      }
  }

  private mark(x: number, z: number): void {
    const i = Math.floor((x - this.x0) / RES)
    const j = Math.floor((z - this.z0) / RES)
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return
    this.occ[j * this.nx + i] = 1
  }

  /** Projette les triangles en plan : leurs arêtes échantillonnées au
   *  demi-pas (un mur vertical n'a pas d'intérieur en plan, seulement une
   *  arête), puis leur intérieur. */
  private stampFootprint(f: Footprint): void {
    const k = f.scale ?? 1
    const ox = f.ox ?? 0
    const oy = f.oy ?? 0
    const oz = f.oz ?? 0
    let P: ArrayLike<number>
    let I: ArrayLike<number> | null = null
    if (f.geo) {
      P = f.geo.getAttribute('position').array as ArrayLike<number>
      I = f.geo.index ? (f.geo.index.array as ArrayLike<number>) : null
    } else if (f.tris) P = f.tris
    else return
    const nT = I ? I.length / 3 : P.length / 9
    const v = new Float64Array(9)
    for (let t = 0; t < nT; t++) {
      for (let c = 0; c < 3; c++) {
        const idx = I ? I[t * 3 + c]! : t * 3 + c
        v[c * 3] = ox + P[idx * 3]! * k
        v[c * 3 + 1] = oy + P[idx * 3 + 1]! * k
        v[c * 3 + 2] = oz + P[idx * 3 + 2]! * k
      }
      if (Math.max(v[1]!, v[4]!, v[7]!) < f.minY) continue
      this.stampTriangle(v)
    }
  }

  private stampTriangle(v: Float64Array): void {
    const ax = v[0]!, az = v[2]!, bx = v[3]!, bz = v[5]!, cx = v[6]!, cz = v[8]!
    for (const [px, pz, qx, qz] of [
      [ax, az, bx, bz],
      [bx, bz, cx, cz],
      [cx, cz, ax, az],
    ] as const) {
      const L = Math.hypot(qx - px, qz - pz)
      const n = Math.max(1, Math.ceil(L / (RES * 0.5)))
      for (let s = 0; s <= n; s++) this.mark(px + ((qx - px) * s) / n, pz + ((qz - pz) * s) / n)
    }
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
    if (Math.abs(d) < 1e-12) return
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - this.x0) / RES))
    const i1 = Math.min(this.nx - 1, Math.floor((Math.max(ax, bx, cx) - this.x0) / RES))
    const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - this.z0) / RES))
    const j1 = Math.min(this.nz - 1, Math.floor((Math.max(az, bz, cz) - this.z0) / RES))
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const px = this.x0 + (i + 0.5) * RES
        const pz = this.z0 + (j + 0.5) * RES
        const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d
        const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d
        if (l1 >= 0 && l2 >= 0 && 1 - l1 - l2 >= 0) this.occ[j * this.nx + i] = 1
      }
  }

  /** Distance de chaque case libre à la case pleine la plus proche. */
  private distance(): void {
    const { nx, nz, occ, clr } = this
    const INF = 1e20
    const m = Math.max(nx, nz)
    const f = new Float64Array(m)
    const d = new Float64Array(m)
    const v = new Int32Array(m)
    const z = new Float64Array(m + 1)
    const tmp = new Float64Array(nx * nz)
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) f[j] = occ[j * nx + i] ? 0 : INF
      dt1d(f, nz, d, v, z)
      for (let j = 0; j < nz; j++) tmp[j * nx + i] = d[j]!
    }
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) f[i] = tmp[j * nx + i]!
      dt1d(f, nx, d, v, z)
      for (let i = 0; i < nx; i++) clr[j * nx + i] = occ[j * nx + i] ? -1 : Math.sqrt(d[i]!) * RES - SLACK
    }
  }

  /** Place sûre autour du point : sa distance au plein (eau comprise), en
   *  unités, jamais surestimée. Négative dedans ou hors de la carte. */
  clearAt(x: number, z: number): number {
    const i = Math.floor((x - this.x0) / RES)
    const j = Math.floor((z - this.z0) / RES)
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -1
    return this.clr[j * this.nx + i]!
  }

  /** Un corps de rayon r tient-il ici ? */
  free(x: number, z: number, r: number): boolean {
    return this.clearAt(x, z) >= r
  }

  /** Le segment garde-t-il le corps hors de tout ? Échantillonné à 0,05. */
  lineClear(ax: number, az: number, bx: number, bz: number, r: number): boolean {
    const L = Math.hypot(bx - ax, bz - az)
    const n = Math.max(1, Math.ceil(L / (RES * 0.5)))
    for (let s = 0; s <= n; s++) if (this.clearAt(ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n) < r) return false
    return true
  }

  // ── nœuds ────────────────────────────────────────────────────────────────
  private nodeClear(n: number): number {
    const i = (n % this.mx) * STRIDE
    const j = ((n / this.mx) | 0) * STRIDE
    if (i >= this.nx || j >= this.nz) return -1
    return this.clr[j * this.nx + i]!
  }
  private nodeX(n: number): number {
    return this.x0 + ((n % this.mx) * STRIDE + 0.5) * RES
  }
  private nodeZ(n: number): number {
    return this.z0 + (((n / this.mx) | 0) * STRIDE + 0.5) * RES
  }
  private nodeAt(x: number, z: number): number {
    const i = Math.min(this.mx - 1, Math.max(0, Math.round((x - this.x0) / RES / STRIDE - 0.25)))
    const j = Math.min(this.mz - 1, Math.max(0, Math.round((z - this.z0) / RES / STRIDE - 0.25)))
    return j * this.mx + i
  }

  /** Le nœud praticable le plus proche (spirale de carrés), ou -1. */
  private nearestNode(x: number, z: number, r: number, maxDist: number): number {
    const need = r
    const c = this.nodeAt(x, z)
    const ci = c % this.mx
    const cj = (c / this.mx) | 0
    const R = Math.ceil(maxDist / NODE)
    let best = -1
    let bd = Infinity
    for (let ring = 0; ring <= R; ring++) {
      // Un anneau plus loin ne peut pas battre le meilleur trouvé.
      if (best >= 0 && (ring - 1) * NODE > bd) break
      for (let dj = -ring; dj <= ring; dj++)
        for (let di = -ring; di <= ring; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue
          const i = ci + di
          const j = cj + dj
          if (i < 0 || j < 0 || i >= this.mx || j >= this.mz) continue
          const n = j * this.mx + i
          if (this.nodeClear(n) < need) continue
          const d = Math.hypot(this.nodeX(n) - x, this.nodeZ(n) - z)
          if (d < bd) {
            bd = d
            best = n
          }
        }
    }
    return best
  }

  /** Le point libre le plus proche pour un corps de rayon r : le point
   *  lui-même s'il est libre, sinon un nœud praticable. */
  nearestFree(x: number, z: number, r: number, maxDist = 6): Pt | null {
    if (this.clearAt(x, z) >= r) return { x, z }
    const n = this.nearestNode(x, z, r, maxDist)
    return n < 0 ? null : { x: this.nodeX(n), z: this.nodeZ(n) }
  }

  // ── composantes connexes ───────────────────────────────────────────────────────────────
  // Pourquoi : la QA de la PR #15 a trouvé des bêtes nées dans une poche
  // (un nœud praticable isolé entre un arbre et un rocher, ou 91 nœuds près du
  // campement) d'où aucun chemin ne sort : un cerf y restait figé 600 s.
  // Savoir à quelle composante appartient un point permet de ne tirer les
  // cibles que là où l'on peut aller, et de sortir un mobile d'une poche.

  /** Étiquettes des composantes pour un corps de rayon r (mêmes règles de
   *  passage que `route`), et la principale : la plus grande, celle du bourg.
   *  Calculées à la première demande après chaque reconstruction. */
  private components(r: number): { label: Int32Array; main: number } {
    let c = this.comps.get(r)
    if (c && c.rev === this.revision) return c
    const { mx, mz } = this
    const n = mx * mz
    const label = c ? c.label : new Int32Array(n)
    label.fill(-1)
    const st = this.stack
    let next = 0
    let main = -1
    let mainSize = 0
    for (let s = 0; s < n; s++) {
      if (label[s]! >= 0 || this.nodeClear(s) < r) continue
      const id = next++
      let size = 0
      let top = 0
      st[top++] = s
      label[s] = id
      while (top > 0) {
        const a = st[--top]!
        size++
        const i = a % mx
        const j = (a / mx) | 0
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            if (di === 0 && dj === 0) continue
            const ii = i + di
            const jj = j + dj
            if (ii < 0 || jj < 0 || ii >= mx || jj >= mz) continue
            const m = jj * mx + ii
            if (label[m]! >= 0 || this.nodeClear(m) < r) continue
            if (di !== 0 && dj !== 0 && (this.nodeClear(j * mx + ii) < r || this.nodeClear(jj * mx + i) < r)) continue
            if (this.clearAt((this.nodeX(a) + this.nodeX(m)) / 2, (this.nodeZ(a) + this.nodeZ(m)) / 2) < r) continue
            label[m] = id
            st[top++] = m
          }
      }
      if (size > mainSize) {
        mainSize = size
        main = id
      }
    }
    c = { label, main, rev: this.revision }
    this.comps.set(r, c)
    return c
  }

  /** La composante principale pour un corps de rayon r. */
  mainComponent(r: number): number {
    return this.components(r).main
  }

  /** La composante où se trouve ce point (celle de son nœud praticable le
   *  plus proche, à moins d'une unité), ou -1. */
  componentAt(x: number, z: number, r: number): number {
    const n = this.nearestNode(x, z, r, 1)
    return n < 0 ? -1 : this.components(r).label[n]!
  }

  /** Le point le plus proche de (x, z) dans la composante `comp` : le point
   *  lui-même s'il est libre et y appartient, sinon le nœud le plus proche
   *  de cette composante (spirale de carrés), ou null au-delà de `maxDist`. */
  nearestIn(x: number, z: number, r: number, comp: number, maxDist = 6): Pt | null {
    if (comp < 0) return null
    const { label } = this.components(r)
    if (this.clearAt(x, z) >= r) {
      const n = this.nearestNode(x, z, r, 1)
      if (n >= 0 && label[n] === comp) return { x, z }
    }
    const c = this.nodeAt(x, z)
    const ci = c % this.mx
    const cj = (c / this.mx) | 0
    const R = Math.ceil(maxDist / NODE)
    let best = -1
    let bd = Infinity
    for (let ring = 0; ring <= R; ring++) {
      if (best >= 0 && (ring - 1) * NODE > bd) break
      for (let dj = -ring; dj <= ring; dj++)
        for (let di = -ring; di <= ring; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue
          const i = ci + di
          const j = cj + dj
          if (i < 0 || j < 0 || i >= this.mx || j >= this.mz) continue
          const n = j * this.mx + i
          if (label[n] !== comp) continue
          const d = Math.hypot(this.nodeX(n) - x, this.nodeZ(n) - z)
          if (d < bd) {
            bd = d
            best = n
          }
        }
    }
    return best < 0 ? null : { x: this.nodeX(best), z: this.nodeZ(best) }
  }

  // ── tas binaire ──────────────────────────────────────────────────────────
  private push(n: number, f: number): void {
    if (this.heapN >= this.heap.length) {
      const h = new Int32Array(this.heap.length * 2)
      h.set(this.heap)
      const hf = new Float32Array(this.heap.length * 2)
      hf.set(this.heapF)
      this.heap = h
      this.heapF = hf
    }
    let k = this.heapN++
    while (k > 0) {
      const p = (k - 1) >> 1
      if (this.heapF[p]! <= f) break
      this.heap[k] = this.heap[p]!
      this.heapF[k] = this.heapF[p]!
      k = p
    }
    this.heap[k] = n
    this.heapF[k] = f
  }
  private pop(): number {
    const top = this.heap[0]!
    const n = this.heap[--this.heapN]!
    const f = this.heapF[this.heapN]!
    let k = 0
    for (;;) {
      let c = 2 * k + 1
      if (c >= this.heapN) break
      if (c + 1 < this.heapN && this.heapF[c + 1]! < this.heapF[c]!) c++
      if (this.heapF[c]! >= f) break
      this.heap[k] = this.heap[c]!
      this.heapF[k] = this.heapF[c]!
      k = c
    }
    this.heap[k] = n
    this.heapF[k] = f
    return top
  }

  /** Le chemin d'un corps de rayon r, de (x0,z0) à (x1,z1) : A* sur les
   *  nœuds de 0,2 u, puis tendu (on saute les nœuds tant que le segment reste
   *  dégagé). But inaccessible : la route mène au point atteignable le plus
   *  proche — le mobile s'en approche au lieu de foncer dans un mur ou de
   *  rester planté. Départ dans une emprise (un bâtiment vient de pousser
   *  sous lui) : le premier pas l'en sort par le plus court. */
  route(x0: number, z0: number, x1: number, z1: number, r: number, maxExpand = 24000): Route {
    const need = r
    // Ligne droite dégagée : le cas courant, sans recherche.
    if (this.clearAt(x0, z0) >= r && this.clearAt(x1, z1) >= r && this.lineClear(x0, z0, x1, z1, r)) {
      return { pts: [{ x: x1, z: z1 }], reached: true, length: Math.hypot(x1 - x0, z1 - z0) }
    }
    const start = this.nearestNode(x0, z0, r, 4)
    if (start < 0) return { pts: [], reached: false, length: 0 }
    const goalFree = this.clearAt(x1, z1) >= r
    let goal = this.nodeAt(x1, z1)
    if (this.nodeClear(goal) < need) goal = this.nearestNode(x1, z1, r, 3)
    const gx = x1
    const gz = z1
    this.gen++
    if (this.gen >= 0xffffffff) {
      this.gen = 1
      this.stamp.fill(0)
      this.closed.fill(0)
    }
    const gen = this.gen
    const mx = this.mx
    this.heapN = 0
    this.gScore[start] = 0
    this.parent[start] = -1
    this.stamp[start] = gen
    const h = (n: number): number => {
      const dx = Math.abs(this.nodeX(n) - gx) / NODE
      const dz = Math.abs(this.nodeZ(n) - gz) / NODE
      return (Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz)) * NODE
    }
    this.push(start, h(start))
    let best = start
    let bestH = h(start)
    let found = false
    let expanded = 0
    while (this.heapN > 0 && expanded < maxExpand) {
      const n = this.pop()
      if (this.closed[n] === gen) continue
      this.closed[n] = gen
      expanded++
      const hn = h(n)
      if (hn < bestH) {
        bestH = hn
        best = n
      }
      if (n === goal) {
        found = true
        best = n
        break
      }
      const i = n % mx
      const j = (n / mx) | 0
      const g = this.gScore[n]!
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue
          const ii = i + di
          const jj = j + dj
          if (ii < 0 || jj < 0 || ii >= mx || jj >= this.mz) continue
          const m = jj * mx + ii
          if (this.closed[m] === gen) continue
          if (this.nodeClear(m) < need) continue
          // En diagonale, les deux voisins orthogonaux doivent passer : pas
          // de coin coupé au ras d'un mur.
          if (di !== 0 && dj !== 0 && (this.nodeClear(j * mx + ii) < need || this.nodeClear(jj * mx + i) < need)) continue
          // Le milieu du pas : un mur fin (une lisse, un piquet) entre deux
          // nœuds libres ne se franchit pas.
          if (this.clearAt((this.nodeX(n) + this.nodeX(m)) / 2, (this.nodeZ(n) + this.nodeZ(m)) / 2) < r) continue
          const ng = g + (di !== 0 && dj !== 0 ? SQRT2 : 1) * NODE
          if (this.stamp[m] === gen && ng >= this.gScore[m]!) continue
          this.stamp[m] = gen
          this.gScore[m] = ng
          this.parent[m] = n
          this.push(m, ng + h(m))
        }
    }
    // Remonte la chaîne de nœuds.
    const chain: Pt[] = []
    for (let n = best; n >= 0; n = this.parent[n]!) chain.push({ x: this.nodeX(n), z: this.nodeZ(n) })
    chain.reverse()
    const reached = found && goal >= 0
    // Le but exact, s'il est libre et visible du dernier nœud.
    if (reached && goalFree) {
      const last = chain[chain.length - 1]!
      if (this.lineClear(last.x, last.z, gx, gz, r)) chain.push({ x: gx, z: gz })
    }
    // Tendre le fil : depuis chaque point, le plus lointain encore visible.
    const pts: Pt[] = []
    let ax = x0
    let az = z0
    let k = 0
    // Départ hors de toute place sûre : on rejoint d'abord le premier nœud.
    if (this.clearAt(x0, z0) < r) {
      pts.push(chain[0]!)
      ax = chain[0]!.x
      az = chain[0]!.z
      k = 1
    }
    while (k < chain.length) {
      let far = k
      for (let t = Math.min(chain.length - 1, k + 60); t > k; t--) {
        if (this.lineClear(ax, az, chain[t]!.x, chain[t]!.z, r)) {
          far = t
          break
        }
      }
      pts.push(chain[far]!)
      ax = chain[far]!.x
      az = chain[far]!.z
      k = far + 1
    }
    let length = 0
    let px = x0
    let pz = z0
    for (const p of pts) {
      length += Math.hypot(p.x - px, p.z - pz)
      px = p.x
      pz = p.z
    }
    return { pts, reached: reached && (goalFree || Math.hypot(px - gx, pz - gz) < 0.6), length }
  }
}

/** Avance le long d'un chemin : déplace `pos` d'au plus `step` sur les points
 *  de passage, en consomme ceux qu'il atteint. Rend la direction du dernier
 *  pas (pour le cap) ou null s'il n'a pas bougé. */
export function follow(pos: { x: number; z: number }, path: Pt[], step: number): { dx: number; dz: number } | null {
  let left = step
  let dir: { dx: number; dz: number } | null = null
  while (left > 1e-6 && path.length > 0) {
    const p = path[0]!
    const dx = p.x - pos.x
    const dz = p.z - pos.z
    const d = Math.hypot(dx, dz)
    if (d > 1e-6) dir = { dx: dx / d, dz: dz / d }
    if (d <= left) {
      pos.x = p.x
      pos.z = p.z
      left -= d
      path.shift()
    } else {
      pos.x += (dx / d) * left
      pos.z += (dz / d) * left
      left = 0
    }
  }
  return dir
}
