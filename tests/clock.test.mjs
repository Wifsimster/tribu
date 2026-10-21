// L'horloge de l'île (3.70) : le jour couvre deux tiers du tour, la nuit un
// tiers, sans saut de soleil ni de lune, et une seule fonction dit l'heure.
//   corepack pnpm test
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}
beforeEach(() => store.clear())

const { DAY_SHARE, dayPhaseAt, dayHourOfClock, clockOfDayHour, secondsUntilDayHour } = await import('../src/game/clock.ts')
const { Game, sunHeightAt, daylightAt, meanLightFactor, lightScaleFor } = await import('../src/game/sim.ts')
const { DAY_SECONDS } = await import('../src/game/content.ts')

const DT = 0.02
const STEPS = Math.round(DAY_SECONDS / DT)
/** Écart circulaire d'une heure à la suivante, dans [−½, ½). */
const step = (a, b) => ((b - a + 1.5) % 1) - 0.5

test('le soleil est levé deux tiers du tour, couché un tiers', () => {
  let day = 0
  for (let i = 0; i < STEPS; i++) if (sunHeightAt(1000 + i * DT) > 0) day += DT
  const share = day / DAY_SECONDS
  assert.ok(Math.abs(share - 2 / 3) < 0.02, `part de jour ${share.toFixed(4)}`)
  assert.equal(DAY_SHARE, 2 / 3)
  // Mesuré d'un coucher à l'autre, au centième de seconde près.
  assert.ok(Math.abs(day - 160) < 0.1, `jour ${day.toFixed(2)} s`)
})

test("l'heure avance toujours, sans saut, et revient sur elle-même chaque tour", () => {
  let prev = dayPhaseAt(0)
  let turned = 0
  // Pente maximale de l'heure : 1 / (1 − π/6) tour par tour d'horloge.
  const maxStep = (DT / DAY_SECONDS) / (1 - Math.PI / 6) + 1e-9
  for (let i = 1; i <= 2 * STEPS; i++) {
    const u = dayPhaseAt(i * DT)
    const d = step(prev, u)
    assert.ok(d > 0, `l'heure recule à t=${(i * DT).toFixed(2)}`)
    assert.ok(d <= maxStep, `saut d'heure ${d} à t=${(i * DT).toFixed(2)}`)
    if (u < prev) turned++
    prev = u
  }
  assert.equal(turned, 2, 'deux tours de cadran en deux journées')
  assert.ok(Math.abs(step(dayPhaseAt(37), dayPhaseAt(37 + DAY_SECONDS))) < 1e-9, 'périodique')
})

test('ni le soleil ni la lune ne sautent : hauteurs continues, lune qui file sans à-coup', () => {
  // La scène place la lune avec −hauteur du soleil et la fait glisser sur la
  // nuit avec nightPhase = (u − ½)·2 (render/scene.ts).
  const nightPhase = (u) => (u >= 0.5 ? (u - 0.5) * 2 : 0)
  let h = sunHeightAt(0)
  let u = dayPhaseAt(0)
  const bound = 2 * Math.PI * (DT / DAY_SECONDS) / (1 - Math.PI / 6) + 1e-9
  for (let i = 1; i <= STEPS; i++) {
    const t = i * DT
    const h2 = sunHeightAt(t)
    const u2 = dayPhaseAt(t)
    assert.ok(Math.abs(h2 - h) <= bound, `soleil : saut de ${Math.abs(h2 - h)} à t=${t.toFixed(2)}`)
    const moon = Math.max(0, -h)
    const moon2 = Math.max(0, -h2)
    assert.ok(Math.abs(moon2 - moon) <= bound, `lune : saut de hauteur à t=${t.toFixed(2)}`)
    // Au lever (u repasse par 0), la lune est sous l'horizon : son retour à
    // l'azimut de départ ne se voit pas.
    if (u2 > u) assert.ok(Math.abs(nightPhase(u2) - nightPhase(u)) <= 2 * bound, `lune : saut d'azimut à t=${t.toFixed(2)}`)
    else assert.ok(moon2 < 1e-3 && moon < 1e-3, `lune visible au lever à t=${t.toFixed(2)}`)
    h = h2
    u = u2
  }
})

test("l'aube et le crépuscule restent lisibles : ils durent autant qu'avant", () => {
  // Le crépuscule : de la part de jour pleine (k=1) à la nuit (k=0).
  const span = (fn) => {
    let s = 0
    for (let i = 0; i < STEPS; i++) {
      const k = fn(i * DT)
      if (k > 0.001 && k < 0.999) s += DT
    }
    return s / 2 // un crépuscule et une aube par tour
  }
  const ss = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  // L'horloge d'avant : u = 0,32 + t/240.
  const before = span((t) => ss(-0.06, 0.2, Math.sin((0.32 + t / DAY_SECONDS) * Math.PI * 2)))
  const after = span(daylightAt)
  assert.ok(after >= before * 0.95, `crépuscule ${after.toFixed(1)} s contre ${before.toFixed(1)} s avant`)
})

test("horloge et heure sont réciproques ; le compte à rebours du HUD tombe à l'heure dite", () => {
  for (let i = 0; i <= 1000; i++) {
    const c = i / 1000
    assert.ok(Math.abs(step(c, clockOfDayHour(dayHourOfClock(c)))) < 1e-12, `c=${c}`)
  }
  for (const target of [0.515, 0.985, 0.25, 0.75]) {
    for (const t0 of [0, 55, 131, 207]) {
      const s = secondsUntilDayHour(t0, target)
      assert.ok(s >= 0 && s < DAY_SECONDS)
      assert.ok(Math.abs(step(target, dayPhaseAt(t0 + s))) < 1e-9, `${target} depuis ${t0}`)
    }
  }
  // La nuit (du coucher au lever) dure moitié moins que le jour.
  // Une partie neuve commence l'après-midi : le coucher vient avant le lever.
  const night = secondsUntilDayHour(0, 0) - secondsUntilDayHour(0, 0.5)
  assert.ok(Math.abs(night - DAY_SECONDS / 3) < 1e-9, `nuit ${night} s`)
})

test('rendement : un tour rapporte autant qu’un tour de 3.69, à tous les planchers de nuit', () => {
  const ss = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  // Le tour de 3.69 : jour et nuit à parts égales, u uniforme dans le temps.
  let even = 0
  for (let i = 0; i < 4000; i++) even += ss(-0.06, 0.2, Math.sin(((i + 0.5) / 4000) * Math.PI * 2))
  even /= 4000
  for (const floor of [0.3, 0.55, 0.85, 0.92, 0.96, 1]) {
    const expected = floor + (1 - floor) * even
    assert.ok(Math.abs(meanLightFactor(floor) - expected) < 1e-3, `plancher ${floor}`)
  }
  assert.equal(lightScaleFor(1), 1)
})

test('hors ligne et en direct, un tour complet rapporte la même chose', () => {
  const NOW = 1_800_000_000_000
  const live = new Game(NOW)
  live.setFocus('wood')
  const twin = new Game(NOW)
  twin.setFocus('wood')
  const w0 = live.save.res.wood
  for (let t = 0; t < DAY_SECONDS; t += 0.25) live.tick(0.25, NOW + t * 1000)
  const t0 = twin.save.res.wood
  twin.creditAbsence(DAY_SECONDS)
  const a = live.save.res.wood - w0
  const b = twin.save.res.wood - t0
  assert.ok(a > 0 && Math.abs(a / b - 1) < 0.01, `direct ${a.toFixed(2)}, hors ligne ${b.toFixed(2)}`)
})

test("une seule horloge : aucune copie de la formule de l'heure hors de clock.ts", () => {
  const root = new URL('..', import.meta.url).pathname
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'blender' || name.startsWith('.')) continue
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|mjs|js)$/.test(name)) files.push(p)
    }
  }
  for (const d of ['src', 'tests', 'tools', 'server']) walk(join(root, d))
  const self = new URL(import.meta.url).pathname
  const offenders = []
  for (const p of files) {
    if (p.endsWith('src/game/clock.ts') || p === self) continue
    readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      // L'ancienne constante d'aube, ou la fraction de journée tirée à la main
      // du temps de jeu (« … / DAY_SECONDS) % 1 », « % DAY_SECONDS) / DAY_SECONDS »).
      if (/\bDAY_START\b/.test(line) || /DAY_SECONDS\s*\)?\s*%\s*1\b/.test(line) || /%\s*DAY_SECONDS\s*\)?\s*\/\s*DAY_SECONDS/.test(line)) {
        offenders.push(`${relative(root, p)}:${i + 1}`)
      }
    })
  }
  assert.deepEqual(offenders, [], "dériver l'heure avec dayPhaseAt (src/game/clock.ts)")
})
