#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { blockAudience, launch, serveDist, watchConsole } from './headless.mjs'

const root = new URL('..', import.meta.url)
const budget = JSON.parse(await readFile(new URL('tools/perf-budget.json', root), 'utf8'))
const save = JSON.parse(await readFile(new URL('tools/saves/age10.json', root), 'utf8'))

const VIEWS = {
  desktop: { viewport: { width: 640, height: 400 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
}

const actAt = process.argv.indexOf('--act')
const act = actAt > 0 ? `&act=${process.argv[actAt + 1]}` : ''

const server = await serveDist()
const browser = await launch()
const results = []
let failed = false
try {
  for (const [name, view] of Object.entries(VIEWS)) {
    const context = await browser.newContext({ ...view, locale: 'fr-FR' })
    await blockAudience(context)
    await context.addInitScript((s) => {
      localStorage.setItem('tribu.save.v1', JSON.stringify({ ...s, t: Date.now() }))
      localStorage.setItem('tribu.sound.v1', '0')
    }, save)
    const page = await context.newPage()
    const console_ = watchConsole(page)
    await page.goto(`${server.url}?nomenu=1&h=0.25${act}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.waitForFunction(() => window.__tribu?.ready === true, null, { timeout: 120000 })
    await page.waitForTimeout(8000)
    const samples = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const out = []
          const tick = () => {
            out.push(window.__tribu.info())
            if (out.length < 20) requestAnimationFrame(tick)
            else resolve(out)
          }
          requestAnimationFrame(tick)
        }),
    )
    const calls = Math.max(...samples.map((s) => s.calls))
    const triangles = Math.max(...samples.map((s) => s.triangles))
    const cap = budget[name]
    const over = calls > cap.calls || triangles > cap.triangles
    const { unexpected } = console_.report()
    failed ||= over
    results.push({ view: name, calls, triangles, cap: { calls: cap.calls, triangles: cap.triangles }, console: unexpected.length })
    console.log(
      `${over ? '✖' : '✔'} ${name.padEnd(7)} appels ${calls} / ${cap.calls}   triangles ${triangles} / ${cap.triangles}` +
        `   (min ${Math.min(...samples.map((s) => s.calls))} appels sur ${samples.length} images)`,
    )
    for (const u of unexpected) console.log(`  console ${u.type} : ${u.text}`)
    await context.close()
  }
} finally {
  await browser.close()
  await server.close()
}
if (process.argv.includes('--json')) console.log(JSON.stringify(results))
if (failed) {
  console.error('Plafond dépassé : voir tools/perf-budget.json et la section Performance du README.')
  process.exit(1)
}
