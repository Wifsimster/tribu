import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { TECHS, WONDERS } = await import('../src/game/content.ts')
const { COSTS_372, WEIGHTS_372, PLOUGH_T, WONDER_SHARE, WONDER_TARGET, INSIGHT_AGES, INSIGHT_T, wonderCost, proportionalCost, nice3 } = await import('./savoirs-rule.mjs')

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')))
const ROUNDS = Number(args.rounds ?? 6)
const V3720 = args.v === '3.72.0'
const WONDER_FROM = V3720 ? 0 : 3
const RETUNE = V3720 ? INSIGHT_AGES : []
const dir = mkdtempSync(join(tmpdir(), 'couts-'))

function run(tablePath, wonders) {
  const argv = ['--import', './tests/resolve-ts.mjs', 'tools/sim-savoirs.mjs', '--no-encourage', '--until=11', '--max=200000', '--json']
  if (tablePath) argv.push(`--costs-file=${tablePath}`)
  if (wonders) argv.push('--wonders=v1', `--wonder-from=${WONDER_FROM}`)
  return JSON.parse(execFileSync(process.execPath, argv, { maxBuffer: 1 << 28, encoding: 'utf8' }))
}

function madeAt(timeline, at) {
  let best = { made: {} }
  for (const p of timeline) {
    if (p.t > at) break
    best = p
  }
  return best.made
}

function retunedCost(out, id) {
  const bought = out.log.filter((e) => e.kind === 'tech')
  const i = bought.findIndex((e) => e.id === id)
  if (i <= 0) return null
  const prev = bought[i - 1]
  const wait = bought[i].insightReady - prev.t
  if (!(wait >= 30)) return null
  const rate = (bought[i].cost - (prev.stock.insight ?? 0)) / wait
  return nice3(INSIGHT_T * rate)
}

function nextTable(out) {
  const techs = {}
  const ploughCost = V3720 ? COSTS_372.techs.plough.cost : nice3(PLOUGH_T * out.avail.plough.insight)
  for (const t of TECHS) {
    const retune = RETUNE.includes(t.age)
    if (!WEIGHTS_372[t.id]) continue
    if (V3720 && !retune) {
      techs[t.id] = COSTS_372.techs[t.id]
      continue
    }
    const seen = out.avail[t.id]
    const cost = t.id === 'plough' ? ploughCost : retune ? (retunedCost(out, t.id) ?? t.cost) : t.cost
    techs[t.id] = { ...(t.id === 'plough' || retune ? { cost } : {}), materials: proportionalCost({ ...t, cost }, seen, WEIGHTS_372, nice3) }
  }
  const entry = (age) => (age === 0 ? 0 : out.log.find((e) => e.kind === 'age' && e.age === age)?.t)
  const end = out.log.find((e) => e.kind === 'end')?.t
  const wonders = {}
  for (const w of WONDERS) {
    if (w.age < WONDER_FROM) continue
    const from = entry(w.age)
    const to = entry(w.age + 1) ?? end
    const a = madeAt(out.timeline, from)
    const b = madeAt(out.timeline, from + WONDER_SHARE * (to - from))
    const made = Object.fromEntries(Object.keys(w.cost).map((r) => [r, (b[r] ?? 0) - (a[r] ?? 0)]))
    const k = adjust.get(w.age) ?? 1
    wonders[w.age] = wonderCost(w, Object.fromEntries(Object.entries(made).map(([r, v]) => [r, v * k])))
  }
  return { techs, wonders }
}

const adjust = new Map()
function retuneWonders(out) {
  if (!V3720) return
  for (const w of out.wonders) {
    const k = adjust.get(w.age) ?? 1
    const late = w.start - w.entry > 1
    const ratio = w.share == null ? w.progress : late ? 1 : WONDER_TARGET / w.share
    adjust.set(w.age, k * Math.min(2, Math.max(0.5, ratio)) ** 0.7)
  }
}

let table = null
let path = null
for (let k = 0; k <= ROUNDS; k++) {
  const out = run(path, k > 0)
  const shares = out.wonders.map((w) => `${w.age}:${w.share == null ? `—${Math.round(w.progress * 100)}%` : Math.round(w.share * 100) + '%'}`).join(' ')
  const ages = out.log.filter((e) => e.kind === 'age' || e.kind === 'end').map((e) => Math.round(e.t / 60)).join(' ')
  console.error(`tour ${k} : âges (min) ${ages} | Merveilles ${shares || '(aucune)'}`)
  if (k > 0) retuneWonders(out)
  const next = nextTable(out)
  const same = table && JSON.stringify(next) === JSON.stringify(table)
  table = next
  path = join(dir, `table-${k}.json`)
  writeFileSync(path, JSON.stringify(table))
  if (same) break
}
const json = JSON.stringify(table, null, 1)
if (args.out) writeFileSync(args.out, json + '\n')
process.stdout.write(json + '\n')
