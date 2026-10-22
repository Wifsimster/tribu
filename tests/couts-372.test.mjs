// Les coûts de la 3.72.0 (docs/specs/equilibrage-savoirs.md, section 10) :
// la table de content.ts est celle de la spec, un chantier déjà payé au-delà
// des nouveaux coûts s'achève au chargement, un rechargement rapide ne
// recrédite pas l'absence, chaque Merveille s'achève dans son âge chez le
// joueur de référence du simulateur, et le chantier n'affame jamais les savoirs.
//   corepack pnpm test
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { Game } = await import('../src/game/sim.ts')
const { SAVE_KEY, emptySave } = await import('../src/game/state.ts')
const { TECHS, TECH_BY_ID, WONDERS, WONDER_BY_AGE, TOOLS } = await import('../src/game/content.ts')
const { COSTS_3720 } = await import('../tools/savoirs-rule.mjs')

const NOW = 1_800_000_000_000
const MATERIALS = ['food', 'wood', 'stone', 'fiber', 'clay', 'copper', 'iron']

beforeEach(() => store.clear())

function saveAt(age, patch = {}) {
  const s = emptySave(NOW)
  s.seed = 7
  s.age = age
  s.techs = TECHS.filter((t) => t.age < age).map((t) => t.id)
  s.tools = TOOLS.filter((t) => t.age < age).map((t) => t.id)
  s.eventIn = 1e9
  s.caravan.nextIn = 1e9
  return Object.assign(s, patch)
}

// ── Critère 13 : content.ts = la table de la spec
test('content.ts porte la table COSTS_3720 (savoirs des âges 3 à 10, Merveilles 0 à 10)', () => {
  for (const [id, c] of Object.entries(COSTS_3720.techs)) {
    const t = TECH_BY_ID.get(id)
    assert.ok(t, id)
    if (c.cost) assert.equal(t.cost, c.cost, `${id} : coût en savoir`)
    assert.deepEqual(t.materials, c.materials, `${id} : matériaux`)
  }
  for (const t of TECHS.filter((t) => t.age >= 4)) assert.ok(COSTS_3720.techs[t.id], `${t.id} absent de la table`)
  for (const w of WONDERS) assert.deepEqual(w.cost, COSTS_3720.wonders[w.age], `Merveille de l'âge ${w.age}`)
  // L'Imprimerie (vers 1450) vient avant la Caravelle (fin du XVe siècle).
  assert.ok(TECH_BY_ID.get('press').cost <= TECH_BY_ID.get('caravel').cost, 'Imprimerie ≤ Caravelle')
})

/** « 1 600 » → 1600 ; « 3 700 nourriture, 15 fer » → { food: 3700, iron: 15 }. */
const NAMES = { nourriture: 'food', bois: 'wood', pierre: 'stone', fibre: 'fiber', fibres: 'fiber', argile: 'clay', cuivre: 'copper', fer: 'iron' }
const num = (s) => Number(s.replace(/[\s  *]/g, ''))
function parseMaterials(cell) {
  const out = {}
  for (const part of cell.split(',')) {
    const m = part.trim().match(/^([\d   ]+)\s+(\S+)$/)
    assert.ok(m, `matériau illisible : « ${part} »`)
    out[NAMES[m[2]]] = num(m[1])
  }
  return out
}

test('la table 10.10 de la spec est celle de content.ts', () => {
  const md = readFileSync(new URL('../docs/specs/equilibrage-savoirs.md', import.meta.url), 'utf8')
  const sec = md.slice(md.indexOf('### 10.10'), md.indexOf('### 10.11'))
  assert.ok(sec.length > 100, 'section 10.10 introuvable')
  const byName = new Map(TECHS.map((t) => [t.name, t]))
  const wonderByName = new Map(WONDERS.map((w) => [w.name, w]))
  let techs = 0
  let wonders = 0
  for (const line of sec.split('\n')) {
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (cells.length < 4) continue
    const [, name] = cells
    const t = byName.get(name)
    const w = wonderByName.get(name)
    if (t) {
      // | âge | savoir | coût en savoir | matériaux |
      assert.equal(num(cells[2].split('→').pop()), t.cost, `${name} : coût`)
      assert.deepEqual(parseMaterials(cells[3]), t.materials, `${name} : matériaux`)
      techs++
    } else if (w) {
      // | âge | Merveille | coût |
      assert.deepEqual(parseMaterials(cells[2]), w.cost, `${name} : coût`)
      wonders++
    }
  }
  assert.equal(techs, Object.keys(COSTS_3720.techs).length, 'savoirs de la table')
  assert.equal(wonders, WONDERS.length, 'Merveilles de la table')
})

// ── Critère 18 : un chantier déjà payé s'achève au chargement, une fois
test('chantier payé au-delà des nouveaux coûts : achevé au chargement, bonus +4 %, rien n’est retiré', () => {
  const def = WONDER_BY_AGE.get(7)
  // Ce qu'un chantier de la 3.71 avait pu verser : plus que la table 3.72.0
  // sur chaque matériau, moins que l'ancien coût.
  const paid = Object.fromEntries(Object.entries(def.cost).map(([r, n]) => [r, n * 1.5]))
  const res = { food: 1e6, wood: 1e5, stone: 1e5, fiber: 1e4, clay: 1e4, copper: 1e4, iron: 1e4, insight: 0 }
  store.set(SAVE_KEY, JSON.stringify(saveAt(7, { res: { ...res }, wonder: { age: 7, paid } })))
  // Le même camp sans le chantier : la référence du bonus.
  const ref = (() => {
    store.set('ref', store.get(SAVE_KEY))
    const s = JSON.parse(store.get(SAVE_KEY))
    s.wonder = null
    store.set(SAVE_KEY, JSON.stringify(s))
    const g = new Game(NOW)
    store.set(SAVE_KEY, store.get('ref'))
    return g
  })()
  const g = new Game(NOW)
  const events = []
  g.on((e) => events.push(e))
  assert.equal(g.save.wonder, null, 'le chantier est fermé')
  assert.deepEqual(g.save.wonders, [7])
  for (const r of MATERIALS) assert.equal(g.amount(r), res[r], `${r} : rien n’est retiré ni rendu`)
  assert.ok(Math.abs(g.rates.food / ref.rates.food - 1.04) < 1e-9, `bonus ${g.rates.food / ref.rates.food}`)
  assert.equal(events.filter((e) => e.type === 'wonderDone').length, 1, 'annoncé une fois')
  assert.ok(g.save.chronicle.some((c) => c.x === `${def.name} est achevée`))
  // Une seule fois : sauvegardée, rechargée, tickée, la Merveille reste comptée une fois.
  g.flush(NOW)
  const again = new Game(NOW)
  const ev2 = []
  again.on((e) => ev2.push(e))
  for (let i = 0; i < 20; i++) again.tick(0.5, NOW)
  assert.deepEqual(again.save.wonders, [7])
  assert.equal(ev2.filter((e) => e.type === 'wonderDone').length, 0)
  // L'âge suivant peut lancer la sienne.
  assert.equal(again.startWonder(), false, 'pas deux fois la même')
})

test('chantier pas encore couvert par les nouveaux coûts : il continue', () => {
  const def = WONDER_BY_AGE.get(7)
  const paid = Object.fromEntries(Object.entries(def.cost).map(([r, n]) => [r, n * 0.5]))
  store.set(SAVE_KEY, JSON.stringify(saveAt(7, { wonder: { age: 7, paid } })))
  const g = new Game(NOW)
  assert.deepEqual(g.save.wonder?.paid, paid)
  assert.deepEqual(g.save.wonders, [])
})

// ── Le chantier cède aux savoirs
test('le chantier ne prend pas le matériau qu’un savoir payable en savoir attend', () => {
  // Âge du bronze, ziggourat en cours : la Métallurgie du cuivre (450 de
  // savoir, 130 pierre, 120 bois, 640 nourriture) a son savoir, pas son bois.
  const res = { food: 5000, wood: 60, stone: 2000, fiber: 100, clay: 500, insight: 600 }
  store.set(SAVE_KEY, JSON.stringify(saveAt(2, { res, wonder: { age: 2, paid: {} } })))
  const g = new Game(NOW)
  const copper = TECH_BY_ID.get('copper')
  assert.ok(g.available().includes(copper))
  assert.ok(!g.canResearch(copper), 'il manque du bois')
  for (let i = 0; i < 60; i++) g.tick(0.5, NOW + i * 500)
  assert.equal(g.save.wonder.paid.wood ?? 0, 0, 'pas un brin de bois pour la ziggourat')
  assert.ok(g.amount('wood') > 60, 'le bois remonte')
  assert.ok((g.save.wonder.paid.stone ?? 0) > 0, 'la pierre en trop part au chantier')
  assert.ok(g.amount('stone') >= copper.materials.stone, 'jamais sous ce que le savoir demande')
  const wood = g.wonderDetail().lines.find((l) => l.id === 'wood')
  assert.equal(wood.held, true)
  assert.equal(wood.forTechs, true)
  assert.equal(wood.flow, 0)
})

// ── La carte du chantier lit le même plancher que le chantier
test('la carte du chantier ne montre aucun débit sous le plancher de 10 + 30 par âge', () => {
  // Antiquité, colonne trophée en cours : un matériau que les savoirs de
  // l'âge ne réclament pas (ou moins que le plancher), tenu sous 130. Jusqu'à
  // la 3.72.0, la carte lui donnait un débit et une échéance que le chantier
  // ne tenait pas.
  const age = 4
  const base = 10 + 30 * age
  const res = { food: 1e6, wood: 1e5, stone: 1e5, fiber: 1e4, clay: 1e4, copper: 1e4, iron: 1e4, insight: 0 }
  store.set(SAVE_KEY, JSON.stringify(saveAt(age, { res, wonder: { age, paid: {} } })))
  const g = new Game(NOW)
  const kept = g.techReserve()
  const id = Object.keys(WONDER_BY_AGE.get(age).cost).find((m) => (kept[m] ?? 0) < base)
  assert.ok(id, 'un matériau de la colonne sous le seul plancher de base')
  g.save.res[id] = base - 20
  const line = g.wonderDetail().lines.find((l) => l.id === id)
  assert.equal(line.floor, base)
  assert.equal(line.held, true)
  assert.equal(line.forTechs, false)
  assert.equal(line.flow, 0)
  assert.equal(line.eta, Infinity)
  // Et le chantier, sur le même stock, ne prélève rien.
  g.tick(0.05, NOW + 50)
  assert.equal(g.save.wonder.paid[id] ?? 0, 0, 'rien versé sous le plancher')
  // Au-dessus du plancher, la carte et le chantier reprennent ensemble.
  g.save.res[id] = base + 500
  const up = g.wonderDetail().lines.find((l) => l.id === id)
  assert.equal(up.held, false)
  assert.ok(up.flow > 0 && Number.isFinite(up.eta))
  g.tick(0.5, NOW + 600)
  assert.ok((g.save.wonder.paid[id] ?? 0) > 0, 'versé au-dessus du plancher')
})

// ── Le marchand suit la même règle
test('le marchand ne vend pas un outil payé dans ce que les savoirs de l’âge attendent', () => {
  // Âge du fer, Forge du fer connue : le sel coûte 400 nourriture, 200 argile
  // et 300 bois. La Charrue a son savoir et demande 220 bois : payer le sel
  // avec 400 bois en laisserait 100.
  const sel = TOOLS.find((t) => t.id === 'sel')
  const caravan = { nextIn: 1e9, visiting: true, visitLeft: 30, haggled: false, traded: true }
  const res = { food: 1e6, wood: 400, stone: 5000, fiber: 1000, clay: 5000, copper: 1000, iron: 1000, insight: 2000 }
  const s = saveAt(3, { res, caravan })
  s.techs.push('ironworking')
  store.set(SAVE_KEY, JSON.stringify(s))
  const g = new Game(NOW)
  assert.ok(g.techReserve().wood >= TECH_BY_ID.get('plough').materials.wood)
  g.offerTool()
  assert.equal(g.toolOffer, null, 'pas d’offre')
  // Déjà proposé (les stocks ont baissé depuis) : l'achat est refusé, rien n'est payé.
  g.toolOffer = sel
  assert.equal(g.acceptTool(), false)
  assert.equal(g.amount('wood'), 400)
  assert.ok(!g.save.tools.includes('sel'))
  // Assez de bois pour les deux : il vend.
  g.save.res.wood = 5000
  g.toolOffer = null
  g.offerTool()
  assert.equal(g.toolOffer, sel)
  assert.equal(g.acceptTool(), true)
  assert.equal(g.amount('wood'), 4700)
})

// ── Bug de la 3.71.1 : un rechargement dans les 5 s recréditait l'absence
test('absence créditée au chargement : la sauvegarde est réécrite, un rechargement à +3 s ne recrédite rien', () => {
  const s = saveAt(3, { res: { food: 100, wood: 100, stone: 100, fiber: 10, clay: 10, copper: 10, iron: 10, insight: 0 } })
  s.t = NOW - 2 * 3600 * 1000
  store.set(SAVE_KEY, JSON.stringify(s))
  const g = new Game(NOW)
  const food = g.amount('food')
  assert.ok(food > 1000, `l’absence est créditée (${food})`)
  assert.equal(JSON.parse(store.get(SAVE_KEY)).t, NOW, 'sauvegarde datée du retour')
  // Rechargé 3 s plus tard, avant la première sauvegarde de la boucle.
  const reload = new Game(NOW + 3000)
  assert.equal(reload.amount('food'), food, 'pas de second crédit')
  assert.equal(reload.amount('insight'), g.amount('insight'))
  assert.equal(reload.save.insightReserve, g.save.insightReserve)
})

const simulate = (...extra) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      ['--import', './tests/resolve-ts.mjs', 'tools/sim-savoirs.mjs', '--no-encourage', '--until=11', '--max=200000', '--json', ...extra],
      { cwd: new URL('..', import.meta.url), maxBuffer: 1 << 28, encoding: 'utf8' },
    ),
  )

// ── Critère 14 : chaque Merveille s'achève dans son âge (simulateur)
test('simulateur, joueur de référence : chaque Merveille lancée à l’entrée de son âge s’achève à 80-86 % de l’âge', { timeout: 600_000 }, () => {
  const out = simulate('--wonders=v1', '--wonder-from=0')
  assert.equal(out.wonders.length, WONDERS.length, 'toutes lancées')
  for (const w of out.wonders) {
    assert.ok(w.start - w.entry < 1, `${w.name} lancée à +${w.start - w.entry} s`)
    assert.ok(w.share != null && w.share >= 0.7 && w.share <= 0.9, `${w.name} : ${w.share == null ? 'non achevée' : Math.round(w.share * 100) + ' %'}`)
    // La cible de l'outil (WONDER_TARGET, 83 %) : 80 à 86 %.
    assert.ok(w.share >= 0.8 && w.share <= 0.86, `${w.name} : ${(w.share * 100).toFixed(1)} %, hors de 80-86 %`)
  }
})

// ── Critère 21 : le rythme des âges recalés
test('simulateur, avec et sans Merveilles, avec et sans changer de récolte : aux âges 4 à 10, un savoir toutes les 7:30 à 15:00', { timeout: 600_000 }, () => {
  for (const extra of [[], ['--wonders=v1', '--wonder-from=0'], ['--focus=food'], ['--wonders=v1', '--wonder-from=0', '--focus=food']]) {
    const techs = simulate(...extra).log.filter((e) => e.kind === 'tech')
    assert.equal(techs.length, TECHS.length, 'tout l’arbre')
    for (let i = 1; i < techs.length; i++) {
      if (techs[i].age < 4) continue
      const gap = techs[i].affordable - techs[i - 1].t
      assert.ok(gap >= 450 && gap <= 900, `${techs[i].name} (${extra.join(' ') || 'sans Merveille'}) : ${gap} s`)
    }
  }
})

// ── Critère 24 : ni le chantier ni le marchand n'affament le joueur qui ne
// change jamais de récolte.
test('simulateur, --focus=food avec les onze Merveilles et les outils : au plus 2 min d’attente de matériau par âge', { timeout: 600_000 }, () => {
  const techs = simulate('--wonders=v1', '--wonder-from=0', '--focus=food').log.filter((e) => e.kind === 'tech')
  assert.equal(techs.length, TECHS.length, 'tout l’arbre')
  const waits = new Map()
  for (const e of techs) waits.set(e.age, (waits.get(e.age) ?? 0) + e.affordable - e.insightReady)
  for (const [age, s] of waits) assert.ok(s <= 120, `âge ${age} : ${s} s d’attente de matériau`)
})
