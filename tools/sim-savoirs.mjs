const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { Game, meanLightFactor } = await import('../src/game/sim.ts')
const { TECHS, TECH_BY_ID, AGES, WONDERS, WONDER_BY_AGE } = await import('../src/game/content.ts')
const { SAVE_KEY, emptySave } = await import('../src/game/state.ts')

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)
const aways = process.argv
  .slice(2)
  .filter((a) => a.startsWith('--away='))
  .map((a) => a.slice(7).split(':').map(Number))
const UNTIL = Number(args.until ?? 3)
const MAX = Number(args.max ?? 4 * 3600)
const ENCOURAGE = !args['no-encourage']
const SEED = Number(args.seed ?? 7)

let a = SEED >>> 0
Math.random = () => {
  a = (a + 0x6d2b79f5) >>> 0
  let t = a
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

if (args.night) console.error('(--night ignoré : depuis la 3.70.0, le jeu porte lui-même la nuit au tiers du cycle)')

const BUILT_IN = typeof Game.prototype.creditAbsentInsight === 'function'
const RULE = args.rule === 'proposal' && !BUILT_IN
if (args.rule === 'proposal' && BUILT_IN) console.error('(--rule=proposal ignoré : la règle est dans le jeu)')
const rule = RULE ? await import('./savoirs-rule.mjs') : null
if (rule) rule.applyProposal(Game)
if (args.costs === 'proportional') {
  const { PROPORTIONAL } = await import('./savoirs-rule.mjs')
  for (const t of TECHS) if (PROPORTIONAL[t.id]) t.materials = PROPORTIONAL[t.id]
}
{
  let table = null
  if (args.costs === '3.72') table = (await import('./savoirs-rule.mjs')).COSTS_372
  if (args.costs === '3.72.0') table = (await import('./savoirs-rule.mjs')).COSTS_3720
  if (args['costs-file']) table = JSON.parse((await import('node:fs')).readFileSync(args['costs-file'], 'utf8'))
  if (table) {
    for (const t of TECHS) {
      const c = table.techs?.[t.id]
      if (!c) continue
      if (c.cost) t.cost = c.cost
      if (c.materials) t.materials = c.materials
    }
    for (const w of WONDERS) {
      const c = table.wonders?.[w.age] ?? table.wonders?.[w.id]
      if (c) w.cost = c
    }
  }
}
if (args.wonders && args.wonders !== 'v1') throw new Error(`--wonders=${args.wonders} : seule la conduite v1 existe`)
const WONDERS_ON = args.wonders === 'v1'
const WONDER_FROM = Number(args['wonder-from'] ?? 3)

const eco = new Map()
const bucket = (age) => {
  if (!eco.has(age)) eco.set(age, { seconds: 0, made: {}, spent: {}, rates: null })
  return eco.get(age)
}
let active = false
{
  const P = Game.prototype
  const produce = P.produce
  P.produce = function (sec) {
    if (active) {
      const b = bucket(this.save.age)
      for (const [r, v] of Object.entries(this.rates)) if (v > 0) b.made[r] = (b.made[r] ?? 0) + v * sec
    }
    return produce.call(this, sec)
  }
  const research = P.research
  P.research = function (id) {
    const ok = research.call(this, id)
    if (ok) {
      const tech = TECH_BY_ID.get(id)
      const b = bucket(tech.age)
      b.spent.insight = (b.spent.insight ?? 0) + tech.cost
      for (const [r, n] of Object.entries(tech.materials ?? {})) b.spent[r] = (b.spent[r] ?? 0) + n
    }
    return ok
  }
  const tickWonder = P.tickWonder
  P.tickWonder = function (dt) {
    const cur = this.save.wonder
    const before = cur ? { ...cur.paid } : null
    tickWonder.call(this, dt)
    if (!cur || !active) return
    const b = bucket(cur.age)
    b.wonder ??= {}
    for (const [r, v] of Object.entries(cur.paid)) b.wonder[r] = (b.wonder[r] ?? 0) + v - (before[r] ?? 0)
  }
}

const log = []
const NOW = 1_800_000_000_000
if (args.from === 'human') {
  const s = emptySave(NOW)
  s.age = 1
  s.techs = ['flint', 'fire', 'shelter', 'spear', 'lamp', 'cordage']
  s.seenFacts = [...s.techs]
  s.res = { food: 16100, wood: 3170, stone: 3000, fiber: 9.3, insight: 6710 }
  s.totalPlaySeconds = 3600
  delete s.insightReserve
  store.set(SAVE_KEY, JSON.stringify(s))
}
const g = new Game(NOW)
if (args.from === 'human' && BUILT_IN)
  log.push({ kind: 'migrate', t: 0, stock: { insight: Math.round(g.amount('insight')), reserve: Math.round(g.save.insightReserve) } })
if (args.from === 'human' && rule) {
  const lf = g.lightFactor
  g.lightFactor = meanLightFactor(g.nightFloor)
  g.refreshRates()
  const mean = g.rates.insight
  g.lightFactor = lf
  g.refreshRates()
  rule.migrate(g, mean)
  log.push({ kind: 'migrate', t: 0, stock: { insight: Math.round(g.amount('insight')), reserve: Math.round(g.save.insightReserve) } })
}
const DT = 0.5
const firstAffordable = new Map()
const insightReady = new Map()
const RES = ['food', 'wood', 'stone', 'fiber', 'clay', 'copper', 'iron', 'insight']
const snap = () => {
  const o = Object.fromEntries(RES.map((r) => [r, Math.round(g.amount(r))]).filter(([, v]) => v > 0))
  if (g.save.insightReserve > 0.5) o.reserve = Math.round(g.save.insightReserve)
  return o
}
let landSlot = 0
let t = 0
const awayQueue = [...aways].sort((x, y) => x[0] - y[0])
if (args.cycle) {
  const [play, away] = String(args.cycle).split(':').map(Number)
  for (let k = play; k < MAX; k += play) awayQueue.push([k, away])
}
let lastAge = g.save.age
const timeline = []
const totalMade = (r) => [...eco.values()].reduce((s, b) => s + (b.made[r] ?? 0), 0)
let wondersDone = g.save.wonders.length
function noteWonders() {
  while (g.save.wonders.length > wondersDone) {
    const age = g.save.wonders[wondersDone++]
    log.push({ kind: 'wonderDone', age, name: WONDER_BY_AGE.get(age).name, t })
  }
}

const avail = {}
function noteAvail() {
  for (const tech of g.available()) {
    if (avail[tech.id]) continue
    const lf = g.lightFactor
    const enc = g.encourageLeft
    const focus = g.save.focus
    g.encourageLeft = 0
    g.lightFactor = meanLightFactor(g.nightFloor)
    const rates = {}
    for (const r of RES) {
      if (r === 'insight' || !g.unlocked.has(r)) continue
      g.save.focus = r
      g.refreshRates()
      rates[r] = +g.rates[r].toFixed(4)
    }
    g.save.focus = focus
    g.refreshRates()
    const insight = +g.rates.insight.toFixed(4)
    g.lightFactor = lf
    g.encourageLeft = enc
    g.refreshRates()
    avail[tech.id] = { t, insight, rates }
  }
}

const costOf = (tech) => (g.techCost ? g.techCost(tech) : { insight: tech.cost, ...(tech.materials ?? {}) })
const nextGoal = () => [...g.available()].sort((x, y) => costOf(x).insight - costOf(y).insight)[0]

function chooseFocus() {
  const goal = nextGoal()
  let best = 'food'
  let worst = 0
  if (goal) {
    const miss = g.missingFor(goal)
    for (const [r, n] of Object.entries(miss)) {
      if (r === 'insight' || !g.unlocked.has(r)) continue
      const focused = g.save.focus === r ? g.rates[r] : g.rates[r] / 0.3
      const wait = n / Math.max(1e-6, focused)
      if (wait > worst) {
        worst = wait
        best = r
      }
    }
  }
  const cur = g.save.wonder
  if (worst === 0 && WONDERS_ON && args['wonder-focus'] && cur) {
    const def = WONDER_BY_AGE.get(cur.age)
    for (const [r, total] of Object.entries(def.cost)) {
      const left = total - (cur.paid[r] ?? 0)
      if (left <= 0 || !g.unlocked.has(r)) continue
      const focused = g.save.focus === r ? g.rates[r] : g.rates[r] / 0.3
      const wait = left / Math.max(1e-6, focused)
      if (wait > worst) {
        worst = wait
        best = r
      }
    }
  }
  if (g.save.focus !== best) g.setFocus(best)
}

function meanInsight() {
  const lf = g.lightFactor
  const enc = g.encourageLeft
  g.encourageLeft = 0
  g.lightFactor = meanLightFactor(g.nightFloor)
  g.refreshRates()
  const insight = +g.rates.insight.toFixed(4)
  g.lightFactor = lf
  g.encourageLeft = enc
  g.refreshRates()
  return insight
}

function buyAll() {
  let bought = true
  while (bought) {
    bought = false
    const list = [...g.available()].sort((x, y) => costOf(x).insight - costOf(y).insight)
    for (const tech of list) {
      if (g.canResearch(tech) && !firstAffordable.has(tech.id)) firstAffordable.set(tech.id, t)
      if (g.research(tech.id)) {
        log.push({ kind: 'tech', id: tech.id, name: tech.name, age: tech.age, t, affordable: firstAffordable.get(tech.id) ?? t, insightReady: insightReady.get(tech.id) ?? t, cost: tech.cost, stock: snap(), meanInsight: meanInsight() })
        bought = true
        break
      }
    }
  }
}

while (t < MAX) {
  while (awayQueue.length && awayQueue[0][0] <= t) {
    const [, s] = awayQueue.shift()
    const before = snap()
    g.creditAbsence(s)
    log.push({ kind: 'away', t, seconds: s, before, after: snap() })
    noteWonders()
    buyAll()
  }
  for (const tech of g.available()) {
    if (!firstAffordable.has(tech.id) && g.canResearch(tech)) firstAffordable.set(tech.id, t)
    if (!insightReady.has(tech.id) && g.amount('insight') >= costOf(tech).insight) insightReady.set(tech.id, t)
  }
  buyAll()
  noteAvail()
  while (g.landOffer) {
    g.chooseLand(g.landOffer.kinds[0], 20 * ++landSlot, 0)
  }
  if (WONDERS_ON && !g.save.wonder && g.save.age >= WONDER_FROM && g.startWonder())
    log.push({ kind: 'wonderStart', age: g.save.age, name: WONDER_BY_AGE.get(g.save.age).name, t })
  if (args.focus !== 'food') chooseFocus()
  if (ENCOURAGE && g.canEncourage()) g.encourage()
  if (g.toolOffer) args['no-tools'] ? g.declineTool() : g.acceptTool()
  {
    const b = bucket(g.save.age)
    b.seconds += DT
    if (!b.rates) {
      b.rates = {}
      for (const r of RES) {
        if (r === 'insight' || !g.unlocked.has(r)) continue
        const f = g.save.focus === r
        b.rates[r] = { focus: f ? g.rates[r] : g.rates[r] / 0.3, idle: f ? g.rates[r] * 0.3 : g.rates[r] }
      }
    }
  }
  active = true
  g.tick(DT, NOW + t * 1000)
  active = false
  t += DT
  noteWonders()
  if (t % 10 === 0) timeline.push({ t, made: Object.fromEntries(RES.map((r) => [r, Math.round(totalMade(r))])) })
  if (g.save.age !== lastAge) {
    lastAge = g.save.age
    log.push({ kind: 'age', age: lastAge, name: AGES[lastAge].name, t, stock: snap(), insightRate: +g.rates.insight.toFixed(3) })
    if (lastAge >= UNTIL) break
  }
  if (g.available().length === 0) {
    log.push({ kind: 'end', age: g.save.age, t, stock: snap() })
    break
  }
}

function wonderSummary() {
  const entry = (age) => (age === 0 ? 0 : log.find((e) => e.kind === 'age' && e.age === age)?.t)
  const out = []
  for (const s of log.filter((e) => e.kind === 'wonderStart')) {
    const from = entry(s.age) ?? 0
    const to = entry(s.age + 1) ?? log.find((e) => e.kind === 'end')?.t ?? t
    const done = log.find((e) => e.kind === 'wonderDone' && e.age === s.age)?.t ?? null
    let progress = 1
    if (done == null) {
      const def = WONDER_BY_AGE.get(s.age)
      const paid = g.save.wonder?.age === s.age ? g.save.wonder.paid : {}
      const need = Object.values(def.cost).reduce((x, y) => x + y, 0)
      const got = Object.entries(def.cost).reduce((x, [r, n]) => x + Math.min(n, paid[r] ?? 0), 0)
      progress = got / need
    }
    out.push({ age: s.age, name: s.name, entry: from, length: to - from, start: s.t, done, share: done == null ? null : (done - from) / (to - from), progress })
  }
  return out
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
if (args.json) {
  process.stdout.write(JSON.stringify({ args, log, avail, timeline, wonders: wonderSummary() }) + '\n')
} else {
  for (const e of log) {
    if (e.kind === 'tech')
      console.log(
        `${mmss(e.affordable).padStart(7)} abordable  ${mmss(e.t).padStart(7)} acheté  [${e.age}] ${e.name.padEnd(24)}${e.affordable - e.insightReady >= 1 ? ` (matériaux +${mmss(e.affordable - e.insightReady)})` : ''} stock ${JSON.stringify(e.stock)}`,
      )
    else if (e.kind === 'age') console.log(`${mmss(e.t).padStart(7)} ══ ${e.name} ══ savoir ${e.insightRate}/s  stock ${JSON.stringify(e.stock)}`)
    else if (e.kind === 'migrate') console.log(`   0:00 -- migration : ${JSON.stringify(e.stock)}`)
    else if (e.kind === 'wonderStart') console.log(`${mmss(e.t).padStart(7)} ▲▲ chantier lancé : ${e.name}`)
    else if (e.kind === 'wonderDone') console.log(`${mmss(e.t).padStart(7)} ▲▲ achevée : ${e.name}`)
    else if (e.kind === 'end') console.log(`${mmss(e.t).padStart(7)} ══ fin de l'arbre ══ stock ${JSON.stringify(e.stock)}`)
    else console.log(`${mmss(e.t).padStart(7)} -- absence ${(e.seconds / 3600).toFixed(1)} h : ${JSON.stringify(e.before)} → ${JSON.stringify(e.after)}`)
  }
  if (t >= MAX) console.log(`(arrêt au plafond ${mmss(MAX)})`)
  if (WONDERS_ON) {
    console.log('\nMerveilles (jeu actif) : durée de l’âge, lancement et achèvement depuis l’entrée dans l’âge')
    for (const w of wonderSummary()) {
      const done = w.done == null ? `non achevée (${Math.round(w.progress * 100)} %)` : `achevée ${mmss(w.done - w.entry)} = ${Math.round(w.share * 100)} % de l’âge`
      console.log(`[${w.age}] ${w.name.padEnd(26)} âge ${mmss(w.length)}  lancée +${mmss(Math.max(0, w.start - w.entry))}  ${done}`)
    }
  }
  {
    const techs = log.filter((e) => e.kind === 'tech')
    const by = new Map()
    for (let i = 1; i < techs.length; i++) {
      const gap = techs[i].affordable - techs[i - 1].t
      const age = techs[i].age
      if (!by.has(age)) by.set(age, [])
      by.get(age).push(gap)
    }
    console.log('\nIntervalle entre deux savoirs (achat précédent → abordable), par âge du savoir')
    for (const [age, gaps] of [...by].sort((x, y) => x[0] - y[0]))
      console.log(`[${age}] ${mmss(Math.min(...gaps))}-${mmss(Math.max(...gaps))}  (${gaps.map(mmss).join(' ')})`)
  }
  if (args.eco) {
    console.log('\nBilan par âge (jeu actif) : produit / dépensé par les savoirs de l’âge = ratio')
    for (const [age, b] of [...eco].sort((x, y) => x[0] - y[0])) {
      console.log(`[${age}] ${AGES[age].name} — ${mmss(b.seconds)} de jeu`)
      for (const r of RES) {
        const made = b.made[r] ?? 0
        const spent = b.spent[r] ?? 0
        const wonder = Math.round(b.wonder?.[r] ?? 0)
        if (made < 0.5 && spent === 0) continue
        const ratio = spent > 0 ? (made / spent).toFixed(1) : '∞'
        const both = spent + wonder > 0 ? (made / (spent + wonder)).toFixed(1) : '∞'
        const rt = b.rates?.[r]
        const rates = rt ? `  focalisé ${rt.focus.toFixed(2)}/s, au repos ${rt.idle.toFixed(2)}/s` : ''
        const w = WONDERS_ON ? `  Merveille ${String(wonder).padStart(7)}  ×${both} avec elle` : ''
        console.log(`   ${r.padEnd(8)} produit ${String(Math.round(made)).padStart(8)}  dépensé ${String(spent).padStart(6)}  ×${ratio}${w}${rates}`)
      }
    }
  }
}
