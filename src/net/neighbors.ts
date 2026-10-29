export interface Neighbor {
  id: string
  name: string
  age: number
  day: number
  techs: number
  wonders: number
  feats: number
  relics: number
  legacy: number
  seed: number
  seen: number
}

export interface Snapshot {
  id: string
  secret: string
  name: string
  age: number
  day: number
  techs: number
  wonders: number
  feats: number
  relics: number
  legacy: number
  seed: number
}

const API = '/api'
const CACHE_KEY = 'tribu.neighbors.v1'
const TIMEOUT_MS = 6000

const DEFAULT_NAMES = [
  'Les Enfants du Feu',
  'Ceux du Rivage',
  'Le Peuple du Vent',
  'Les Veilleurs',
  'La Tribu du Chêne',
  'Ceux de la Pierre',
  'Les Fils du Sel',
  'Le Clan de l’Aube',
]

export function suggestName(seed: number): string {
  return DEFAULT_NAMES[Math.abs(seed) % DEFAULT_NAMES.length]!
}

export function makeIdentity(seed: number): { id: string; secret: string; name: string } {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const secret = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  const id =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `t-${secret.slice(0, 12)}-${Date.now().toString(36)}`
  return { id, secret, name: suggestName(seed) }
}

async function call(path: string, init?: RequestInit): Promise<unknown | null> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(API + path, { ...init, signal: ctrl.signal })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function publish(snap: Snapshot): Promise<boolean> {
  const out = await call('/tribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(snap),
  })
  return !!(out as { ok?: boolean } | null)?.ok
}

export async function leave(id: string, secret: string): Promise<boolean> {
  const out = await call('/leave', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, secret }),
  })
  return !!(out as { ok?: boolean } | null)?.ok
}

export async function announceVisit(id: string, secret: string, to: string): Promise<void> {
  await call('/visit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, secret, to }),
  })
}

export interface Offer {
  id: number
  owner: string
  name: string
  age: number
  give_res: string
  give_qty: number
  want_res: string
  want_qty: number
  created: number
}

export async function postOffer(
  id: string,
  secret: string,
  giveRes: string,
  giveQty: number,
  wantRes: string,
  wantQty: number,
): Promise<{ ok: boolean; error?: string }> {
  const out = (await call('/offer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, secret, giveRes, giveQty, wantRes, wantQty }),
  })) as { ok?: boolean; error?: string } | null
  return { ok: !!out?.ok, error: out?.error }
}

export async function fetchOffers(
  id: string,
): Promise<{ mine: Offer[]; offers: Offer[] } | null> {
  const out = (await call(`/offers?id=${encodeURIComponent(id)}`)) as {
    mine?: Offer[]
    offers?: Offer[]
  } | null
  if (!out) return null
  return { mine: out.mine ?? [], offers: out.offers ?? [] }
}

export async function acceptOffer(
  id: string,
  secret: string,
  offer: number,
): Promise<{ ok: boolean; gone?: boolean; giveRes?: string; giveQty?: number; from?: string } | null> {
  return (await call('/accept', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, secret, offer }),
  })) as { ok: boolean } | null
}

export async function withdrawOffer(id: string, secret: string, offer: number): Promise<void> {
  await call('/withdraw', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, secret, offer }),
  })
}

export async function sendGift(
  id: string,
  secret: string,
  to: string,
  relic: string,
): Promise<boolean> {
  const out = await call('/gift', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, secret, to, relic }),
  })
  return !!(out as { ok?: boolean } | null)?.ok
}

export async function drainInbox(
  id: string,
  secret: string,
): Promise<{ kind: string; from?: string; relic?: string; res?: string; qty?: number }[]> {
  const out = (await call('/inbox', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, secret }),
  })) as { events?: { kind: string }[] } | null
  return Array.isArray(out?.events)
    ? (out.events as { kind: string; from?: string; relic?: string; res?: string; qty?: number }[])
    : []
}

export function publishBeacon(snap: Snapshot): void {
  try {
    const body = JSON.stringify(snap)
    if (navigator.sendBeacon) {
      navigator.sendBeacon(`${API}/tribe`, new Blob([body], { type: 'application/json' }))
      return
    }
    void fetch(`${API}/tribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch {
  }
}

export async function fetchNeighbors(selfId: string, n = 8): Promise<Neighbor[] | null> {
  const q = `/neighbors?id=${encodeURIComponent(selfId)}&n=${n}`
  const out = await call(q) as { neighbors?: Neighbor[] } | null
  if (!out || !Array.isArray(out.neighbors)) return null
  return out.neighbors.filter((t) => t && typeof t.id === 'string' && typeof t.age === 'number')
}

export function cacheNeighbors(list: Neighbor[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(list.slice(0, 12)))
  } catch {
  }
}

export function cachedNeighbors(): Neighbor[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as Neighbor[]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}
