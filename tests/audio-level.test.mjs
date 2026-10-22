// Aucun son de public/audio ne doit être quasi muet. Un fichier silencieux se
// charge et se décode sans erreur : le jeu coupe alors son repli synthétisé et
// joue… du silence (c'est arrivé : oiseaux.mp3 à -91 dB jusqu'à la 3.61.0).
// La mesure passe par ffmpeg (volumedetect), déjà requis par tools/. Sans
// ffmpeg, le test est sauté en local ; en CI il échoue, pour ne jamais passer
// en silence.
//   corepack pnpm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('../public/audio/', import.meta.url))
const sounds = readdirSync(dir).filter((f) => f.endsWith('.mp3')).sort()

/** Sonie moyenne en dBFS. */
function meanVolume(file) {
  // volumedetect écrit sa mesure sur stderr.
  const r = spawnSync('ffmpeg', ['-nostats', '-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], {
    encoding: 'utf8',
  })
  const m = /mean_volume: (-?[\d.]+|-inf) dB/.exec(r.stderr ?? '')
  assert.ok(m, `pas de mesure de sonie pour ${file}`)
  return m[1] === '-inf' ? -Infinity : Number(m[1])
}

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

test('ffmpeg est disponible en CI pour mesurer les sons', { skip: !process.env.CI }, () => {
  assert.ok(hasFfmpeg, 'ffmpeg introuvable : la mesure de sonie ne peut pas tourner')
})

test('aucun son de public/audio n’est quasi muet (sonie moyenne ≥ -50 dB)', { skip: !hasFfmpeg && 'ffmpeg absent' }, () => {
  assert.ok(sounds.length > 0, 'aucun son trouvé')
  const quiet = sounds
    .map((f) => [f, meanVolume(`${dir}${f}`)])
    .filter(([, db]) => db < -50)
    .map(([f, db]) => `${f} (${db} dB)`)
  assert.deepEqual(quiet, [], 'sons quasi muets')
})
