import type { Object3D } from 'three'
import { BASE_GROWTH, Island, RAIL_AGE, type LandPlot } from './island'
import { Village } from './village'

type Pt = { x: number; z: number }

export interface PlanSave {
  seed: number
  age: number
  land: readonly LandPlot[]
  layout: { id: string; x: number; z: number; rot: number }[]
  layoutV: number
  goods: Pt | null
  belt: number[] | null
  streets: Pt[][] | null
  wonderAt: Pt | null
  museumAt: Pt | null
}

export interface Raised {
  island: Island
  village: Village
  kept: boolean
  migrate: boolean
  grand: boolean
  layoutV: number
}

export function raiseWorld(
  save: PlanSave,
  opts: {
    electric: boolean
    yule: boolean
    rates: Partial<Record<string, number>>
    ageChanged?: boolean
    wonder?: { age: number; stage: number } | null
    relics?: readonly string[]
  },
): Raised {
  const island = new Island(save.seed, save.age, save.land)
  const age = save.age
  const v3 = save.layoutV === 3
  const plan = v3 || save.layoutV === 4 ? save.layout : []
  const kept = plan.every((p) => island.isLand(p.x, p.z))
  let streets = kept ? save.streets : null
  let wonderAt = kept ? save.wonderAt : null
  let museumAt = kept ? save.museumAt : null
  if (!streets && kept && v3 && plan.length > 0) {
    const old = legacyPlan(save, opts.wonder ?? null, opts.relics ?? [])
    streets = old.streets
    wonderAt ??= old.wonderAt
    museumAt ??= old.museumAt
  }
  const village = new Village(island, age, opts.electric, opts.yule, {
    belt: kept ? save.belt : null,
    streets,
    wonderAt,
    museumAt,
  })
  village.setCargo(opts.rates)
  const tracing = kept && v3 && age >= RAIL_AGE
  const migrate = kept && plan.length > 0 && (tracing || village.beltGrew)
  village.adoptLayout(kept ? plan : [], migrate)
  village.adoptGoods(kept ? save.goods : null)
  return {
    island,
    village,
    kept,
    migrate,
    grand: tracing || (migrate && !!opts.ageChanged && age === RAIL_AGE),
    layoutV: kept && v3 && age < RAIL_AGE ? 3 : 4,
  }
}

export function planOf(village: Village): {
  layout: { id: string; x: number; z: number; rot: number }[]
  belt: number[]
  streets: Pt[][]
  wonderAt: Pt | null
  museumAt: Pt | null
} {
  return {
    layout: village.layout,
    belt: village.belt,
    streets: village.streets,
    wonderAt: village.wonderSpot,
    museumAt: village.museumSpot,
  }
}

function legacyPlan(
  save: PlanSave,
  wonder: { age: number; stage: number } | null,
  relics: readonly string[],
): { streets: Pt[][]; wonderAt: Pt | null; museumAt: Pt | null } {
  const old = new Island(save.seed, save.age, save.land, BASE_GROWTH)
  const v = new Village(old, save.age, false, false, { legacy: true })
  v.adoptLayout(save.layout)
  v.adoptGoods(save.goods)
  if (wonder) v.setWonder(wonder.age, wonder.stage)
  if (relics.length > 0) v.setRelics(relics)
  const out = { streets: v.streets, wonderAt: v.wonderSpot, museumAt: v.museumSpot }
  for (const g of [old.group, v.group]) dispose(g)
  return out
}

function dispose(root: Object3D): void {
  root.traverse((o) => {
    const m = o as { geometry?: { dispose(): void }; material?: unknown }
    m.geometry?.dispose()
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : []
    for (const mat of mats) (mat as { dispose(): void }).dispose()
  })
}
