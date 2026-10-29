import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const { TECH_BY_ID, TECHS, DESTINATIONS } = await import('../src/game/content.ts')

const ROOT = new URL('..', import.meta.url).pathname

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.(ts|mjs)$/.test(name) ? [path] : []
  })
}

test("chaque knows('…') de src/ et tests/ nomme un savoir qui existe", () => {
  const unknown = []
  let calls = 0
  const self = new URL(import.meta.url).pathname
  for (const path of [...files(join(ROOT, 'src')), ...files(join(ROOT, 'tests'))]) {
    if (path === self) continue
    const lines = readFileSync(path, 'utf8').split('\n')
    lines.forEach((line, i) => {
      for (const [, id] of line.matchAll(/\bknows\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        calls++
        if (!TECH_BY_ID.has(id)) unknown.push(`${relative(ROOT, path)}:${i + 1} knows('${id}')`)
      }
    })
  }
  assert.ok(calls > 20, `seulement ${calls} appels trouvés : le motif ne voit plus le code`)
  assert.deepEqual(unknown, [])
})

test('les prérequis des savoirs et des destinations existent', () => {
  const unknown = []
  for (const t of TECHS) for (const r of t.requires) if (!TECH_BY_ID.has(r)) unknown.push(`${t.id} ← ${r}`)
  for (const d of DESTINATIONS) if (d.tech && !TECH_BY_ID.has(d.tech)) unknown.push(`${d.id} ← ${d.tech}`)
  assert.deepEqual(unknown, [])
})
