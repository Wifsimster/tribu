#!/usr/bin/env node
// Screenshot + measurement harness for the gauntlet loop.
//
//   node tools/shoot.mjs <url> <label> [--presets mobile,desktop] [--settle 6000]
//                        [--save partie.json] [--console off]
//
// La console compte : erreurs ET avertissements sont relevés, et le script
// échoue sur tout message hors de la liste blanche (`CONSOLE_ALLOW`,
// tools/headless.mjs). `--console off` pour la barre (Townscaper), dont la
// console n'est pas la nôtre.
//
// `--save` sème une sauvegarde (JSON d'une `tribu.save.v1`) avant le
// chargement : c'est ainsi qu'on mesure une île avancée, parcelles comprises.
// La mesure d'audience (Umami, production) est toujours bloquée : une mesure
// ne doit jamais compter comme une visite.
//
// Captures the same viewports for our build and for the bar (Townscaper), so a
// critic can put them side by side with the labels stripped. Also records the
// objective half: load time under simulated 4G, draw calls and triangle count.
//
// Honest caveat baked into the output: headless Chromium renders through
// SwiftShader (software GL). The `fps` field is a RELATIVE signal between runs
// on this machine, never a claim about a real phone's GPU.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { blockAudience, launch, watchConsole } from './headless.mjs'

const PRESETS = {
  mobile: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  desktop: { width: 1440, height: 900, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
}

// Chrome DevTools "Fast 4G" profile.
const NET_4G = {
  offline: false,
  downloadThroughput: (4 * 1024 * 1024) / 8,
  uploadThroughput: (3 * 1024 * 1024) / 8,
  latency: 20,
}

const [, , url, label, ...rest] = process.argv
if (!url || !label) {
  console.error('usage: shoot.mjs <url> <label> [--presets mobile,desktop] [--settle ms]')
  process.exit(1)
}

const arg = (name, fallback) => {
  const i = rest.indexOf(`--${name}`)
  return i >= 0 && rest[i + 1] !== undefined ? rest[i + 1] : fallback
}
const presets = arg('presets', 'mobile,desktop').split(',')
const settle = Number(arg('settle', 6000))
const outDir = arg('out', 'shots')
// The bar is a ~40 MB Unity WebGL build: throttled, it never leaves its loading
// bar, so capturing it fairly means capturing it unthrottled. Our own build is
// always measured throttled — that asymmetry favours the bar, which is the point.
const cpuRate = Number(arg('cpu', 4))
// Le build Unity de la barre en DPR 3 dépasse les 60 s de capture sous SwiftShader.
const dprOverride = arg('dpr', null)
const throttleNet = arg('net', '4g') !== 'off'
const savePath = arg('save', null)
const seeded = savePath ? JSON.parse(await readFile(savePath, 'utf8')) : null
const judgeConsole = arg('console', 'on') !== 'off'

await mkdir(outDir, { recursive: true })
const browser = await launch()
let unexpected = 0

const report = { url, label, capturedAt: new Date().toISOString(), runs: [] }

for (const name of presets) {
  const base = PRESETS[name]
  if (!base) continue
  const viewport = dprOverride ? { ...base, deviceScaleFactor: Number(dprOverride) } : base

  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    locale: 'fr-FR',
  })
  await blockAudience(context)
  if (seeded)
    await context.addInitScript((save) => {
      // Date du jour : une date figée créditerait huit heures d'absence.
      localStorage.setItem('tribu.save.v1', JSON.stringify({ ...save, t: Date.now() }))
      localStorage.setItem('tribu.sound.v1', '0')
    }, seeded)
  const page = await context.newPage()

  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  if (throttleNet) await cdp.send('Network.emulateNetworkConditions', NET_4G)
  if (cpuRate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate })

  const consoleWatch = watchConsole(page)

  const t0 = Date.now()
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  const domReady = Date.now() - t0

  // First moment the canvas has actually drawn something, not just been created.
  let firstDraw = null
  try {
    await page.waitForFunction(
      () => {
        const c = document.querySelector('canvas')
        return !!c && c.width > 0 && c.height > 0
      },
      { timeout: 30000 },
    )
    firstDraw = Date.now() - t0
  } catch {
    /* the bar may not use a canvas the same way */
  }

  await page.waitForTimeout(settle)

  // Frame pacing over two seconds, at 4x CPU throttle, software GL.
  const fps = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0
        const start = performance.now()
        const tick = () => {
          frames++
          if (performance.now() - start < 2000) requestAnimationFrame(tick)
          else resolve(Math.round((frames / (performance.now() - start)) * 1000))
        }
        requestAnimationFrame(tick)
      }),
  )

  const info = await page.evaluate(() => window.__tribu?.info?.() ?? null)

  const transferred = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .reduce((sum, r) => sum + (r.encodedBodySize || 0), 0),
  )

  const file = join(outDir, `${label}-${name}.png`)
  // A busy WebGL page can stall the default screenshot wait forever.
  await page.screenshot({ path: file, timeout: 60000, caret: 'initial' })

  const { seen, unexpected: odd } = consoleWatch.report()
  const errors = seen.filter((m) => m.type !== 'warning').map((m) => m.text)
  const warnings = seen.filter((m) => m.type === 'warning').map((m) => m.text)
  if (judgeConsole) unexpected += odd.length
  report.runs.push({
    preset: name,
    viewport,
    screenshot: file,
    domReadyMs: domReady,
    firstDrawMs: firstDraw,
    fpsSoftwareGL: fps,
    rendererInfo: info,
    transferredBytes: transferred,
    errors,
    warnings,
    consoleUnexpected: odd.map((m) => `${m.type}: ${m.text}`),
  })
  console.log(
    `${label}/${name}: ${file}  dom=${domReady}ms firstDraw=${firstDraw}ms fps~${fps} ` +
      `calls=${info?.calls ?? '—'} tris=${info?.triangles ?? '—'} bytes=${transferred}` +
      ` console=${seen.length} (hors liste ${odd.length})`,
  )
  if (judgeConsole) for (const m of odd) console.log(`  ✖ ${m.type} : ${m.text}`)

  await context.close()
}

await browser.close()
await writeFile(join(outDir, `${label}.json`), JSON.stringify(report, null, 2))
console.log(`report → ${join(outDir, `${label}.json`)}`)
if (unexpected) {
  console.error(`${unexpected} message(s) console hors liste blanche (tools/headless.mjs, CONSOLE_ALLOW).`)
  process.exit(1)
}
