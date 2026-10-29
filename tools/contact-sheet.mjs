#!/usr/bin/env node
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const IDS = ['hut','field','granary','aqueduct','knapping','woodpile','lamps','spearrack','ropes','jars','loom','chopping','orepile','furnace','cart','tablets','sailframe','forge','plough','stele','market','villa','watermill','glassworks','milestone','lectern','collar','threefield','windmill','clock','press','caravel','easel','observatory','bank','anatomy','steamengine','railway','gaslamp','bessemer','telegraph','electric','garage','radio','plane','clinic','computer','dish','server','solar','phone']

await mkdir('/tmp/contact', { recursive: true })
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 700, height: 560 }, deviceScaleFactor: 2 })
const errs = []
p.on('pageerror', (e) => errs.push(String(e)))
await p.addInitScript(() => localStorage.setItem('tribu.save.v1', JSON.stringify({
  v: 1, t: Date.now(), seed: 5, res: { food: 900, wood: 400, stone: 300, insight: 90 },
  techs: ['fire','stone_tools','hearth','tally'], age: 2, focus: 'food', expedition: null,
  caravan: { nextIn: 99000, visiting: false, visitLeft: 0, haggled: false, traded: false },
  seenFacts: [], totalPlaySeconds: 9000, relics: [], eventIn: 99000, chronicle: [], feats: [],
  outpost: false, outpostIn: 99000, wonder: null, wonders: [], legacy: 0, tribe: null,
})))
await p.goto('http://127.0.0.1:8899/?h=0.3', { waitUntil: 'load' })
await p.waitForTimeout(8000)
await p.click('#menu-continue').catch(() => {})
await p.waitForTimeout(1500)

await p.evaluate(() => {
  const st = window.__tribu.stage
  const keep = new Set([window.__tribu.village().group])
  st.scene.children.forEach((o) => { if (!keep.has(o) && !/Light/.test(o.type)) o.visible = false })
  document.getElementById('ui').style.display = 'none'
  document.querySelector('.menu-fab').style.display = 'none'
  document.querySelector('.daydial').style.display = 'none'
  document.querySelector('.toasts').style.display = 'none'
  st.islandRadius = 2.4
})

for (const id of IDS) {
  const ok = await p.evaluate((bid) => {
    const v = window.__tribu.village()
    const before = new Set(v.group.children)
    v.propPlacements.length = 0
    v.placed.clear()
    v.propPlacements.push({ id: bid, x: 0, y: 0, z: 0, rot: Math.PI * 0.78 })
    try { v.rebuildProps() } catch (e) { return String(e) }
    v.group.children.forEach((c) => { c.visible = !before.has(c) })
    return true
  }, id)
  if (ok !== true) { console.log(`✗ ${id} : ${ok}`); continue }
  const taille = await p.evaluate(() => {
    const v = window.__tribu.village()
    const st = window.__tribu.stage
    const m = v.group.children.find((c) => c.visible)
    if (!m) return 0
    m.geometry.computeBoundingBox()
    const bb = m.geometry.boundingBox
    const sx = bb.max.x - bb.min.x, sy = bb.max.y - bb.min.y, sz = bb.max.z - bb.min.z
    const d = Math.max(sx, sy, sz, 0.35)
    st.islandRadius = d * 1.55
    m.position.y = -bb.min.y - sy * 0.42
    return +d.toFixed(2)
  })
  await p.waitForTimeout(320)
  await p.screenshot({ path: `/tmp/contact/${id}.png`, clip: { x: 110, y: 60, width: 480, height: 440 } })
  process.stdout.write(`${id}:${taille} `)
}
console.log('rendus :', IDS.length, '· erreurs JS :', errs.length, errs.slice(0, 2))
await b.close()
