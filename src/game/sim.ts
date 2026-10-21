import {
  AGES,
  DAY_SECONDS,
  DESTINATION_BY_ID,
  DESTINATIONS,
  VISIT_DEST,
  SEASON_DAYS,
  SEASONS,
  FEATS,
  HALF_TECHS,
  LAND_BY_ID,
  LANDS,
  type LandDef,
  WONDER_BY_AGE,
  type WonderDef,
  RELIC_BY_ID,
  RELICS,
  RESOURCES,
  TECHS,
  TECH_BY_ID,
  TOOLS,
  TOOL_BY_ID,
  type AgeDef,
  type DestinationDef,
  type Effect,
  type RelicDef,
  type ResourceId,
  type TechDef,
  type ToolDef,
} from './content'
import { cycleMean, dayPhaseAt, isNightHour } from './clock'
import {
  INSIGHT_RESERVE_HOURS,
  OFFLINE_CAP_SECONDS,
  OFFLINE_INSIGHT_TAU,
  emptySave,
  loadSave,
  writeSave,
  type SaveV1,
} from './state'

export type GameEvent =
  | { type: 'tech'; tech: TechDef }
  | { type: 'age'; age: AgeDef }
  | { type: 'expeditionStart' }
  | { type: 'exodus'; legacy: number }
  | { type: 'season'; id: number; name: string; fact: string }
  | { type: 'wonderStage'; def: WonderDef; stage: number }
  | { type: 'wonderDone'; def: WonderDef }
  | { type: 'outpostFounded' }
  | { type: 'feat'; id: string; name: string }
  | { type: 'outpostTribute'; loot: Partial<Record<ResourceId, number>> }
  | {
      type: 'worldEvent'
      kind: 'wreck' | 'migration' | 'eclipse' | 'aurora' | 'merchant'
      fact: string
      loot?: { wood: number; insight: number }
    }
  | {
      type: 'expeditionEnd'
      loot: Partial<Record<ResourceId, number>>
      find: string | null
      journal: string
      relic: RelicDef | null
      setback: boolean
    }
  | { type: 'encourage' }
  /** Le colon a débarqué chez un voisin : main.ts le fera savoir au serveur,
   *  qui glissera le mot dans SA boîte aux lettres. */
  | { type: 'visitDone'; neighborId: string; name: string }
  /** Une nouvelle venue d'une autre tribu, appliquée au retour du joueur. */
  | { type: 'mail'; text: string; relic: RelicDef | null }
  /** `reserve` : le savoir de l'absence mis en réserve, en plus de `gained`. */
  | { type: 'offline'; seconds: number; gained: Partial<Record<ResourceId, number>>; reserve: number }
  /** Une partie d'avant la réserve de savoir : son stock au-delà du prochain
   *  savoir est passé en réserve, une fois, sans rien retirer. */
  | { type: 'reserveMigrated'; kept: number; reserve: number }
  | { type: 'caravanArrive'; merchant: string }
  | {
      type: 'caravanTrade'
      gave: { res: ResourceId; amount: number }
      got: { res: ResourceId; amount: number }
      insight: number
      tale: string | null
    }
  /** Le marchand ouvre sa cale et tend un objet : au joueur de dire oui. */
  | { type: 'caravanOffer'; def: ToolDef }
  /** L'offre n'a pas eu de réponse avant le départ de la barque. */
  | { type: 'caravanOfferGone' }
  /** Le joueur a accepté : l'objet change de mains. */
  | { type: 'caravanTool'; def: ToolDef; paid: Partial<Record<ResourceId, number>> }
  | { type: 'caravanLeave' }
  /** La mer recule : `count` nouvelles cartes en file. `catchUp` signale le
   *  rattrapage d'une sauvegarde au chargement, pas un jalon vécu en direct. */
  | { type: 'landOffer'; count: number; catchUp: boolean }
  | { type: 'landPlaced'; def: LandDef }
  | { type: 'nightfall'; floor: number }
  | { type: 'daybreak' }

type Listener = (e: GameEvent) => void

/** Base yield per second when the settler is focused on that resource. */
const BASE_RATE: Record<ResourceId, number> = {
  food: 0.5,
  wood: 0.36,
  stone: 0.24,
  fiber: 0.18,
  clay: 0.14,
  copper: 0.09,
  iron: 0.06,
  insight: 0,
}

/** Resources the settler still works while focused elsewhere, at this fraction. */
const IDLE_FRACTION = 0.3

/** Savoir tiré de chaque unité de matériau récoltée par seconde. 0,05 jusqu'à
 *  la 3.71, quand encourager, la lumière et le legs comptaient deux fois sur
 *  cette part ; 0,07 depuis la 3.71.1, qui ne les compte qu'une fois, pour
 *  garder le rythme actif de la 3.71 (tools/sim-savoirs.mjs --until=10,
 *  outils du marchand acceptés : chaque âge entre −4 % et 0 %, l'âge 10 à
 *  377 min contre 392). */
const INSIGHT_PER_MATERIAL = 0.07

const ENCOURAGE_SECONDS = 15
const ENCOURAGE_MULT = 2
const ENCOURAGE_COOLDOWN = 45

const EXPEDITION_SECONDS = 90
const EXPEDITION_FOOD_COST = 10
/** Savoir rapporté = taux moyen du camp × durée × ce coefficient × lootK/durationK
 *  de la destination. Calé pour que la côte (lootK/durationK = 1,12) rende
 *  1,3 fois le savoir du camp, le rapport des âges 1 et 2 jusqu'à la 3.71. */
const COAST = DESTINATION_BY_ID.get('cote')!
const EXPEDITION_INSIGHT_K = 1.3 / (COAST.lootK / COAST.durationK)

/** Les récompenses fixes (épave, tribut du comptoir, savoir du troc) suivent
 *  la production à partir de cet âge, l'Antiquité... */
const INDEXED_FROM_AGE = 3
/** ... et valent au moins ces secondes de production moyenne : ce que valait
 *  le barème fixe à la fin de l'âge du bronze, tous ses savoirs connus. Pas
 *  de saut à l'entrée de l'Antiquité, où le barème reste encore au-dessus. */
const WRECK_SECONDS = { wood: 45, insight: 14 }
const OUTPOST_SECONDS = { food: 6, wood: 11, insight: 9 }
const TRADE_INSIGHT_SECONDS = 13

// Le commerce ouvre avec l'âge du bronze : le fait historique de la techno
// « bronze » explique déjà pourquoi (cuivre et étain ne gisent jamais ensemble).
const CARAVAN_AGE = 2
const CARAVAN_PERIOD = 210
const CARAVAN_VISIT = 26
const CARAVAN_OFFLINE_MAX = 3
/** La vitesse en mer d'une tribu qui entre dans chaque âge avec tous les
 *  savoirs et outils de vitesse des âges d'avant : l'étalon des durées. */
const SPEED_BY_AGE: number[] = AGES.map((a) =>
  [...TECHS, ...TOOLS]
    .filter((t) => t.age < a.id)
    .flatMap((t) => t.effects)
    .reduce((m, e) => (e.kind === 'expeditionSpeed' ? m * e.mult : m), 1),
)

/** Le temps que la barque reste à quai quand le marchand tend un outil. */
const TOOL_OFFER_WAIT = 40

const MERCHANTS = ['de Chypre', "d'Anatolie", 'du Levant', 'des Cyclades', "d'Égypte"]

/** Sans aucune lumière, la nuit ne laisse que 30 % du rendement. Le feu puis la
 *  lampe à graisse relèvent ce plancher via l'effet `nightFloor`. */
const NIGHT_BASE_FLOOR = 0.3

function smoothstep01(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Hauteur du soleil, de −1 à 1. C'est ELLE qui dit l'heure de la nuit : la
 *  part de jour, elle, reste plate à zéro d'un bout à l'autre et ne permet pas
 *  de distinguer le crépuscule du cœur de nuit. */
export function sunHeightAt(totalPlaySeconds: number): number {
  return Math.sin(dayPhaseAt(totalPlaySeconds) * Math.PI * 2)
}

function daylightOfHour(u: number): number {
  return smoothstep01(-0.06, 0.2, Math.sin(u * Math.PI * 2))
}

/** Part de jour, même formule que le rendu : les deux doivent tomber d'accord
 *  sur l'heure qu'il est. */
export function daylightAt(totalPlaySeconds: number): number {
  return daylightOfHour(dayPhaseAt(totalPlaySeconds))
}

/** Part de jour moyenne d'un tour, dans le temps : le jour couvre deux tiers
 *  du tour (voir clock.ts). */
const DAYLIGHT_MEAN = cycleMean(daylightOfHour)
/** La même sur un tour où jour et nuit durent autant — l'horloge d'avant la
 *  3.70. C'est la référence du rendement : la nuit raccourcie est un confort
 *  de jeu, pas un bonus de production. */
const DAYLIGHT_MEAN_EVEN =
  Array.from({ length: 720 }, (_, i) => daylightOfHour((i + 0.5) / 720)).reduce((a, b) => a + b) / 720

/** Rendement moyen d'un tour pour un plancher de nuit donné : la courbe
 *  instantanée est mise à l'échelle pour que ce rendement reste celui d'un
 *  tour à parts égales. Plancher 1 : échelle 1, rien ne change. */
export function lightScaleFor(floor: number): number {
  return (floor + (1 - floor) * DAYLIGHT_MEAN_EVEN) / (floor + (1 - floor) * DAYLIGHT_MEAN)
}

/** Facteur de lumière instantané : de `floor` la nuit à 1 en plein jour, le
 *  tout à l'échelle de lightScaleFor (la nuit garde `floor` du plein jour). */
export function lightFactorFor(floor: number, daylight: number): number {
  return lightScaleFor(floor) * (floor + (1 - floor) * daylight)
}

/** Facteur moyen d'un tour complet, calculé sur la courbe instantanée — c'est
 *  celui de la production hors ligne. */
export function meanLightFactor(floor: number): number {
  return cycleMean((u) => lightFactorFor(floor, daylightOfHour(u)))
}

/** Sans lumière, on se couche au coucher du soleil — quand la lune prend la
 *  place du soleil sur le cadran du HUD. Toute la lumière du monde ne repousse le coucher que jusqu'à
 *  SLEEP_DEEP : le cœur de la nuit appartient au sommeil à toutes les époques,
 *  et l'île doit être vue endormie. Le feu grignote l'aube, le lampadaire
 *  grignote beaucoup plus — mais aucun savoir ne supprime la nuit. */
const SLEEP_DUSK = 0
const SLEEP_DEEP = -0.75

/** Le marchand paie en histoires autant qu'en métal : chaque anecdote est un
 *  fait de commerce ancien réel. */
const TRADE_TALES = [
  "l'épave d'Uluburun, coulée vers −1300, portait dix tonnes de cuivre chypriote et une tonne d'étain",
  "l'étain des Cornouailles voyageait jusqu'à la Méditerranée orientale, de comptoir en comptoir",
  "le lapis-lazuli des mines d'Afghanistan ornait déjà les tombes égyptiennes vers −3000",
  'à Kanesh, en Anatolie, les marchands assyriens tenaient leurs comptes et leurs prêts à intérêt sur tablettes, vers −1900',
  "de l'ambre de la Baltique a été retrouvé dans la tombe de Toutânkhamon",
]

/** Ce que le colon raconte au retour, par tempérament de destination. */
const SIGHTS: Record<string, string[]> = {
  ilot: [
    'des phoques endormis sur les rochers, indifférents à la barque',
    'une colonie de sternes qui criait sur la falaise',
    "des flaques de marée pleines d'étoiles de mer",
    "un vieux foyer éteint — d'autres sont passés ici avant nous",
  ],
  cote: [
    'une plage noire où fumait une source chaude',
    'des empreintes énormes dans la vase, remontant vers les terres',
    'une forêt qui descendait boire à la mer',
    'des feux au loin, sur les collines — nous ne sommes pas seuls',
  ],
  large: [
    "un banc de dauphins qui a suivi l'étrave une matinée entière",
    "une île qui n'était qu'un brouillard, et qui a disparu au soir",
    'la haute mer si calme que le ciel entier tenait dedans',
    "une baleine, plus longue que dix barques, qui a soufflé tout près",
  ],
}

const SETBACKS = [
  'une bourrasque a couché le mât — une partie du butin est passée par-dessus bord',
  'un récif a raclé la coque : il a fallu alléger pour rentrer',
  "le brouillard a coûté deux jours et une partie des vivres",
]

/** Les événements rares : chacun paie en spectacle ET en histoire vraie. */
const EVENT_FACTS = {
  wreck: "Le bois d'épave était si précieux que le « droit de bris » médiéval réglait qui pouvait ramasser les épaves — souvent le seigneur du rivage, parfois les moines du coin.",
  migration: 'Les chasseurs du Paléolithique suivaient les migrations saisonnières des rennes : à Pincevent, les campements entiers se déplaçaient avec les troupeaux, saison après saison.',
  eclipse: "Thalès de Milet aurait prédit l'éclipse du 28 mai −585, qui interrompit net une bataille entre Lydiens et Mèdes — les deux armées y virent un signe et firent la paix.",
  aurora: "L'aurore de 1859 (l'événement de Carrington) fut si intense que des télégraphes fonctionnèrent débranchés, alimentés par le courant induit dans leurs propres lignes.",
  merchant: "Sur les routes de la soie, un ballot changeait dix fois de mains sans qu'aucun marchand ne fasse le trajet entier : le commerce antique était un relais, pas une traversée.",
} as const

const FINDS = [
  'un galet gravé de traits parallèles',
  'une dent de grand fauve percée',
  'un bloc d’ocre rouge usé par le frottement',
  'une coquille venue d’une mer lointaine',
  'un os d’oiseau creusé de quatre trous',
  'une empreinte de main soufflée sur la roche',
]

/** Le musée d'un voisin, déduit de son identité : le serveur ne transporte que
 *  le NOMBRE de reliques, et cette liste doit être la même pour tout le monde
 *  — donc tirée du seul identifiant, sans hasard. */
export function museumOf(id: string, count: number): RelicDef[] {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0
  const pool = [...RELICS]
  // Mélange de Fisher-Yates piloté par un PRNG semé sur l'identifiant.
  for (let i = pool.length - 1; i > 0; i--) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0
    const j = h % (i + 1)
    ;[pool[i], pool[j]] = [pool[j]!, pool[i]!]
  }
  return pool.slice(0, Math.max(0, Math.min(RELICS.length, count)))
}

/** Le profil d'une destination — 'visite' n'est pas dans la table : elle est
 *  fabriquée à la volée pour l'île d'un voisin. */
function destProfile(id: string): DestinationDef {
  return id === 'visite' ? VISIT_DEST : (DESTINATION_BY_ID.get(id) ?? DESTINATIONS[1]!)
}

/** Ce que le colon rapporte de chez les autres : ce sont des gens, pas un
 *  décor — ce qu'il raconte parle toujours d'eux. */
const VISIT_SIGHTS = [
  'leurs feux répondre aux nôtres depuis la grève',
  "des maisons qu'on ne bâtit pas comme ici, et qui tiennent aussi bien",
  "leurs enfants courir jusqu'à la barque pour voir de quel bois elle était",
  'un vieux dessiner leur île dans le sable pour lui expliquer où il avait accosté',
  "qu'ils comptaient les jours autrement, et qu'ils avaient pourtant le même hiver",
  'leur feu commun brûler au milieu du village, exactement comme le nôtre',
]

/** Combien de jalons « la mer recule » une partie a franchis : deux par âge
 *  révolu (mi-âge, puis passage), plus celui de mi-âge de l'âge courant. Se
 *  lit sur l'état, sans historique : c'est ce qui permet le rattrapage d'une
 *  sauvegarde d'avant les parcelles. */
export function landMilestones(age: number, techs: readonly string[]): number {
  const cur = AGES[Math.min(age, AGES.length - 1)]!
  const done = techs.filter((id) => TECH_BY_ID.get(id)?.age === cur.id).length
  return Math.min(age, AGES.length - 1) * 2 + (done >= Math.ceil(cur.techsToAdvance / 2) ? 1 : 0)
}

/** Distance entre deux cellules du réseau hexagonal axial (q, r). */
export function hexDistance(aq: number, ar: number, bq: number, br: number): number {
  const dq = aq - bq
  const dr = ar - br
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
}

/** Une parcelle couvre son centre et l'anneau autour : deux parcelles se
 *  chevauchent si leurs centres sont à 2 cellules ou moins, et se TOUCHENT
 *  — bord contre bord — à 3. */
export const LAND_OVERLAP = 2
export const LAND_TOUCH = 3
/** Le voisinage : une terre qui touche une terre du même type voit son bonus
 *  majoré de moitié (×1,08 devient ×1,12). La seule règle, sans combinatoire :
 *  trois forêts en chaîne valent trois forêts voisines, pas davantage. */
export const LAND_BOND = 1.5

/** Pour chaque parcelle posée : touche-t-elle une parcelle du même type ? */
export function landBonds(land: readonly { kind: string; q: number; r: number }[]): boolean[] {
  return land.map((a, i) =>
    land.some((b, j) => j !== i && b.kind === a.kind && hexDistance(a.q, a.r, b.q, b.r) <= LAND_TOUCH),
  )
}

/** L'effet d'une terre qui a une voisine de son type : le gain majoré de
 *  moitié. Seuls les multiplicateurs grandissent. */
function bonded(e: Effect): Effect {
  if (e.kind === 'gatherRate' || e.kind === 'expeditionSpeed') return { ...e, mult: 1 + (e.mult - 1) * LAND_BOND }
  return e
}

/** Les trois terres d'un jalon : tirées sans doublon parmi celles que la
 *  tribu peut exploiter, par un PRNG semé sur l'île ET le numéro du jalon —
 *  même île, même jalon, mêmes cartes. */
export function drawLands(seed: number, n: number, age: number, unlocked: ReadonlySet<ResourceId>): string[] {
  const pool = LANDS.filter((l) => (l.fromAge ?? 0) <= age && (!l.needs || unlocked.has(l.needs))).map((l) => l.id)
  let h = (seed ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0
  for (let i = pool.length - 1; i > 0; i--) {
    h = (Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0
    const j = h % (i + 1)
    ;[pool[i], pool[j]] = [pool[j]!, pool[i]!]
  }
  return pool.slice(0, 3)
}

export class Game {
  save: SaveV1
  /** Live per-second yields, recomputed whenever anything structural changes. */
  rates: Record<ResourceId, number>
  unlocked: Set<ResourceId>
  buildings: Set<string>
  encourageLeft = 0
  encourageCooldown = 0
  lastFact: TechDef | null = null

  currentMerchant = ''

  private listeners: Listener[] = []
  /** Événements émis avant le premier abonnement (constructeur, rattrapage hors
   *  ligne) : sans tampon, le toast « pendant ton absence » partait dans le vide. */
  private pendingEvents: GameEvent[] = []
  private saveAccumulator = 0
  private mult!: Record<ResourceId, number>
  private insightAdd = 0
  private carry = 0
  private expeditionSpeed = 1
  private nightFloor = NIGHT_BASE_FLOOR
  /** Le grand marchand (événement) paie mieux — consommé au départ de la barque. */
  private goldenTrade = false
  /** Ce que les outils achetés font gagner sur CHAQUE troc, cumulé. */
  private tradeBonus = 1
  private lastSeasonId = -1
  private lightFactor = 1
  private wasNight = false

  constructor(now: number) {
    const { save, offlineSeconds, migrateReserve } = loadSave(now)
    this.save = save
    this.unlocked = new Set<ResourceId>(['food', 'wood', 'stone', 'insight'])
    this.buildings = new Set()
    this.rates = { ...BASE_RATE, insight: 0 }
    this.recompute()

    if (migrateReserve) this.migrateInsightReserve()

    if (offlineSeconds > 60) this.creditAbsence(offlineSeconds)
    this.catchUpAge()
    // Une sauvegarde d'avant les parcelles (ou qui a franchi un âge en
    // rattrapage) reçoit en file tous ses jalons passés. Ils attendent le
    // joueur comme les autres : rien ne se pose sans lui.
    this.syncLand(true)

    // Les tribus d'avant la Chronique ouvrent leur registre en cours de route.
    if (this.save.chronicle.length === 0 && this.save.techs.length > 0)
      this.record(
        'age',
        `La Chronique s'ouvre — la tribu porte déjà ${this.save.techs.length} découverte${this.save.techs.length > 1 ? 's' : ''}`,
      )
  }

  /** Crédite une absence : au CHARGEMENT (constructeur) mais aussi au RETOUR
   *  D'ONGLET — sur mobile la page reste vivante en arrière-plan pendant des
   *  heures sans jamais repasser par le constructeur, et le dt plafonné du
   *  frame suivant effaçait tout le temps caché. C'était ça, « l'idle ne
   *  marche pas quand l'application ne tourne pas ». */
  creditAbsence(rawSeconds: number): void {
    const seconds = Math.min(rawSeconds, OFFLINE_CAP_SECONDS)
    // Seuil bas : un téléphone verrouillé 30 s pendant une expédition doit
    // compter. Seul le TOAST garde un seuil élevé, pour ne pas commenter
    // chaque changement d'application.
    if (seconds <= 3) return
    const before = { ...this.save.res }
    // Encourager dure quinze secondes, pas toute l'absence : le geste est
    // décompté, et l'absence se crédite sans lui.
    const encourageLeft = Math.max(0, this.encourageLeft - seconds)
    this.encourageCooldown = Math.max(0, this.encourageCooldown - seconds)
    this.encourageLeft = 0
    // Une expédition en cours se poursuit sans le joueur ; le camp ne produit
    // qu'une fois le colon rentré.
    let workSeconds = seconds
    const exp = this.save.expedition
    if (exp) {
      if (seconds >= exp.remaining) {
        workSeconds = seconds - exp.remaining
        this.finishExpedition()
      } else {
        exp.remaining -= seconds
        workSeconds = 0
      }
    }
    let reserve = 0
    if (workSeconds > 0) {
      // Une absence couvre des cycles entiers : on produit au facteur moyen
      // d'un tour, tiré de la même courbe que le jeu en direct. L'horloge de
      // jeu, elle, n'avance pas : la saison resterait figée sur celle du
      // départ, alors on prend la moyenne des quatre.
      this.lightFactor = meanLightFactor(this.nightFloor)
      this.seasonMean = true
      this.refreshRates()
      const insight = this.amount('insight')
      this.produce(workSeconds)
      // Le savoir produit suit sa propre règle : les matériaux, eux, sont
      // crédités en entier.
      this.save.res.insight = insight
      reserve = this.creditAbsentInsight(workSeconds)
      // Le chantier continue sans le joueur, au débit du jeu en direct, sur
      // ce que l'absence a rentré.
      this.tickWonder(workSeconds)
      this.seasonMean = false
    }
    this.encourageLeft = encourageLeft
    this.refreshRates()
    // Le commerce continue sans le joueur : quelques passages de barque sont
    // crédités en silence, plafonnés pour ne pas vider les stocks du retour.
    if (this.save.age >= CARAVAN_AGE) {
      const visits = Math.min(CARAVAN_OFFLINE_MAX, Math.floor(seconds / CARAVAN_PERIOD))
      for (let i = 0; i < visits; i++) this.doTrade(1, true)
    }
    const gained: Partial<Record<ResourceId, number>> = {}
    for (const id of Object.keys(this.save.res) as ResourceId[]) {
      const delta = (this.save.res[id] ?? 0) - (before[id] ?? 0)
      if (delta > 0.5) gained[id] = delta
    }
    if (seconds > 90) this.emit({ type: 'offline', seconds, gained, reserve })
  }

  /** Crédite un écart de l'horloge murale vu par la boucle de jeu (onglet
   *  caché, écran verrouillé), menu ouvert ou non : un jeu en pause est un
   *  joueur absent. La sauvegarde est réécrite tout de suite, sans quoi un
   *  rechargement recréditerait le même écart depuis l'ancienne date. */
  creditGap(seconds: number, now: number): void {
    if (!(seconds > 5)) return
    this.creditAbsence(seconds)
    writeSave(this.save, now)
  }

  /** Les taux du camp au facteur moyen d'un tour, colon au travail et sans
   *  encourager : ce que le camp rapporte « en moyenne », même pendant une
   *  expédition. */
  private campMeanRates(): Record<ResourceId, number> {
    const { lightFactor, encourageLeft } = this
    const expedition = this.save.expedition
    this.save.expedition = null
    this.encourageLeft = 0
    this.lightFactor = meanLightFactor(this.nightFloor)
    this.refreshRates()
    const rates = { ...this.rates }
    this.save.expedition = expedition
    this.encourageLeft = encourageLeft
    this.lightFactor = lightFactor
    this.refreshRates()
    return rates
  }

  /** Taux de savoir moyen d'un tour, nuit comprise, d'après la vraie courbe
   *  jour/nuit. */
  private meanInsightRate(): number {
    return this.campMeanRates().insight
  }

  /** Le savoir de `seconds` secondes de travail sans le joueur. Une absence
   *  avance la partie sans la jouer à sa place : r·τ·(1 − e^(−s/τ)) tout de
   *  suite (presque tout d'une courte pause, ~10 min de savoir pour une nuit),
   *  le reste en réserve jusqu'à deux heures de savoir. Rend ce qui est entré
   *  en réserve. */
  private creditAbsentInsight(seconds: number): number {
    const r = this.meanInsightRate()
    const now = r * OFFLINE_INSIGHT_TAU * (1 - Math.exp(-seconds / OFFLINE_INSIGHT_TAU))
    this.save.res.insight = this.amount('insight') + now
    const R = this.save.insightReserve
    const added = Math.max(0, Math.min(r * seconds - now, r * INSIGHT_RESERVE_HOURS * 3600 - R))
    this.save.insightReserve = R + added
    return added
  }

  /** Une partie d'avant la réserve, au premier chargement : le stock garde de
   *  quoi payer le prochain savoir (ou dix minutes de savoir), le surplus part
   *  en réserve, sans plafond. Rien n'est retiré : il rentre en jouant, deux
   *  fois plus vite. La sauvegarde porte ensuite le champ, on ne repasse pas. */
  private migrateInsightReserve(): void {
    const cheapest = Math.min(...this.available().map((t) => t.cost))
    const keep = Math.max(Number.isFinite(cheapest) ? cheapest : 0, this.meanInsightRate() * OFFLINE_INSIGHT_TAU)
    const stock = this.amount('insight')
    this.save.insightReserve = Math.max(0, stock - keep)
    this.save.res.insight = Math.min(stock, keep)
    if (this.save.insightReserve > 0.5)
      this.emit({ type: 'reserveMigrated', kept: this.save.res.insight, reserve: this.save.insightReserve })
  }

  static fresh(now: number): Game {
    try {
      localStorage.removeItem('tribu.save.v1')
    } catch {
      /* ignore */
    }
    const g = new Game(now)
    g.save = emptySave(now)
    g.recompute()
    return g
  }

  on(fn: Listener): void {
    this.listeners.push(fn)
    if (this.pendingEvents.length > 0) {
      const backlog = this.pendingEvents
      this.pendingEvents = []
      for (const e of backlog) this.emit(e)
    }
  }

  private emit(e: GameEvent): void {
    if (this.listeners.length === 0) {
      this.pendingEvents.push(e)
      return
    }
    for (const fn of this.listeners) fn(e)
  }

  get age(): AgeDef {
    return AGES[Math.min(this.save.age, AGES.length - 1)]!
  }

  amount(id: ResourceId): number {
    return this.save.res[id] ?? 0
  }

  knows(id: string): boolean {
    return this.save.techs.includes(id)
  }

  /** Technologies the player can see: current age or earlier, prerequisites met. */
  available(): TechDef[] {
    return TECHS.filter(
      (t) =>
        !this.knows(t.id) &&
        t.age <= this.save.age &&
        t.requires.every((r) => this.knows(r)),
    )
  }

  /** How far the current age is from opening the next one. */
  ageProgress(): { done: number; needed: number } {
    const done = this.save.techs.filter((id) => TECH_BY_ID.get(id)?.age === this.save.age).length
    return { done, needed: this.age.techsToAdvance }
  }

  private recompute(): void {
    const mult = {} as Record<ResourceId, number>
    for (const id of Object.keys(RESOURCES) as ResourceId[]) mult[id] = 1
    this.insightAdd = 0
    this.carry = 0
    this.expeditionSpeed = 1
    this.tradeBonus = 1
    this.nightFloor = NIGHT_BASE_FLOOR
    this.unlocked = new Set<ResourceId>(['food', 'wood', 'stone', 'insight'])
    this.buildings = new Set()

    // Savoirs ET outils versent dans le même moulin : un outil n'est qu'un
    // paquet d'effets de plus, qui vient du dehors au lieu de l'arbre.
    // Les terres aussi, chacune majorée si une voisine est du même type.
    const bonds = landBonds(this.save.land)
    const sources: (readonly Effect[] | undefined)[] = [
      ...this.save.techs.map((id) => TECH_BY_ID.get(id)?.effects),
      ...this.save.tools.map((id) => TOOL_BY_ID.get(id)?.effects),
      ...this.save.land.map((l, i) => {
        const fx = LAND_BY_ID.get(l.kind)?.effects
        return fx && bonds[i] ? fx.map(bonded) : fx
      }),
    ]
    for (const effects of sources) {
      if (!effects) continue
      for (const e of effects) {
        switch (e.kind) {
          case 'gatherRate':
            mult[e.resource] *= e.mult
            break
          case 'unlockResource':
            this.unlocked.add(e.resource)
            break
          case 'insightRate':
            this.insightAdd += e.add
            break
          case 'carry':
            this.carry += e.add
            break
          case 'expeditionSpeed':
            this.expeditionSpeed *= e.mult
            break
          case 'building':
            this.buildings.add(e.building)
            break
          case 'nightFloor':
            this.nightFloor = Math.max(this.nightFloor, e.value)
            break
          case 'tradeBonus':
            this.tradeBonus *= e.mult
            break
        }
      }
    }
    this.mult = mult
    this.refreshRates()
  }

  private refreshRates(): void {
    // Parti en expédition, le colon ne travaille plus au camp : tout s'arrête.
    // C'est le vrai prix du voyage — le butin doit valoir le temps perdu.
    if (this.save.expedition) {
      for (const id of Object.keys(RESOURCES) as ResourceId[]) this.rates[id] = 0
      return
    }
    const encourage = this.encourageLeft > 0 ? ENCOURAGE_MULT : 1
    const carryBonus = 1 + this.carry * 0.02
    // Encourager, la lumière et le legs s'appliquent UNE fois, à la fin. La
    // part matériaux du savoir se lit donc avant eux : lue après, elle les
    // comptait deux fois (encourager ×2,7 au lieu de ×2, nuit au carré).
    const pace = encourage * this.lightFactor * this.legacyBonus
    let material = 0
    for (const id of Object.keys(RESOURCES) as ResourceId[]) {
      if (id === 'insight') continue
      if (!this.unlocked.has(id)) {
        this.rates[id] = 0
        continue
      }
      const focusFactor = this.save.focus === id ? 1 : IDLE_FRACTION
      const r =
        BASE_RATE[id] *
        this.mult[id] *
        focusFactor *
        carryBonus *
        this.wonderBonus *
        (id === 'food' ? this.seasonFood : 1)
      this.rates[id] = r * pace
      material += r
    }
    // Knowledge grows out of what the tribe actually does, not out of nothing.
    this.rates.insight =
      (0.2 + this.insightAdd + material * INSIGHT_PER_MATERIAL) * pace * this.mult.insight
  }

  /** La nuit ralentit la tribu : le rendement glisse entre le plancher de nuit
   *  (selon la lumière découverte) et le plein jour (voir lightFactorFor). */
  private updateLight(): void {
    const k = daylightAt(this.save.totalPlaySeconds)
    this.lightFactor = lightFactorFor(this.nightFloor, k)
    // La nuit du cadran : soleil sous l'horizon. L'heure ne fait qu'avancer,
    // la bascule ne peut pas battre — pas besoin d'hystérésis.
    const night = isNightHour(dayPhaseAt(this.save.totalPlaySeconds))
    if (night !== this.wasNight) {
      this.wasNight = night
      this.emit(night ? { type: 'nightfall', floor: this.nightFloor } : { type: 'daybreak' })
    }
  }

  private produce(seconds: number): void {
    for (const id of Object.keys(RESOURCES) as ResourceId[]) {
      const rate = this.rates[id]
      if (rate <= 0) continue
      this.save.res[id] = (this.save.res[id] ?? 0) + rate * seconds
    }
  }

  setFocus(id: ResourceId): void {
    if (!this.unlocked.has(id) || id === 'insight') return
    this.save.focus = id
    this.refreshRates()
  }

  canEncourage(): boolean {
    return this.encourageCooldown <= 0 && this.encourageLeft <= 0
  }

  encourage(): boolean {
    if (!this.canEncourage()) return false
    this.encourageLeft = ENCOURAGE_SECONDS
    this.encourageCooldown = ENCOURAGE_COOLDOWN
    this.refreshRates()
    this.emit({ type: 'encourage' })
    return true
  }

  canResearch(t: TechDef): boolean {
    if (this.knows(t.id) || this.amount('insight') < t.cost) return false
    if (t.materials) {
      for (const [res, n] of Object.entries(t.materials) as [ResourceId, number][]) {
        if (this.amount(res) < n) return false
      }
    }
    return true
  }

  /** Ce qui manque encore pour lancer cette recherche, savoir compris. */
  missingFor(t: TechDef): Partial<Record<ResourceId, number>> {
    const missing: Partial<Record<ResourceId, number>> = {}
    if (this.amount('insight') < t.cost) missing.insight = t.cost - this.amount('insight')
    if (t.materials) {
      for (const [res, n] of Object.entries(t.materials) as [ResourceId, number][]) {
        if (this.amount(res) < n) missing[res] = n - this.amount(res)
      }
    }
    return missing
  }

  research(id: string): boolean {
    const tech = TECH_BY_ID.get(id)
    if (!tech || !this.canResearch(tech)) return false
    this.save.res.insight = this.amount('insight') - tech.cost
    if (tech.materials) {
      for (const [res, n] of Object.entries(tech.materials) as [ResourceId, number][]) {
        this.save.res[res] = this.amount(res) - n
      }
    }
    this.save.techs.push(tech.id)
    if (!this.save.seenFacts.includes(tech.id)) this.save.seenFacts.push(tech.id)
    this.lastFact = tech
    this.recompute()
    this.record('tech', `Découverte : ${tech.name}`)
    this.emit({ type: 'tech', tech })
    this.checkAge()
    this.syncLand(false)
    return true
  }

  /** Met la file à jour des jalons franchis. Les cartes s'accumulent sans
   *  limite ni minuterie : c'est le joueur qui les pose, quand il veut. */
  private syncLand(catchUp: boolean): void {
    const target = landMilestones(this.save.age, this.save.techs)
    let count = 0
    while (this.save.landN < target) {
      const n = this.save.landN++
      this.save.landPending.push({ n, kinds: drawLands(this.save.seed, n, this.save.age, this.unlocked) })
      count++
    }
    if (count > 0) this.emit({ type: 'landOffer', count, catchUp })
  }

  /** La carte la plus ancienne de la file : c'est elle qu'on choisit d'abord. */
  get landOffer(): { n: number; kinds: string[] } | null {
    return this.save.landPending[0] ?? null
  }

  /** La terre retenue sur la carte, en attente de son emplacement. Rien n'est
   *  écrit dans la sauvegarde tant qu'elle n'est pas posée : la carte reste en
   *  tête de file, et un rechargement la rend telle quelle. */
  placing: string | null = null

  /** Le joueur retient une terre de la carte : reste à choisir où la poser. */
  pickLand(kind: string): boolean {
    const offer = this.landOffer
    if (!offer || !offer.kinds.includes(kind) || !LAND_BY_ID.has(kind)) return false
    this.placing = kind
    return true
  }

  /** Il se ravise : la carte retourne dans la file, intacte. */
  cancelLand(): void {
    this.placing = null
  }

  /** Une parcelle en (q, r) mordrait-elle sur une terre déjà gagnée ? La
   *  validation que la simulation peut faire seule ; l'île de base, elle, se
   *  vérifie côté rendu (`Island.canAnchor`). */
  landOverlaps(q: number, r: number): boolean {
    return this.save.land.some((l) => hexDistance(l.q, l.r, q, r) <= LAND_OVERLAP)
  }

  /** Poser `kind` en (q, r) créerait-il un voisinage ? */
  landBondAt(kind: string, q: number, r: number): boolean {
    return this.save.land.some((l) => l.kind === kind && hexDistance(l.q, l.r, q, r) <= LAND_TOUCH)
  }

  /** Pose la terre retenue (`pickLand`) à l'ancre (q, r). */
  placeLand(q: number, r: number): boolean {
    return this.placing !== null && this.chooseLand(this.placing, q, r)
  }

  /** Le joueur retient une terre de la carte en tête de file ; elle se pose à
   *  l'ancre (q, r) qu'il a touchée. L'effet compte dès maintenant, sans
   *  rétroactivité. */
  chooseLand(kind: string, q: number, r: number): boolean {
    const offer = this.landOffer
    const def = LAND_BY_ID.get(kind)
    if (!offer || !def || !offer.kinds.includes(kind)) return false
    if (!Number.isInteger(q) || !Number.isInteger(r)) return false
    if (this.landOverlaps(q, r)) return false
    this.placing = null
    this.save.landPending.shift()
    this.save.land.push({ kind, q, r })
    this.recompute()
    this.record('land', `La mer recule : ${def.name.toLowerCase()} gagnée sur l'eau`)
    this.emit({ type: 'landPlaced', def })
    return true
  }

  private checkAge(): void {
    const { done, needed } = this.ageProgress()
    if (done >= needed && this.save.age < AGES.length - 1) {
      this.save.age += 1
      this.record('age', `Nouvel âge : ${this.age.name}`)
      this.emit({ type: 'age', age: this.age })
    }
  }

  /** Re-vérifié au chargement : une mise à jour peut AJOUTER des âges après
   *  qu'un joueur a fini le dernier — son 5/5 doit alors ouvrir la suite. */
  private catchUpAge(): void {
    let guard = AGES.length
    while (guard-- > 0) {
      const before = this.save.age
      this.checkAge()
      if (this.save.age === before) break
    }
  }

  /** Les voyages s'allongent avec les âges — le monde à explorer grandit. La
   *  vitesse DIVISE la durée : un savoir ×1,6 rend le voyage 1,6 fois plus
   *  court, comme il l'annonce. Jusqu'à la 3.71 elle s'amortissait
   *  (0,45 + 0,55/vitesse) et les savoirs tardifs ne gagnaient plus que 1 à
   *  4 %. La base de chaque âge est celle de la 3.71 pour une tribu qui a
   *  l'équipement des âges d'avant : ~90 s au Paléolithique, ~4 min en fin
   *  d'arbre, et le butin suit la durée. */
  expeditionDuration(destId = 'cote'): number {
    const age = Math.min(this.save.age, AGES.length - 1)
    const ref = SPEED_BY_AGE[age]!
    const base = (EXPEDITION_SECONDS + age * 45) * (0.45 + 0.55 / ref) * ref
    const k = destProfile(destId).durationK
    return Math.max(45, (base * k) / this.expeditionSpeed)
  }

  /** Les provisions suivent l'économie réelle : ~30 secondes de récolte de
   *  nourriture focalisée, portage compris. Un barème fixe par âge devenait
   *  dérisoire dès que les multiplicateurs s'empilaient. */
  expeditionCost(): number {
    const carryBonus = 1 + this.carry * 0.02
    const focusedFood = BASE_RATE.food * this.mult.food * carryBonus
    return Math.max(EXPEDITION_FOOD_COST + this.save.age * 10, Math.round(focusedFood * 30))
  }

  /** Palier de la flotte : le même barème que le rendu du bateau. */
  get boatTier(): number {
    return this.knows('automobile')
      ? 5
      : this.knows('steamengine')
        ? 4
        : this.knows('caravel')
          ? 3
          : this.knows('sail')
            ? 2
            : this.knows('polished_axe')
              ? 1
              : 0
  }

  canReach(destId: string): boolean {
    const d = destProfile(destId)
    // Le rail et l'avion ne se jugent pas au palier de la flotte : ils se
    // jugent au savoir. On ne prend pas le train sur un radeau perfectionné.
    if (d.tech) return this.knows(d.tech)
    return this.boatTier >= d.minTier
  }

  /** Les voisins joignables, posés par main.ts à chaque synchro. Hors
   *  sauvegarde : c'est une vue du monde, pas un état de la partie. */
  visitable: { id: string; name: string; age: number; relics: number }[] = []

  /** Mettre le cap sur l'île d'un voisin. Même économie qu'une expédition,
   *  mais on sait chez QUI on va — et eux le sauront aussi. */
  startVisit(id: string, name: string): boolean {
    if (!this.canExpedition() || !this.canReach('visite')) return false
    const cost = this.expeditionCost()
    if (this.amount('food') < cost) return false
    this.save.res.food = this.amount('food') - cost
    const total = this.expeditionDuration('visite')
    this.save.expedition = { remaining: total, total, dest: 'visite', visit: { id, name } }
    this.refreshRates()
    this.emit({ type: 'expeditionStart' })
    return true
  }

  /** Le comptoir : la marchandise quitte le camp au dépôt (ou au paiement
   *  d'une offre acceptée). Refuse net si les réserves n'y sont pas. */
  tradeSpend(res: ResourceId, qty: number): boolean {
    if (!this.unlocked.has(res) || !(qty > 0) || this.amount(res) < qty) return false
    this.save.res[res] = this.amount(res) - qty
    writeSave(this.save, Date.now())
    return true
  }

  /** Marchandise qui entre : d'un échange accepté, ou d'un dépôt repris. */
  tradeCredit(res: ResourceId, qty: number, text: string): void {
    if (!(qty > 0)) return
    this.save.res[res] = this.amount(res) + qty
    this.record('trade', text)
    writeSave(this.save, Date.now())
  }

  /** Offrir une relique : elle QUITTE le musée. Un présent qui ne coûte rien
   *  n'est pas un présent — et la pièce redevient trouvable en expédition. */
  giveRelic(relicId: string, toName: string): RelicDef | null {
    const def = RELIC_BY_ID.get(relicId)
    const at = this.save.relics.indexOf(relicId)
    if (!def || at < 0) return null
    this.save.relics.splice(at, 1)
    this.record('relic', `${def.name} part en présent pour ${toName}.`)
    writeSave(this.save, Date.now())
    return def
  }

  /** Le courrier des autres tribus, relevé par main.ts. Le serveur n'écrit
   *  que des faits ; c'est ici qu'ils deviennent des lignes de Chronique. */
  receiveMail(
    events: { kind: string; from?: string; relic?: string; res?: string; qty?: number }[],
  ): void {
    for (const e of events) {
      const who = (e.from ?? 'Une tribu inconnue').slice(0, 24)
      if (e.kind === 'visit') {
        // Tournure qui marche avec n'importe quel nom de tribu : « X est
        // venu » se casse dès que le nom est pluriel, et ils le sont presque tous.
        const text = `Une barque de ${who} a accosté sur notre rivage.`
        this.record('visit', text)
        this.emit({ type: 'mail', text, relic: null })
      } else if (e.kind === 'trade' || e.kind === 'refund') {
        const res = e.res as ResourceId
        const qty = Number(e.qty)
        if (!RESOURCES[res] || !(qty > 0)) continue
        this.save.res[res] = this.amount(res) + qty
        const label = `${RESOURCES[res].icon}\u202F${Math.round(qty)}`
        const text =
          e.kind === 'trade'
            ? `Le comptoir a trouvé preneur : ${who} paie ${label}.`
            : `Dépôt repris au comptoir : ${label} rentre au camp.`
        this.record('trade', text)
        this.emit({ type: 'mail', text, relic: null })
      } else if (e.kind === 'gift') {
        const def = RELICS.find((r) => r.id === e.relic)
        if (!def) continue
        // Une relique déjà exposée ne se dédouble pas : le geste compte quand
        // même, il s'écrit dans la Chronique.
        const isNew = !this.save.relics.includes(def.id)
        if (isNew) this.save.relics.push(def.id)
        // Même précaution que pour les visites : la tournure ne doit pas
        // supposer le nombre ni le genre du nom de la tribu.
        const text = isNew
          ? `Un présent de ${who} : ${def.name.toLowerCase()} entre au musée.`
          : `Un présent de ${who} : ${def.name.toLowerCase()} — le musée en possédait déjà une.`
        this.record('relic', text)
        this.emit({ type: 'mail', text, relic: isNew ? def : null })
      }
    }
    if (events.length > 0) writeSave(this.save, Date.now())
  }

  canExpedition(): boolean {
    return this.seaOpen && !this.save.expedition && this.amount('food') >= this.expeditionCost()
  }

  startExpedition(destId: DestinationDef['id'] = 'cote', embassy = false): boolean {
    if (!this.canExpedition() || !this.canReach(destId)) return false
    if (embassy && (this.save.outpost || !this.knows('sail'))) return false
    const cost = this.expeditionCost() * (embassy ? 2 : 1)
    if (this.amount('food') < cost) return false
    this.save.res.food = this.amount('food') - cost
    const total = this.expeditionDuration(destId)
    this.save.expedition = { remaining: total, total, dest: destId, embassy }
    this.refreshRates()
    this.emit({ type: 'expeditionStart' })
    return true
  }

  private finishExpedition(): void {
    const loot: Partial<Record<ResourceId, number>> = {}
    // Le butin est PROPORTIONNEL à la durée réelle du voyage : un trajet
    // raccourci par les technos de vitesse rapporte moins par trajet, donc le
    // taux (butin/seconde) reste constant et le spam n'est plus une stratégie.
    // Calibré ≈ 1,4× la récolte focalisée, sur toutes les ressources à la fois.
    const ratio = (this.save.expedition?.total ?? EXPEDITION_SECONDS) / EXPEDITION_SECONDS
    // Le butin profite du portage en racine carrée : sans lui, l'expédition
    // tardive devenait strictement moins bonne que rester au camp (le camp
    // encaisse ×20 de portage, le voyage rien) ; en plein, elle redevenait
    // dominante. La racine garde la tension.
    const carryBonus = Math.sqrt(1 + this.carry * 0.02)
    const visit = this.save.expedition?.visit ?? null
    const dest = destProfile(this.save.expedition?.dest ?? 'cote')
    // Le tempérament de la destination joue sur le butin — la durée a déjà
    // payé sa part via ratio, lootK est le pari en plus.
    const lootBias = dest.lootK / dest.durationK
    // Un revers abîme le butin, jamais le colon : l'idle ne punit pas, il
    // raconte. Un bateau au-dessus du minimum requis affronte mieux la mer.
    const seaworthy = Math.max(0.4, 1 - 0.12 * (this.boatTier - dest.minTier))
    const setback = Math.random() < dest.risk * seaworthy
    const scale = (90 + this.save.age * 80) * ratio * carryBonus * lootBias * (setback ? 0.55 : 1)
    for (const id of this.unlocked) {
      if (id === 'insight') continue
      loot[id] = Math.round(scale * BASE_RATE[id] * this.mult[id])
    }
    // Le savoir rapporté vaut 1,3 fois celui que le camp aurait produit sur
    // la même durée (vers la côte, à tous les âges) : un barème par âge ne
    // suivait pas la part matériaux du savoir, et tombait à 0,15 en fin d'arbre.
    const total = this.save.expedition?.total ?? EXPEDITION_SECONDS
    loot.insight = Math.round(this.campMeanRates().insight * total * EXPEDITION_INSIGHT_K * lootBias)
    for (const [id, n] of Object.entries(loot) as [ResourceId, number][]) {
      this.save.res[id] = this.amount(id) + n
    }
    // A find is flavour, not power: it is what the settler brings home to look at.
    const find = Math.random() < 0.35 ? (FINDS[Math.floor(Math.random() * FINDS.length)] ?? null) : null
    // Une relique pour le musée — jamais deux fois la même.
    let relic: RelicDef | null = null
    if (Math.random() < dest.relicChance) {
      // Chez un voisin, on ne ramène pas n'importe quoi : une pièce de LEUR
      // musée. Leur collection est déduite de leur identité et de leur nombre
      // de reliques — le serveur n'en transporte que le compte.
      const pool = visit
        ? museumOf(visit.id, this.visitable.find((v) => v.id === visit.id)?.relics ?? 0).filter(
            (r) => !this.save.relics.includes(r.id),
          )
        : RELICS.filter((r) => !this.save.relics.includes(r.id))
      relic = pool[Math.floor(Math.random() * pool.length)] ?? null
      if (relic) this.save.relics.push(relic.id)
    }
    // L'ambassade fonde le comptoir : pas de butin d'exception, une relation.
    if (this.save.expedition?.embassy) {
      this.save.outpost = true
      this.save.outpostIn = 60
      this.save.expedition = null
      this.record('outpost', "Un comptoir est fondé sur l'îlot voisin")
      this.refreshRates()
      this.emit({
        type: 'expeditionEnd',
        loot,
        find: null,
        journal:
          "L'îlot voisin — les feux ont répondu aux nôtres. Un comptoir est fondé : leur barque viendra porter tribut.",
        relic,
        setback: false,
      })
      this.emit({ type: 'outpostFounded' })
      return
    }
    const sights = visit ? VISIT_SIGHTS : (SIGHTS[dest.id] ?? [])
    const sight = sights[Math.floor(Math.random() * sights.length)] ?? 'la mer, longtemps'
    // « Chez X » plutôt que « L'île de X » : aucun nom de tribu ne s'élide
    // proprement derrière « de » (« l'île de Les Veilleurs »…).
    let journal = visit
      ? `Chez ${visit.name} — le colon a vu ${sight}.`
      : `${dest.name} — le colon a vu ${sight}.`
    if (setback)
      journal += ` Mais ${SETBACKS[Math.floor(Math.random() * SETBACKS.length)]}.`
    this.save.expedition = null
    this.record('exp', visit ? `Visite — ${journal}` : `Expédition — ${journal}`)
    // Ils sauront qu'on est venu : main.ts porte le mot au serveur.
    if (visit) this.emit({ type: 'visitDone', neighborId: visit.id, name: visit.name })
    if (relic) this.record('relic', `Relique rapportée : ${relic.name.toLowerCase()}`)
    this.refreshRates()
    this.emit({ type: 'expeditionEnd', loot, find, journal, relic, setback })
  }

  /** Une ligne de Chronique écrite par le monde (le grand tracé). */
  note(kind: string, text: string): void {
    this.record(kind, text)
  }

  /** Une ligne de plus à la Chronique — datée du jour de jeu, dans le monde
   *  courant. Bornée : la saga tient dans le localStorage, pas l'inverse. */
  private record(kind: string, text: string): void {
    const c = this.save.chronicle
    c.push({
      w: this.save.legacy + 1,
      d: Math.floor(this.save.totalPlaySeconds / DAY_SECONDS) + 1,
      k: kind,
      x: text,
    })
    if (c.length > 600) c.splice(0, c.length - 600)
  }

  /** Ça mord : la pêche paie un petit bonus par prise — l'équivalent de
   *  quelques secondes de récolte, en plus du travail normal du colon. */
  landCatch(): number {
    const n = Math.max(1, Math.round(this.rates.food * (6 + Math.random() * 6)))
    this.save.res.food = this.amount('food') + n
    return n
  }

  /** L'arbre entier est-il su ? C'est la porte de l'Exode. */
  get treeComplete(): boolean {
    return TECHS.every((t) => this.save.techs.includes(t.id))
  }

  /** La constellation : chaque Exode accompli accélère la récolte pour toujours. */
  get legacyBonus(): number {
    return 1 + this.save.legacy * 0.08
  }

  /** L'Exode : la tribu embarque vers une île inconnue. Nouveau seed, savoirs
   *  et réserve de savoir remis à zéro — mais le musée voyage dans la cale,
   *  avec les hauts faits et le nom du village, et une étoile de plus brille
   *  au-dessus de la récolte. */
  exodus(): boolean {
    if (!this.treeComplete) return false
    // Ce qui monte dans la cale se nomme ici, et rien d'autre : les OUTILS
    // n'y sont pas. Ils appartiennent à l'île et au village qu'ils ont servi ;
    // la tribu recommence avec sa mémoire, pas avec son outillage — sans quoi
    // chaque Exode empilerait ses bonus au lieu de rouvrir une page.
    const relics = this.save.relics
    const legacy = this.save.legacy + 1
    this.record('exodus', "L'Exode : la tribu largue les amarres, l'île retourne au silence")
    const chronicle = this.save.chronicle
    // L'identité du voisinage traverse l'Exode : c'est la même tribu qui
    // recommence, et les voisins doivent continuer à la reconnaître.
    const tribe = this.save.tribe
    // Les hauts faits et le nom du village sont ceux de la tribu, pas de
    // l'île : remis à zéro, chaque Exode rejouait « Première vitrine » dès
    // le premier balayage, le musée étant du voyage.
    const { feats, village } = this.save
    this.save = { ...emptySave(Date.now()), relics, legacy, chronicle, tribe, feats, village }
    this.record('exodus', 'La tribu débarque sur une île inconnue')
    this.unlocked = new Set<ResourceId>(['food', 'wood', 'stone', 'insight'])
    this.buildings = new Set()
    this.encourageLeft = 0
    this.encourageCooldown = 0
    this.lastFact = null
    this.wasNight = false
    this.currentMerchant = ''
    this.toolOffer = null
    this.recompute()
    writeSave(this.save, Date.now())
    this.emit({ type: 'exodus', legacy })
    return true
  }

  /** Où en est-on DANS la saison, de 0 à 1. L'île s'enneige avec, au lieu de
   *  blanchir d'un coup au changement de saison. */
  get seasonU(): number {
    const len = DAY_SECONDS * SEASON_DAYS
    return (this.save.totalPlaySeconds % len) / len
  }

  /** La saison courante, calculée sur le temps de jeu cumulé. */
  get season(): (typeof SEASONS)[number] {
    return SEASONS[Math.floor(this.save.totalPlaySeconds / (DAY_SECONDS * SEASON_DAYS)) % 4]!
  }

  /** Vrai le temps de créditer une absence : la nourriture suit alors la
   *  moyenne des quatre saisons, l'horloge de jeu n'avançant pas. */
  private seasonMean = false

  /** L'hiver mord moins quand on sait stocker : le grenier amortit. */
  private get seasonFood(): number {
    const of = (f: number): number => (f < 1 && this.knows('granary') ? (f + 1) / 2 : f)
    if (this.seasonMean) return SEASONS.reduce((s, x) => s + of(x.food), 0) / SEASONS.length
    return of(this.season.food)
  }

  // ── La Merveille de l'âge ────────────────────────────────────────────────
  /** État lisible par le HUD et le rendu. */
  wonderState(): { def: WonderDef; status: 'done' | 'building' | 'available'; progress: number } | null {
    const cur = this.save.wonder
    if (cur) {
      const def = WONDER_BY_AGE.get(cur.age)!
      return { def, status: 'building', progress: this.wonderProgress(def, cur.paid) }
    }
    const def = WONDER_BY_AGE.get(this.save.age)
    if (!def) return null
    if (this.save.wonders.includes(def.age)) return { def, status: 'done', progress: 1 }
    return { def, status: 'available', progress: 0 }
  }

  /** L'état DÉTAILLÉ du chantier : ce qui est versé, ce qu'il reste, à quel
   *  débit et pour combien de temps — matériau par matériau. « 62 % » ne dit
   *  ni ce qui manque, ni combien de temps il faudra attendre. */
  wonderDetail(): {
    def: WonderDef
    progress: number
    lines: { id: ResourceId; paid: number; total: number; flow: number; eta: number }[]
    eta: number
  } | null {
    const cur = this.save.wonder
    if (!cur) return null
    const def = WONDER_BY_AGE.get(cur.age)
    if (!def) return null
    const lines = (Object.entries(def.cost) as [ResourceId, number][]).map(([id, total]) => {
      const paid = Math.min(total, cur.paid[id] ?? 0)
      // Le débit réellement versé : 60 % de la production, et seulement ce qui
      // dépasse le plancher de réserve (voir tickWonder).
      const flow = paid >= total ? 0 : this.wonderFlow(id)
      // Débit nul sur un reste dû (colon parti) : pas d'échéance.
      return { id, paid, total, flow, eta: paid >= total ? 0 : flow > 0 ? (total - paid) / flow : Infinity }
    })
    return {
      def,
      progress: this.wonderProgress(def, cur.paid),
      lines,
      eta: Math.max(0, ...lines.map((l) => l.eta)),
    }
  }

  /** Ce que le chantier prend par seconde : 60 % de la production, avec un
   *  petit minimum pour les matériaux à peine récoltés. Rien quand rien ne
   *  rentre — colon en expédition : le chantier attend son retour. */
  private wonderFlow(id: ResourceId): number {
    const rate = this.rates[id]
    return rate > 0 ? Math.max(0.4, rate * 0.6) : 0
  }

  private wonderProgress(def: WonderDef, paid: Partial<Record<ResourceId, number>>): number {
    let need = 0
    let got = 0
    for (const [id, n] of Object.entries(def.cost) as [ResourceId, number][]) {
      need += n
      got += Math.min(paid[id] ?? 0, n)
    }
    return need > 0 ? got / need : 1
  }

  startWonder(): boolean {
    if (this.save.wonder) return false
    const def = WONDER_BY_AGE.get(this.save.age)
    if (!def || this.save.wonders.includes(def.age)) return false
    this.save.wonder = { age: def.age, paid: {} }
    this.record('wonder', `Le chantier commence : ${def.name.toLowerCase()}`)
    this.emit({ type: 'wonderStage', def, stage: 0 })
    return true
  }

  /** Le chantier boit les surplus : jusqu'à ~3 % du restant dû par seconde,
   *  sans jamais descendre une ressource sous un matelas de sécurité. */
  private tickWonder(dt: number): void {
    const cur = this.save.wonder
    if (!cur) return
    const def = WONDER_BY_AGE.get(cur.age)
    if (!def) {
      this.save.wonder = null
      return
    }
    const before = this.wonderProgress(def, cur.paid)
    for (const [id, total] of Object.entries(def.cost) as [ResourceId, number][]) {
      const paid = cur.paid[id] ?? 0
      if (paid >= total) continue
      const floor = 50 + this.save.age * 30
      const avail = this.amount(id) - floor
      if (avail <= 0) continue
      // Le chantier prend une PART DE LA PRODUCTION, jamais la réserve. Avant,
      // il emportait tout ce qui dépassait le plancher à chaque image : à
      // l'ère industrielle, la tour de fer (60 000 de fer) avalait la totalité
      // du fer produit et le joueur n'en voyait plus jamais un gramme — signalé
      // en jeu, et c'était bien ça. Il en reste donc 40 % pour la tribu, et la
      // Merveille avance au rythme de ce que l'île sait vraiment produire.
      const flow = this.wonderFlow(id)
      const take = Math.min(avail, flow * dt, total - paid)
      if (take <= 0) continue
      this.save.res[id] = this.amount(id) - take
      cur.paid[id] = paid + take
    }
    const after = this.wonderProgress(def, cur.paid)
    const stageOf = (v: number): number => (v >= 1 ? 4 : v >= 0.75 ? 3 : v >= 0.5 ? 2 : v >= 0.25 ? 1 : 0)
    if (stageOf(after) !== stageOf(before)) {
      if (after >= 1) {
        this.save.wonder = null
        this.save.wonders.push(def.age)
        this.record('wonder', `${def.name} est achevée`)
        this.refreshRates()
        this.emit({ type: 'wonderDone', def })
      } else {
        this.emit({ type: 'wonderStage', def, stage: stageOf(after) })
      }
    }
  }

  /** Chaque Merveille achevée inspire la tribu : +4 % de récolte, cumulés. */
  private get wonderBonus(): number {
    return 1 + this.save.wonders.length * 0.04
  }

  /** Les hauts faits se constatent : un balayage par seconde suffit. */
  private featAcc = 0
  private tickFeats(dt: number): void {
    this.featAcc += dt
    if (this.featAcc < 1) return
    this.featAcc = 0
    const S = this.save
    const ok: Record<string, boolean> = {
      etincelle: S.techs.length >= 1,
      bronze: S.age >= 2,
      michemin: S.techs.length >= HALF_TECHS,
      sage: this.treeComplete,
      relique: S.relics.length >= 1,
      musee: S.relics.length >= RELICS.length,
      outil: S.tools.length >= 1,
      atelier: S.tools.length >= TOOLS.length,
      merveille: S.wonders.length >= 1,
      comptoir: S.outpost,
      exode: S.legacy >= 1,
      constellation: S.legacy >= 3,
      annee: S.totalPlaySeconds >= 2880,
      memoire: S.chronicle.length >= 100,
    }
    for (const f of FEATS) {
      if (S.feats.includes(f.id) || !ok[f.id]) continue
      S.feats.push(f.id)
      this.record('feat', `Haut fait : ${f.name}`)
      this.emit({ type: 'feat', id: f.id, name: f.name })
    }
  }

  private tickSeason(): void {
    const cur = this.season
    if (cur.id === this.lastSeasonId) return
    const first = this.lastSeasonId === -1
    this.lastSeasonId = cur.id
    this.refreshRates()
    if (first) return
    this.record('season', `${cur.name} s'installe`)
    this.emit({ type: 'season', id: cur.id, name: cur.name, fact: cur.fact })
  }

  get relics(): RelicDef[] {
    return this.save.relics
      .map((id) => RELIC_BY_ID.get(id))
      .filter((r): r is RelicDef => !!r)
  }

  /** Les outils possédés, dans l'ordre des époques — l'ordre où ils sont
   *  arrivés, puisque le marchand sort toujours le plus ancien qui manque. */
  get tools(): ToolDef[] {
    return TOOLS.filter((t) => this.save.tools.includes(t.id))
  }

  /** Ce que l'île produit par seconde en moyenne d'un tour, colon au travail
   *  sur cette ressource (le savoir : au travail en cours). L'étalon des
   *  récompenses fixes. */
  private referenceRate(id: ResourceId): number {
    if (id === 'insight') return this.campMeanRates().insight
    return (
      BASE_RATE[id] *
      this.mult[id] *
      (1 + this.carry * 0.02) *
      this.legacyBonus *
      this.wonderBonus *
      meanLightFactor(this.nightFloor)
    )
  }

  /** Une récompense fixe gardée telle quelle jusqu'à l'âge du bronze, puis
   *  jamais moins que `seconds` secondes de production : 40 bois d'épave par
   *  âge, c'était une poignée à l'ère industrielle. */
  private indexed(fixed: number, id: ResourceId, seconds: number): number {
    if (this.save.age < INDEXED_FROM_AGE) return fixed
    return Math.max(fixed, seconds * this.referenceRate(id))
  }

  /** L'épave : du bois et un peu de savoir. */
  wreckLoot(): { wood: number; insight: number } {
    const k = 1 + this.save.age
    return {
      wood: Math.round(this.indexed(40 * k, 'wood', WRECK_SECONDS.wood)),
      insight: Math.round(this.indexed(8 * k, 'insight', WRECK_SECONDS.insight)),
    }
  }

  /** Le tribut de la navette du comptoir. */
  outpostLoot(): Partial<Record<ResourceId, number>> {
    const k = 1 + this.save.age
    return {
      food: Math.round(this.indexed(18 * k, 'food', OUTPOST_SECONDS.food)),
      wood: Math.round(this.indexed(10 * k, 'wood', OUTPOST_SECONDS.wood)),
      insight: Math.round(this.indexed(5 * k, 'insight', OUTPOST_SECONDS.insight)),
    }
  }

  /** Les événements rares ne vivent qu'en direct : l'absence ne les simule
   *  pas — ce sont des raisons de REGARDER le jeu, pas des chiffres de plus. */
  private tickEvents(dt: number): void {
    if (this.save.age < 1) return
    this.save.eventIn -= dt
    if (this.save.eventIn > 0) return
    this.save.eventIn = 360 + Math.random() * 420
    const day = dayPhaseAt(this.save.totalPlaySeconds) < 0.5
    const pool: ('wreck' | 'migration' | 'eclipse' | 'aurora' | 'merchant')[] = ['wreck']
    if (day) pool.push('migration', 'eclipse')
    else pool.push('aurora')
    if (this.save.age >= CARAVAN_AGE && !this.save.caravan.visiting) pool.push('merchant')
    const kind = pool[Math.floor(Math.random() * pool.length)]!
    if (kind === 'wreck') {
      const { wood, insight } = this.wreckLoot()
      this.save.res.wood = this.amount('wood') + wood
      this.save.res.insight = this.amount('insight') + insight
      this.record('event', "Une épave s'est échouée sur la rive")
      this.emit({ type: 'worldEvent', kind, fact: EVENT_FACTS.wreck, loot: { wood, insight } })
      return
    }
    if (kind === 'merchant') {
      this.save.caravan.nextIn = Math.min(this.save.caravan.nextIn, 1)
      this.goldenTrade = true
    }
    this.record(
      'event',
      kind === 'migration'
        ? "Un grand troupeau a traversé l'île"
        : kind === 'eclipse'
          ? 'Une éclipse a assombri le plein jour'
          : kind === 'aurora'
            ? 'Une aurore a dansé dans la nuit'
            : 'Un grand marchand est passé au village',
    )
    this.emit({ type: 'worldEvent', kind, fact: EVENT_FACTS[kind] })
  }

  /** La navette du comptoir : un tribut périodique, tant que l'île écoute. */
  private tickOutpost(dt: number): void {
    if (!this.save.outpost) return
    this.save.outpostIn = Math.max(0, this.save.outpostIn - dt)
    // La navette du comptoir est une coque comme une autre : elle attend le
    // jour, ou le phare.
    if (this.save.outpostIn > 0 || !this.seaOpen) return
    this.save.outpostIn = 220 + Math.random() * 120
    const loot = this.outpostLoot()
    for (const [id, n] of Object.entries(loot) as [ResourceId, number][])
      this.save.res[id] = this.amount(id) + n
    this.emit({ type: 'outpostTribute', loot })
  }

  private tickCaravan(dt: number): void {
    if (this.save.age < CARAVAN_AGE) return
    const c = this.save.caravan
    if (!c.visiting) {
      c.nextIn = Math.max(0, c.nextIn - dt)
      // Le marchand ne cherche pas une passe qu'il ne voit pas : il patiente au
      // large jusqu'à l'aube, ou jusqu'à ce qu'un phare la lui montre.
      if (c.nextIn <= 0 && this.seaOpen) {
        c.visiting = true
        c.visitLeft = CARAVAN_VISIT
        c.haggled = false
        c.traded = false
        this.currentMerchant = MERCHANTS[Math.floor(Math.random() * MERCHANTS.length)] ?? ''
        this.emit({ type: 'caravanArrive', merchant: this.currentMerchant })
      }
      return
    }
    c.visitLeft = Math.max(0, c.visitLeft - dt)
    // L'échange se conclut au milieu de la visite : le joueur a le temps de
    // marchander d'un tap avant que le prix soit fixé.
    if (!c.traded && c.visitLeft <= CARAVAN_VISIT * 0.5) {
      c.traded = true
      this.doTrade((c.haggled ? 1.3 : 1) * (this.goldenTrade ? 2.2 : 1), false)
      this.offerTool()
    }
    // Et il ne repart pas non plus dans le noir : il dort à bord, amarré.
    if (c.visitLeft <= 0 && this.seaOpen) {
      c.visiting = false
      c.nextIn = CARAVAN_PERIOD * (0.8 + Math.random() * 0.5)
      this.goldenTrade = false
      // Une offre restée sans réponse repart dans la cale : il la refera.
      if (this.toolOffer) {
        this.toolOffer = null
        this.emit({ type: 'caravanOfferGone' })
      }
      this.emit({ type: 'caravanLeave' })
    }
  }

  /** Troc : le marchand prend un tiers du surplus le plus abondant et paie dans
   *  la ressource la plus rare, au cours implicite des taux de récolte. */
  private doTrade(mult: number, silent: boolean): void {
    const materials = [...this.unlocked].filter((id) => id !== 'insight')
    const price = (id: ResourceId): number => 1 / BASE_RATE[id]

    let give: ResourceId | null = null
    for (const id of materials) {
      if (this.amount(id) < 15) continue
      if (!give || this.amount(id) > this.amount(give)) give = id
    }
    if (!give) return

    let get: ResourceId | null = null
    for (const id of materials) {
      if (id === give) continue
      if (!get || this.amount(id) < this.amount(get)) get = id
    }
    if (!get) return

    // Les outils de commerce (le réal, le conteneur) ne changent pas ce que la
    // tribu donne — ils changent ce qu'elle obtient en face.
    const paying = mult * this.tradeBonus
    const gave = Math.min(this.amount(give) * 0.33, 40 + this.save.age * 50)
    const value = gave * price(give)
    const got = Math.max(1, Math.round((value * 0.75 * paying) / price(get)))
    const insight = Math.round(this.indexed(6 + this.save.age * 8, 'insight', TRADE_INSIGHT_SECONDS) * paying)

    this.save.res[give] = this.amount(give) - gave
    this.save.res[get] = this.amount(get) + got
    this.save.res.insight = this.amount('insight') + insight

    if (!silent) {
      const tale =
        Math.random() < 0.4
          ? (TRADE_TALES[Math.floor(Math.random() * TRADE_TALES.length)] ?? null)
          : null
      this.emit({
        type: 'caravanTrade',
        gave: { res: give, amount: Math.round(gave) },
        got: { res: get, amount: got },
        insight,
        tale,
      })
    }
  }

  /** LA CALE. Un marchand n'apporte pas que des tas à rééquilibrer : il pose
   *  parfois sur le sable un objet que l'île ne saura jamais faire pousser ni
   *  cuire. C'est la seule source d'outils du jeu — aucun savoir n'en donne,
   *  aucune expédition n'en ramène.
   *
   *  Il n'en sort qu'un par passage, le plus ancien qui manque, et seulement si
   *  la tribu peut le payer d'un coup : le marchand ne fait pas crédit. S'il
   *  n'est pas abordable — ou payable dans une ressource encore inconnue —, il
   *  attend un prochain passage : il ne sort pas le suivant à sa place.
   *
   *  Il le PROPOSE, il ne se paie pas tout seul : le joueur accepte ou refuse
   *  (acceptTool, declineTool). Ce n'est jamais une affaire d'absence — seul
   *  le passage joué sous les yeux du joueur ouvre la cale. */
  private offerTool(): void {
    const def = TOOLS.find((t) => t.age <= this.save.age && !this.save.tools.includes(t.id))
    if (!def || !this.canPayTool(def)) return
    this.toolOffer = def
    // Il laisse au joueur le temps de lire la fiche avant de reprendre la mer.
    const c = this.save.caravan
    c.visitLeft = Math.max(c.visitLeft, TOOL_OFFER_WAIT)
    this.emit({ type: 'caravanOffer', def })
  }

  private canPayTool(def: ToolDef): boolean {
    return Object.entries(def.price).every(
      ([res, n]) => this.unlocked.has(res as ResourceId) && this.amount(res as ResourceId) >= n,
    )
  }

  /** L'objet que le marchand tend, en attente de réponse. Hors sauvegarde :
   *  la barque repartie, l'offre retourne dans la cale. */
  toolOffer: ToolDef | null = null

  /** Le joueur accepte : il paie, l'outil entre au village. Refuse net si
   *  l'offre est tombée ou si les réserves ne suivent plus. */
  acceptTool(): boolean {
    const def = this.toolOffer
    if (!def || !this.save.caravan.visiting) return false
    if (!this.canPayTool(def)) return false
    this.toolOffer = null
    const paid: Partial<Record<ResourceId, number>> = {}
    for (const [res, n] of Object.entries(def.price) as [ResourceId, number][]) {
      this.save.res[res] = this.amount(res) - n
      paid[res] = n
    }
    this.save.tools.push(def.id)
    // Un outil change les taux : la simulation doit le savoir tout de suite,
    // sans quoi le gain n'apparaîtrait qu'au prochain savoir découvert.
    this.recompute()
    this.record('tool', `${def.name} entre au village — ${def.boon.toLowerCase()}.`)
    this.emit({ type: 'caravanTool', def, paid })
    writeSave(this.save, Date.now())
    return true
  }

  /** Le joueur refuse : l'objet reste dans la cale, rien n'est payé. Le
   *  marchand le reproposera à un prochain passage. */
  declineTool(): void {
    this.toolOffer = null
  }

  /** Part du rendement conservée en pleine nuit — la meilleure lumière connue. */
  get nightLight(): number {
    return this.nightFloor
  }

  get isNight(): boolean {
    return this.wasNight
  }

  /** L'heure où TOUT LE MONDE dort — colon et villageois. La lumière découverte
   *  ne fait que mordre sur le crépuscule et l'aube : elle allonge la veillée,
   *  elle n'abolit jamais la nuit. */
  get sleepTime(): boolean {
    const t = Math.min(1, Math.max(0, (this.nightFloor - NIGHT_BASE_FLOOR) / (1 - NIGHT_BASE_FLOOR)))
    return sunHeightAt(this.save.totalPlaySeconds) < SLEEP_DUSK + (SLEEP_DEEP - SLEEP_DUSK) * t
  }

  /** Le phare tient la passe : sans lui, aucune coque n'entre ni ne sort dans
   *  le noir. C'est la seule raison d'être d'une tour à feu. */
  get canSailAtNight(): boolean {
    return this.buildings.has('lighthouse')
  }

  /** La mer est-elle praticable ? Expéditions, barque marchande et navette du
   *  comptoir passent toutes par là. */
  get seaOpen(): boolean {
    return !this.wasNight || this.canSailAtNight
  }

  /** Un tap sur la barque avant la conclusion du troc améliore le prix. */
  haggle(): boolean {
    const c = this.save.caravan
    if (!c.visiting || c.haggled || c.traded) return false
    c.haggled = true
    return true
  }

  tick(dt: number, now: number): void {
    if (dt <= 0) return
    this.save.totalPlaySeconds += dt
    this.updateLight()
    this.refreshRates()

    if (this.encourageLeft > 0) {
      this.encourageLeft -= dt
      if (this.encourageLeft <= 0) {
        this.encourageLeft = 0
        this.refreshRates()
      }
    }
    if (this.encourageCooldown > 0) this.encourageCooldown = Math.max(0, this.encourageCooldown - dt)

    this.produce(dt)
    // La réserve d'une absence rentre au rythme du savoir produit : il coule
    // deux fois plus vite tant qu'elle dure. Encourager l'accélère, une
    // expédition l'arrête, comme la récolte.
    if (this.save.insightReserve > 0) {
      const d = Math.min(this.save.insightReserve, Math.max(0, this.rates.insight) * dt)
      this.save.res.insight = this.amount('insight') + d
      this.save.insightReserve -= d
    }

    const exp = this.save.expedition
    if (exp) {
      // Bornée à zéro : le voyage est fini, mais la barque peut attendre le
      // jour au large — le HUD affiche alors l'attente, pas un compte négatif.
      exp.remaining = Math.max(0, exp.remaining - dt)
      if (exp.remaining <= 0 && this.seaOpen) this.finishExpedition()
    }

    this.tickCaravan(dt)

    this.tickEvents(dt)
    this.tickWonder(dt)
    this.tickOutpost(dt)
    this.tickFeats(dt)
    this.tickSeason()

    this.saveAccumulator += dt
    if (this.saveAccumulator >= 5) {
      this.saveAccumulator = 0
      writeSave(this.save, now)
    }
  }

  flush(now: number): void {
    writeSave(this.save, now)
  }
}
