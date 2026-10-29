import { test } from 'node:test'
import assert from 'node:assert/strict'

const warn = console.warn
console.warn = (...a) => {
  if (!String(a[0]).includes('indisponible')) warn(...a)
}

const { Island, BASE_GROWTH } = await import('../src/render/island.ts')
const { Village } = await import('../src/render/village.ts')
const { raiseWorld, planOf } = await import('../src/render/plan.ts')
const { insideBelt } = await import('../src/render/belt.ts')
const { TECHS, TOOLS, livingBuildings } = await import('../src/game/content.ts')

const atAge = (age) =>
  new Set(TECHS.filter((t) => t.age <= age).flatMap((t) => t.effects.filter((e) => e.kind === 'building').map((e) => e.building)))
const tools = (age) => TOOLS.filter((t) => t.age <= age).map((t) => t.id)

function v3(seed, age) {
  const island = new Island(seed, age, [], BASE_GROWTH)
  const v = new Village(island, age, age >= 8, false, { legacy: true })
  v.setWonder(age, 4)
  v.sync(livingBuildings(atAge(age), age))
  v.setRelics(['amphore'])
  v.setTools(tools(age))
  return {
    seed, age, land: [], layout: v.layout, layoutV: 3, goods: v.goodsAt,
    belt: null, streets: null, wonderAt: null, museumAt: null,
  }
}

function load(save, ageChanged = false) {
  const r = raiseWorld(save, {
    electric: save.age >= 8, yule: false, rates: { wood: 2, stone: 1 }, ageChanged,
    wonder: { age: save.age, stage: 4 }, relics: ['amphore'],
  })
  const v = r.village
  v.setWonder(save.age, 4)
  v.sync(livingBuildings(atAge(save.age), save.age))
  v.setRelics(['amphore'])
  v.setTools(tools(save.age))
  return { r, v, save: { ...save, ...planOf(v), layoutV: r.layoutV, goods: v.goodsAt } }
}

const at = (layout) => new Map(layout.map((p) => [p.id, `${p.x},${p.z},${p.rot}`]))

test('plan v3 à l’âge 7 et 10 : peu de bâtiments reposés, aucun perdu, stable sur trois chargements', () => {
  let total = 0
  let moved = 0
  for (const seed of [1_337_042, 42, 2024]) {
    for (const age of [7, 10]) {
      const label = `graine ${seed}, âge ${age}`
      const s0 = v3(seed, age)
      const l1 = load(s0)
      assert.equal(l1.r.layoutV, 4, label)
      assert.ok(l1.r.grand, `${label} : le grand tracé a sa carte`)
      const before = at(s0.layout)
      const after = at(l1.save.layout)
      for (const id of before.keys()) assert.ok(after.has(id), `${label} : ${id} a disparu`)
      const changed = [...before.keys()].filter((id) => before.get(id) !== after.get(id))
      assert.deepEqual(changed.sort(), l1.v.moved.map((m) => m.id).sort(), label)
      for (const m of l1.v.moved) {
        const r = l1.v.reach(m.id)
        assert.ok(l1.v.beltDist(m.to.x, m.to.z) >= r + Village.BELT_CLEAR - 1e-6, `${label} : ${m.id} reposé sur la voie`)
      }
      const lots = l1.v.lots
      for (let i = 0; i < lots.length; i++)
        for (let j = i + 1; j < lots.length; j++) {
          const gap = Math.hypot(lots[i].x - lots[j].x, lots[i].z - lots[j].z) - lots[i].r - lots[j].r
          assert.ok(gap >= Village.ALLEY - 1e-6, `${label} : deux emprises à ${gap.toFixed(2)}`)
        }
      total += s0.layout.filter((p) => p.id !== 'lighthouse').length
      moved += l1.v.moved.filter((m) => m.id !== 'lighthouse').length
      const l2 = load(l1.save)
      const l3 = load(l2.save)
      assert.equal(l2.r.migrate, false, `${label} : nouveau délogement au 2e chargement`)
      assert.deepEqual(l2.save, l1.save, `${label} : le 2e chargement change la sauvegarde`)
      assert.deepEqual(l3.save, l1.save, `${label} : le 3e chargement change la sauvegarde`)
    }
  }
  assert.ok(moved / total <= 0.2, `${moved} bâtiments reposés sur ${total} (${((100 * moved) / total).toFixed(1)} %)`)
})

test('plan v3 avant l’âge 7 : rien ne bouge, le grand tracé attend l’âge 7', () => {
  const s0 = v3(42, 5)
  const l1 = load(s0)
  assert.equal(l1.r.layoutV, 3)
  assert.equal(l1.v.moved.length, 0)
  assert.deepEqual(at(l1.save.layout), at(s0.layout))
  assert.ok(l1.save.streets.length === 3)
  const l7 = load({ ...l1.save, age: 7 }, true)
  assert.equal(l7.r.layoutV, 4)
  assert.ok(l7.r.grand)
  assert.deepEqual(l7.save.streets, l1.save.streets)
})

test('une partie neuve : à l’âge 7, la voie trouve la place libre', () => {
  for (const seed of [7, 99]) {
    let save = { seed, age: 0, land: [], layout: [], layoutV: 4, goods: null, belt: null, streets: null, wonderAt: null, museumAt: null }
    let n = 0
    let movedAt7 = 0
    for (let age = 0; age <= 8; age++) {
      const l = load({ ...save, age }, age > 0)
      if (age === 7) movedAt7 = l.v.moved.length
      n = l.save.layout.length
      save = l.save
    }
    assert.ok(movedAt7 <= 2, `graine ${seed} : ${movedAt7} bâtiments reposés à l’âge 7 sur ${n}`)
  }
})

test('la route du ponton coupe la voie une fois, une seule ; la gare est côté bourg', () => {
  for (const seed of [1_337_042, 7, 42, 99, 2024]) {
    for (const age of [0, 4, 7, 10]) {
      const v = new Village(new Island(seed, age, []), age, age >= 8, false)
      v.sync(livingBuildings(atAge(age), age))
      assert.equal(v.crossings, 1, `graine ${seed}, âge ${age} : ${v.crossings} traversées`)
      if (age < 7) continue
      const g = v.stationPoint
      assert.ok(g, `graine ${seed}, âge ${age} : pas de gare`)
      assert.ok(insideBelt(v.belt, g.x, g.z), `graine ${seed}, âge ${age} : quai côté mer`)
      const d = v.beltDist(g.x, g.z)
      assert.ok(d > 1 && d < 2.5, `graine ${seed}, âge ${age} : quai à ${d.toFixed(2)} u de l’axe`)
    }
  }
})
