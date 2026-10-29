#!/usr/bin/env node
// Compresse les glb de src/assets/models avec gltfpack (meshoptimizer, MIT) :
// EXT_meshopt_compression, sans simplifier la géométrie. À rejouer après chaque
// export Blender ; sans effet sur ce qui est déjà compressé (pas de perte en
// cascade).
//
//   corepack pnpm models:pack            (écrit sur place)
//   corepack pnpm models:pack -- --dry   (compte seulement)
//
// Restent tels quels, par construction :
//  - les fichiers lus à la main (fauna-glb.ts, settler-clips.ts) : aucun
//    décodeur meshopt côté lecteur maison ;
//  - ceux qui portent un attribut personnalisé (`_STAGE` des Merveilles) :
//    gltfpack 1.3 le supprime, même avec -kv.
// Options : -cc compression maximale ; -kn/-km/-ke gardent noms de nœuds,
// matériaux et extras ; -vpf garde les positions en flottants (sans cela
// gltfpack déplace l'échelle de quantification dans le nœud, et le jeu ne lit
// que la géométrie du maillage).

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, renameSync, statSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const dir = new URL('../src/assets/models/', import.meta.url).pathname
const cli = createRequire(import.meta.url).resolve('gltfpack/cli.js')
const dry = process.argv.includes('--dry')
const HAND_READ = /^(deer|gull|hen|horse|sheep|settler-.*)\.glb$/

function jsonOf(buf) {
  return buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')
}

const tmp = mkdtempSync(join(tmpdir(), 'tribu-pack-'))
let before = 0
let after = 0
for (const f of readdirSync(dir).filter((n) => n.endsWith('.glb')).sort()) {
  const path = join(dir, f)
  const buf = readFileSync(path)
  const json = jsonOf(buf)
  let why = null
  if (HAND_READ.test(f)) why = 'lu à la main'
  else if (json.includes('EXT_meshopt_compression')) why = 'déjà compressé'
  else if (/"_[A-Z0-9_]+"\s*:/.test(json)) why = 'attribut personnalisé'
  if (why) {
    console.log(`= ${f} (${why})`)
    continue
  }
  const out = join(tmp, f)
  execFileSync(process.execPath, [cli, '-i', path, '-o', out, '-cc', '-kn', '-km', '-ke', '-vpf'], { stdio: 'pipe' })
  const [a, b] = [buf.length, statSync(out).size]
  before += a
  after += b
  console.log(`✓ ${f}  ${a} → ${b}`)
  if (!dry) renameSync(out, path)
}
console.log(`total traité : ${before} → ${after} octets`)
