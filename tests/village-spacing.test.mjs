import { test } from 'node:test'
import assert from 'node:assert/strict'

const warn = console.warn
console.warn = (...a) => {
  if (!String(a[0]).includes('indisponible')) warn(...a)
}

const { Island, GROUND_Y } = await import('../src/render/island.ts')
const { Village } = await import('../src/render/village.ts')
const { TECHS, AGES, livingBuildings } = await import('../src/game/content.ts')

const ALL = new Set(TECHS.flatMap((t) => t.effects.filter((e) => e.kind === 'building').map((e) => e.building)))
const SEEDS = [1_337_042, 7, 42, 99, 2024]
const STAGES = [3, 6, 8, AGES.length - 1]

function town(seed, age) {
  const island = new Island(seed, age, [])
  const village = new Village(island, age, true, false)
  village.setWonder(age, 4)
  village.sync(livingBuildings(ALL, age))
  village.setRelics(['amphore'])
  return { island, village }
}

test('toutes les cellules de terre sont au même niveau, sur toutes les graines', () => {
  for (const seed of SEEDS)
    for (const age of [0, AGES.length - 1]) {
      const island = new Island(seed, age, [])
      const pos = island.terrainMesh.geometry.getAttribute('position')
      const nor = island.terrainMesh.geometry.getAttribute('normal')
      const slots = island.terrainSlots
      const levels = new Set()
      for (let i = 0; i < pos.count; i++) {
        if (slots[i] >= island.cells.length * 2 || nor.getY(i) < 0.99) continue
        levels.add(pos.getY(i).toFixed(4))
      }
      assert.deepEqual([...levels], [GROUND_Y.toFixed(4)], `graine ${seed}, âge ${age}`)
      assert.ok(GROUND_Y > 0.5)
    }
})

test('aucun bâtiment n’en touche un autre, même aux âges avancés', () => {
  for (const seed of SEEDS)
    for (const age of STAGES) {
      const { island, village } = town(seed, age)
      const lots = village.lots
      assert.ok(lots.length >= village.layout.length + 2, `graine ${seed}, âge ${age} : ${lots.length} disques`)
      for (let i = 0; i < lots.length; i++) {
        const a = lots[i]
        assert.ok(island.isLand(a.x, a.z), `disque ${i} dans l'eau (graine ${seed}, âge ${age})`)
        for (let j = i + 1; j < lots.length; j++) {
          const b = lots[j]
          const gap = Math.hypot(a.x - b.x, a.z - b.z) - a.r - b.r
          assert.ok(
            gap >= Village.ALLEY - 1e-6,
            `graine ${seed}, âge ${age} : disques ${i} et ${j} à ${gap.toFixed(2)} (ruelle ${Village.ALLEY})`,
          )
        }
      }
      for (const p of village.propPlacements) assert.equal(p.y, GROUND_Y, `${p.id} à y=${p.y}`)
    }
})

test('le rayon d’occupation couvre toute la géométrie posée', () => {
  const { village } = town(SEEDS[0], 5)
  for (const id of ['windmill', 'aqueduct', 'villa', 'hut']) {
    const r = village.reach(id)
    let far = 0
    for (const g of village.propGeo(id)) {
      const pos = g.getAttribute('position')
      for (let i = 0; i < pos.count; i++) far = Math.max(far, Math.hypot(pos.getX(i), pos.getZ(i)))
    }
    assert.ok(r >= far - 1e-6, `${id} : rayon ${r} < géométrie ${far}`)
  }
})
