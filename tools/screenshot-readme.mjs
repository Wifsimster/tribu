#!/usr/bin/env node
// Captures de vitrine pour le README.
//
//   NODE_PATH=/tmp/node_modules node tools/screenshot-readme.mjs [url] [--out docs]
//
// Un chargement neuf montre une île vide au Paléolithique : c'est honnête, mais
// ça ne montre rien du jeu. On sème donc une sauvegarde de Renaissance AVANT le
// chargement (`addInitScript`, jamais après : le `pagehide` → `game.flush()`
// écrase toute injection faite une fois la page vivante) et on laisse le jeu
// construire son monde tout seul à partir de cet état.
//
// `?nomenu=1` écarte l'écran d'accueil — qui s'ouvre TOUJOURS quand il y a de la
// progression — et `?h=` fige l'heure, sans quoi deux captures successives
// tombent à des moments différents du cycle jour/nuit.

import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const [, , urlArg, ...rest] = process.argv
const url = urlArg ?? 'https://tribu.battistella.ovh'
const arg = (name, fallback) => {
  const i = rest.indexOf(`--${name}`)
  return i >= 0 && rest[i + 1] !== undefined ? rest[i + 1] : fallback
}
const outDir = arg('out', 'docs')
const settle = Number(arg('settle', 12000))

// Tous les savoirs jusqu'au Moyen Âge inclus, plus trois de Renaissance : le
// village a ses toits d'ardoise (âge ≥ 6), son moulin, son aqueduc, son phare
// et son musée, mais pas encore la cheminée d'usine qui mangerait la silhouette.
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
  t: 0, // remplacé à l'injection : une date figée créditerait 8 h d'absence
  seed: 1_337_042,
  res: { food: 480, wood: 610, stone: 395, fiber: 210, clay: 168, copper: 92, iron: 74, insight: 46 },
  techs: TECHS,
  age: 6,
  focus: 'wood',
  expedition: null,
  caravan: { nextIn: 200, visiting: false, visitLeft: 0, haggled: false, traded: false },
  // Les faits déjà lus : sinon la carte du savoir s'ouvre par-dessus la scène.
  seenFacts: TECHS,
  totalPlaySeconds: 41_000,
  relics: ['amphore', 'fossile', 'boussole'],
  eventIn: 500,
  feats: [],
  outpost: true,
  outpostIn: 260,
  // Une Merveille en chantier : les échafaudages sont ce qui se regarde le mieux.
  wonder: { age: 6, paid: { wood: 0.62, stone: 0.55, iron: 0.4 } },
  wonders: [0, 1, 2, 3, 4, 5],
  layout: [],
  layoutV: 2,
  village: 'Aubevent',
  chronicle: [],
  legacy: 1,
  tribe: null,
}

// Pas de vue mobile : en portrait la caméra laisse l'île au tiers du cadre, le
// reste est de la mer vide — c'est le jeu tel qu'il est, mais ça ne le montre pas.
const SHOTS = [
  { label: 'screenshot', preset: 'desktop', hour: '0.22' },
  { label: 'screenshot-nuit', preset: 'desktop', hour: '0.78' },
]

const PRESETS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
}

await mkdir(outDir, { recursive: true })
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

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
      // Le son ne se déclenche pas sans geste utilisateur, mais autant être net.
      localStorage.setItem('tribu.sound.v1', '0')
    } catch {
      /* stockage bloqué : la capture montrera une île neuve, c'est tout */
    }
  }, SAVE)

  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(`${url}?nomenu=1&h=${hour}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForFunction(() => window.__tribu?.ready === true, { timeout: 30000 })
  // Le monde se pose : village construit, faune répartie, eau et ciel en place.
  await page.waitForTimeout(settle)

  const info = await page.evaluate(() => ({
    ...window.__tribu.info(),
    age: window.__tribu.game?.save?.age,
    techs: window.__tribu.game?.save?.techs?.length,
  }))

  const file = join(outDir, `${label}.png`)
  await page.screenshot({ path: file, timeout: 60000, caret: 'initial' })
  report.runs.push({ label, preset, hour, file, info, errors })
  console.log(`${label}: ${file}  âge=${info.age} savoirs=${info.techs} calls=${info.calls} tris=${info.triangles} erreurs=${errors.length}`)

  await context.close()
}

await browser.close()
await writeFile(join(outDir, 'screenshots.json'), JSON.stringify(report, null, 2))
console.log(`rapport → ${join(outDir, 'screenshots.json')}`)
// Les PNG sortent en 2880×1800 (DPR 2). Ramenés à 1600 de large pour le README :
//   ffmpeg -y -i docs/screenshot.png -vf "scale=1600:-1:flags=lanczos" out.png
