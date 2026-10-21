// Le bon outil pour la nourriture : les trois tables du §2 de la spec
// (docs/specs/actions-peche-chasse-cueillette.md), ligne par ligne.
//   corepack pnpm test
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { TOOL_TECHS, actionFor, clipFor, toolFor, visualTool } = await import('../src/game/work-tool.ts')
const { TECHS } = await import('../src/game/content.ts')

/** Un jeu de savoirs, et la liste de ceux que la fonction a interrogés. */
function knower(...ids) {
  const asked = new Set()
  const knows = (id) => {
    asked.add(id)
    return ids.includes(id)
  }
  return { knows, asked }
}

// Chaque ligne : savoirs connus → outil. La première ligne vraie de la table
// gagne : un savoir plus avancé prend le pas sur les plus simples.
const ROWS = {
  fish: [
    [['bessemer', 'weaving', 'cordage', 'spear'], 'reel'],
    [['weaving', 'cordage', 'spear'], 'net'],
    [['cordage', 'spear'], 'line'],
    [['spear'], 'foene'],
    [[], 'hand'],
  ],
  hunt: [
    [['cordage', 'spear'], 'bow'],
    [['spear'], 'spear'],
    [[], 'hand'],
  ],
  gather: [
    [['threefield', 'agriculture', 'spear'], 'scythe'],
    [['agriculture', 'spear'], 'sickle'],
    [['spear', 'cordage'], 'hand'],
    [[], 'hand'],
  ],
}

for (const [action, rows] of Object.entries(ROWS))
  test(`toolFor « ${action} » : chaque ligne de la table`, () => {
    for (const [ids, tool] of rows) assert.equal(toolFor(action, knower(...ids).knows), tool, `${action} avec ${ids.join(', ') || 'rien'}`)
  })

test('pêche sans épieu : main nue (le colon ne tient plus un épieu inconnu)', () => {
  assert.equal(toolFor('fish', knower().knows), 'hand')
  assert.equal(visualTool(toolFor('fish', knower().knows)), 'hand')
})

test('aucun savoir inconnu n’est interrogé', () => {
  const ids = new Set(TECHS.map((t) => t.id))
  for (const id of TOOL_TECHS) assert.ok(ids.has(id), `${id} n'existe pas dans TECHS`)
  // Et la fonction n'en demande pas d'autres, quel que soit le cas.
  const all = knower()
  for (const action of Object.keys(ROWS)) toolFor(action, all.knows)
  for (const id of all.asked) assert.ok(TOOL_TECHS.includes(id), `${id} interrogé hors table`)
  const seen = knower()
  for (const f of [false, true]) for (const tap of [false, true]) actionFor(f, tap, seen.knows)
  for (const id of seen.asked) assert.ok(ids.has(id), `${id} n'existe pas dans TECHS`)
})

test('actionFor : pêche au rivage, cueillette au buisson touché ou après l’agriculture, chasse sinon avec l’épieu', () => {
  assert.equal(actionFor(true, true, knower('agriculture').knows), 'fish')
  assert.equal(actionFor(false, true, knower('spear').knows), 'gather', 'tap sur un buisson = cueillette')
  assert.equal(actionFor(false, false, knower('spear').knows), 'hunt', 'focus nourriture avant l’agriculture = chasse')
  assert.equal(actionFor(false, false, knower('spear', 'agriculture').knows), 'gather', 'après l’agriculture, la chasse disparaît')
  assert.equal(actionFor(false, false, knower().knows), 'gather', 'sans épieu : cueillette à la main')
})

test('clipFor : un geste Blender pour chaque outil de la cueillette, aucun encore ailleurs', () => {
  assert.equal(clipFor('gather', 'hand'), 'gather_hand')
  assert.equal(clipFor('gather', 'sickle'), 'gather_sickle')
  assert.equal(clipFor('gather', 'scythe'), 'gather_scythe')
  for (const tool of ['hand', 'foene', 'line', 'net', 'reel']) assert.equal(clipFor('fish', tool), null)
  for (const tool of ['hand', 'spear', 'bow']) assert.equal(clipFor('hunt', tool), null)
})
