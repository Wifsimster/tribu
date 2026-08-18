import {
  AGES,
  RESOURCES,
  TECHS,
  TECH_BY_ID,
  type AgeDef,
  type ResourceId,
  type TechDef,
} from './content'
import { emptySave, loadSave, writeSave, type SaveV1 } from './state'

export type GameEvent =
  | { type: 'tech'; tech: TechDef }
  | { type: 'age'; age: AgeDef }
  | { type: 'expeditionStart' }
  | { type: 'expeditionEnd'; loot: Partial<Record<ResourceId, number>>; find: string | null }
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

/** Le marchand paie en histoires autant qu'en métal : chaque anecdote est un
 *  fait de commerce ancien réel. */
const TRADE_TALES = [
  "l'épave d'Uluburun, coulée vers −1300, portait dix tonnes de cuivre chypriote et une tonne d'étain",
  "l'étain des Cornouailles voyageait jusqu'à la Méditerranée orientale, de comptoir en comptoir",
  "le lapis-lazuli des mines d'Afghanistan ornait déjà les tombes égyptiennes vers −3000",
  'à Kanesh, en Anatolie, les marchands assyriens tenaient leurs comptes et leurs prêts à intérêt sur tablettes, vers −1900',
  "de l'ambre de la Baltique a été retrouvé dans la tombe de Toutânkhamon",
]

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

  constructor(now: number) {
    const { save, offlineSeconds } = loadSave(now)
    this.save = save
    this.unlocked = new Set<ResourceId>(['food', 'wood', 'stone', 'insight'])
    this.buildings = new Set()
    this.rates = { ...BASE_RATE, insight: 0 }
    this.recompute()

    if (offlineSeconds > 60) {
      const before = { ...this.save.res }
      this.produce(offlineSeconds)
      // Le commerce continue sans le joueur : quelques passages de barque sont
      // crédités en silence, plafonnés pour ne pas vider les stocks du retour.
      if (this.save.age >= CARAVAN_AGE) {
        const visits = Math.min(CARAVAN_OFFLINE_MAX, Math.floor(offlineSeconds / CARAVAN_PERIOD))
        for (let i = 0; i < visits; i++) this.doTrade(1, true)
      }
      const gained: Partial<Record<ResourceId, number>> = {}
      for (const id of Object.keys(this.save.res) as ResourceId[]) {
        const delta = (this.save.res[id] ?? 0) - (before[id] ?? 0)
        if (delta > 0.5) gained[id] = delta
      }
      this.emit({ type: 'offline', seconds: offlineSeconds, gained })
    }
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
        }
      }
    }
    this.mult = mult
    this.refreshRates()
  }

  private refreshRates(): void {
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
      const r = BASE_RATE[id] * this.mult[id] * focusFactor * carryBonus * encourage
      this.rates[id] = r
      material += r
    }
    // Knowledge grows out of what the tribe actually does, not out of nothing.
    this.rates.insight = (0.2 + this.insightAdd + material * 0.05) * encourage
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
    return !this.knows(t.id) && this.amount('insight') >= t.cost
  }

  research(id: string): boolean {
    const tech = TECH_BY_ID.get(id)
    if (!tech || !this.canResearch(tech)) return false
    this.save.res.insight = this.amount('insight') - tech.cost
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

  expeditionDuration(): number {
    return EXPEDITION_SECONDS / this.expeditionSpeed
  }

  canExpedition(): boolean {
    return !this.save.expedition && this.amount('food') >= EXPEDITION_FOOD_COST
  }

  startExpedition(): boolean {
    if (!this.canExpedition()) return false
    this.save.res.food = this.amount('food') - EXPEDITION_FOOD_COST
    const total = this.expeditionDuration()
    this.save.expedition = { remaining: total, total }
    this.emit({ type: 'expeditionStart' })
    return true
  }

  private finishExpedition(): void {
    const loot: Partial<Record<ResourceId, number>> = {}
    const scale = 40 + this.save.age * 60
    for (const id of this.unlocked) {
      if (id === 'insight') continue
      loot[id] = Math.round(scale * BASE_RATE[id] * this.mult[id])
    }
    loot.insight = Math.round(12 + this.save.age * 25 + this.insightAdd * 20)
    for (const [id, n] of Object.entries(loot) as [ResourceId, number][]) {
      this.save.res[id] = this.amount(id) + n
    }
    // A find is flavour, not power: it is what the settler brings home to look at.
    const find = Math.random() < 0.35 ? (FINDS[Math.floor(Math.random() * FINDS.length)] ?? null) : null
    this.save.expedition = null
    this.emit({ type: 'expeditionEnd', loot, find })
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
      this.doTrade(c.haggled ? 1.3 : 1, false)
    }
    if (c.visitLeft <= 0) {
      c.visiting = false
      c.nextIn = CARAVAN_PERIOD * (0.8 + Math.random() * 0.5)
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
