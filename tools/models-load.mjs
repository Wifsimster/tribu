#!/usr/bin/env node
// Poids et temps de chargement des glb dans Chromium headless, sur l'île figée
// de l'âge 10 (tools/saves/age10.json) : N parties, médiane. Sert à comparer
// deux builds avec le même protocole (avant/après models:pack).
//
//   corepack pnpm build && node tools/models-load.mjs [--runs 5] [--net 4g|none]
//                                [--shot dossier/prefixe] [--act gather:scythe]
//
// Relève : nombre et octets des .glb transférés (corps, sans compression de
// transport : nginx ne compresse pas les glb), délai entre le début de la
// navigation et la fin du dernier .glb, délai jusqu'à `__tribu.ready`.

import { readFile } from 'node:fs/promises'
import { blockAudience, launch, serveDist, watchConsole } from './headless.mjs'

const rest = process.argv.slice(2)
const arg = (n, d) => (rest.includes(`--${n}`) ? rest[rest.indexOf(`--${n}`) + 1] : d)
const runs = Number(arg('runs', 5))
const net = arg('net', 'none')
const shot = arg('shot', null)
const act = arg('act', null)
const save = JSON.parse(await readFile(new URL('saves/age10.json', import.meta.url), 'utf8'))
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]

const server = await serveDist()
const browser = await launch()
const out = { glbCount: [], glbBytes: [], glbMs: [], readyMs: [], console: [] }
try {
  for (let i = 0; i < runs; i++) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'fr-FR' })
    await blockAudience(context)
    await context.addInitScript((s) => {
      localStorage.setItem('tribu.save.v1', JSON.stringify({ ...s, t: Date.now() }))
      localStorage.setItem('tribu.sound.v1', '0')
    }, save)
    const page = await context.newPage()
    const con = watchConsole(page)
    if (net === '4g') {
      const cdp = await context.newCDPSession(page)
      await cdp.send('Network.enable')
      await cdp.send('Network.emulateNetworkConditions', { offline: false, downloadThroughput: (4 * 1024 * 1024) / 8, uploadThroughput: (3 * 1024 * 1024) / 8, latency: 20 })
    }
    let bytes = 0
    let count = 0
    let lastEnd = 0
    const t0 = Date.now()
    page.on('response', async (r) => {
      if (!/\.glb(\?|$)/.test(r.url())) return
      const b = await r.body().catch(() => null)
      if (b) { bytes += b.length; count++; lastEnd = Date.now() - t0 }
    })
    await page.goto(`${server.url}?nomenu=1&h=0.25${act ? `&act=${act}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.waitForFunction(() => window.__tribu?.ready === true, null, { timeout: 120000 })
    out.readyMs.push(Date.now() - t0)
    await page.waitForTimeout(8000)
    out.glbCount.push(count); out.glbBytes.push(bytes); out.glbMs.push(lastEnd)
    out.console.push(...con.report().unexpected.map((u) => u.text))
    if (shot && i === 0) await page.screenshot({ path: `${shot}.png` })
    await context.close()
  }
} finally {
  await browser.close()
  await server.close()
}
console.log(JSON.stringify({
  runs, net, glbCount: median(out.glbCount), glbBytes: median(out.glbBytes),
  glbDoneMs: median(out.glbMs), readyMs: median(out.readyMs), allGlbDoneMs: out.glbMs, consoleProblems: out.console,
}, null, 2))
