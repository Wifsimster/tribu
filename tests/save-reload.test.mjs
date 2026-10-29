import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { play, reload } = await import('./save-play.mjs')

const r3 = (v) => Math.round(v * 1000) / 1000
function snapshot(game, village) {
  const s = game.save
  return {
    layout: s.layout.map((p) => `${p.id} ${r3(p.x)} ${r3(p.z)} ${r3(p.rot)}`).sort(),
    goods: s.goods && `${r3(s.goods.x)} ${r3(s.goods.z)}`,
    wonder: village?.wonderAt && `${r3(village.wonderAt.x)} ${r3(village.wonderAt.z)}`,
    res: Object.fromEntries(Object.entries(s.res).sort().map(([k, v]) => [k, r3(v)])),
    techs: [...s.techs].sort(),
    age: s.age,
    land: s.land.map((l) => `${l.kind} ${l.q} ${l.r}`),
    relics: s.relics,
    tools: s.tools,
  }
}

const SEEDS = [7, 1_337_042, 3333]
const AGES_ = [4, 7, 10]
const PARCELS = [0, 12]
const CASES = SEEDS.flatMap((seed) => AGES_.flatMap((age) => PARCELS.map((parcels) => ({ seed, age, parcels }))))

test(`lot de ${CASES.length} sauvegardes : trois chargements, rien ne bouge ni ne disparaît`, () => {
  const faults = []
  for (const { seed, age, parcels } of CASES) {
    const { saved: before, played } = play(seed, age, parcels)
    const tag = `graine ${seed} âge ${age} ${before.land.length} parcelles`
    const kept = snapshot({ save: before }, null), wrote = snapshot({ save: { ...before, ...played } }, null)
    for (const k of ['techs', 'age', 'relics', 'tools', 'res'])
      if (JSON.stringify(kept[k]) !== JSON.stringify(wrote[k]))
        faults.push(`${tag} : ${k} perdu à l'écriture\n    joué ${JSON.stringify(wrote[k])}\n    sauvé ${JSON.stringify(kept[k])}`)
    let prev = null
    for (let n = 1; n <= 3; n++) {
      const { game, village } = reload(seed * 13 + n * 1009)
      const now = snapshot(game, village)
      const ids = (l) => l.map((p) => p.id).sort().join(',')
      if (ids(game.save.layout) !== ids(before.layout))
        faults.push(`${tag}, chargement ${n} : plan ${before.layout.length} → ${game.save.layout.length} (${ids(before.layout)} → ${ids(game.save.layout)})`)
      const ref = prev ?? snapshot({ save: before }, village)
      for (const k of Object.keys(now)) {
        if (k === 'wonder' && !prev) continue
        const a = JSON.stringify(ref[k]), b = JSON.stringify(now[k])
        if (a !== b) faults.push(`${tag}, chargement ${n} : ${k} a changé\n    avant ${a}\n    après ${b}`)
      }
      prev = now
    }
  }
  assert.deepEqual(faults, [], faults.join('\n'))
})

test("l'ordre de load() suit buildWorld et placeGoods (src/main.ts)", () => {
  const src = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const body = src.slice(src.indexOf('function buildWorld('), src.indexOf('function surveyNodes('))
  const goods = src.slice(src.indexOf('function placeGoods('))
  const calls = (s) => [...s.matchAll(/village\.(setCargo|adoptLayout|adoptGoods|setWonder|sync|setRelics|setTools)\(|village\.goodsAvoid =|(?<!function )placeGoods\(\)|(?<!function )raiseWorld\(/g)].map((m) => m[1] ?? m[0])
  const plan = readFileSync(new URL('../src/render/plan.ts', import.meta.url), 'utf8')
  const raise = plan.slice(plan.indexOf('export function raiseWorld('))
  const lifted = calls(raise.slice(0, raise.indexOf('\n}\n')))
  const world = calls(body).flatMap((c) => (c === 'raiseWorld(' ? lifted : [c]))
  const at = world.indexOf('placeGoods()')
  const order = [...world.slice(0, at), ...calls(goods.slice(0, goods.indexOf('\n}\n'))), ...world.slice(at + 1)]
  assert.deepEqual(order, ['setCargo', 'adoptLayout', 'adoptGoods', 'setWonder', 'sync', 'setRelics', 'village.goodsAvoid =', 'setTools'])
})
