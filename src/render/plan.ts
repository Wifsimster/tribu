// La levée du monde depuis la sauvegarde : l'île, puis le plan du village —
// gardé, retracé ou passé au grand tracé. Partagé par main.ts et les tests :
// la migration que vérifient les tests est celle que joue le jeu.

import type { Object3D } from 'three'
import { BASE_GROWTH, Island, RAIL_AGE, type LandPlot } from './island'
import { Village } from './village'

type Pt = { x: number; z: number }

/** Ce que la levée lit de la sauvegarde. */
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
  /** Le plan sauvegardé est-il gardé (sinon : retracé à neuf) ? */
  kept: boolean
  /** Des bâtiments ont-ils pu être délogés à ce chargement ? */
  migrate: boolean
  /** Le grand tracé (migration v3, ou la mer qui recule à l'âge 7) : il a
   *  droit à sa carte. */
  grand: boolean
  /** La version du plan à écrire dans la sauvegarde. */
  layoutV: number
}

/** L'île et le village, plan adopté. `rates` : ce que la tribu produit — la
 *  rame doit le savoir AVANT que la voie ne se pose. */
export function raiseWorld(
  save: PlanSave,
  opts: {
    electric: boolean
    yule: boolean
    rates: Partial<Record<string, number>>
    ageChanged?: boolean
    /** La Merveille montée (chantier en cours ou dernière achevée) et les
     *  reliques : pour retrouver leurs places d'avant la ceinture. */
    wonder?: { age: number; stage: number } | null
    relics?: readonly string[]
  },
): Raised {
  const island = new Island(save.seed, save.age, save.land)
  const age = save.age
  // Le plan sauvegardé d'abord : ce qui est bâti ne se redéplace pas.
  // Plan d'une version antérieure : il est retracé selon les règles du jour.
  // Un plan tracé sur une île plus grande que celle d'aujourd'hui (avant les
  // parcelles, l'île grandissait à chaque âge) est retracé une fois : un
  // bâtiment ne se pose pas dans l'eau.
  // v3 : l'île plate et la règle « deux bâtiments ne se touchent jamais ».
  // Un plan v2 pouvait coller deux toits : il est retracé une fois.
  // v4 : la ceinture ferrée. Un plan v3 est gardé tel quel ; à l'âge 7, ce
  // qui est sur le tracé de la voie est reposé ailleurs, une fois.
  const v3 = save.layoutV === 3
  const plan = v3 || save.layoutV === 4 ? save.layout : []
  const kept = plan.every((p) => island.isLand(p.x, p.z))
  // Les rues d'une partie d'avant la ceinture, passée l'âge 7 : celles de
  // l'île de base (1,45), où ses maisons ont été bâties — pas celles que
  // tracerait l'île agrandie, qui passeraient au travers.
  let streets = kept ? save.streets : null
  let wonderAt = kept ? save.wonderAt : null
  let museumAt = kept ? save.museumAt : null
  if (!streets && kept && v3 && plan.length > 0) {
    // La 3.61 ne gardait ni les rues, ni la Merveille, ni le musée : ils
    // étaient retirés à chaque chargement. On les retire une dernière fois
    // comme elle, pour les garder là où le joueur les voyait (avant l'âge 7
    // aussi : le ponton, qui oriente les rues, tient désormais compte de la
    // ceinture).
    const old = legacyPlan(save, opts.wonder ?? null, opts.relics ?? [])
    streets = old.streets
    wonderAt ??= old.wonderAt
    museumAt ??= old.museumAt
  }
  // Le centre du village suit l'époque : tipis puis maison, feu ouvert puis
  // brasero, lampadaire dès que l'électricité est sue.
  const village = new Village(island, age, opts.electric, opts.yule, {
    belt: kept ? save.belt : null,
    streets,
    wonderAt,
    museumAt,
  })
  // La rame charge les ressources que la tribu produit le plus : à donner
  // AVANT que la voie ne se pose (plan adopté ci-dessous), pour qu'elle parte
  // déjà chargée et non avec des wagons vides.
  village.setCargo(opts.rates)
  // LE GRAND TRACÉ : une fois, au premier chargement d'un plan v3 à l'âge 7
  // ou plus ; puis chaque fois que la ceinture s'éloigne du centre (la mer
  // qui recule à l'âge 7, une terre gagnée) et touche quelque chose. Jamais
  // sinon : un rechargement ne déplace rien.
  const tracing = kept && v3 && age >= RAIL_AGE
  const migrate = kept && plan.length > 0 && (tracing || village.beltGrew)
  village.adoptLayout(kept ? plan : [], migrate)
  // Le quai du marchand est repris AVANT tout ce qui se pose ensuite : la
  // Merveille, le musée et les nouveaux ateliers le contournent. Un plan
  // retracé repart sans lui.
  village.adoptGoods(kept ? save.goods : null)
  return {
    island,
    village,
    kept,
    migrate,
    grand: tracing || (migrate && !!opts.ageChanged && age === RAIL_AGE),
    // Un plan v3 d'avant l'âge 7 reste v3 : son grand tracé l'attend.
    layoutV: kept && v3 && age < RAIL_AGE ? 3 : 4,
  }
}

/** Le plan à écrire dans la sauvegarde. */
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

/** Le plan tel que le voyait la 3.61 : rues, Merveille et musée de l'île
 *  de base, avec les mêmes terres et les mêmes bâtiments. Un village de
 *  passage, construit pour être lu puis jeté — il n'est jamais montré. */
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
