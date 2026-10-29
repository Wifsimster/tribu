#!/usr/bin/env node
import { mkdir, writeFile, readFile, stat, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mergeCredits } from './credits-file.mjs'

const run = promisify(execFile)

async function normalize(file, kind) {
  const tmp = `${file}.tmp.mp3`
  await run('ffmpeg', [
    '-y', '-i', file,
    '-af', `loudnorm=I=${kind === 'bed' ? -23 : -18}:LRA=7:TP=-1.5`,
    '-c:a', 'libmp3lame', '-q:a', kind === 'bed' ? '7' : '4', tmp,
  ])
  await rename(tmp, file)
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'audio')
const API = 'https://api.elevenlabs.io/v1/sound-generation'

const FORMATS = { bed: 'mp3_22050_32', shot: 'mp3_44100_128' }

const SOUNDS = [
  {
    id: 'mer',
    kind: 'bed',
    seconds: 12,
    text: 'Calm gentle ocean waves lapping on a small pebble beach, close and intimate, steady rhythm, no wind, no seagulls, no music, clean field recording',
  },
  {
    id: 'feu',
    kind: 'bed',
    seconds: 10,
    text: 'Small cozy campfire burning steadily, soft continuous crackle, close microphone, no big pops, no wind, no music, clean field recording',
  },
  {
    id: 'pluie',
    kind: 'bed',
    seconds: 12,
    text: 'Steady light rain falling on grass and leaves, soft and even, no thunder, no wind gusts, no music, clean field recording',
  },
  {
    id: 'bourdon',
    kind: 'bed',
    seconds: 8,
    text: 'Low steady electrical hum of a street lamp ballast, continuous drone, clear and present, no buzzing insects, no music',
  },
  {
    id: 'bois',
    kind: 'shot',
    seconds: 1,
    text: 'One single axe chop into a tree trunk, dry wooden crack, close, short, outdoors, no echo, no music',
  },
  {
    id: 'pierre',
    kind: 'shot',
    seconds: 1,
    text: 'One single stone pick striking rock, sharp mineral crack with small debris, close, short, no echo, no music',
  },
  {
    id: 'cueillette',
    kind: 'shot',
    seconds: 1,
    text: 'One short rustle of hands pulling leaves and berries from a bush, dry foliage, close, brief, no music',
  },
  {
    id: 'chasse',
    kind: 'shot',
    seconds: 1.2,
    text: 'One spear thrust into hide and straw, dull thud with a short fibrous tear, close, brief, no music, no animal cry',
  },

  {
    id: 'toc',
    kind: 'shot',
    seconds: 0.8,
    text: 'One single dull knock on a thick wooden log, dry, close, short decay, no reverb, no music',
  },
  {
    id: 'carillon',
    kind: 'shot',
    seconds: 1.6,
    text: 'One short bright glassy chime, single soft note, gentle sparkle, warm decay, no melody, no music bed',
  },
  {
    id: 'piece',
    kind: 'shot',
    seconds: 1,
    text: 'Two small bronze coins clinking together once, dry and close, short, no reverb, no music',
  },
  {
    id: 'plouf',
    kind: 'shot',
    seconds: 1,
    text: 'One small stone plopping into calm water, close, short, gentle, no splash of a big object, no music',
  },
  {
    id: 'cloche',
    kind: 'shot',
    seconds: 4,
    text: 'One strike of a small distant village church bell, medieval, long natural tail, outdoors, no music, no crowd',
  },
]

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const val = (f) => args.find((a) => a.startsWith(`${f}=`))?.split('=')[1]
const dry = has('--dry-run')
const force = has('--force')
const only = val('--only')?.split(',').map((s) => s.trim())
const formatOverride = val('--format')

const wanted = only ? SOUNDS.filter((s) => only.includes(s.id)) : SOUNDS

const credits = wanted.reduce((n, s) => n + Math.ceil(s.seconds * 40), 0)

console.log(
  `${wanted.length} son(s) à générer — ~${credits} crédits ` +
    `(${((credits / 10000) * 100).toFixed(0)} % du quota mensuel gratuit).\n`,
)

if (dry) {
  for (const s of wanted) {
    const fmt = formatOverride ?? FORMATS[s.kind]
    console.log(`· ${s.id.padEnd(9)} ${String(s.seconds).padStart(4)} s  ${s.kind === 'bed' ? 'boucle' : 'coup  '}  ${fmt}`)
    console.log(`  « ${s.text} »\n`)
  }
  console.log('Rien n’a été appelé (--dry-run).')
  process.exit(0)
}

const key = process.env.ELEVENLABS_API_KEY
if (!key) {
  console.error('ELEVENLABS_API_KEY manquante — la clé du palier gratuit suffit :')
  console.error('  https://elevenlabs.io → compte gratuit → Profile → API key')
  console.error('10 000 crédits/mois, usage non commercial. La série complète en coûte ~3 000.')
  process.exit(1)
}

await mkdir(OUT, { recursive: true })

let written = 0
let bytes = 0
const generated = {}
for (const s of wanted) {
  const fmt = formatOverride ?? FORMATS[s.kind]
  const file = join(OUT, `${s.id}.mp3`)
  if (!force) {
    const existing = await stat(file).catch(() => null)
    if (existing) {
      console.log(`= ${s.id} — déjà là (${(existing.size / 1024).toFixed(0)} ko), --force pour refaire`)
      continue
    }
  }
  const body = {
    text: s.text,
    duration_seconds: s.seconds,
    prompt_influence: 0.6,
    model_id: 'eleven_text_to_sound_v2',
    loop: s.kind === 'bed',
    output_format: fmt,
  }
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    console.error(`✗ ${s.id} — HTTP ${res.status} : ${(await res.text()).slice(0, 300)}`)
    continue
  }
  const buf = Buffer.from(await res.arrayBuffer())
  await writeFile(file, buf)
  await normalize(file, s.kind)
  written++
  const st = await stat(file)
  bytes += st.size
  generated[s.id] =
    `- **${s.id}** — généré avec ElevenLabs (text-to-sound-effects), palier gratuit, usage non commercial · ` +
    `prompt : « ${s.text} » · tools/gen-sfx.mjs`
  console.log(`✓ ${s.id.padEnd(9)} ${(st.size / 1024).toFixed(0).padStart(4)} ko  ${fmt}`)
}

if (Object.keys(generated).length > 0) {
  const creditsFile = join(OUT, 'CREDITS.md')
  const existing = await readFile(creditsFile, 'utf8').catch(() => null)
  await writeFile(creditsFile, mergeCredits(existing, generated))
}

console.log(`\n${written} fichier(s), ${(bytes / 1024).toFixed(0)} ko au total dans public/audio/.`)
console.log('Écoute-les avant de les câbler : une génération est un tirage, pas un rendu déterministe.')
