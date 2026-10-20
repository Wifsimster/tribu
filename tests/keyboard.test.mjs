// L'orbite au clavier (v3.65.0). Demande du joueur : « j'aimerais également
// pouvoir me déplacer avec les touches de direction autour de l'île ».
//   corepack pnpm test
import { test } from 'node:test'
import assert from 'node:assert/strict'

const K = await import('../src/render/keyboard.ts')
const C = await import('../src/render/controls.ts')

const rig = () => ({ azimuth: 1, polar: Math.PI * 0.38, distance: 21 })

/** Déplacement attendu après `T` s touche tenue depuis l'arrêt : la vitesse
 *  rejoint V en exp(-t/RAMP), d'où V·(T − RAMP·(1 − e^(−T/RAMP))). */
const travelled = (V, T) => V * (T - K.RAMP_S * (1 - Math.exp(-T / K.RAMP_S)))

function hold(orbit, seconds, dt) {
  const n = Math.round(seconds / dt)
  for (let i = 0; i < n; i++) orbit.step(dt)
}

test('← tenue 1 s : l\'azimut baisse de la vitesse attendue, quel que soit le pas', () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
    const r = rig()
    const o = new K.KeyOrbit(r)
    assert.equal(o.press('ArrowLeft', 'ArrowLeft'), true)
    hold(o, 1, dt)
    const got = 1 - r.azimuth
    const want = travelled(K.AZIMUTH_SPEED, 1)
    assert.ok(Math.abs(got - want) < 0.02, `dt=${dt}: ${got} ≠ ${want}`)
  }
})

test('→, D tournent dans l\'autre sens ; ← et → ensemble s\'annulent', () => {
  const r = rig()
  const o = new K.KeyOrbit(r)
  o.press('d', 'KeyD')
  hold(o, 0.5, 1 / 60)
  assert.ok(r.azimuth > 1.3)
  o.release('d', 'KeyD')
  hold(o, 1, 1 / 60)
  assert.equal(o.active, false, 'la vitesse retombe et la boucle s\'arrête')
  const still = r.azimuth
  o.press('ArrowLeft', 'ArrowLeft')
  o.press('ArrowRight', 'ArrowRight')
  hold(o, 1, 1 / 60)
  assert.equal(r.azimuth, still)
})

test('AZERTY (Q/Z/S/D) et QWERTY (A/W/S/D) pilotent la même orbite', () => {
  for (const [left, up] of [['q', 'z'], ['a', 'w'], ['Q', 'Z']]) {
    const r = rig()
    const o = new K.KeyOrbit(r)
    assert.equal(o.press(left, 'KeyX'), true)
    assert.equal(o.press(up, 'KeyY'), true)
    hold(o, 0.3, 1 / 60)
    assert.ok(r.azimuth < 1, left)
    assert.ok(r.polar < Math.PI * 0.38, up)
  }
  assert.equal(new K.KeyOrbit(rig()).press('e', 'KeyE'), false, 'les autres touches passent')
})

test('↑ / ↓ restent dans les bornes de l\'inclinaison', () => {
  const r = rig()
  const o = new K.KeyOrbit(r)
  o.press('ArrowUp', 'ArrowUp')
  hold(o, 5, 1 / 60)
  assert.equal(r.polar, C.MIN_POLAR)
  o.releaseAll()
  o.press('ArrowDown', 'ArrowDown')
  hold(o, 5, 1 / 60)
  assert.equal(r.polar, C.MAX_POLAR)
})

test('+ / - et le pavé numérique zooment dans les bornes 8–58', () => {
  const r = rig()
  const o = new K.KeyOrbit(r)
  o.press('+', 'Equal')
  hold(o, 0.5, 1 / 60)
  assert.ok(r.distance < 21)
  hold(o, 5, 1 / 60)
  assert.equal(r.distance, C.MIN_ZOOM)
  // Maj lâchée avant la touche : `key` change, `code` non — elle se relâche.
  assert.equal(o.release('=', 'Equal'), true)
  o.press('-', 'NumpadSubtract')
  hold(o, 5, 1 / 60)
  assert.equal(r.distance, C.MAX_ZOOM)
  o.releaseAll()
  o.press('Unidentified', 'NumpadAdd')
  hold(o, 0.5, 1 / 60)
  assert.ok(r.distance < C.MAX_ZOOM)
})

test('releaseAll (blur, onglet caché) arrête net : rien ne tourne seul', () => {
  const r = rig()
  const o = new K.KeyOrbit(r)
  o.press('ArrowLeft', 'ArrowLeft')
  o.press('ArrowUp', 'ArrowUp')
  hold(o, 0.5, 1 / 60)
  o.releaseAll()
  assert.equal(o.active, false)
  const snap = { ...r }
  hold(o, 1, 1 / 60)
  assert.deepEqual(r, snap)
})

test('les champs de saisie gardent leur clavier', () => {
  assert.equal(K.isEditable({ tagName: 'INPUT' }), true)
  assert.equal(K.isEditable({ tagName: 'TEXTAREA' }), true)
  assert.equal(K.isEditable({ tagName: 'DIV', isContentEditable: true }), true)
  assert.equal(K.isEditable({ tagName: 'CANVAS', isContentEditable: false }), false)
  assert.equal(K.isEditable(null), false)
})

// Câblage DOM, simulé : la page reçoit les touches par `window`.
test('attachKeyboard : rien dans un input, preventDefault seulement si consommé, relâche au blur', async () => {
  const listeners = {}
  const docListeners = {}
  const frames = []
  globalThis.window = { addEventListener: (t, f) => ((listeners[t] ??= []).push(f)) }
  globalThis.document = { hidden: false, addEventListener: (t, f) => ((docListeners[t] ??= []).push(f)) }
  globalThis.requestAnimationFrame = (f) => frames.push(f)
  let now = 0
  const perf = globalThis.performance
  Object.defineProperty(globalThis, 'performance', { value: { now: () => now }, configurable: true })
  try {
    const r = rig()
    let isBlocked = false
    K.attachKeyboard(r, () => isBlocked)
    const fire = (type, init) => {
      let prevented = false
      const e = { ctrlKey: false, altKey: false, metaKey: false, target: { tagName: 'BODY' }, ...init, preventDefault: () => (prevented = true) }
      for (const f of listeners[type] ?? []) f(e)
      return prevented
    }
    const run = (seconds) => {
      for (let i = 0; i < seconds * 60 && frames.length; i++) {
        now += 1000 / 60
        frames.shift()(now)
      }
    }

    assert.equal(fire('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', target: { tagName: 'INPUT' } }), false)
    assert.equal(fire('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true }), false)
    assert.equal(fire('keydown', { key: 'Tab', code: 'Tab' }), false, 'Tab n\'est pas consommé')
    isBlocked = true
    assert.equal(fire('keydown', { key: 'ArrowLeft', code: 'ArrowLeft' }), false, 'menu ouvert')
    isBlocked = false
    assert.equal(frames.length, 0, 'aucune image demandée sans touche')

    assert.equal(fire('keydown', { key: 'ArrowLeft', code: 'ArrowLeft' }), true)
    // La répétition de l'OS ne relance pas une deuxième boucle.
    fire('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', repeat: true })
    assert.equal(frames.length, 1)
    run(0.5)
    assert.ok(r.azimuth < 1)

    for (const f of listeners.blur) f()
    const az = r.azimuth
    run(2)
    assert.equal(frames.length, 0, 'la boucle s\'est arrêtée')
    assert.ok(Math.abs(r.azimuth - az) < 1e-9)
  } finally {
    delete globalThis.window
    delete globalThis.document
    delete globalThis.requestAnimationFrame
    Object.defineProperty(globalThis, 'performance', { value: perf, configurable: true })
  }
})
