import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const CLIPS = await import('../src/render/settler-clips.ts')
const { Settler } = await import('../src/render/settler.ts')
const { Island } = await import('../src/render/island.ts')
const { Vector3 } = await import('three')
const RIG = JSON.parse(readFileSync(new URL('../src/render/settler-rig.json', import.meta.url), 'utf8'))

const buf = (name) => {
  const b = readFileSync(new URL(`../src/assets/models/${name}`, import.meta.url))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}
CLIPS.adoptSettlerModels(buf('settler-clips.glb'), buf('settler-tools.glb'))

const TOL = 1e-3

test('parité : le jeu pose main, bout d’outil et pieds là où Blender les a mis (12 instants × 3 clips)', () => {
  const s = new Settler(new Island(7, 0, []))
  const origin = s.group.position.clone()
  const at = (obj, local) => obj.localToWorld(new Vector3().fromArray(local)).sub(origin)
  for (const name of CLIPS.CLIP_NAMES) {
    const clip = CLIPS.settlerClip(name)
    assert.equal(clip.check.length, 12, `${name} : 12 instants de contrôle`)
    const tip = clip.tool === 'hand' ? RIG.points.fingers.at : CLIPS.settlerTool(clip.tool).tip.toArray()
    let worst = 0
    const moved = { hand: 0, tip: 0, footL: 0, footR: 0 }
    for (const row of clip.check) {
      assert.ok(s.poseClip(name, row.t))
      s.group.updateMatrixWorld(true)
      const got = {
        hand: at(s.armR, RIG.points.hand.at),
        tip: at(s.toolR, tip),
        footL: at(s.legL, RIG.points.footL.at),
        footR: at(s.legR, RIG.points.footR.at),
      }
      for (const k of Object.keys(got)) {
        const want = new Vector3().fromArray(row[k])
        const d = got[k].distanceTo(want)
        worst = Math.max(worst, d)
        assert.ok(d <= TOL, `${name} t=${row.t} ${k} : écart ${d.toFixed(5)} u (jeu ${got[k].toArray().map((v) => v.toFixed(3))}, Blender ${row[k]})`)
        moved[k] = Math.max(moved[k], want.distanceTo(new Vector3().fromArray(clip.check[0][k])))
      }
    }
    const most = Math.max(...Object.values(moved))
    assert.ok(most >= 0.2, `${name} : déplacement maximal ${most.toFixed(3)} u, comparaison triviale`)
    assert.ok(worst <= TOL)
  }
})
