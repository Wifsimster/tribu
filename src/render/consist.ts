export const CARGO = ['wood', 'stone', 'food', 'fiber', 'clay', 'copper', 'iron'] as const
export type Cargo = (typeof CARGO)[number]

export type CarKind = 'loco' | 'coach' | 'empty' | Cargo

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

export const TRAIN_SCALE = 1.4

export const TRAIN_AGE = 7
export const COACH_AGE = 8

export function goodsCount(age: number): number {
  return Math.min(5, Math.max(2, age - TRAIN_AGE + 2))
}

export function rankCargo(rates: Partial<Record<string, number>>): Cargo[] {
  return CARGO.filter((id) => (rates[id] ?? 0) > 0)
    .map((id, k) => ({ id, r: rates[id] ?? 0, k }))
    .sort((a, b) => b.r - a.r || a.k - b.k)
    .map((e) => e.id)
}

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

export interface Track {
  pts: readonly { x: number; z: number }[]
  cum: readonly number[]
  closed?: boolean
}

export function wrapS(t: Track, s: number): number {
  if (!t.closed) return s
  const L = t.cum[t.cum.length - 1]!
  return ((s % L) + L) % L
}

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

export function pointAt(t: Track, s: number): { x: number; z: number } {
  s = wrapS(t, s)
  const i = segmentAt(t, s)
  const a = t.pts[i - 1]!
  const b = t.pts[i]!
  const len = Math.max(1e-6, t.cum[i]! - t.cum[i - 1]!)
  const u = (s - t.cum[i - 1]!) / len
  return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u }
}

export function chordFrom(t: Track, s0: number, step: 1 | -1, dist: number): number {
  const p = pointAt(t, s0)
  const n = t.pts.length
  if (t.closed) {
    const L = t.cum[n - 1]!
    const w = wrapS(t, s0)
    let base = s0 - w
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
    const bS = atEnd ? aS + step * dist * 2 : t.cum[k]!
    const b = atEnd ? pointAt(t, bS) : t.pts[k]!
    if (atEnd || Math.hypot(b.x - p.x, b.z - p.z) >= dist) return aS + (bS - aS) * chordRoot(a, b, p, dist)
    aS = bS
    a = b
    k += step
  }
}

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
  len: number
  x: number
  z: number
  yaw: number
  front: { x: number; z: number }
  back: { x: number; z: number }
  sFront: number
  sBack: number
}

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
