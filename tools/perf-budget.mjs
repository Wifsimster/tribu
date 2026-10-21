#!/usr/bin/env node
// Le plafond d'appels de dessin, vérifié : la sauvegarde figée de l'âge 10
// (tools/saves/age10.json), le cadrage par défaut, à midi, en bureau et en
// téléphone (390×844). Échoue si un relevé dépasse son plafond de
// tools/perf-budget.json.
//
//   corepack pnpm build && corepack pnpm perf:budget
//   PW_CHROME=/chemin/vers/chrome-headless-shell corepack pnpm perf:budget
//
// Les appels et les triangles ne dépendent pas de la définition de l'écran,
// seulement de ce que la caméra cadre : la vue bureau se mesure à 640×400
// (même rapport que 1440×900) et tout se rend en DPR 1, pour qu'un Chromium
// logiciel (SwiftShader) tienne la mesure en une minute environ.

import { readFile } from 'node:fs/promises'
import { blockAudience, launch, serveDist, watchConsole } from './headless.mjs'

const root = new URL('..', import.meta.url)
const budget = JSON.parse(await readFile(new URL('tools/perf-budget.json', root), 'utf8'))
const save = JSON.parse(await readFile(new URL('tools/saves/age10.json', root), 'utf8'))

const VIEWS = {
  desktop: { viewport: { width: 640, height: 400 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
}

const server = await serveDist()
const browser = await launch()
const results = []
let failed = false
try {
  for (const [name, view] of Object.entries(VIEWS)) {
    const context = await browser.newContext({ ...view, locale: 'fr-FR' })
    await blockAudience(context)
    await context.addInitScript((s) => {
      // Date du jour : une date figée créditerait huit heures d'absence.
      localStorage.setItem('tribu.save.v1', JSON.stringify({ ...s, t: Date.now() }))
      localStorage.setItem('tribu.sound.v1', '0')
    }, save)
    const page = await context.newPage()
    const console_ = watchConsole(page)
    // h=0.25 : le zénith, ombres pleines ; c'est le cadrage où le jeu
    // dessine le plus (la nuit éteint les ombres de plusieurs objets).
    await page.goto(`${server.url}?nomenu=1&h=0.25`, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.waitForFunction(() => window.__tribu?.ready === true, null, { timeout: 120000 })
    // Les modèles (faune, véhicules, Merveilles) arrivent en différé.
    await page.waitForTimeout(8000)
    // Le maximum sur une vingtaine d'images : oiseaux, fumées et bêtes
    // entrent et sortent du cadre.
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
