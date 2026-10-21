import { LAND_BY_ID, type ResourceId } from './content'

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
  /** Outils achetés au marchand. Contrairement aux reliques, ils ne montent
   *  pas dans la cale de l'Exode : la tribu emporte sa mémoire, pas son
   *  outillage — il reste sur l'île avec le village qu'il a servi. */
  tools: string[]
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
   *  sauter tout le village d'une session à l'autre. La hauteur n'est pas
   *  gardée : l'île n'a qu'un niveau (GROUND_Y), tout s'y pose. */
  layout: { id: string; x: number; z: number; rot: number }[]
  /** Version du PLAN. Quand les règles d'urbanisme changent (v2 : les rues),
   *  un plan tracé selon les anciennes ne peut pas être conservé — le village
   *  serait un semis au milieu d'un réseau de rues. Il est retracé une fois.
   *  v4 : la ceinture ferrée. Un plan v3 est GARDÉ ; à l'âge 7, seuls les
   *  bâtiments sur le tracé de la voie sont reposés ailleurs (« Le grand
   *  tracé »), une fois. */
  layoutV: number
  /** La CEINTURE (sentier côtier, chemin, puis voie ferrée en boucle) : 72
   *  rayons depuis le centre de l'île, tous les 5°. Persistée parce qu'elle
   *  dépend de l'ordre des terres gagnées : elle ne fait que s'éloigner du
   *  centre, et n'est jamais retracée au chargement. */
  belt: number[] | null
  /** Les RUES du village, telles que tracées la première fois : la forêt et
   *  le ponton qui guidaient leur tracé changent quand la mer recule à
   *  l'âge 7 ; les rues, elles, restent sous les maisons qui les bordent. */
  streets: { x: number; z: number }[][] | null
  /** Places de la Merveille et du musée, réservées une fois pour toutes. */
  wonderAt: { x: number; z: number } | null
  museumAt: { x: number; z: number } | null
  /** Le quai du marchand, où attendent les outils achetés (l'étain excepté,
   *  posé au camp). Choisi une fois, à la première marchandise, et gardé :
   *  comme le plan, il dépend de l'île et ne doit plus bouger. */
  goods: { x: number; z: number } | null
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
  /** Les terres gagnées sur la mer : type et cellule centrale (axiale) de la
   *  parcelle de sept hexagones. Elles appartiennent à l'île, comme les
   *  outils : l'Exode les laisse derrière lui. */
  land: { kind: string; q: number; r: number }[]
  /** Les jalons franchis dont la carte attend le choix du joueur, du plus
   *  ancien au plus récent : numéro du jalon et les trois terres tirées. Rien
   *  ne se pose tout seul — une carte en attente ne rapporte rien. */
  landPending: { n: number; kinds: string[] }[]
  /** Nombre de jalons déjà distribués (posés ou en file). Absent d'une
   *  sauvegarde d'avant les parcelles : il vaut alors 0, et tous les jalons
   *  déjà franchis arrivent en file au chargement. */
  landN: number
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
  }
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Une identité de voisinage n'est utilisable que si ses trois champs sont du
 *  texte : sinon elle vaut mieux absente qu'illisible pour les autres. */
function cleanTribe(t: SaveV1['tribe']): SaveV1['tribe'] {
  if (!t || typeof t.id !== 'string' || typeof t.secret !== 'string') return null
  return { id: t.id, secret: t.secret, name: text(t.name).trim().slice(0, 24) || 'Tribu sans nom' }
}

const coord = (v: unknown): v is number => Number.isInteger(v) && Math.abs(v as number) <= 60

const finite = (v: unknown, max = 200): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max

/** Un point du plan relu : deux nombres finis, ou rien. */
function cleanPoint(v: unknown): { x: number; z: number } | null {
  const p = v as { x?: unknown; z?: unknown } | null | undefined
  return p && finite(p.x) && finite(p.z) ? { x: p.x, z: p.z } : null
}

/** La ceinture relue : exactement 72 rayons finis et positifs, ou rien (elle
 *  sera alors tracée à neuf). */
function cleanBelt(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length !== 72) return null
  return v.every((r) => finite(r, 80) && r > 1) ? (v as number[]).slice() : null
}

/** Les rues relues : au plus trois polylignes d'au plus 64 points. */
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
    // Les listes d'identifiants sont relues comme du TEXTE, jamais telles
    // quelles : `recompute` parcourt les outils à chaque changement, et une
    // sauvegarde bricolée ne doit pas pouvoir y glisser autre chose.
    save.tools = Array.isArray(save.tools) ? save.tools.filter((t) => typeof t === 'string') : []
    // Les terres passent par `recompute` comme les outils : type connu,
    // coordonnées entières et bornées, sinon la parcelle est ignorée.
    save.land = cleanLand(save.land)
    save.landPending = cleanPending(save.landPending)
    // Le quai relu est deux nombres finis, ou rien : il sera alors retiré.
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
