#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { blockAudience, launch, serveDist, watchConsole } from './headless.mjs'

const save = JSON.parse(await readFile(new URL('saves/age10.json', import.meta.url), 'utf8'))
const target = process.argv.slice(2).find((a) => !a.startsWith('--'))
const server = target ? null : await serveDist()
const base = target ?? server.url

const RUNS = [
  { label: 'partie neuve', query: '', save: null },
  { label: 'âge 10', query: '?nomenu=1&h=0.25', save },
]

const browser = await launch()
let unexpected = 0
try {
  for (const run of RUNS) {
    const context = await browser.newContext({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 1, locale: 'fr-FR' })
    await blockAudience(context)
    if (run.save)
      await context.addInitScript((s) => {
        localStorage.setItem('tribu.save.v1', JSON.stringify({ ...s, t: Date.now() }))
        localStorage.setItem('tribu.sound.v1', '0')
      }, run.save)
    const page = await context.newPage()
    const watch = watchConsole(page)
    await page.goto(`${base}${run.query}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.waitForFunction(() => window.__tribu?.ready === true, null, { timeout: 120000 })
    await page.waitForTimeout(8000)
    const r = watch.report()
    unexpected += r.unexpected.length
    console.log(`${r.unexpected.length ? '✖' : '✔'} ${run.label} : ${r.seen.length} message(s), ${r.unexpected.length} hors liste blanche`)
    for (const s of r.seen) {
      const bad = r.unexpected.includes(s)
      console.log(`  ${bad ? '✖' : '·'} ${s.type} : ${s.text}${s.url ? `  (${s.url})` : ''}`)
    }
    await context.close()
  }
} finally {
  await browser.close()
  await server?.close()
}
if (unexpected) {
  console.error(`${unexpected} message(s) console hors liste blanche (tools/headless.mjs, CONSOLE_ALLOW).`)
  process.exit(1)
}
