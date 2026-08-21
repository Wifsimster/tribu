/** Le voisinage : les silhouettes de l'horizon sont d'autres joueurs.
 *
 *  Règle absolue de ce module : le réseau est un ORNEMENT. Toute erreur est
 *  avalée en silence, tout appel a un délai de garde, et le jeu doit se jouer
 *  exactement pareil serveur éteint, avion activé, ou API inconnue. Rien ici
 *  ne doit jamais faire échouer une frame.
 *
 *  Ce qui sort d'ici : un pseudo et une poignée de compteurs. Jamais la
 *  sauvegarde, jamais l'île, jamais la Chronique. Et rien ne part tant que le
 *  joueur n'a pas rejoint le voisinage de lui-même. */

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
  /** Horodatage serveur du dernier signe de vie. */
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

/** Noms proposés au premier voisinage — le joueur peut en mettre un autre. */
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

/** Identité tirée une fois pour toutes, côté client : ni compte, ni mot de
 *  passe, ni adresse — un identifiant et un secret qui ne quittent la
 *  sauvegarde que pour prouver « c'est bien moi » au moment de publier. */
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
  // Hors ligne : inutile de réveiller la pile réseau pour rien.
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

/** Publie l'instantané public. Renvoie false si le serveur refuse (identité
 *  déjà prise par un autre appareil) ou s'il est injoignable. */
export async function publish(snap: Snapshot): Promise<boolean> {
  const out = await call('/tribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(snap),
  })
  return !!(out as { ok?: boolean } | null)?.ok
}

/** Quitter le voisinage : le serveur efface la ligne pour de bon. */
export async function leave(id: string, secret: string): Promise<boolean> {
  const out = await call('/leave', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, secret }),
  })
  return !!(out as { ok?: boolean } | null)?.ok
}

/** Prévenir un voisin qu'on a accosté chez lui. Le texte du message est écrit
 *  par le SERVEUR : un client ne doit pas pouvoir dicter ce qui s'inscrira
 *  dans la Chronique de quelqu'un d'autre. */
export async function announceVisit(id: string, secret: string, to: string): Promise<void> {
  await call('/visit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, secret, to }),
  })
}

/** Offrir une relique à une autre tribu. */
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

/** Relève du courrier : lit ET vide la boîte côté serveur. */
export async function drainInbox(
  id: string,
  secret: string,
): Promise<{ kind: string; from?: string; relic?: string }[]> {
  const out = (await call('/inbox', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, secret }),
  })) as { events?: { kind: string }[] } | null
  return Array.isArray(out?.events) ? (out.events as { kind: string; from?: string }[]) : []
}

/** Publication de dernière seconde, au moment où l'onglet part : `keepalive`
 *  laisse la requête vivre après la page. Aucune réponse n'est attendue. */
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
    /* le voisinage n'est jamais une urgence */
  }
}

/** Lit le voisinage. Se consulte SANS avoir rejoint : on peut regarder
 *  l'horizon sans y paraître soi-même. */
export async function fetchNeighbors(selfId: string, n = 8): Promise<Neighbor[] | null> {
  const q = `/neighbors?id=${encodeURIComponent(selfId)}&n=${n}`
  const out = await call(q) as { neighbors?: Neighbor[] } | null
  if (!out || !Array.isArray(out.neighbors)) return null
  return out.neighbors.filter((t) => t && typeof t.id === 'string' && typeof t.age === 'number')
}

/** Le dernier voisinage connu est gardé sur l'appareil : au prochain
 *  lancement, l'horizon est peuplé AVANT même la première réponse — et le
 *  reste entièrement hors ligne. */
export function cacheNeighbors(list: Neighbor[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(list.slice(0, 12)))
  } catch {
    /* stockage plein : l'horizon sera juste vide au prochain lancement */
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
