#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { blockAudience, launch, watchConsole } from './headless.mjs'

const [, , urlArg, ...rest] = process.argv
const url = urlArg ?? 'https://tribu.battistella.ovh'
const arg = (name, fallback) => {
  const i = rest.indexOf(`--${name}`)
  return i >= 0 && rest[i + 1] !== undefined ? rest[i + 1] : fallback
}
const outDir = arg('out', 'docs')
const settle = Number(arg('settle', 12000))

const TECHS = [
  'flint', 'fire', 'shelter', 'spear', 'lamp', 'cordage',
  'agriculture', 'pottery', 'weaving', 'polished_axe', 'granary',
  'copper', 'bronze', 'wheel', 'writing', 'sail',
  'ironworking', 'plough', 'alphabet', 'coinage', 'lighthouse', 'aqueduct',
  'concrete', 'watermill', 'glass', 'roads', 'codex',
  'horsecollar', 'threefield', 'windmill', 'clock', 'press',
  'caravel', 'observatory', 'bank',
]

const SAVE = {
  v: 1,
  t: 0,
  seed: 1_337_042,
  res: { food: 480, wood: 610, stone: 395, fiber: 210, clay: 168, copper: 92, iron: 74, insight: 46 },
  techs: TECHS,
  age: 6,
  focus: 'wood',
  expedition: null,
  caravan: { nextIn: 200, visiting: false, visitLeft: 0, haggled: false, traded: false },
  seenFacts: TECHS,
  totalPlaySeconds: 41_000,
  relics: ['amphore', 'fossile', 'boussole'],
  eventIn: 500,
  feats: [],
  outpost: true,
  outpostIn: 260,
  wonder: { age: 6, paid: { wood: 0.62, stone: 0.55, iron: 0.4 } },
  wonders: [0, 1, 2, 3, 4, 5],
  layout: [],
  layoutV: 2,
  village: 'Aubevent',
  chronicle: [],
  legacy: 1,
  tribe: null,
}

const SHOTS = [
  { label: 'screenshot', preset: 'desktop', hour: '0.22' },
  { label: 'screenshot-nuit', preset: 'desktop', hour: '0.78' },
]

const PRESETS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
}

await mkdir(outDir, { recursive: true })
const browser = await launch()
let unexpected = 0

const report = { url, capturedAt: new Date().toISOString(), runs: [] }

for (const { label, preset, hour } of SHOTS) {
  const vp = PRESETS[preset]
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor,
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
    locale: 'fr-FR',
  })

  await context.addInitScript((save) => {
    try {
      localStorage.setItem('tribu.save.v1', JSON.stringify({ ...save, t: Date.now() }))
      localStorage.setItem('tribu.sound.v1', '0')
    } catch {
    }
  }, SAVE)

  await blockAudience(context)
  const page = await context.newPage()
  const consoleWatch = watchConsole(page)

  await page.goto(`${url}?nomenu=1&h=${hour}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForFunction(() => window.__tribu?.ready === true, { timeout: 30000 })
  await page.waitForTimeout(settle)

  const info = await page.evaluate(() => ({
    ...window.__tribu.info(),
    age: window.__tribu.game?.save?.age,
    techs: window.__tribu.game?.save?.techs?.length,
  }))

  const file = join(outDir, `${label}.png`)
  await page.screenshot({ path: file, timeout: 60000, caret: 'initial' })
  const { seen, unexpected: odd } = consoleWatch.report()
  const errors = seen.filter((m) => m.type !== 'warning').map((m) => m.text)
  const warnings = seen.filter((m) => m.type === 'warning').map((m) => m.text)
  unexpected += odd.length
  report.runs.push({ label, preset, hour, file, info, errors, warnings })
  console.log(
    `${label}: ${file}  âge=${info.age} savoirs=${info.techs} calls=${info.calls} tris=${info.triangles} ` +
      `erreurs=${errors.length} avertissements=${warnings.length} hors liste=${odd.length}`,
  )
  for (const m of odd) console.log(`  ✖ ${m.type} : ${m.text}`)

  await context.close()
}

await browser.close()
await writeFile(join(outDir, 'screenshots.json'), JSON.stringify(report, null, 2))
console.log(`rapport → ${join(outDir, 'screenshots.json')}`)
if (unexpected) {
  console.error(`${unexpected} message(s) console hors liste blanche (tools/headless.mjs, CONSOLE_ALLOW).`)
  process.exit(1)
}
