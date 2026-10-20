// La CEINTURE : le tracé qui fait le tour de l'île, sentier côtier aux
// premiers âges, chemin ensuite, voie ferrée à l'âge 7. Module sans three ni
// asset : les tests le chargent sous Node, et la règle se lit ici d'un bloc.
//
// Le tracé (conception du 2026-10-13, section 2.a) :
// 1. le rivage réel, échantillonné en polaire depuis le centre de l'île sur
//    720 rayons (distance à la première eau, `isLand` faisant foi) ;
// 2. lissé par une convolution circulaire GAUSSIENNE (σ = 30°) — son noyau
//    est positif, donc une côte qui avance ne fait jamais reculer la voie ;
// 3. abaissé d'un recul unique, le plus petit qui garde l'axe à une case
//    (1,35 u) de l'eau partout.
// Il est gardé en 72 rayons (tous les 5°), relus comme les points de contrôle
// d'une B-spline cubique périodique en polaire : courbe C², et chaque point
// est une moyenne à poids positifs des rayons voisins — un rayon qui grandit
// ne peut que repousser la courbe vers le large.

export const BELT_N = 72
/** Le tracé sur l'île de base (le sentier, avant l'âge 7) : lissage de 32°
 *  et une case de garde (1,35 u). Mesuré (conception) : la moyenne glissante
 *  ou Fourier à 5 harmoniques descendaient à 2,2 u de rayon de courbure ; à
 *  30°, l'île de base descend à 8,99 u (graine 123), à 32° 9,5 u au moins.
 *
 *  Le tracé de la VOIE, sur l'île agrandie (2026-10-20, 90 sauvegardes 3.61
 *  générées, dix graines, âges 7 à 10, 0 à 12 parcelles, phare à part) :
 *  σ 32° / garde 1,35 → rayon ≥ 12,2 u, 13,6 % des bâtiments sur le tracé,
 *  11 parties sur 90 au-delà de 20 % ; σ 28° / garde 1,2 → rayon ≥ 11,3 u,
 *  10,9 %, 2 parties sur 90 (22,7 % au pire). On garde la seconde : moins de
 *  bâtiments déplacés, la garde de la conception (1,2 u) et un rayon bien
 *  au-dessus du plancher de 9 u. */
export const BELT_SIGMA = (32 * Math.PI) / 180
export const BELT_GUARD = 1.35
export const RAIL_SIGMA = (28 * Math.PI) / 180
export const RAIL_GUARD = 1.2
const RAYS = 720

type IsLand = (x: number, z: number) => boolean

export interface Pt {
  x: number
  z: number
}

/** Distance du centre à la première eau, sur `rays` rayons (θ = atan2(z, x)). */
export function shoreRadii(isLand: IsLand, rays = RAYS, step = 0.05, max = 80): Float64Array {
  const out = new Float64Array(rays)
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2
    const c = Math.cos(a)
    const s = Math.sin(a)
    let r = 0
    while (r < max && isLand(r * c, r * s)) r += step
    out[i] = r
  }
  return out
}

/** Convolution circulaire par une gaussienne d'écart-type `sigma` (radians). */
export function gaussCircular(v: ArrayLike<number>, sigma: number): Float64Array {
  const n = v.length
  const s = (sigma / (Math.PI * 2)) * n
  const h = Math.ceil(s * 3)
  const w: number[] = []
  let sum = 0
  for (let k = -h; k <= h; k++) {
    const e = Math.exp(-(k * k) / (2 * s * s))
    w.push(e)
    sum += e
  }
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let acc = 0
    for (let k = -h; k <= h; k++) acc += v[(((i + k) % n) + n) % n]! * w[k + h]!
    out[i] = acc / sum
  }
  return out
}

/** Le rayon de la ceinture à l'angle θ : B-spline cubique uniforme et
 *  périodique des rayons de contrôle. */
export function beltRadius(radii: readonly number[], theta: number): number {
  const n = radii.length
  const t = ((((theta / (Math.PI * 2)) * n) % n) + n) % n
  const j = Math.floor(t)
  const u = t - j
  const c = (k: number): number => radii[(((j + k) % n) + n) % n]!
  const u2 = u * u
  const u3 = u2 * u
  return (
    (c(-1) * (1 - u) ** 3 + c(0) * (3 * u3 - 6 * u2 + 4) + c(1) * (-3 * u3 + 3 * u2 + 3 * u + 1) + c(2) * u3) / 6
  )
}

/** La ceinture en polyligne FERMÉE, à pas régulier (≈ `step` u), parcourue
 *  dans le sens HORAIRE vu du ciel (θ décroissant) : vu de la caméra par
 *  défaut, la rame passe de gauche à droite au premier plan. Le dernier point
 *  répète le premier ; `cum` va de 0 à la longueur de la boucle. */
export function beltPath(radii: readonly number[], step = 0.4): { pts: Pt[]; cum: number[] } {
  const fineN = 4096
  const fine: Pt[] = []
  for (let i = 0; i <= fineN; i++) {
    const a = -(i / fineN) * Math.PI * 2
    const r = beltRadius(radii, a)
    fine.push({ x: r * Math.cos(a), z: r * Math.sin(a) })
  }
  const fc = [0]
  for (let i = 1; i < fine.length; i++)
    fc.push(fc[i - 1]! + Math.hypot(fine[i]!.x - fine[i - 1]!.x, fine[i]!.z - fine[i - 1]!.z))
  const total = fc[fc.length - 1]!
  const n = Math.max(8, Math.round(total / step))
  const pts: Pt[] = []
  let k = 1
  for (let i = 0; i < n; i++) {
    const s = (total * i) / n
    while (k < fine.length - 1 && fc[k]! < s) k++
    const a = fine[k - 1]!
    const b = fine[k]!
    const u = (s - fc[k - 1]!) / Math.max(1e-9, fc[k]! - fc[k - 1]!)
    pts.push({ x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u })
  }
  pts.push({ x: pts[0]!.x, z: pts[0]!.z })
  const cum = [0]
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z))
  return { pts, cum }
}

/** Distance à l'eau la plus proche, plafonnée à `cap` (échantillonnée tous
 *  les 5 cm sur 32 directions). */
export function waterDist(isLand: IsLand, x: number, z: number, cap = 4): number {
  if (!isLand(x, z)) return 0
  for (let r = 0.05; r <= cap + 1e-9; r += 0.05)
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2
      if (!isLand(x + Math.cos(a) * r, z + Math.sin(a) * r)) return r
    }
  return cap
}

/** La plus petite garde axe-eau le long de la ceinture. */
export function beltGuard(isLand: IsLand, pts: readonly Pt[], cap = 4): number {
  let g = Infinity
  for (const p of pts) g = Math.min(g, waterDist(isLand, p.x, p.z, cap))
  return g
}

/** Vrai si tout l'axe tient à `guard` de l'eau (sortie dès le premier point
 *  fautif : c'est la sonde de la recherche du recul). */
function guarded(isLand: IsLand, pts: readonly Pt[], guard: number): boolean {
  for (const p of pts) if (waterDist(isLand, p.x, p.z, guard) < guard - 1e-9) return false
  return true
}

/** Arrondi au centième PAR EXCÈS : une ceinture relue n'est jamais en deçà de
 *  celle qu'on a tracée. */
const up = (v: number): number => Math.ceil(v * 100 - 1e-6) / 100

/** Le tracé que réclame CETTE île : rivage lissé, puis recul. `rail` : le
 *  tracé de la voie (île agrandie), sinon celui du sentier. */
export function beltFor(isLand: IsLand, rail = false): number[] {
  const guard = rail ? RAIL_GUARD : BELT_GUARD
  const g = gaussCircular(shoreRadii(isLand), rail ? RAIL_SIGMA : BELT_SIGMA)
  const step = RAYS / BELT_N
  const base: number[] = []
  for (let j = 0; j < BELT_N; j++) base.push(g[j * step]!)
  const at = (d: number): number[] => base.map((r) => up(Math.max(2, r - d)))
  const ok = (d: number): boolean => guarded(isLand, beltPath(at(d)).pts, guard)
  if (ok(0)) return at(0)
  // Le plus petit recul qui tient la garde, au vingtième d'unité, par
  // dichotomie : `lo` ne tient pas, `hi` tient.
  let lo = 0
  let hi = 12
  if (!ok(hi)) return at(hi)
  while (hi - lo > 0.05) {
    const m = Math.round(((lo + hi) / 2) * 100) / 100
    if (ok(m)) hi = m
    else lo = m
  }
  return at(hi)
}

/** La ceinture après une terre gagnée (ou le palier de l'âge 7) : elle ne
 *  peut que s'éloigner du centre — rayon par rayon, le plus grand des deux.
 *  Le raccord se lisse de lui-même : la courbe est une B-spline des rayons.
 *  La conception proposait un maximum ADOUCI (k = 0,6) ; mesuré, il ajoutait
 *  0,15 u à chaque pose là où les deux tracés coïncident — au point même où
 *  la garde est la plus juste — et la voie glissait vers l'eau de pose en pose
 *  (garde 0,95 u après quatre parcelles, graine 2024). Le maximum simple tient
 *  1,3 u et un rayon de courbure de 9,5 u au moins (dix graines, douze
 *  parcelles). Si le nouveau tracé ne dépasse nulle part l'ancien, l'ancien
 *  est rendu TEL QUEL : les chargements successifs ne le font pas dériver. */
export function growBelt(prev: readonly number[] | null, next: readonly number[]): number[] {
  if (!prev || prev.length !== BELT_N) return [...next]
  return prev.map((r, j) => Math.max(r, next[j]!))
}

/** Une ceinture relue de la sauvegarde : 72 rayons finis et positifs, ou rien. */
export function cleanBelt(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length !== BELT_N) return null
  if (!v.every((r) => typeof r === 'number' && Number.isFinite(r) && r > 1 && r < 80)) return null
  return v.map((r) => up(r as number))
}

/** Le rayon de courbure, mesuré sur la polyligne : cercle par trois points
 *  espacés de `span` sommets de part et d'autre. */
export function minCurvatureRadius(pts: readonly Pt[], span = 3): number {
  const n = pts.length - 1
  let best = Infinity
  for (let i = 0; i < n; i++) {
    const a = pts[(i - span + n) % n]!
    const b = pts[i]!
    const c = pts[(i + span) % n]!
    const ab = Math.hypot(b.x - a.x, b.z - a.z)
    const bc = Math.hypot(c.x - b.x, c.z - b.z)
    const ca = Math.hypot(a.x - c.x, a.z - c.z)
    const cross = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x))
    if (cross < 1e-12) continue
    best = Math.min(best, (ab * bc * ca) / (2 * cross))
  }
  return best
}

/** Le point de la ceinture (abscisse) le plus proche de `p`, et sa distance. */
export function nearestOnLoop(t: { pts: readonly Pt[]; cum: readonly number[] }, p: Pt): { s: number; d: number } {
  let best = 0
  let bestD = Infinity
  for (let i = 1; i < t.pts.length; i++) {
    const a = t.pts[i - 1]!
    const b = t.pts[i]!
    const vx = b.x - a.x
    const vz = b.z - a.z
    const L = vx * vx + vz * vz
    const u = L > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / L)) : 0
    const d = Math.hypot(a.x + vx * u - p.x, a.z + vz * u - p.z)
    if (d < bestD) {
      bestD = d
      best = t.cum[i - 1]! + (t.cum[i]! - t.cum[i - 1]!) * u
    }
  }
  return { s: best, d: bestD }
}

/** Le point (x, z) est-il À L'INTÉRIEUR de la ceinture ? */
export function insideBelt(radii: readonly number[], x: number, z: number): boolean {
  return Math.hypot(x, z) < beltRadius(radii, Math.atan2(z, x))
}
