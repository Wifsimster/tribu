import {
  AGES,
  DAY_SECONDS,
  DAY_START,
  DESTINATION_BY_ID,
  DESTINATIONS,
  RELIC_BY_ID,
  RELICS,
  RESOURCES,
  TECHS,
  TECH_BY_ID,
  type AgeDef,
  type DestinationDef,
  type RelicDef,
  type ResourceId,
  type TechDef,
} from './content'
import { OFFLINE_CAP_SECONDS, emptySave, loadSave, writeSave, type SaveV1 } from './state'

export type GameEvent =
  | { type: 'tech'; tech: TechDef }
  | { type: 'age'; age: AgeDef }
  | { type: 'expeditionStart' }
  | { type: 'exodus'; legacy: number }
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
  | { type: 'offline'; seconds: number; gained: Partial<Record<ResourceId, number>> }
  | { type: 'caravanArrive'; merchant: string }
  | {
      type: 'caravanTrade'
      gave: { res: ResourceId; amount: number }
      got: { res: ResourceId; amount: number }
      insight: number
      tale: string | null
    }
  | { type: 'caravanLeave' }
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

const ENCOURAGE_SECONDS = 15
const ENCOURAGE_MULT = 2
const ENCOURAGE_COOLDOWN = 45

const EXPEDITION_SECONDS = 90
const EXPEDITION_FOOD_COST = 10

// Le commerce ouvre avec l'âge du bronze : le fait historique de la techno
// « bronze » explique déjà pourquoi (cuivre et étain ne gisent jamais ensemble).
const CARAVAN_AGE = 2
const CARAVAN_PERIOD = 210
const CARAVAN_VISIT = 26
const CARAVAN_OFFLINE_MAX = 3

const MERCHANTS = ['de Chypre', "d'Anatolie", 'du Levant', 'des Cyclades', "d'Égypte"]

/** Sans aucune lumière, la nuit ne laisse que 30 % du rendement. Le feu puis la
 *  lampe à graisse relèvent ce plancher via l'effet `nightFloor`. */
const NIGHT_BASE_FLOOR = 0.3

function smoothstep01(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Part de jour, même formule que le rendu : les deux doivent tomber d'accord
 *  sur l'heure qu'il est. */
export function daylightAt(totalPlaySeconds: number): number {
  const u = (DAY_START + totalPlaySeconds / DAY_SECONDS) % 1
  return smoothstep01(-0.06, 0.2, Math.sin(u * Math.PI * 2))
}

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
  private lightFactor = 1
  private wasNight = false

  constructor(now: number) {
    const { save, offlineSeconds } = loadSave(now)
    this.save = save
    this.unlocked = new Set<ResourceId>(['food', 'wood', 'stone', 'insight'])
    this.buildings = new Set()
    this.rates = { ...BASE_RATE, insight: 0 }
    this.recompute()

    if (offlineSeconds > 60) this.creditAbsence(offlineSeconds)
    this.catchUpAge()
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
    if (workSeconds > 0) {
      // Une absence couvre des cycles entiers : on produit au facteur moyen
      // (moitié jour, moitié nuit au plancher).
      this.lightFactor = (1 + this.nightFloor) / 2
      this.refreshRates()
      this.produce(workSeconds)
    }
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
    if (seconds > 90) this.emit({ type: 'offline', seconds, gained })
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
    this.nightFloor = NIGHT_BASE_FLOOR
    this.unlocked = new Set<ResourceId>(['food', 'wood', 'stone', 'insight'])
    this.buildings = new Set()

    for (const id of this.save.techs) {
      const tech = TECH_BY_ID.get(id)
      if (!tech) continue
      for (const e of tech.effects) {
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
    let material = 0
    for (const id of Object.keys(RESOURCES) as ResourceId[]) {
      if (id === 'insight') continue
      if (!this.unlocked.has(id)) {
        this.rates[id] = 0
        continue
      }
      const focusFactor = this.save.focus === id ? 1 : IDLE_FRACTION
      const r =
        BASE_RATE[id] * this.mult[id] * focusFactor * carryBonus * encourage * this.lightFactor * this.legacyBonus
      this.rates[id] = r
      material += r
    }
    // Knowledge grows out of what the tribe actually does, not out of nothing.
    this.rates.insight =
      (0.2 + this.insightAdd + material * 0.05) * encourage * this.lightFactor * this.legacyBonus
  }

  /** La nuit ralentit la tribu : le rendement glisse entre le plancher de nuit
   *  (selon la lumière découverte) et 1 en plein jour. */
  private updateLight(): void {
    const k = daylightAt(this.save.totalPlaySeconds)
    this.lightFactor = this.nightFloor + (1 - this.nightFloor) * k
    const night = this.wasNight ? k < 0.55 : k < 0.4 // hystérésis, comme le HUD
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
    this.emit({ type: 'tech', tech })
    this.checkAge()
    return true
  }

  private checkAge(): void {
    const { done, needed } = this.ageProgress()
    if (done >= needed && this.save.age < AGES.length - 1) {
      this.save.age += 1
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

  /** Les voyages s'allongent avec les âges — le monde à explorer grandit —
   *  et la vitesse AMORTIT au lieu de diviser : cumulées, les technos de
   *  vitesse atteignent ×63 et réduisaient tout voyage tardif au plancher,
   *  les rendant inutiles. Ici : ~90 s au Paléolithique, ~2 min à l'âge du
   *  fer équipé, ~4 min à l'ère contemporaine — et le butin suit la durée. */
  expeditionDuration(destId = 'cote'): number {
    const base = EXPEDITION_SECONDS + this.save.age * 45
    const damp = 0.45 + 0.55 / this.expeditionSpeed
    const k = DESTINATION_BY_ID.get(destId)?.durationK ?? 1
    return Math.max(45, base * damp * k)
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
    return this.boatTier >= (DESTINATION_BY_ID.get(destId)?.minTier ?? 0)
  }

  canExpedition(): boolean {
    return !this.save.expedition && this.amount('food') >= this.expeditionCost()
  }

  startExpedition(destId: DestinationDef['id'] = 'cote'): boolean {
    if (!this.canExpedition() || !this.canReach(destId)) return false
    this.save.res.food = this.amount('food') - this.expeditionCost()
    const total = this.expeditionDuration(destId)
    this.save.expedition = { remaining: total, total, dest: destId }
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
    const dest = DESTINATION_BY_ID.get(this.save.expedition?.dest ?? 'cote') ?? DESTINATIONS[1]!
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
    loot.insight = Math.round((12 + this.save.age * 25 + this.insightAdd * 20) * ratio * lootBias)
    for (const [id, n] of Object.entries(loot) as [ResourceId, number][]) {
      this.save.res[id] = this.amount(id) + n
    }
    // A find is flavour, not power: it is what the settler brings home to look at.
    const find = Math.random() < 0.35 ? (FINDS[Math.floor(Math.random() * FINDS.length)] ?? null) : null
    // Une relique pour le musée — jamais deux fois la même.
    let relic: RelicDef | null = null
    if (Math.random() < dest.relicChance) {
      const pool = RELICS.filter((r) => !this.save.relics.includes(r.id))
      relic = pool[Math.floor(Math.random() * pool.length)] ?? null
      if (relic) this.save.relics.push(relic.id)
    }
    const sights = SIGHTS[dest.id] ?? []
    const sight = sights[Math.floor(Math.random() * sights.length)] ?? 'la mer, longtemps'
    let journal = `${dest.name} — le colon a vu ${sight}.`
    if (setback)
      journal += ` Mais ${SETBACKS[Math.floor(Math.random() * SETBACKS.length)]}.`
    this.save.expedition = null
    this.refreshRates()
    this.emit({ type: 'expeditionEnd', loot, find, journal, relic, setback })
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
   *  remis à zéro — mais le musée voyage dans la cale, et une étoile de plus
   *  brille au-dessus de la récolte. */
  exodus(): boolean {
    if (!this.treeComplete) return false
    const relics = this.save.relics
    const legacy = this.save.legacy + 1
    this.save = { ...emptySave(Date.now()), relics, legacy }
    this.unlocked = new Set<ResourceId>(['food', 'wood', 'stone', 'insight'])
    this.buildings = new Set()
    this.encourageLeft = 0
    this.encourageCooldown = 0
    this.lastFact = null
    this.wasNight = false
    this.currentMerchant = ''
    this.recompute()
    writeSave(this.save, Date.now())
    this.emit({ type: 'exodus', legacy })
    return true
  }

  get relics(): RelicDef[] {
    return this.save.relics
      .map((id) => RELIC_BY_ID.get(id))
      .filter((r): r is RelicDef => !!r)
  }

  /** Les événements rares ne vivent qu'en direct : l'absence ne les simule
   *  pas — ce sont des raisons de REGARDER le jeu, pas des chiffres de plus. */
  private tickEvents(dt: number): void {
    if (this.save.age < 1) return
    this.save.eventIn -= dt
    if (this.save.eventIn > 0) return
    this.save.eventIn = 360 + Math.random() * 420
    const u = (DAY_START + this.save.totalPlaySeconds / DAY_SECONDS) % 1
    const day = u < 0.5
    const pool: ('wreck' | 'migration' | 'eclipse' | 'aurora' | 'merchant')[] = ['wreck']
    if (day) pool.push('migration', 'eclipse')
    else pool.push('aurora')
    if (this.save.age >= CARAVAN_AGE && !this.save.caravan.visiting) pool.push('merchant')
    const kind = pool[Math.floor(Math.random() * pool.length)]!
    if (kind === 'wreck') {
      const wood = Math.round(40 * (1 + this.save.age))
      const insight = Math.round(8 * (1 + this.save.age))
      this.save.res.wood = this.amount('wood') + wood
      this.save.res.insight = this.amount('insight') + insight
      this.emit({ type: 'worldEvent', kind, fact: EVENT_FACTS.wreck, loot: { wood, insight } })
      return
    }
    if (kind === 'merchant') {
      this.save.caravan.nextIn = Math.min(this.save.caravan.nextIn, 1)
      this.goldenTrade = true
    }
    this.emit({ type: 'worldEvent', kind, fact: EVENT_FACTS[kind] })
  }

  private tickCaravan(dt: number): void {
    if (this.save.age < CARAVAN_AGE) return
    const c = this.save.caravan
    if (!c.visiting) {
      c.nextIn -= dt
      if (c.nextIn <= 0) {
        c.visiting = true
        c.visitLeft = CARAVAN_VISIT
        c.haggled = false
        c.traded = false
        this.currentMerchant = MERCHANTS[Math.floor(Math.random() * MERCHANTS.length)] ?? ''
        this.emit({ type: 'caravanArrive', merchant: this.currentMerchant })
      }
      return
    }
    c.visitLeft -= dt
    // L'échange se conclut au milieu de la visite : le joueur a le temps de
    // marchander d'un tap avant que le prix soit fixé.
    if (!c.traded && c.visitLeft <= CARAVAN_VISIT * 0.5) {
      c.traded = true
      this.doTrade((c.haggled ? 1.3 : 1) * (this.goldenTrade ? 2.2 : 1), false)
    }
    if (c.visitLeft <= 0) {
      c.visiting = false
      c.nextIn = CARAVAN_PERIOD * (0.8 + Math.random() * 0.5)
      this.goldenTrade = false
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

    const gave = Math.min(this.amount(give) * 0.33, 40 + this.save.age * 50)
    const value = gave * price(give)
    const got = Math.max(1, Math.round((value * 0.75 * mult) / price(get)))
    const insight = Math.round((6 + this.save.age * 8) * mult)

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

  /** Part du rendement conservée en pleine nuit — la meilleure lumière connue. */
  get nightLight(): number {
    return this.nightFloor
  }

  get isNight(): boolean {
    return this.wasNight
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

    const exp = this.save.expedition
    if (exp) {
      exp.remaining -= dt
      if (exp.remaining <= 0) this.finishExpedition()
    }

    this.tickCaravan(dt)

    this.tickEvents(dt)

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
