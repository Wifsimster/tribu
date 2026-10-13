// Aucun bâtiment sur le ballast. La rame roule sur le tracé ADOUCI de la voie
// (smoothPath), qui s'écarte du plan jusqu'à 1 u : le placement doit se mesurer
// à lui, pas aux sommets du plan.
//   corepack pnpm test
import { test } from 'node:test'
import assert from 'node:assert/strict'

const warn = console.warn
console.warn = (...a) => {
  if (!String(a[0]).includes('indisponible')) warn(...a)
}

const { Island } = await import('../src/render/island.ts')
const { Village } = await import('../src/render/village.ts')
const { TECHS, TOOLS, livingBuildings } = await import('../src/game/content.ts')

const ALL = new Set(TECHS.flatMap((t) => t.effects.filter((e) => e.kind === 'building').map((e) => e.building)))
const known = (age) =>
  new Set(TECHS.filter((t) => t.age <= age).flatMap((t) => t.effects.filter((e) => e.kind === 'building').map((e) => e.building)))
const tools = (age) => TOOLS.filter((t) => t.age <= age).map((t) => t.id)
const SEEDS = [1_337_042, 7, 42, 99, 2024, 11, 222, 44444]
/** Demi-largeur du ballast posé (railway, BoxGeometry de 1,15). */
const HALF_BALLAST = 0.575

/** Distance de p à l'axe d'une polyligne. */
function axisDist(pts, p) {
  let best = Infinity
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const vx = b.x - a.x
    const vz = b.z - a.z
    const L = vx * vx + vz * vz
    const u = L > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / L)) : 0
    best = Math.min(best, Math.hypot(a.x + vx * u - p.x, a.z + vz * u - p.z))
  }
  return best
}

/** Tout ce qui occupe une parcelle, avec son disque d'occupation. */
function bodies(v) {
  const out = v.propPlacements.map((p) => ({ id: p.id, x: p.x, z: p.z, r: v.reach(p.id) }))
  if (v.wonderPos) out.push({ id: 'merveille', x: v.wonderPos.x, z: v.wonderPos.z, r: Village.WONDER_R })
  if (v.museumPos) out.push({ id: 'musée', x: v.museumPos.x, z: v.museumPos.z, r: Village.MUSEUM_R })
  if (v.goodsPos) out.push({ id: 'quai', x: v.goodsPos.x, z: v.goodsPos.z, r: Village.GOODS_R })
  return out
}

function assertClear(v, label) {
  assert.ok(v.trackPath.length > 1, `${label} : pas de voie`)
  for (const b of bodies(v)) {
    const margin = axisDist(v.trackPath, b) - b.r
    assert.ok(
      margin >= HALF_BALLAST,
      `${label} : ${b.id} à ${margin.toFixed(2)} u de l'axe des rails (demi-ballast ${HALF_BALLAST})`,
    )
  }
}

/** Un chargement de partie, dans l'ordre de buildWorld (main.ts). */
function world(seed, age, save) {
  const v = new Village(new Island(seed, age, []), age, age >= 8, false)
  v.adoptLayout(save?.layout ?? [])
  v.adoptGoods(save?.goods ?? null)
  v.setWonder(age, 4)
  v.sync(livingBuildings(known(age), age))
  v.setRelics(['amphore'])
  v.setTools(tools(age))
  return v
}

test('le bourg complet ne touche pas le ballast de la voie posée (âges 7 et 10)', () => {
  for (const seed of SEEDS)
    for (const age of [7, 10]) {
      const v = new Village(new Island(seed, age, []), age, age >= 8, false)
      v.setWonder(age, 4)
      v.sync(livingBuildings(ALL, age))
      v.setRelics(['amphore'])
      v.setTools(tools(age))
      assertClear(v, `graine ${seed}, âge ${age}`)
    }
})

test('une partie jouée âge par âge garde le ballast libre', () => {
  for (const seed of SEEDS.slice(0, 4)) {
    let save = null
    for (let age = 5; age <= 10; age++) {
      const v = world(seed, age, save)
      save = { layout: v.layout, goods: v.goodsAt }
      if (age >= 7) assertClear(v, `graine ${seed}, âge ${age}`)
    }
  }
})

test('une sauvegarde avec un bâtiment sur le ballast : lui seul bouge', () => {
  const seed = 1_337_042
  const age = 8
  const ref = world(seed, age, null)
  const save = { layout: ref.layout, goods: ref.goodsAt }
  // Le grenier d'une version antérieure, posé sur l'axe même des rails.
  const k = save.layout.findIndex((p) => p.id === 'granary')
  assert.ok(k >= 0)
  const on = ref.trackPath[Math.floor(ref.trackPath.length * 0.3)]
  save.layout[k] = { ...save.layout[k], x: on.x, z: on.z }
  const v = world(seed, age, save)
  assertClear(v, 'sauvegarde réparée')
  const now = new Map(v.layout.map((p) => [p.id, p]))
  for (const p of save.layout) {
    const q = now.get(p.id)
    assert.ok(q, `${p.id} a disparu`)
    if (p.id === 'granary') {
      assert.ok(Math.hypot(q.x - p.x, q.z - p.z) > 0.5, 'le grenier sur les rails n’a pas bougé')
    } else {
      assert.deepEqual([q.x, q.z, q.rot], [p.x, p.z, p.rot], `${p.id} a bougé sans être sur la voie`)
    }
  }
  assert.deepEqual(v.goodsAt, save.goods, 'le quai a bougé sans être sur la voie')
})
