// Le phare et la boucle ferrée. Sa place est entre la voie et la mer ; sur un
// cap trop étroit pour son socle (3,9 u exigés de l'axe, 2,6 à 3,4 u
// disponibles), il passe côté terre, contre la voie, sur le cap (plan de
// l'île organique, risques de l'incrément 2). Avant ce repli, il était reposé
// dans le bourg : 69 phares sur 104 sauvegardes 3.62 finissaient dans l'île.
//   corepack pnpm test
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

/** Un plan v3, posé comme le posait la 3.61 (île de base 1,45, sans ceinture). */
function v3(seed, age) {
  const island = new Island(seed, age, [], BASE_GROWTH)
  const v = new Village(island, age, age >= 8, false, { legacy: true })
  v.setWonder(age, 4)
  v.sync(livingBuildings(atAge(age), age))
  v.setRelics(['amphore'])
  v.setTools(tools(age))
  return { seed, age, land: [], layout: v.layout, layoutV: 3, goods: v.goodsAt, belt: null, streets: null, wonderAt: null, museumAt: null }
}

/** Un chargement, comme `buildWorld` (main.ts). */
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

/** Le phare tient sa place : sur la côte (au-delà de la voie) ou contre la
 *  voie côté terre, à CAPE_REACH au plus de l'axe ; jamais sur la voie, la
 *  route, le passage à niveau ni un voisin ; sur la terre. */
function checkLighthouse(v, label) {
  const p = v.layout.find((q) => q.id === 'lighthouse')
  assert.ok(p, `${label} : phare perdu`)
  const r = v.reach('lighthouse')
  const d = v.beltDist(p.x, p.z)
  assert.ok(d >= r + Village.BELT_CLEAR - 1e-6, `${label} : phare à ${d.toFixed(2)} u de l'axe, sur la voie`)
  const coast = !insideBelt(v.belt, p.x, p.z)
  assert.ok(coast || d <= Village.CAPE_REACH, `${label} : phare dans les terres, à ${d.toFixed(2)} u de la voie`)
  for (const l of v.lots) {
    if (l.x === p.x && l.z === p.z) continue
    const gap = Math.hypot(l.x - p.x, l.z - p.z) - l.r - r
    assert.ok(gap >= Village.ALLEY - 1e-6, `${label} : phare à ${gap.toFixed(2)} u d'un voisin`)
  }
  const c = v.crossing
  if (c) assert.ok(Math.hypot(c.x - p.x, c.z - p.z) >= r + 2.2 - 1e-6, `${label} : phare sur le passage à niveau`)
  assert.ok(v.laneDist(p.x, p.z) >= r + 1.2 - 1e-6, `${label} : phare à ${v.laneDist(p.x, p.z).toFixed(2)} u d'une rue`)
  assert.ok(v.island.isLand(p.x, p.z), `${label} : phare dans l'eau`)
  return coast ? 'côte' : 'voie'
}

test('grand tracé : le phare rejoint la côte, ou la voie côté terre sur le cap ; stable sur trois chargements', () => {
  const seen = { côte: 0, voie: 0 }
  // Graines où le repli d'avant posait le phare dans le bourg (sauvegardes
  // 3.62 générées, phare.mjs) et graines ordinaires.
  for (const seed of [1_337_042, 42, 2024, 5, 99]) {
    for (const age of [7, 10]) {
      const label = `graine ${seed}, âge ${age}`
      const l1 = load(v3(seed, age))
      seen[checkLighthouse(l1.v, label)]++
      const l2 = load(l1.save)
      const l3 = load(l2.save)
      const key = (l) => JSON.stringify(l.save.layout.find((q) => q.id === 'lighthouse'))
      assert.equal(key(l2), key(l1), `${label} : le phare bouge au 2e chargement`)
      assert.equal(key(l3), key(l2), `${label} : le phare bouge au 3e chargement`)
    }
  }
  // Le repli côté terre sert vraiment : sur ces graines, la bande est trop
  // étroite au moins une fois.
  assert.ok(seen.voie > 0, `aucun phare contre la voie (${JSON.stringify(seen)})`)
})

const KINDS = ['foret', 'carriere', 'prairie', 'roseliere', 'crique', 'affleurement']
/** `n` parcelles posées à l'ancre par défaut, comme « Pose-la pour moi ». */
function plots(seed, n) {
  const land = []
  for (let i = 0; i < n; i++) {
    const at = new Island(seed, 0, land, undefined, true).defaultAnchor()
    if (!at) break
    land.push({ kind: KINDS[i % 6], q: at.q, r: at.r })
  }
  return land
}

test('partie neuve : à l’âge 7, la mer recule et le phare quitte les terres', () => {
  // Graine 31337 à six parcelles : le phare des terres rendait sa place
  // avant d'en trouver une autre, le moulin reposé s'y posait, et le phare,
  // resté là faute de cap, le touchait.
  for (const [seed, n] of [[42, 0], [99, 0], [5, 0], [31337, 6]]) {
    let save = { seed, age: 0, land: plots(seed, n), layout: [], layoutV: 4, goods: null, belt: null, streets: null, wonderAt: null, museumAt: null }
    for (let a = 0; a <= 8; a++) {
      const l = load({ ...save, age: a }, a > 0)
      save = l.save
      if (a < 7) continue
      checkLighthouse(l.v, `graine ${seed}, ${n} parcelles, âge ${a}`)
      const lots = l.v.lots
      for (let i = 0; i < lots.length; i++)
        for (let j = i + 1; j < lots.length; j++) {
          const gap = Math.hypot(lots[i].x - lots[j].x, lots[i].z - lots[j].z) - lots[i].r - lots[j].r
          assert.ok(gap >= Village.ALLEY - 1e-6, `graine ${seed}, âge ${a} : deux bâtiments à ${gap.toFixed(2)} u`)
        }
    }
    // Rechargé à l'âge 8 : le phare ne bouge plus.
    const again = load(save)
    assert.deepEqual(again.save.layout.find((q) => q.id === 'lighthouse'), save.layout.find((q) => q.id === 'lighthouse'), `graine ${seed}`)
  }
})
