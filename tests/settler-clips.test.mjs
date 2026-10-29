import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'

const CLIPS = await import('../src/render/settler-clips.ts')
const { Settler } = await import('../src/render/settler.ts')
const { Island } = await import('../src/render/island.ts')
const { Euler, Quaternion, Vector3 } = await import('three')
const RIG = JSON.parse(readFileSync(new URL('../src/render/settler-rig.json', import.meta.url), 'utf8'))

const file = (name) => new URL(`../src/assets/models/${name}`, import.meta.url)
const buf = (name) => {
  const b = readFileSync(file(name))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}
const island = new Island(7, 0, [])
const S = RIG.scale
const DT = 1 / 60

function gltf(name) {
  const b = readFileSync(file(name))
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'))
}

function quats(s) {
  return CLIPS.NODES.map((n) => s[n].quaternion.clone())
}
const jump = (a, b) => Math.max(...a.map((q, i) => q.angleTo(b[i])))

function settlerAt(clip) {
  const s = new Settler(island)
  s.setTool(clip === 'gather_scythe' ? 'scythe' : clip === 'gather_sickle' ? 'sickle' : 'hand', 0)
  s.setClip(clip)
  s.group.position.set(2, s.group.position.y, 2)
  s.sendTo(new Vector3(2, 0, 2.6))
  return s
}

function run(s, until, max = 4000, each = () => {}) {
  for (let i = 0; i < max; i++) {
    s.update(DT, 1)
    each(i)
    if (until()) return i
  }
  throw new Error('jamais atteint')
}

test('repli : sans glb chargé, le geste procédural joue et rien ne lève d’exception', () => {
  assert.equal(CLIPS.settlerClip('gather_hand'), null)
  const s = settlerAt('gather_hand')
  run(s, () => s.phase === 'work', 300)
  assert.equal(s.timer, 2.6, 'durée de travail historique (2,6 s)')
  const before = s.armR.rotation.x
  for (let i = 0; i < 30; i++) s.update(DT, 1)
  assert.notEqual(s.armR.rotation.x, before, 'animateWork lève et frappe')
  assert.equal(s.carry.visible, false, 'pas de panier sans modèles')
  s.setTool('sickle', 1)
  s.setTool('scythe', 2)
  assert.ok(s.tool, 'faux procédurale de repli')
})

test('contrat : les nœuds, les pivots de settler-rig.json, les clips et leurs événements', () => {
  CLIPS.adoptSettlerModels(buf('settler-clips.glb'), buf('settler-tools.glb'))
  const g = gltf('settler-clips.glb')
  assert.deepEqual(g.nodes.map((n) => n.name).sort(), [...CLIPS.NODES].sort(), 'exactement les dix nœuds')
  assert.ok(g.nodes.every((n) => n.mesh === undefined), 'aucun maillage dans le fichier des clips')
  for (const n of g.nodes) {
    const parent = g.nodes.find((p) => p.children?.includes(g.nodes.indexOf(n)))
    assert.equal(parent?.name ?? null, RIG.nodes[n.name].parent, `${n.name} : parent du jeu`)
  }
  assert.deepEqual(g.animations.map((a) => a.name).sort(), [...CLIPS.CLIP_NAMES].sort())
  const pose = CLIPS.newPose()
  for (const name of CLIPS.CLIP_NAMES) {
    const clip = CLIPS.settlerClip(name)
    CLIPS.sampleClip(clip, 0, pose)
    for (const n of CLIPS.NODES) {
      const d = pose[n].p.distanceTo(new Vector3().fromArray(RIG.nodes[n].pivot))
      assert.ok(d <= 1e-3, `${name} : ${n} à ${d.toFixed(4)} u de son pivot à la frame 0`)
    }
    const names = clip.events.map((e) => e.name)
    for (const ev of ['strike', 'fill', 'loop_in', 'loop_out']) assert.ok(names.includes(ev), `${name} : événement ${ev}`)
    assert.ok(g.animations.find((a) => a.name === name).samplers.every((s) => s.interpolation === 'LINEAR'))
    assert.equal(clip.timeline.filter((e) => e.name === 'fill').length, 3, `${name} : trois « fill » par travail`)
  }
  assert.ok(statSync(file('settler-clips.glb')).size <= 60 * 1024, 'settler-clips.glb ≤ 60 Ko')
  assert.ok(statSync(file('settler-tools.glb')).size <= 40 * 1024, 'settler-tools.glb ≤ 40 Ko')
  const tris = (geo) => geo.index.count / 3
  for (const t of ['sickle', 'scythe']) assert.ok(tris(CLIPS.settlerTool(t).geometry) <= 250, `${t} ≤ 250 triangles`)
  for (let lv = 0; lv <= 3; lv++) assert.ok(tris(CLIPS.carryGeometry('basket', lv)) <= 200, `panier cran ${lv} ≤ 200 triangles`)
  for (let lv = 1; lv <= 3; lv++) assert.ok(tris(CLIPS.carryGeometry('sheaf', lv)) <= 300, `gerbe cran ${lv} ≤ 300 triangles`)
  assert.equal(CLIPS.carryGeometry('sheaf', 0), null, 'gerbe vide : rien à dessiner')
})

test('lecteur : un fichier hors format est refusé plutôt que joué de travers', () => {
  const b = Buffer.from(readFileSync(file('settler-clips.glb')))
  const len = b.readUInt32LE(12)
  const json = b.subarray(20, 20 + len).toString('utf8')
  const patch = (from, to) => {
    const out = Buffer.from(b)
    const js = json.replace(from, to)
    assert.equal(js.length, json.length)
    out.write(js, 20, 'utf8')
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
  }
  assert.throws(() => CLIPS.readClips(patch('"LINEAR"', '"STEP"  ')), /interpolation/)
  assert.throws(() => CLIPS.readClips(patch('"name":"cast"', '"name":"cist"')), /cast absent/)
  assert.throws(() => CLIPS.readClips(patch('"loop_out"', '"loop_xxx"')), /boucle absente/)
})

test('lecture : boucles dépliées, événements franchis une seule fois', () => {
  const clip = CLIPS.settlerClip('gather_hand')
  const span = clip.loopOut - clip.loopIn
  assert.ok(Math.abs(clip.length - (clip.duration + 2 * span)) < 1e-6)
  assert.ok(Math.abs(CLIPS.clipTime(clip, clip.loopIn + span + 0.1) - (clip.loopIn + 0.1)) < 1e-9)
  assert.equal(CLIPS.clipTime(clip, clip.length), clip.duration)
  let strikes = 0
  for (let e = 0; e < clip.length; e += DT) strikes += CLIPS.eventsBetween(clip, e, e + DT).filter((x) => x.name === 'strike').length
  assert.equal(strikes, 6, 'deux picorages par boucle, trois boucles')
  for (const name of CLIPS.CLIP_NAMES) {
    const c = CLIPS.settlerClip(name)
    const a = CLIPS.sampleClip(c, c.loopIn, CLIPS.newPose())
    const b = CLIPS.sampleClip(c, c.loopOut, CLIPS.newPose())
    for (const n of CLIPS.NODES) assert.ok(a[n].q.angleTo(b[n].q) < 2e-3, `${name} : ${n} ne se referme pas`)
  }
})

test('sol : aucun pied sous le sol, aucun pied qui glisse pendant un geste', () => {
  const s = new Settler(island)
  const o = s.group.position.clone()
  const foot = (leg) => s[leg].localToWorld(new Vector3().fromArray(RIG.points[leg === 'legL' ? 'footL' : 'footR'].at)).sub(o)
  for (const name of CLIPS.CLIP_NAMES) {
    const clip = CLIPS.settlerClip(name)
    let first = null
    for (let t = 0; t <= clip.duration + 1e-9; t += DT) {
      s.poseClip(name, t)
      s.group.updateMatrixWorld(true)
      const f = [foot('legL'), foot('legR')]
      first ??= f
      for (let k = 0; k < 2; k++) {
        assert.ok(f[k].y >= -0.02, `${name} t=${t.toFixed(2)} : pied ${f[k].y.toFixed(3)} sous le sol`)
        const slide = Math.hypot(f[k].x - first[k].x, f[k].z - first[k].z)
        assert.ok(slide <= 0.02, `${name} t=${t.toFixed(2)} : pied qui glisse de ${slide.toFixed(3)} u`)
      }
    }
  }
})

test('impact : à chaque coup, le bout de l’outil est dans le buisson, à mi-hauteur', () => {
  const MID = 0.22 * ((1.05 + 1.575) / 2)
  const s = new Settler(island)
  const o = s.group.position.clone()
  for (const name of CLIPS.CLIP_NAMES) {
    const clip = CLIPS.settlerClip(name)
    const tip = clip.tool === 'hand' ? RIG.points.fingers.at : CLIPS.settlerTool(clip.tool).tip.toArray()
    for (const ev of clip.events.filter((e) => e.name === 'strike')) {
      s.poseClip(name, ev.t)
      s.group.updateMatrixWorld(true)
      const p = s.toolR.localToWorld(new Vector3().fromArray(tip)).sub(o)
      assert.ok(Math.abs(p.y - MID) <= 0.15, `${name} t=${ev.t} : bout d'outil à ${p.y.toFixed(3)} u, mi-hauteur ${MID.toFixed(3)}`)
      assert.ok(p.z > 0.2, `${name} t=${ev.t} : le coup porte devant le colon (z ${p.z.toFixed(2)})`)
    }
  }
})

function clipOwn(clip, e0, e1) {
  const a = CLIPS.sampleClip(clip, CLIPS.clipTime(clip, e0), CLIPS.newPose())
  const b = CLIPS.sampleClip(clip, CLIPS.clipTime(clip, e1), CLIPS.newPose())
  return Math.max(...CLIPS.NODES.map((n) => a[n].q.angleTo(b[n].q)))
}

function walkOwn() {
  const s = new Settler(island)
  s.group.position.set(-6, s.group.position.y, -6)
  s.sendTo(new Vector3(6, 0, 6))
  for (let i = 0; i < 30; i++) s.update(DT, 1)
  let prev = quats(s)
  let most = 0
  for (let i = 0; i < 120 && s.phase === 'walkOut'; i++) {
    s.update(DT, 1)
    const now = quats(s)
    most = Math.max(most, jump(prev, now))
    prev = now
  }
  return most
}

const FADE_SLACK = 0.05

function watchFades(s, label, frames, until, WALK, shown = quats(s)) {
  let prev = shown
  let after = 0
  let fading = 0
  for (let i = 0; i < frames; i++) {
    const e0 = s.play?.e ?? null
    const phase0 = s.phase
    s.update(DT, 1)
    const now = quats(s)
    const fadeIn = s.play && s.play.e <= s.play.fade + DT
    const fadeOut = !!s.out
    if (fadeIn || fadeOut) {
      fading++
      after = 30
    } else if (after > 0) after--
    const watched = (fadeIn || fadeOut || after > 0) && s.phase !== 'deposit' && phase0 !== 'deposit' && !s.isSleeping
    if (watched) {
      const own = s.play && e0 !== null ? clipOwn(s.play.clip, e0, s.play.e) : WALK
      const j = jump(prev, now)
      assert.ok(j <= own + FADE_SLACK, `${label} image ${i} (${fadeIn ? 'entrée' : fadeOut ? 'sortie' : 'après'}) : saut de ${j.toFixed(3)} rad, geste ${own.toFixed(3)}`)
    }
    prev = now
    if (until?.()) break
  }
  return fading
}

test('continuité : entrée, sortie, fête, nuit et départ en expédition sans saut sur tout le fondu ; wake() remet au repos', () => {
  const WALK = walkOwn()
  assert.ok(WALK > 0.02 && WALK < 0.2, `marche : ${WALK.toFixed(3)} rad par image`)
  for (const name of CLIPS.CLIP_NAMES) {
    const s = settlerAt(name)
    const crossed = []
    let phase = s.phase
    const fading = watchFades(s, `${name} cycle`, 6000, () => {
      if (s.phase !== phase) crossed.push(`${phase}→${s.phase}`)
      phase = s.phase
      return s.phase === 'deposit'
    }, WALK)
    assert.deepEqual(crossed, ['walkOut→work', 'work→walkHome', 'walkHome→deposit'])
    assert.ok(fading >= 2 * 9, `${name} : ${fading} images de fondu vues (entrée + sortie ≥ 0,15 s chacune)`)
    for (const cut of ['celebrate', 'night', 'expedition']) {
      const t = settlerAt(name)
      run(t, () => t.phase === 'work' && t.play && t.play.e > 1.2)
      const shown = quats(t)
      if (cut === 'celebrate') t.celebrate()
      else if (cut === 'night') t.setNight(true)
      else t.departExpedition(true)
      const seen = watchFades(t, `${name} ${cut}`, 240, null, WALK, shown)
      assert.ok(seen >= 9, `${name} ${cut} : ${seen} images de fondu vues`)
    }
    const w = settlerAt(name)
    run(w, () => w.phase === 'work' && w.play && w.play.e > 1)
    w.wake()
    for (const n of CLIPS.NODES) {
      const node = RIG.nodes[n]
      const r = node.rest ?? [0, 0, 0]
      const q = new Quaternion().setFromEuler(new Euler(r[0], r[1], r[2]))
      assert.ok(w[n].quaternion.angleTo(q) < 1e-6, `${name} : ${n} pas au repos après wake()`)
      assert.ok(w[n].position.distanceTo(new Vector3().fromArray(node.pivot)) < 1e-6, `${name} : ${n} hors de son pivot après wake()`)
    }
    assert.equal(w.play, null)
  }
})

test('sommeil : couché, le colon n’a plus ni panier ni gerbe ; relevé, il les retrouve', () => {
  for (const name of CLIPS.CLIP_NAMES) {
    const s = settlerAt(name)
    run(s, () => s.phase === 'work' && s.carry.level >= 1)
    assert.equal(s.carry.visible, true)
    s.setNight(true)
    run(s, () => s.isSleeping, 6000)
    for (let i = 0; i < 120; i++) {
      s.update(DT, 1)
      assert.equal(s.carry.visible, false, `${name} : accessoire visible au lit`)
    }
    s.setNight(false)
    run(s, () => !s.isSleeping && s.lieDown === 0, 2000)
    s.update(DT, 1)
    assert.equal(s.carry.visible, true, `${name} : accessoire retrouvé au réveil`)
  }
})

test('dépôt : onDeposit tombe une fois par travail, au feu, panier vidé', () => {
  const s = settlerAt('gather_hand')
  let calls = 0
  let level = -1
  s.onDeposit = () => {
    calls++
    level = s.carry.level
  }
  run(s, () => s.phase === 'walkHome')
  assert.equal(calls, 0, 'pas avant le retour au feu')
  run(s, () => s.phase === 'deposit', 6000)
  assert.equal(calls, 1)
  assert.equal(level, 0, 'panier déjà vidé quand main.ts rend la main à la chasse')
})

test('réussite : le panier passe ses quatre crans pendant le travail, reste plein au retour, se vide au feu', () => {
  for (const name of CLIPS.CLIP_NAMES) {
    const s = settlerAt(name)
    run(s, () => s.phase === 'work')
    const seen = new Set([s.carry.level])
    run(s, () => s.phase !== 'work', 4000, () => seen.add(s.carry.level))
    assert.deepEqual([...seen].sort(), [0, 1, 2, 3], `${name} : crans vus pendant le travail`)
    assert.equal(s.carry.level, 3)
    assert.equal(s.carry.visible, true, `${name} : plein et visible au retour`)
    run(s, () => s.phase === 'deposit', 6000, () => s.phase === 'walkHome' && assert.equal(s.carry.level, 3, `${name} : plein pendant tout le retour`))
    assert.equal(s.carry.level, 0, `${name} : vidé au dépôt`)
    assert.equal(s.carry.visible, name === 'gather_hand')
  }
})

test('outils : faucille et faux de Blender, tranchant à la couleur de l’âge des métaux', () => {
  const s = new Settler(island)
  s.setTool('sickle', 0)
  const model = CLIPS.settlerTool('sickle')
  assert.equal(s.tool.geometry.index.count, model.geometry.index.count, 'la faucille vient du glb')
  s.setTool('sickle', 2)
  const col = s.tool.geometry.getAttribute('color')
  let iron = 0
  for (let i = 0; i < col.count; i++) if (Math.abs(col.getX(i) - model.edge.r) < 1e-3 && Math.abs(col.getZ(i) - model.edge.b) < 1e-3) iron++
  assert.equal(iron, 0, 'plus aucun sommet couleur silex une fois au fer')
  assert.equal(s.tool.parent, s.toolR, 'l’outil est dans la main (nœud toolR)')
})
