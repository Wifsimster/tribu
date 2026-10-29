import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
const files = (dir, ext) =>
  readdirSync(new URL(dir, root))
    .filter((f) => f.endsWith(ext))
    .map((f) => f.slice(0, -ext.length))
    .sort()

test('chaque son de public/audio a sa ligne dans CREDITS.md', () => {
  const sounds = files('public/audio/', '.mp3')
  assert.ok(sounds.length > 0, 'aucun son trouvé')
  const credited = new Set(
    read('public/audio/CREDITS.md')
      .split('\n')
      .map((l) => /^- \*\*([^*]+)\*\* — \S/.exec(l)?.[1])
      .filter(Boolean),
  )
  assert.deepEqual(sounds.filter((s) => !credited.has(s)), [], 'sons sans ligne de provenance')
  assert.deepEqual([...credited].filter((c) => !sounds.includes(c)).sort(), [], 'crédits sans fichier')
})

test('chaque modèle de src/assets/models a sa ligne dans ASSETS.md', () => {
  const models = files('src/assets/models/', '.glb')
  assert.ok(models.length > 0, 'aucun modèle trouvé')
  const rows = new Set(
    read('ASSETS.md')
      .split('\n')
      .map((l) => /^\| `([^`]+)\.glb` \|/.exec(l)?.[1])
      .filter(Boolean),
  )
  assert.deepEqual(models.filter((m) => !rows.has(m)), [], 'modèles sans ligne de provenance')
})
