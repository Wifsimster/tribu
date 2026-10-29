import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { AGES, TECHS, WONDERS, RELICS, FEATS, TOOLS, HALF_TECHS } = await import('../src/game/content.ts')

const YEAR = {
  flint: -3_300_000,
  fire: -780_000,
  shelter: -400_000,
  spear: -250_000,
  lamp: -17_000,
  cordage: -47_000,
  stalagmites: -176_500,
  agriculture: -9_500,
  pottery: -20_000,
  weaving: -27_000,
  polished_axe: -46_000,
  granary: -9_300,
  dolmen: -3_500,
  copper: -3_300,
  bronze: null,
  wheel: -3_500,
  writing: -3_400,
  sail: -3_100,
  ziggurat: -2_100,
  ironworking: -3_200,
  plough: null,
  alphabet: -1_050,
  coinage: -630,
  lighthouse: -458,
  aqueduct: -312,
  phare: -280,
  concrete: null,
  watermill: -25,
  glass: -50,
  roads: null,
  codex: 150,
  trophee: 113,
  horsecollar: null,
  threefield: null,
  windmill: 1180,
  clock: 1300,
  press: 1450,
  cathedrale: 1439,
  caravel: null,
  perspective: 1425,
  observatory: 1609,
  bank: null,
  anatomy: 1543,
  dome: 1436,
  steamengine: 1769,
  railway: 1830,
  gaslight: 1807,
  bessemer: 1856,
  telegraph: 1844,
  tour: 1889,
  electricity: 1907,
  automobile: 1908,
  radio: 1901,
  flight: 1903,
  penicillin: 1928,
  gratteciel: 1931,
  computer: 1977,
  satellite: null,
  internet: 1969,
  solar: 2020,
  smartphone: 2007,
  fusee: 1967,
  ai: 2017,
  storage: 2023,
  desal: null,
  crispr: 2012,
  carbon: null,
  quantum: null,
  fusion: 2022,
}

const PRECURSORS = {
  pottery: 'le fait dit « 8 500 ans avant l’agriculture »',
  weaving: 'le fait dit que le tissu précède de loin le métier à tisser',
  polished_axe: 'le fait dit qu’en Europe la technique n’arrive qu’au Néolithique',
  ironworking: 'perles de fer météoritique, « fer du ciel », bien avant la forge',
  perspective: 'la Renaissance commence à Florence avant la fin du Moyen Âge ailleurs',
  dome: 'idem : Brunelleschi, Florence, 1436',
}

const TODAY_FROM = 2000

function parseYear(s) {
  s = s.trim()
  if (s === 'nos jours') return Infinity
  if (s === "aujourd'hui") return TODAY_FROM
  if (s === 'demain') return Infinity
  const neg = s.startsWith('−')
  const millions = /millions?$/.test(s)
  const n = Number(s.replace(/^−/, '').replace(/\s*millions?$/, '').replace(/\s/g, '').replace(',', '.'))
  assert.ok(Number.isFinite(n), `période illisible : « ${s} »`)
  return (neg ? -1 : 1) * n * (millions ? 1e6 : 1)
}

function periodOf(age) {
  const [from, to] = AGES[age].period.split(' à ')
  assert.ok(from && to, `période de l'âge ${age} : « ${AGES[age].period} »`)
  return { from: parseYear(from), to: parseYear(to) }
}

test('les périodes des âges se lisent et se suivent sans trou ni recouvrement', () => {
  for (let i = 0; i < AGES.length; i++) {
    const p = periodOf(i)
    assert.ok(p.from < p.to, `${AGES[i].name} : ${AGES[i].period}`)
    if (i > 0 && i < AGES.length - 1) assert.equal(p.from, periodOf(i - 1).to, `${AGES[i].name} commence où finit ${AGES[i - 1].name}`)
  }
})

test('chaque savoir et chaque Merveille a sa date dans la table', () => {
  const ids = [...TECHS.map((t) => t.id), ...WONDERS.map((w) => w.id)].sort()
  assert.deepEqual(Object.keys(YEAR).sort(), ids)
})

test('chaque fait daté tombe dans la période de son âge (précurseurs listés à part)', () => {
  const items = [...TECHS, ...WONDERS]
  const out = []
  for (const it of items) {
    const y = YEAR[it.id]
    if (y === null) continue
    const { from, to } = periodOf(it.age)
    const inside = y >= from && y <= to
    if (PRECURSORS[it.id]) {
      assert.ok(y < from, `${it.id} est listé comme précurseur mais tombe dans son âge : retire-le de la liste`)
      continue
    }
    if (!inside) out.push(`${it.id} (${y}) hors de ${AGES[it.age].name}, ${AGES[it.age].period}`)
  }
  assert.deepEqual(out, [])
})

test('la date de la table est bien celle qu’écrit le fait', () => {
  const nb = (s) => s.replace(/\u202f|\u00a0/g, ' ')
  const OTHER = {
    spear: '300 000 ans',
    cordage: '50 000 ans',
    polished_axe: '49 000 ans',
    stalagmites: '176 500 ans',
    granary: '11 300 ans',
    dolmen: '5 000 ans',
    glass: 'Ier siècle avant notre ère',
    codex: 'IIe siècle',
    cathedrale: '424 ans',
    solar: 'la moins chère',
    lamp: 'Lascaux',
    lighthouse: "l'Agamemnon d'Eschyle",
  }
  const missing = []
  for (const it of [...TECHS, ...WONDERS]) {
    const y = YEAR[it.id]
    if (y === null) continue
    const text = nb(it.fact)
    const forms = [y < 0 ? `−${-y}` : String(y), nb(Math.abs(y).toLocaleString('fr-FR'))]
    if (y <= -1e6) forms.push(`${String(-y / 1e6).replace('.', ',')} millions`)
    if (OTHER[it.id]) forms.push(OTHER[it.id])
    if (!forms.some((f) => text.includes(f))) missing.push(`${it.id} (${y}) : « ${text.slice(0, 70)}… »`)
  }
  assert.deepEqual(missing, [])
})

test('la monnaie lydienne porte la même date partout', () => {
  const coin = TECHS.find((t) => t.id === 'coinage')
  const relic = RELICS.find((r) => r.id === 'monnaie')
  assert.match(coin.fact, /Lydie vers −630/)
  assert.match(relic.fact, /Lydie vers −630/)
})

test('le phare d’Alexandrie à l’âge du fer, la colonne Trajane à l’Antiquité', () => {
  assert.equal(WONDERS.find((w) => w.id === 'phare').age, 3)
  assert.equal(WONDERS.find((w) => w.id === 'trophee').age, 4)
  assert.deepEqual(WONDERS.map((w) => w.age), AGES.map((a) => a.id))
})

const words = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)

function overlap(a, b) {
  const A = new Set(words(a))
  const B = new Set(words(b))
  let n = 0
  for (const w of A) if (B.has(w)) n++
  return n / Math.min(A.size, B.size)
}

test('chaque savoir a son anecdote, et elle ne redit pas le fait', () => {
  for (const t of TECHS) {
    assert.ok(t.funFact && t.funFact.trim().length > 40, `${t.id} : anecdote absente ou vide`)
    assert.notEqual(t.funFact.trim(), t.fact.trim(), `${t.id} : anecdote = fait`)
    const o = overlap(t.fact, t.funFact)
    assert.ok(o < 0.4, `${t.id} : l'anecdote reprend ${Math.round(o * 100)} % des mots du fait`)
  }
})

test('aucun texte historique n’est vide', () => {
  for (const x of [...TECHS, ...WONDERS, ...RELICS, ...TOOLS]) assert.ok(x.fact.trim().length > 40, x.id)
})

const FR = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize']

test('index.html compte les vrais savoirs et les vrais hauts faits', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const counts = [...html.matchAll(/(\d+) (?:découvertes|savoirs)/g)].map((m) => Number(m[1]))
  assert.ok(counts.length >= 3, 'les trois mentions du nombre de savoirs')
  for (const n of counts) assert.equal(n, TECHS.length)
  const jalons = [...html.matchAll(/(\p{L}+) jalons/gu)].map((m) => m[1].toLowerCase())
  assert.deepEqual(jalons, [FR[FEATS.length]])
})

test('le HUD d’avant le premier rendu affiche la vraie période du Paléolithique', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  assert.match(html, new RegExp(`id="age-period">${AGES[0].period}<`))
})

test('les hauts faits disent les vrais nombres', () => {
  assert.equal(HALF_TECHS, Math.ceil(TECHS.length / 2))
  const desc = (id) => FEATS.find((f) => f.id === id).desc
  assert.match(desc('michemin'), new RegExp(`\\b${HALF_TECHS} savoirs`))
  assert.match(desc('musee'), new RegExp(`\\b${RELICS.length} reliques`))
  assert.match(desc('atelier'), new RegExp(`\\b${FR[TOOLS.length]} outils`))
})
