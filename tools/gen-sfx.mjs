#!/usr/bin/env node
/**
 * gen-sfx.mjs — génère les sons de Tribu avec ElevenLabs (text-to-sound-effects).
 *
 * L'ambiance du jeu est aujourd'hui 100 % synthétisée dans le navigateur
 * (src/audio/ambience.ts) : zéro octet d'asset, boucles parfaites, et des
 * paramètres qui suivent l'état du jeu. Ce script sert à REMPLACER
 * sélectivement ce qui sonne le plus « synthé » — les nappes d'ambiance et
 * les sons d'interaction — sans toucher à la couche paramétrique.
 *
 * PALIER GRATUIT (choix assumé de Damien, jeu personnel non monétisé) :
 * 10 000 crédits par mois, usage NON COMMERCIAL, attribution demandée. La
 * série complète coûte ~3 000 crédits, soit moins d'un tiers du quota
 * mensuel — et on ne la génère qu'une fois. Si le jeu devait un jour être
 * monétisé, il faudrait soit un plan Starter, soit repasser par la banque
 * CC0 : tools/fetch-sfx.mjs fait exactement le même travail, gratuitement et
 * sans clause d'usage.
 *
 *   ELEVENLABS_API_KEY=... node tools/gen-sfx.mjs --dry-run
 *   ELEVENLABS_API_KEY=... node tools/gen-sfx.mjs --only=toc,carillon
 *   ELEVENLABS_API_KEY=... node tools/gen-sfx.mjs --force
 *
 * Options :
 *   --dry-run     n'appelle rien : affiche les prompts et le coût estimé
 *   --only=a,b    ne génère que ces identifiants
 *   --force       régénère même si le fichier existe déjà
 *   --format=...  format de sortie (défaut : par catégorie, voir FORMATS)
 *
 * Les fichiers atterrissent dans public/audio/<id>.mp3. Rien n'est écrasé
 * sans --force : une génération réussie est un tirage, on la garde.
 */
import { mkdir, writeFile, stat, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Le modèle rend des niveaux très inégaux d'un tirage à l'autre (mesuré :
 *  de -23 dB à -64 dB de moyenne sur la même série). Ces sons se mélangent à
 *  un synthé calibré : ils doivent viser la même cible de sonie. */
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

/** Nappes : longues, bouclées, jouées en continu. Un débit modeste suffit —
 *  ce sont des textures larges, personne n'y cherche un aigu cristallin, et
 *  chaque kilo-octet est payé au chargement de la PWA.
 *  Sons d'interaction : courts, joués au premier plan, pleine qualité. */
const FORMATS = { bed: 'mp3_22050_32', shot: 'mp3_44100_128' }

/** Les prompts sont en ANGLAIS : le modèle y est nettement plus obéissant.
 *  Chacun dit aussi ce qu'il ne veut PAS — c'est ce qui évite les nappes
 *  « cinématiques » avec nappe de synthé et coup de tonnerre dramatique. */
const SOUNDS = [
  // ── Nappes d'ambiance (bouclées) ────────────────────────────────────────
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
    id: 'nuit',
    kind: 'bed',
    seconds: 12,
    text: 'Summer night field ambience, sparse crickets chirping at a distance, very quiet, no birds, no wind, no music, clean field recording',
  },
  {
    id: 'oiseaux',
    kind: 'bed',
    seconds: 12,
    text: 'Early morning forest birdsong, a few small birds at a distance, sparse and calm, no wind, no water, no music, clean field recording',
  },
  {
    id: 'bourdon',
    kind: 'bed',
    seconds: 8,
    text: 'Low steady electrical hum of a street lamp ballast, continuous drone, clear and present, no buzzing insects, no music',
  },
  // ── Le travail du colon : un son PAR COUP, déclenché par l'animation ────
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

  // ── Sons d'interaction (coups uniques) ──────────────────────────────────
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

/** Tarif public au moment de l'écriture : 40 crédits par seconde quand la
 *  durée est imposée (ce qu'on fait ici, pour des boucles régulières), ou
 *  ~0,02 $ par effet en paiement à la génération. */
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
    // Prompt suivi de près : sans ça le modèle « embellit » (nappes, reverb).
    prompt_influence: 0.6,
    model_id: 'eleven_text_to_sound_v2',
    // Une nappe doit boucler sans couture — c'est tout l'intérêt face au synthé.
    loop: s.kind === 'bed',
    output_format: fmt,
  }
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    // Le corps d'erreur liste les valeurs acceptées : on le montre tel quel.
    console.error(`✗ ${s.id} — HTTP ${res.status} : ${(await res.text()).slice(0, 300)}`)
    continue
  }
  const buf = Buffer.from(await res.arrayBuffer())
  await writeFile(file, buf)
  await normalize(file, s.kind)
  written++
  const st = await stat(file)
  bytes += st.size
  console.log(`✓ ${s.id.padEnd(9)} ${(st.size / 1024).toFixed(0).padStart(4)} ko  ${fmt}`)
}

console.log(`\n${written} fichier(s), ${(bytes / 1024).toFixed(0)} ko au total dans public/audio/.`)
console.log('Écoute-les avant de les câbler : une génération est un tirage, pas un rendu déterministe.')
