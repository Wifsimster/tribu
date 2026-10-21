// Une partie neuve jouée par un joueur « raisonnable », sous Node, avec le
// vrai `Game` de src/game/sim.ts : il achète chaque savoir dès qu'il est
// abordable, travaille la ressource qui bloque le prochain savoir, encourage
// dès que le geste est prêt et pose chaque terre offerte. Relève quand chaque
// savoir devient abordable, quand il est acheté, quand chaque âge s'ouvre, et
// les stocks à ce moment-là. Sert la spec docs/specs/equilibrage-savoirs.md.
//
//   node --import ./tests/resolve-ts.mjs tools/sim-savoirs.mjs [options]
//
// Options :
//   --until=<âge>         s'arrête à l'ouverture de cet âge (défaut 3)
//   --max=<secondes>      plafond de temps actif (défaut 4 h)
//   --away=<t>:<s>        une absence de <s> secondes après <t> s de jeu actif
//                         (répétable : --away=1200:28800)
//   --night=3.70          nuit au tiers du cycle (horloge de la 3.70.0)
//   --rule=proposal       applique la règle de coût de la spec (sans toucher
//                         au code du jeu : les coûts sont recalculés ici)
//   --cycle=<jeu>:<abs>   sessions répétées : <jeu> s actives puis <abs> s
//                         d'absence, en boucle (le joueur occasionnel)
//   --from=human          part de la partie de l'humain (Néolithique, 6 savoirs,
//                         6,71 k de savoir) au lieu d'une partie neuve ; avec
//                         --rule=proposal, la migration de la spec s'applique
//   --no-encourage        joueur qui ne tape jamais « Encourager »
//   --json                sortie JSON au lieu du tableau
//   --seed=<n>            graine du hasard (défaut 7)

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { Game } = await import('../src/game/sim.ts')
const { TECHS, TECH_BY_ID, AGES, DAY_SECONDS } = await import('../src/game/content.ts')
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

// ── Hasard reproductible (même PRNG que tests/save-play.mjs) ──────────────
let a = SEED >>> 0
Math.random = () => {
  a = (a + 0x6d2b79f5) >>> 0
  let t = a
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// ── La nuit de la 3.70.0 : le jour couvre 2/3 du tour ─────────────────────
// Copie de la formule de src/game/clock.ts (branche feat/nuit-plus-courte),
// le temps qu'elle arrive sur master : c(u) = u + (S − ½)·sin²(πu).
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
if (args.night === '3.70') {
  const STRETCH = 2 / 3 - 0.5
  const cOf = (u) => u + STRETCH * Math.sin(Math.PI * u) ** 2
  const frac = (x) => x - Math.floor(x)
  const uOf = (c) => {
    const p = frac(c)
    let u = p
    for (let i = 0; i < 6; i++) u -= (cOf(u) - p) / (1 + STRETCH * Math.PI * Math.sin(2 * Math.PI * u))
    return frac(u)
  }
  const C0 = cOf(0.32)
  const dayAt = (s) => smooth(-0.06, 0.2, Math.sin(2 * Math.PI * uOf(C0 + s / DAY_SECONDS)))
  // Moyenne temporelle du facteur de lumière sur un tour, pour l'absence.
  const meanK = (() => {
    let sum = 0
    const N = 2400
    for (let i = 0; i < N; i++) sum += dayAt(((i + 0.5) / N) * DAY_SECONDS)
    return sum / N
  })()
  const P = Game.prototype
  P.updateLight = function () {
    const k = dayAt(this.save.totalPlaySeconds)
    this.lightFactor = this.nightFloor + (1 - this.nightFloor) * k
    const night = this.wasNight ? k < 0.55 : k < 0.4
    this.wasNight = night
  }
  // creditAbsence produit au facteur (1 + plancher)/2 ; on lui prête le
  // plancher qui donne la moyenne de la 3.70 : plancher + (1 − plancher)·k̄.
  const credit = P.creditAbsence
  P.creditAbsence = function (s) {
    const f = this.nightFloor
    const mean = f + (1 - f) * meanK
    this.nightFloor = 2 * mean - 1
    try {
      credit.call(this, s)
    } finally {
      this.nightFloor = f
    }
  }
}

// ── La règle proposée (voir la spec) ──────────────────────────────────────
const RULE = args.rule === 'proposal'
const rule = RULE ? await import('./savoirs-rule.mjs') : null
if (rule) rule.applyProposal(Game)

// ── La partie ─────────────────────────────────────────────────────────────
const log = []
const NOW = 1_800_000_000_000
if (args.from === 'human') {
  // La capture de l'humain (prod, 3.69.0) : Néolithique 0/4, lampe et
  // cordage connus. La pierre n'est pas lisible : on la met au niveau du bois.
  const s = emptySave(NOW)
  s.age = 1
  s.techs = ['flint', 'fire', 'shelter', 'spear', 'lamp', 'cordage']
  s.seenFacts = [...s.techs]
  s.res = { food: 16100, wood: 3170, stone: 3000, fiber: 9.3, insight: 6710 }
  s.totalPlaySeconds = 3600
  store.set(SAVE_KEY, JSON.stringify(s))
}
const g = new Game(NOW)
if (args.from === 'human' && rule) {
  // Taux moyen d'un cycle : celui que l'absence utilise.
  const lf = g.lightFactor
  g.lightFactor = (1 + g.nightFloor) / 2
  g.refreshRates()
  const mean = g.rates.insight
  g.lightFactor = lf
  g.refreshRates()
  rule.migrate(g, mean)
  log.push({ kind: 'migrate', t: 0, stock: { insight: Math.round(g.amount('insight')), reserve: Math.round(g.save.insightReserve) } })
}
const DT = 0.5
const firstAffordable = new Map()
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

/** Le prochain objectif : le savoir disponible le moins cher en savoir —
 *  c'est celui sur lequel la feuille de savoir s'ouvre. */
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
  if (g.save.focus !== best) g.setFocus(best)
}

function buyAll() {
  let bought = true
  while (bought) {
    bought = false
    const list = [...g.available()].sort((x, y) => costOf(x).insight - costOf(y).insight)
    for (const tech of list) {
      if (g.canResearch(tech) && !firstAffordable.has(tech.id)) firstAffordable.set(tech.id, t)
      if (g.research(tech.id)) {
        log.push({ kind: 'tech', id: tech.id, name: tech.name, age: tech.age, t, affordable: firstAffordable.get(tech.id) ?? t, stock: snap() })
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
    buyAll()
  }
  // Les savoirs que l'on PEUT acheter sont repérés avant l'achat : c'est
  // l'instant « abordable », celui qui compte pour le rythme.
  for (const tech of g.available()) if (!firstAffordable.has(tech.id) && g.canResearch(tech)) firstAffordable.set(tech.id, t)
  buyAll()
  while (g.landOffer) {
    g.chooseLand(g.landOffer.kinds[0], 20 * ++landSlot, 0)
  }
  chooseFocus()
  if (ENCOURAGE && g.canEncourage()) g.encourage()
  g.tick(DT, NOW + t * 1000)
  t += DT
  if (g.save.age !== lastAge) {
    lastAge = g.save.age
    log.push({ kind: 'age', age: lastAge, name: AGES[lastAge].name, t, stock: snap(), insightRate: +g.rates.insight.toFixed(3) })
    if (lastAge >= UNTIL) break
  }
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
if (args.json) {
  process.stdout.write(JSON.stringify({ args, log }, null, 1) + '\n')
} else {
  for (const e of log) {
    if (e.kind === 'tech')
      console.log(
        `${mmss(e.affordable).padStart(7)} abordable  ${mmss(e.t).padStart(7)} acheté  [${e.age}] ${e.name.padEnd(24)} stock ${JSON.stringify(e.stock)}`,
      )
    else if (e.kind === 'age') console.log(`${mmss(e.t).padStart(7)} ══ ${e.name} ══ savoir ${e.insightRate}/s  stock ${JSON.stringify(e.stock)}`)
    else if (e.kind === 'migrate') console.log(`   0:00 -- migration : ${JSON.stringify(e.stock)}`)
    else console.log(`${mmss(e.t).padStart(7)} -- absence ${(e.seconds / 3600).toFixed(1)} h : ${JSON.stringify(e.before)} → ${JSON.stringify(e.after)}`)
  }
  if (t >= MAX) console.log(`(arrêt au plafond ${mmss(MAX)})`)
}
