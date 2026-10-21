// La rame du chemin de fer : de quoi elle est faite, et comment elle se pose
// sur la voie. Module sans import d'asset ni de three : les tests le chargent
// sous Node, et la règle de jeu se lit ici d'un bloc.

/** Les ressources qu'un wagon sait montrer. Le savoir (`insight`) ne se
 *  charge pas sur un plateau : il n'a pas de wagon. L'ordre sert à départager
 *  deux productions égales, pour que la rame ne change pas au hasard. */
export const CARGO = ['wood', 'stone', 'food', 'fiber', 'clay', 'copper', 'iron'] as const
export type Cargo = (typeof CARGO)[number]

/** Un véhicule de la rame. `empty` : le wagon couvert, quand il y a plus de
 *  wagons que de ressources produites (ou qu'un modèle manque). */
export type CarKind = 'loco' | 'coach' | 'empty' | Cargo

/** Longueur hors-tout de chaque véhicule, d'un bout d'attelage à l'autre
 *  (pour la loco : du chasse-pierres à l'attelage arrière). Mesurée sur les
 *  fichiers livrés et vérifiée par les tests : les attelages sont aux deux
 *  bouts, à ±longueur/2 du centre. */
export const CAR_LENGTH: Record<CarKind, number> = {
  loco: 2.43,
  coach: 1.72,
  empty: 1.34,
  wood: 1.34,
  stone: 1.34,
  food: 1.34,
  fiber: 1.34,
  clay: 1.34,
  copper: 1.34,
  iron: 1.34,
}

/** Le fichier de chaque véhicule (src/assets/models/<id>.glb). */
export const CAR_MODEL: Record<CarKind, string> = {
  loco: 'loco',
  coach: 'wagon_coach',
  empty: 'wagon_empty',
  wood: 'wagon_wood',
  stone: 'wagon_stone',
  food: 'wagon_food',
  fiber: 'wagon_fiber',
  clay: 'wagon_clay',
  copper: 'wagon_copper',
  iron: 'wagon_iron',
}

/** L'ÉCHELLE de la rame, posée sur la voie. Les modèles livrés font une loco
 *  de 2,43 u de long et 1,02 u de haut ; le colon, joué à ×1,32 pour rester
 *  lisible sur un téléphone (settler.ts), fait 2,2 u de haut à l'écran pour
 *  1,70 m. À l'échelle du village (colon 1,5 u), la loco fait 2,75 m : un
 *  jouet. La taille réelle (loco à vapeur de 10 à 12 m, ×4) ne tient pas sur
 *  la boucle : un véhicule RIGIDE de longueur L sur un rayon R a le milieu
 *  à L²/8R de la corde, et l'essieu avant de la loco (à 0,6/2,43 de L) à
 *  0,558·k²/R de l'axe. Avec R ≥ 11,3 u (voie de l'île agrandie, dix graines,
 *  douze parcelles) et la tolérance de 0,10 u (roue de 6 cm sur un rail de
 *  8 cm), k ≤ 1,42 ; la taille réelle demanderait R ≥ 89 u, une île trois
 *  fois plus grande que la nôtre. Mesuré en jeu à 1,45 : 0,1005 u au pire
 *  (graine 42, douze parcelles). On prend 1,4 : loco de 3,40 u (3,85 m),
 *  1,43 u de haut, soit les deux tiers du colon tel qu'on le voit (2,2 u) ;
 *  rame de 15,2 u à l'âge 10 pour une boucle de 110 u au moins. */
export const TRAIN_SCALE = 1.4

/** L'âge du chemin de fer (savoir `railway`, Ère industrielle). */
export const TRAIN_AGE = 7
/** La voiture de voyageurs arrive avec l'Ère moderne. */
export const COACH_AGE = 8

/** Wagons de marchandises : deux à l'apparition du train, un de plus par âge.
 *  Bornés à deux en dessous (le train n'existe pas avant l'âge 7, mais une
 *  partie bricolée ne doit pas donner une loco seule) et à cinq au-dessus (le
 *  dernier âge est le 10 : la rame fait alors 10,85 u, loco et voiture
 *  comprises). */
export function goodsCount(age: number): number {
  return Math.min(5, Math.max(2, age - TRAIN_AGE + 2))
}

/** Les ressources classées de la plus produite à la moins produite ; celles
 *  qui ne produisent rien n'en sont pas (leur wagon serait un mensonge). */
export function rankCargo(rates: Partial<Record<string, number>>): Cargo[] {
  return CARGO.filter((id) => (rates[id] ?? 0) > 0)
    .map((id, k) => ({ id, r: rates[id] ?? 0, k }))
    .sort((a, b) => b.r - a.r || a.k - b.k)
    .map((e) => e.id)
}

/** La composition : la loco, la voiture de voyageurs juste derrière elle dès
 *  l'âge 8, puis un wagon par ressource dans l'ordre de production. Si la
 *  voie est trop courte pour la rame entière, on dételle par la queue — les
 *  marchandises d'abord, la voiture en dernier, jamais la loco. */
export function consistFor(age: number, ranked: readonly Cargo[], maxLength = Infinity): CarKind[] {
  const cars: CarKind[] = ['loco']
  if (age >= COACH_AGE) cars.push('coach')
  for (let i = 0; i < goodsCount(age); i++) cars.push(ranked[i] ?? 'empty')
  while (cars.length > 1 && consistLength(cars) > maxLength) cars.pop()
  return cars
}

export function consistLength(cars: readonly CarKind[]): number {
  return cars.reduce((m, k) => m + CAR_LENGTH[k], 0)
}

// ── Pose sur la voie ─────────────────────────────────────────────────────────

export interface Track {
  pts: readonly { x: number; z: number }[]
  /** Abscisse curviligne cumulée de chaque point. */
  cum: readonly number[]
  /** Voie en BOUCLE : le dernier point répète le premier, et l'abscisse se
   *  lit modulo la longueur (`cum` du dernier point). Plus de bout de voie. */
  closed?: boolean
}

/** L'abscisse ramenée dans [0, L[ sur une boucle ; telle quelle sinon. */
export function wrapS(t: Track, s: number): number {
  if (!t.closed) return s
  const L = t.cum[t.cum.length - 1]!
  return ((s % L) + L) % L
}

/** Le segment [i − 1, i] qui porte l'abscisse `s` (recherche dichotomique). */
function segmentAt(t: Track, s: number): number {
  const n = t.pts.length
  let lo = 1
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (t.cum[mid]! < s) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Le point de la voie à l'abscisse `s`. Sur une boucle, l'abscisse est lue
 *  modulo la longueur. Sur une voie ouverte, au-delà des bouts, on prolonge
 *  le segment final en ligne droite : un véhicule rigide reste de sa longueur
 *  même s'il dépasse d'un cheveu. */
export function pointAt(t: Track, s: number): { x: number; z: number } {
  s = wrapS(t, s)
  const i = segmentAt(t, s)
  const a = t.pts[i - 1]!
  const b = t.pts[i]!
  const len = Math.max(1e-6, t.cum[i]! - t.cum[i - 1]!)
  const u = (s - t.cum[i - 1]!) / len
  return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u }
}

/** L'abscisse, en partant de `s0` dans le sens `step` (±1), du premier point
 *  de la voie à exactement `dist` (à vol d'oiseau) du point de départ.
 *
 *  C'est la clé de l'attelage : un wagon est RIGIDE. Poser ses deux bouts à
 *  `dist` d'abscisse l'un de l'autre le raccourcirait en courbe (la corde est
 *  plus courte que l'arc) et il chevaucherait son voisin. On pose donc ses
 *  deux attelages SUR la voie, à sa vraie longueur l'un de l'autre.
 *
 *  Sur une boucle, la recherche des sommets fait le tour (abscisse non
 *  ramenée : le résultat peut sortir de [0, L[, `pointAt` le relit). */
export function chordFrom(t: Track, s0: number, step: 1 | -1, dist: number): number {
  const p = pointAt(t, s0)
  const n = t.pts.length
  if (t.closed) {
    const L = t.cum[n - 1]!
    const w = wrapS(t, s0)
    let base = s0 - w
    // Le premier sommet strictement au-delà de s0 dans le sens `step`.
    let k = segmentAt(t, w)
    if (step > 0) {
      while (k < n - 1 && t.cum[k]! <= w) k++
    } else {
      k = k - 1
      while (k > 0 && t.cum[k]! >= w) k--
      if (t.cum[k]! >= w) {
        k = n - 2
        base -= L
      }
    }
    let aS = s0
    let a = p
    for (let guard = 0; guard < 4 * n; guard++) {
      const bS = base + t.cum[k]!
      const b = t.pts[k]!
      if (Math.hypot(b.x - p.x, b.z - p.z) >= dist) return aS + (bS - aS) * chordRoot(a, b, p, dist)
      aS = bS
      a = b
      k += step
      if (k > n - 1) {
        k = 1
        base += L
      } else if (k < 0) {
        k = n - 2
        base -= L
      }
    }
    return s0 - step * dist
  }
  // Le premier sommet de la voie strictement au-delà de s0 dans le sens
  // `step` ; hors des bornes (−1 ou n) : il n'y en a plus.
  let k: number
  if (step > 0) {
    k = 0
    while (k < n && t.cum[k]! <= s0) k++
  } else {
    k = n - 1
    while (k >= 0 && t.cum[k]! >= s0) k--
  }
  let aS = s0
  let a = p
  for (;;) {
    const atEnd = k < 0 || k > n - 1
    // Bout de voie : on prolonge le dernier segment (cf. pointAt).
    const bS = atEnd ? aS + step * dist * 2 : t.cum[k]!
    const b = atEnd ? pointAt(t, bS) : t.pts[k]!
    if (atEnd || Math.hypot(b.x - p.x, b.z - p.z) >= dist) return aS + (bS - aS) * chordRoot(a, b, p, dist)
    aS = bS
    a = b
    k += step
  }
}

/** |(a − p) + (b − a)·u| = dist : la racine de [0, 1], la plus grande (on
 *  s'éloigne de p ; a est encore à moins de `dist`, b au-delà). */
function chordRoot(a: { x: number; z: number }, b: { x: number; z: number }, p: { x: number; z: number }, dist: number): number {
  const vx = b.x - a.x
  const vz = b.z - a.z
  const wx = a.x - p.x
  const wz = a.z - p.z
  const A = vx * vx + vz * vz
  const B = 2 * (wx * vx + wz * vz)
  const C = wx * wx + wz * wz - dist * dist
  return A > 1e-12 ? (-B + Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A) : 0
}

export interface CarPose {
  kind: CarKind
  /** Longueur posée (modèle × échelle de la rame). */
  len: number
  /** Centre du véhicule, au sol. */
  x: number
  z: number
  /** Rotation Y : le +Z du modèle (son avant) regarde la tête de rame. */
  yaw: number
  /** Les deux bouts (attelages), posés sur l'axe de la voie. */
  front: { x: number; z: number }
  back: { x: number; z: number }
  sFront: number
  sBack: number
}

/** Pose la rame : la tête (le chasse-pierres de la loco) à l'abscisse `head`,
 *  tournée vers les abscisses croissantes si `dir` = 1, décroissantes sinon.
 *  Chaque véhicule suivant commence exactement où finit le précédent : les
 *  attelages se touchent par construction, en ligne droite comme en courbe.
 *  `scale` : l'échelle de la rame (TRAIN_SCALE dans le jeu). */
export function layConsist(
  t: Track,
  head: number,
  dir: 1 | -1,
  cars: readonly CarKind[],
  scale = 1,
): CarPose[] {
  const out: CarPose[] = []
  let s = head
  let front = pointAt(t, s)
  const back: 1 | -1 = dir > 0 ? -1 : 1
  for (const kind of cars) {
    const len = CAR_LENGTH[kind] * scale
    const sBack = chordFrom(t, s, back, len)
    const b = pointAt(t, sBack)
    out.push({
      kind,
      len,
      x: (front.x + b.x) / 2,
      z: (front.z + b.z) / 2,
      yaw: Math.atan2(front.x - b.x, front.z - b.z),
      front,
      back: b,
      sFront: s,
      sBack,
    })
    s = sBack
    front = b
  }
  return out
}

/** Le tracé adouci. Le plan de la voie est fait de pas de 1,6 u qui tournent
 *  jusqu'à 30° d'un coup : un rayon de courbure d'environ 3 u une fois les
 *  coins arrondis, et sur un tel rayon une loco rigide de 2,43 u a les roues
 *  du milieu à 20 cm du rail. On lisse donc la voie elle-même : rééchantillonnée
 *  finement, moyennée sur une fenêtre glissante de `window` u (`passes` fois :
 *  mesuré, la loco passe de 1,16 u d'écart au rail à 0,18 u au pire
 *  (graine 3333, âge 7), et la
 *  voie ne s'écarte du plan que de 0,6 u, sans frôler de parcelle de plus),
 *  puis redécoupée tous les `step` u. Les deux bouts ne bougent pas — la
 *  fenêtre se resserre en approchant des heurtoirs. */
export function smoothPath(
  pts: readonly { x: number; z: number }[],
  window = 6,
  passes = 2,
  step = 0.4,
): { x: number; z: number }[] {
  if (pts.length < 3) return pts.map((p) => ({ x: p.x, z: p.z }))
  const fine = resample(pts, 0.1)
  let cur = fine
  const h = Math.round(window / 2 / 0.1)
  for (let k = 0; k < passes; k++) {
    const n = cur.length
    // Sommes cumulées : une moyenne glissante en O(n).
    const sx = [0]
    const sz = [0]
    for (const p of cur) {
      sx.push(sx[sx.length - 1]! + p.x)
      sz.push(sz[sz.length - 1]! + p.z)
    }
    cur = cur.map((_, i) => {
      const w = Math.min(h, i, n - 1 - i)
      const c = 2 * w + 1
      return { x: (sx[i + w + 1]! - sx[i - w]!) / c, z: (sz[i + w + 1]! - sz[i - w]!) / c }
    })
  }
  return resample(cur, step)
}

/** La polyligne redécoupée à pas régulier (le dernier pas absorbe le reste). */
function resample(pts: readonly { x: number; z: number }[], step: number): { x: number; z: number }[] {
  const cum = [0]
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z))
  const total = cum[cum.length - 1]!
  const n = Math.max(1, Math.round(total / step))
  const t = { pts, cum }
  const out: { x: number; z: number }[] = []
  for (let i = 0; i <= n; i++) out.push(pointAt(t, (total * i) / n))
  return out
}

/** L'abscisse du point de la voie le plus proche de `p`. */
export function nearestAbscissa(t: Track, p: { x: number; z: number }): number {
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
  return best
}
