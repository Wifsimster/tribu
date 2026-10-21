#!/usr/bin/env node
// La vraie géométrie du colon, sortie du jeu pour Blender : chaque membre
// (body, head, armL, armR, legL, legR) dans l'espace de son nœud, avec ses
// couleurs. tools/blender/settler_rig.py l'attache à l'os du même nom :
// l'animateur voit la silhouette du jeu, pas une approximation.
//
//   node --import ./tests/resolve-ts.mjs tools/export-settler-proxy.mjs [sortie.json]
//
// Sans argument, le JSON part sur la sortie standard.

import { writeFileSync } from 'node:fs'

const { Settler } = await import('../src/render/settler.ts')
const { Island } = await import('../src/render/island.ts')

const settler = new Settler(new Island(7, 0, []))
const r4 = (v) => Math.round(v * 1e4) / 1e4
const limbs = {}
for (const name of ['body', 'head', 'armL', 'armR', 'legL', 'legR']) {
  const g = settler[name].geometry
  limbs[name] = {
    position: Array.from(g.getAttribute('position').array, r4),
    color: Array.from(g.getAttribute('color').array, r4),
    index: Array.from(g.index.array),
  }
}
const out = JSON.stringify({ _doc: 'tools/export-settler-proxy.mjs — géométrie du colon par membre, espace du nœud (y en haut, regard +z)', limbs })
if (process.argv[2]) writeFileSync(process.argv[2], out)
else process.stdout.write(out)
