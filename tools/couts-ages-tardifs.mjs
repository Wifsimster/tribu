// Calcule la table de la section 10 de docs/specs/equilibrage-savoirs.md :
// matériaux des savoirs des âges 4 à 10 (règle de la section 9, parts
// WEIGHTS_372), coût en savoir et matériaux de la Charrue, coûts des
// Merveilles 3 à 10 (wonderCost). Les taux dépendent des coûts (le joueur
// focalise ce qui manque, les Merveilles finies donnent +4 %) : on itère
// jusqu'à ce que la table ne bouge plus.
//
//   node --import ./tests/resolve-ts.mjs tools/couts-ages-tardifs.mjs [--rounds=6] [--out=table.json]
//
// Chaque tour fait tourner tools/sim-savoirs.mjs --no-encourage --wonders=v1
// --json sur la table du tour précédent. Le premier tour joue SANS Merveille :
// avec les coûts d'aujourd'hui, la première Merveille bloque toutes les
// suivantes (voir 10.1). Converge en 5 tours.

import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { TECHS, WONDERS } = await import('../src/game/content.ts')
const { WEIGHTS_372, PLOUGH_T, WONDER_SHARE, wonderCost, proportionalCost, nice3 } = await import('./savoirs-rule.mjs')

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')))
const ROUNDS = Number(args.rounds ?? 6)
const dir = mkdtempSync(join(tmpdir(), 'couts-'))

function run(tablePath, wonders) {
  const argv = ['--import', './tests/resolve-ts.mjs', 'tools/sim-savoirs.mjs', '--no-encourage', '--until=11', '--max=200000', '--json']
  if (tablePath) argv.push(`--costs-file=${tablePath}`)
  if (wonders) argv.push('--wonders=v1')
  return JSON.parse(execFileSync(process.execPath, argv, { maxBuffer: 1 << 28, encoding: 'utf8' }))
}

/** Production cumulée (jeu actif) à l'instant `at`. */
function madeAt(timeline, at) {
  let best = { made: {} }
  for (const p of timeline) {
    if (p.t > at) break
    best = p
  }
  return best.made
}

function nextTable(out) {
  const techs = {}
  const ploughCost = nice3(PLOUGH_T * out.avail.plough.insight)
  for (const t of TECHS) {
    if (!WEIGHTS_372[t.id]) continue
    const seen = out.avail[t.id]
    const cost = t.id === 'plough' ? ploughCost : t.cost
    techs[t.id] = { ...(t.id === 'plough' ? { cost } : {}), materials: proportionalCost({ ...t, cost }, seen, WEIGHTS_372, nice3) }
  }
  const entry = (age) => (age === 0 ? 0 : out.log.find((e) => e.kind === 'age' && e.age === age)?.t)
  const end = out.log.find((e) => e.kind === 'end')?.t
  const wonders = {}
  for (const w of WONDERS) {
    if (w.age < 3) continue
    const from = entry(w.age)
    const to = entry(w.age + 1) ?? end
    const a = madeAt(out.timeline, from)
    const b = madeAt(out.timeline, from + WONDER_SHARE * (to - from))
    const made = Object.fromEntries(Object.keys(w.cost).map((r) => [r, (b[r] ?? 0) - (a[r] ?? 0)]))
    wonders[w.id] = wonderCost(w, made)
  }
  return { techs, wonders }
}

let table = null
let path = null
for (let k = 0; k <= ROUNDS; k++) {
  const out = run(path, k > 0)
  const shares = out.wonders.map((w) => `${w.age}:${w.share == null ? `—${Math.round(w.progress * 100)}%` : Math.round(w.share * 100) + '%'}`).join(' ')
  const ages = out.log.filter((e) => e.kind === 'age' || e.kind === 'end').map((e) => Math.round(e.t / 60)).join(' ')
  console.error(`tour ${k} : âges (min) ${ages} | Merveilles ${shares || '(aucune)'}`)
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
