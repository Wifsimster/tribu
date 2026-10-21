#!/usr/bin/env node
// Planches et GIF des gestes du colon (spec actions, critère 9) : pour chaque
// outil de la cueillette, le colon posé près d'un buisson de l'île de l'âge 10
// (tools/saves/age10.json), l'action forcée par `?act=gather:<outil>`.
//
//   corepack pnpm build && node tools/shoot-actions.mjs [sortie] [--tools hand,sickle,scythe]
//   PW_CHROME=/chemin/vers/chrome-headless-shell node tools/shoot-actions.mjs …
//
// Par outil : deux planches de 8 images (7 pendant le travail, 1 au retour,
// panier plein), l'une à la taille du jeu (390×844, colon ~50 px de haut,
// agrandie ×2 au plus proche voisin), l'autre en gros plan ; et un GIF du
// travail en gros plan si ffmpeg est là. La boucle du jeu est figée
// (requestAnimationFrame), le colon avance à pas fixes de 1/30 s : les images
// ne dépendent pas de la vitesse de SwiftShader.

import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { blockAudience, launch, serveDist, watchConsole } from './headless.mjs'

const args = process.argv.slice(2)
const out = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--tools') ?? 'shots/actions'
const toolsArg = args.includes('--tools') ? args[args.indexOf('--tools') + 1] : 'hand,sickle,scythe'
const TOOLS = toolsArg.split(',')
const W = 390
const H = 844
const save = JSON.parse(await readFile(new URL('saves/age10.json', import.meta.url), 'utf8'))
let ffmpeg = true
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
} catch {
  ffmpeg = false
}

await mkdir(out, { recursive: true })
const server = await serveDist()
const browser = await launch()
const report = []
let unexpected = 0
try {
  for (const tool of TOOLS) {
    const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'fr-FR' })
    await blockAudience(context)
    await context.addInitScript((s) => {
      localStorage.setItem('tribu.save.v1', JSON.stringify({ ...s, t: Date.now() }))
      localStorage.setItem('tribu.sound.v1', '0')
    }, save)
    const page = await context.newPage()
    const watch = watchConsole(page)
    await page.goto(`${server.url}?nomenu=1&h=0.25&act=gather:${tool}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.waitForFunction(() => window.__tribu?.ready === true, null, { timeout: 120000 })
    // Modèles (faune, colon) en différé, puis quelques images de la vraie
    // boucle pour que l'outil et le geste forcés soient posés.
    await page.waitForTimeout(10000)

    const info = await page.evaluate(() => {
      window.requestAnimationFrame = () => 0
      const t = window.__tribu
      const s = t.settler()
      const isl = t.island()
      // Le buisson debout le plus proche du colon, et le colon posé à 1 u de lui.
      const at = s.group.position
      let bush = null
      for (const m of isl.pickables) {
        if (isl.kindFor(m) !== 'food') continue
        for (let i = 0; i < m.count; i++) {
          if (isl.isFelled(m, i)) continue
          const p = isl.instancePosition(m, i)
          if (!bush || p.distanceTo(at) < bush.distanceTo(at)) bush = p
        }
      }
      s.setNight(false)
      s.wake()
      // Panier vide : la planche montre les quatre crans depuis le début.
      s.carryLevel = 0
      s.refreshCarry()
      s.group.position.set(bush.x + 1, s.group.position.y, bush.z + 0.3)
      s.sendTo(bush)
      for (let i = 0; i < 600 && s.phase !== 'work'; i++) s.update(1 / 30, 1)
      return { bush: [bush.x, bush.z], phase: s.phase, clip: s.play?.clip.name ?? null, length: s.play?.clip.length ?? 0 }
    })
    if (info.phase !== 'work' || !info.clip) throw new Error(`${tool} : le colon ne joue pas de geste Blender (${JSON.stringify(info)})`)

    // Une image : le rendu complet de la scène par une caméra posée face au
    // colon, dans l'axe de la caméra du jeu, puis recadrée autour de lui.
    // `view` : 'jeu' = l'axe de la caméra du jeu (ce que voit le joueur),
    // 'profil' = de côté, caméra basse, pour juger le geste.
    const shot = (px, crop, view) =>
      page.evaluate(
        ({ px, crop, view, W, H }) => {
          const t = window.__tribu
          const st = t.stage
          const s = t.settler()
          const cam = st.camera.clone()
          cam.clearViewOffset()
          cam.near = 0.1
          cam.far = 1000
          cam.aspect = W / H
          cam.updateProjectionMatrix()
          const look = s.group.position.clone()
          look.y += 0.8
          let dir
          if (view === 'jeu') dir = st.camera.position.clone().sub(st.target).normalize()
          else {
            // De profil, côté main droite (x+ du colon), un peu de face.
            const yaw = s.group.rotation.y + Math.PI / 2 - 0.35
            dir = new look.constructor(Math.sin(yaw), 0.42, Math.cos(yaw)).normalize()
          }
          const d = (H * 1.85) / (2 * px * Math.tan((cam.fov * Math.PI) / 360))
          cam.position.copy(look).addScaledVector(dir, d)
          cam.lookAt(look)
          st.renderer.render(st.scene, cam)
          const c = document.createElement('canvas')
          c.width = c.height = crop
          c.getContext('2d').drawImage(st.renderer.domElement, (W - crop) / 2, (H - crop) / 2, crop, crop, 0, 0, crop, crop)
          return c.toDataURL('image/png')
        },
        { px, crop, view, W, H },
      )
    const step = (seconds) =>
      page.evaluate((n) => {
        const s = window.__tribu.settler()
        for (let i = 0; i < n; i++) s.update(1 / 30, 1)
        return { phase: s.phase, e: s.play?.e ?? null, carry: s.carry }
      }, Math.round(seconds * 30))
    const write = (name, url) => writeFile(join(out, name), Buffer.from(url.split(',')[1], 'base64'))

    // 7 instants du travail, puis le retour panier plein.
    const frames = []
    let e = 0
    for (let k = 0; k < 7; k++) {
      const target = ((k + 0.5) * info.length) / 7
      const st = await step(target - e)
      e = target
      frames.push({ ...st, label: `travail ${target.toFixed(1)} s` })
      await write(`${tool}-jeu-${k}.png`, await shot(50, 160, 'jeu'))
      await write(`${tool}-gros-${k}.png`, await shot(260, 380, 'profil'))
    }
    const home = await step(info.length - e + 0.4)
    frames.push({ ...home, label: 'retour' })
    await write(`${tool}-jeu-7.png`, await shot(50, 160, 'jeu'))
    await write(`${tool}-gros-7.png`, await shot(260, 380, 'profil'))

    // GIF : le travail suivant, en entier, à 10 i/s (un tour de retour au feu
    // puis un nouveau départ prendrait trop de temps sous SwiftShader).
    let gif = null
    if (ffmpeg) {
      await page.evaluate(() => {
        const s = window.__tribu.settler()
        // Retour au buisson pour un nouveau travail complet.
        s.wake()
        s.carryLevel = 0
        s.refreshCarry()
        const b = s.destination.clone()
        s.group.position.set(b.x + 1, s.group.position.y, b.z + 0.3)
        s.sendTo(b)
        for (let i = 0; i < 600 && s.phase !== 'work'; i++) s.update(1 / 30, 1)
      })
      const n = Math.round(info.length * 10) + 8
      for (let i = 0; i < n; i++) {
        await write(`gif-${tool}-${String(i).padStart(3, '0')}.png`, await shot(260, 380, 'profil'))
        await step(0.1)
      }
      gif = join(out, `${tool}.gif`)
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '10', '-i', join(out, `gif-${tool}-%03d.png`),
        '-vf', 'split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer', gif])
    }
    if (ffmpeg)
      for (const kind of ['jeu', 'gros'])
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(out, `${tool}-${kind}-%d.png`),
          '-vf', `${kind === 'jeu' ? 'scale=iw*2:ih*2:flags=neighbor,' : ''}tile=4x2:padding=4:color=white`, '-frames:v', '1',
          join(out, `planche-${tool}-${kind}.png`)])
    const { unexpected: bad } = watch.report()
    unexpected += bad.length
    for (const b of bad) console.log(`  console ${b.type} : ${b.text}`)
    report.push({ tool, clip: info.clip, length: info.length, frames, gif })
    console.log(`✔ ${tool} : ${info.clip}, ${info.length.toFixed(1)} s de travail, crans ${frames.map((f) => f.carry.level).join(' ')}, console ${bad.length}`)
    await context.close()
  }
} finally {
  await browser.close()
  await server.close()
}
await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 1))
if (unexpected) {
  console.error(`${unexpected} message(s) console hors liste blanche.`)
  process.exit(1)
}
