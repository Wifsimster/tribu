import type { ResourceId } from './content'

export interface Expedition {
  /** Seconds of expedition work still to do, before speed multipliers. */
  remaining: number
  total: number
  /** Destination choisie — absente sur les vieilles saves (= côte lointaine). */
  dest?: string
  /** Vrai si ce voyage est l'ambassade qui fonde le comptoir. */
  embassy?: boolean
  /** Cap sur l'île d'un voisin : son identité voyage AVEC l'expédition, sinon
   *  un rechargement en cours de traversée ne saurait plus chez qui on va. */
  visit?: { id: string; name: string }
}

export interface CaravanState {
  /** Seconds until the next merchant boat shows up (only counts from Bronze Age). */
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
  /** Reliques rapportées d'expédition, exposées au musée du village. */
  relics: string[]
  /** Secondes avant le prochain événement rare du monde (live uniquement). */
  eventIn: number
  /** Hauts faits accomplis. */
  feats: string[]
  /** Comptoir établi sur l'îlot voisin, et minuterie de sa navette. */
  outpost: boolean
  outpostIn: number
  /** Chantier de Merveille en cours (âge + part déjà payée par ressource). */
  wonder: { age: number; paid: Partial<Record<ResourceId, number>> } | null
  /** Âges dont la Merveille est achevée sur CETTE île. */
  wonders: number[]
  /** Le PLAN du village : où chaque bâtiment s'est posé, une fois pour toutes.
   *  Persisté parce que les emplacements sont DÉRIVÉS de la taille de l'île —
   *  qui grandit à chaque âge. Recalculés à chaque chargement, ils faisaient
   *  sauter tout le village d'une session à l'autre. La hauteur, elle, n'est
   *  pas gardée : le terrain change, elle est relue sous chaque bâtiment. */
  layout: { id: string; x: number; z: number; rot: number }[]
  /** Version du PLAN. Quand les règles d'urbanisme changent (v2 : les rues),
   *  un plan tracé selon les anciennes ne peut pas être conservé — le village
   *  serait un semis au milieu d'un réseau de rues. Il est retracé une fois. */
  layoutV: number
  /** Le nom du village. Indépendant de l'identité de voisinage : nommer son
   *  village ne doit pas publier la tribu sur le serveur (paraître est
   *  opt-in, regarder ne l'est pas). Quand la tribu EST publiée, les deux
   *  noms sont tenus égaux. */
  village: string
  /** La Chronique : chaque ligne de l'histoire de CETTE tribu — monde (w),
   *  jour (d), genre (k) et texte (x). Survit aux Exodes. */
  chronicle: { w: number; d: number; k: string; x: string }[]
  /** Nombre d'Exodes accomplis : la constellation de la tribu. */
  legacy: number
  /** Identité publique dans le voisinage — absente tant que le joueur n'a pas
   *  choisi d'y paraître. Elle vit DANS la sauvegarde : elle voyage donc avec
   *  le code de transfert, et une tribu restaurée ailleurs reste la même aux
   *  yeux des autres. Le secret n'est jamais montré. */
  tribe: { id: string; secret: string; name: string } | null
}

export const SAVE_KEY = 'tribu.save.v1'

/** Offline progress is credited, but capped so the game cannot be beaten by
 *  closing the tab for a month. */
export const OFFLINE_CAP_SECONDS = 8 * 3600

export function emptySave(now: number): SaveV1 {
  return {
    v: 1,
    t: now,
    // Chaque joueur reçoit sa propre île : le seed est tiré une fois et persiste
    // avec la sauvegarde, donc l'île est unique mais stable d'une session à l'autre.
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
    eventIn: 420,
    chronicle: [],
    feats: [],
    outpost: false,
    outpostIn: 240,
    wonder: null,
    wonders: [],
    layout: [],
    layoutV: 2,
    village: '',
    legacy: 0,
    tribe: null,
  }
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Une identité de voisinage n'est utilisable que si ses trois champs sont du
 *  texte : sinon elle vaut mieux absente qu'illisible pour les autres. */
function cleanTribe(t: SaveV1['tribe']): SaveV1['tribe'] {
  if (!t || typeof t.id !== 'string' || typeof t.secret !== 'string') return null
  return { id: t.id, secret: t.secret, name: text(t.name).trim().slice(0, 24) || 'Tribu sans nom' }
}

export function loadSave(now: number): { save: SaveV1; offlineSeconds: number } {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(SAVE_KEY)
  } catch {
    // Private browsing or blocked storage: play in memory, never crash.
    return { save: emptySave(now), offlineSeconds: 0 }
  }
  if (!raw) return { save: emptySave(now), offlineSeconds: 0 }

  try {
    const parsed = JSON.parse(raw) as SaveV1
    if (parsed.v !== 1) return { save: emptySave(now), offlineSeconds: 0 }
    const elapsed = Math.max(0, Math.min((now - parsed.t) / 1000, OFFLINE_CAP_SECONDS))
    const base = emptySave(now)
    const save = {
      // `layoutV` doit venir de la sauvegarde LUE, pas du gabarit : une save
      // d'avant les rues n'a pas la clé, et le spread lui aurait prêté la
      // version du jour — son vieux plan aurait été adopté tel quel.
      ...base,
      ...parsed,
      layoutV: parsed.layoutV ?? 0,
      res: { ...base.res, ...parsed.res },
    }
    // Les NOMS relus d'une sauvegarde doivent être du texte. Une save bricolée
    // (ou un transfert modifié) portant un objet ici se publiait telle quelle
    // dans le voisinage, où tout le monde lisait « [object Object] ».
    save.village = text(save.village)
    save.tribe = cleanTribe(save.tribe)
    return { save, offlineSeconds: elapsed }
  } catch {
    return { save: emptySave(now), offlineSeconds: 0 }
  }
}

export function writeSave(save: SaveV1, now: number): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ ...save, t: now }))
  } catch {
    // Storage full or unavailable — losing a save is better than losing the frame.
  }
}
