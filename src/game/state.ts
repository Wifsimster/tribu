import { LAND_BY_ID, type ResourceId } from './content'

export interface Expedition {
  remaining: number
  total: number
  dest?: string
  embassy?: boolean
  visit?: { id: string; name: string }
}

export interface CaravanState {
  nextIn: number
  visiting: boolean
  visitLeft: number
  haggled: boolean
  traded: boolean
}

export interface SaveV1 {
  v: 1
  t: number
  seed: number
  res: Partial<Record<ResourceId, number>>
  techs: string[]
  age: number
  focus: ResourceId
  expedition: Expedition | null
  caravan: CaravanState
  seenFacts: string[]
  totalPlaySeconds: number
  relics: string[]
  tools: string[]
  eventIn: number
  feats: string[]
  outpost: boolean
  outpostIn: number
  wonder: { age: number; paid: Partial<Record<ResourceId, number>> } | null
  wonders: number[]
  layout: { id: string; x: number; z: number; rot: number }[]
  layoutV: number
  belt: number[] | null
  streets: { x: number; z: number }[][] | null
  wonderAt: { x: number; z: number } | null
  museumAt: { x: number; z: number } | null
  goods: { x: number; z: number } | null
  village: string
  chronicle: { w: number; d: number; k: string; x: string }[]
  legacy: number
  tribe: { id: string; secret: string; name: string } | null
  land: { kind: string; q: number; r: number }[]
  landPending: { n: number; kinds: string[] }[]
  landN: number
  insightReserve: number
}

export const SAVE_KEY = 'tribu.save.v1'

export const OFFLINE_CAP_SECONDS = 8 * 3600
export const OFFLINE_INSIGHT_TAU = 600
export const INSIGHT_RESERVE_HOURS = 2

export function emptySave(now: number): SaveV1 {
  return {
    v: 1,
    t: now,
    seed: Math.floor(Math.random() * 0x7fffffff),
    res: { food: 0, wood: 0, stone: 0, insight: 0 },
    techs: [],
    age: 0,
    focus: 'food',
    expedition: null,
    caravan: { nextIn: 150, visiting: false, visitLeft: 0, haggled: false, traded: false },
    seenFacts: [],
    totalPlaySeconds: 0,
    relics: [],
    tools: [],
    eventIn: 420,
    chronicle: [],
    feats: [],
    outpost: false,
    outpostIn: 240,
    wonder: null,
    wonders: [],
    layout: [],
    layoutV: 4,
    goods: null,
    belt: null,
    streets: null,
    wonderAt: null,
    museumAt: null,
    village: '',
    legacy: 0,
    tribe: null,
    land: [],
    landPending: [],
    landN: 0,
    insightReserve: 0,
  }
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

function cleanTribe(t: SaveV1['tribe']): SaveV1['tribe'] {
  if (!t || typeof t.id !== 'string' || typeof t.secret !== 'string') return null
  return { id: t.id, secret: t.secret, name: text(t.name).trim().slice(0, 24) || 'Tribu sans nom' }
}

const coord = (v: unknown): v is number => Number.isInteger(v) && Math.abs(v as number) <= 60

const finite = (v: unknown, max = 200): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max

function cleanPoint(v: unknown): { x: number; z: number } | null {
  const p = v as { x?: unknown; z?: unknown } | null | undefined
  return p && finite(p.x) && finite(p.z) ? { x: p.x, z: p.z } : null
}

function cleanBelt(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length !== 72) return null
  return v.every((r) => finite(r, 80) && r > 1) ? (v as number[]).slice() : null
}

function cleanStreets(v: unknown): { x: number; z: number }[][] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > 3) return null
  const out: { x: number; z: number }[][] = []
  for (const lane of v) {
    if (!Array.isArray(lane) || lane.length > 64) return null
    const pts = lane.map(cleanPoint)
    if (pts.some((p) => !p)) return null
    out.push(pts as { x: number; z: number }[])
  }
  return out
}

function cleanLand(v: unknown): SaveV1['land'] {
  if (!Array.isArray(v)) return []
  const out: SaveV1['land'] = []
  for (const e of v as Partial<SaveV1['land'][number]>[]) {
    if (!e || typeof e.kind !== 'string' || !LAND_BY_ID.has(e.kind)) continue
    if (!coord(e.q) || !coord(e.r)) continue
    out.push({ kind: e.kind, q: e.q, r: e.r })
  }
  return out
}

function cleanPending(v: unknown): SaveV1['landPending'] {
  if (!Array.isArray(v)) return []
  const out: SaveV1['landPending'] = []
  for (const e of v as Partial<SaveV1['landPending'][number]>[]) {
    if (!e || !Number.isInteger(e.n) || !Array.isArray(e.kinds)) continue
    const kinds = e.kinds.filter((k): k is string => typeof k === 'string' && LAND_BY_ID.has(k))
    if (kinds.length === 0) continue
    out.push({ n: e.n as number, kinds })
  }
  return out
}

export function loadSave(now: number): { save: SaveV1; offlineSeconds: number; migrateReserve?: boolean } {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(SAVE_KEY)
  } catch {
    return { save: emptySave(now), offlineSeconds: 0 }
  }
  if (!raw) return { save: emptySave(now), offlineSeconds: 0 }

  try {
    const parsed = JSON.parse(raw) as SaveV1
    if (parsed.v !== 1) return { save: emptySave(now), offlineSeconds: 0 }
    const elapsed = Math.max(0, Math.min((now - parsed.t) / 1000, OFFLINE_CAP_SECONDS))
    const base = emptySave(now)
    const save = {
      ...base,
      ...parsed,
      layoutV: parsed.layoutV ?? 0,
      res: { ...base.res, ...parsed.res },
    }
    save.village = text(save.village)
    save.tribe = cleanTribe(save.tribe)
    save.tools = Array.isArray(save.tools) ? save.tools.filter((t) => typeof t === 'string') : []
    save.land = cleanLand(save.land)
    save.landPending = cleanPending(save.landPending)
    const g = save.goods as { x?: unknown; z?: unknown } | null | undefined
    save.goods =
      g && typeof g.x === 'number' && typeof g.z === 'number' && Number.isFinite(g.x) && Number.isFinite(g.z)
        ? { x: g.x, z: g.z }
        : null
    save.landN = Number.isInteger(save.landN) && save.landN >= 0 && save.landN <= 999 ? save.landN : 0
    save.belt = cleanBelt(save.belt)
    save.streets = cleanStreets(save.streets)
    save.wonderAt = cleanPoint(save.wonderAt)
    save.museumAt = cleanPoint(save.museumAt)
    const reserve = (parsed as Partial<SaveV1>).insightReserve
    save.insightReserve = typeof reserve === 'number' && Number.isFinite(reserve) && reserve > 0 ? reserve : 0
    return { save, offlineSeconds: elapsed, migrateReserve: reserve === undefined }
  } catch {
    return { save: emptySave(now), offlineSeconds: 0 }
  }
}

export function writeSave(save: SaveV1, now: number): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ ...save, t: now }))
  } catch {
  }
}
