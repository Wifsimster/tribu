#!/usr/bin/env node
/**
 * fetch-sfx.mjs — les sons de Tribu, gratuitement et sans risque de licence.
 *
 * POURQUOI PAS DE GÉNÉRATION IA : les modèles hébergés (ElevenLabs et
 * consorts) ne donnent la licence commerciale qu'à partir d'un plan payant,
 * et les modèles ouverts qui tourneraient ici sont soit non commerciaux
 * (AudioGen, AudioLDM 2), soit trop lourds pour cette machine sans GPU.
 * Une banque CC0 donne un meilleur résultat, pour zéro euro et zéro doute :
 * le CC0 est un abandon de droits, il n'y a rien à respecter ensuite.
 *
 * Source : Freesound, filtré sur `license:"Creative Commons 0"`. La clé API
 * est gratuite (simple inscription, aucun moyen de paiement) :
 *   https://freesound.org/apiv2/apply/
 *
 * Sans clé du tout : Kenney (kenney.nl, tout en CC0) et les bundles GDC de
 * Sonniss (libres de droits) se téléchargent à la main — voir --sources.
 *
 *   node tools/fetch-sfx.mjs --dry-run
 *   FREESOUND_API_KEY=... node tools/fetch-sfx.mjs
 *   FREESOUND_API_KEY=... node tools/fetch-sfx.mjs --only=toc,carillon --force
 *
 * Chaque son est post-traité par ffmpeg : les nappes deviennent des BOUCLES
 * SANS COUTURE (la queue est fondue sur la tête), les sons d'interaction sont
 * détourés et normalisés. Tout atterrit dans public/audio/, avec un
 * CREDITS.md qui trace l'origine de chaque fichier.
 */
import { mkdir, writeFile, stat, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'audio')
const TMP = '/tmp/tribu-sfx'
const API = 'https://freesound.org/apiv2/search/text/'

/** Une nappe : longue, bouclée, jouée en fond. Un débit modeste suffit, et
 *  chaque kilo-octet se paie au chargement de la PWA.
 *  Un son d'interaction : court, au premier plan, plus de définition. */
const BED = { rate: 22050, bitrate: '32k' }
const SHOT = { rate: 44100, bitrate: '96k' }
/** Durée du fondu tête/queue qui rend une nappe bouclable. */
const CROSSFADE = 1.5

const SOUNDS = [
  // ── Nappes ──────────────────────────────────────────────────────────────
  { id: 'mer', kind: 'bed', seconds: 12, query: 'calm sea waves small shore', dur: [10, 90] },
  { id: 'feu', kind: 'bed', seconds: 10, query: 'campfire crackling close', dur: [8, 90] },
  { id: 'pluie', kind: 'bed', seconds: 12, query: 'light rain leaves no thunder', dur: [10, 90] },
  { id: 'nuit', kind: 'bed', seconds: 12, query: 'crickets night field', dur: [10, 90] },
  { id: 'oiseaux', kind: 'bed', seconds: 12, query: 'forest birds morning ambience', dur: [10, 90] },
  { id: 'bourdon', kind: 'bed', seconds: 8, query: 'electric hum lamp buzz', dur: [5, 60] },
  // ── Sons d'interaction ──────────────────────────────────────────────────
  { id: 'toc', kind: 'shot', seconds: 1, query: 'knock wood single', dur: [0.2, 3] },
  { id: 'carillon', kind: 'shot', seconds: 2, query: 'soft chime bell single', dur: [0.3, 5] },
  { id: 'piece', kind: 'shot', seconds: 1.2, query: 'coins clink small', dur: [0.2, 4] },
  { id: 'plouf', kind: 'shot', seconds: 1.2, query: 'water drop plop', dur: [0.2, 4] },
  { id: 'cloche', kind: 'shot', seconds: 5, query: 'church bell distant single strike', dur: [2, 12] },
]

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const val = (f) => args.find((a) => a.startsWith(`${f}=`))?.split('=')[1]
const only = val('--only')?.split(',').map((s) => s.trim())
const force = has('--force')
const wanted = only ? SOUNDS.filter((s) => only.includes(s.id)) : SOUNDS

if (has('--sources')) {
  console.log(`Sans aucune inscription :
  · Kenney — kenney.nl/assets?q=audio — tout en CC0, packs « Interface Sounds »,
    « Impact Sounds », « RPG Audio ». Idéal pour toc / carillon / pièce.
  · Sonniss GDC Bundle — sonniss.com/gameaudiogdc — libre de droits, dizaines
    de giga de prises de son réelles. Idéal pour les nappes.
  · Pixabay Sound Effects — pixabay.com/sound-effects — licence maison
    permissive, API gratuite elle aussi.

Avec une clé Freesound (gratuite, sans moyen de paiement) : ce script fait tout.`)
  process.exit(0)
}

if (has('--dry-run')) {
  console.log(`${wanted.length} son(s), tous filtrés sur license:"Creative Commons 0" :\n`)
  for (const s of wanted) {
    const p = s.kind === 'bed' ? BED : SHOT
    console.log(
      `· ${s.id.padEnd(9)} ${s.kind === 'bed' ? `boucle ${s.seconds} s` : `coup  ${s.seconds} s`}` +
        `  ${p.rate} Hz ${p.bitrate}  ← « ${s.query} » (${s.dur[0]}–${s.dur[1]} s)`,
    )
  }
  console.log('\nCoût : 0 €. Rien n’a été appelé (--dry-run).')
  process.exit(0)
}

const key = process.env.FREESOUND_API_KEY
if (!key) {
  console.error('FREESOUND_API_KEY manquante — la clé est gratuite : https://freesound.org/apiv2/apply/')
  console.error('Ou `node tools/fetch-sfx.mjs --sources` pour les banques sans inscription.')
  process.exit(1)
}

await mkdir(OUT, { recursive: true })
await mkdir(TMP, { recursive: true })

/** Le meilleur candidat CC0 : on trie par téléchargements — sur Freesound
 *  c'est le signal de qualité le plus fiable, la note moyenne étant souvent
 *  portée par deux votes. */
async function pick(s) {
  const url = new URL(API)
  url.searchParams.set('query', s.query)
  url.searchParams.set(
    'filter',
    `license:"Creative Commons 0" duration:[${s.dur[0]} TO ${s.dur[1]}]`,
  )
  url.searchParams.set('sort', 'downloads_desc')
  url.searchParams.set('page_size', '10')
  url.searchParams.set('fields', 'id,name,username,license,duration,previews,url')
  url.searchParams.set('token', key)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`recherche HTTP ${res.status} : ${(await res.text()).slice(0, 200)}`)
  const json = await res.json()
  return json.results?.[0] ?? null
}

/** Post-traitement. Une nappe est bouclée en fondant sa tête sur sa queue :
 *  le fichier obtenu se rejoue à l'infini sans clic. Un son d'interaction est
 *  détouré (silence de tête coupé) puis normalisé. */
async function postProcess(inFile, outFile, s) {
  const p = s.kind === 'bed' ? BED : SHOT
  if (s.kind === 'bed') {
    const x = CROSSFADE
    await run('ffmpeg', [
      '-y', '-i', inFile, '-i', inFile,
      '-filter_complex',
      `[0:a]atrim=start=${x}:end=${s.seconds},asetpts=PTS-STARTPTS[body];` +
        `[1:a]atrim=start=0:end=${x},asetpts=PTS-STARTPTS[head];` +
        `[body][head]acrossfade=d=${x}:c1=tri:c2=tri,loudnorm=I=-23:LRA=7[out]`,
      '-map', '[out]', '-ar', String(p.rate), '-ac', '1', '-b:a', p.bitrate, outFile,
    ])
  } else {
    await run('ffmpeg', [
      '-y', '-i', inFile,
      '-af',
      `silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02,` +
        `atrim=end=${s.seconds},asetpts=PTS-STARTPTS,loudnorm=I=-18:LRA=7`,
      '-ar', String(p.rate), '-ac', '1', '-b:a', p.bitrate, outFile,
    ])
  }
}

const credits = []
let written = 0
let bytes = 0

for (const s of wanted) {
  const outFile = join(OUT, `${s.id}.mp3`)
  if (!force) {
    const existing = await stat(outFile).catch(() => null)
    if (existing) {
      console.log(`= ${s.id} — déjà là (${(existing.size / 1024).toFixed(0)} ko)`)
      continue
    }
  }
  try {
    const hit = await pick(s)
    if (!hit) {
      console.error(`✗ ${s.id} — aucun résultat CC0 pour « ${s.query} »`)
      continue
    }
    const preview = hit.previews?.['preview-hq-mp3']
    if (!preview) {
      console.error(`✗ ${s.id} — pas d'aperçu téléchargeable (#${hit.id})`)
      continue
    }
    const raw = join(TMP, `${s.id}-raw.mp3`)
    const dl = await fetch(preview)
    if (!dl.ok) throw new Error(`téléchargement HTTP ${dl.status}`)
    await writeFile(raw, Buffer.from(await dl.arrayBuffer()))
    await postProcess(raw, outFile, s)
    const st = await stat(outFile)
    written++
    bytes += st.size
    credits.push(
      `- **${s.id}** — « ${hit.name} » par ${hit.username} · CC0 · freesound #${hit.id} · ${hit.url}`,
    )
    console.log(`✓ ${s.id.padEnd(9)} ${(st.size / 1024).toFixed(0).padStart(4)} ko  ← #${hit.id} ${hit.name.slice(0, 40)}`)
  } catch (e) {
    console.error(`✗ ${s.id} — ${e.message}`)
  }
}

if (credits.length > 0) {
  await writeFile(
    join(OUT, 'CREDITS.md'),
    `# Origine des sons\n\nTous les fichiers de ce dossier viennent de Freesound sous licence\n**CC0** (domaine public) et ont été retaillés par \`tools/fetch-sfx.mjs\`.\nLe CC0 n'oblige à rien — cette liste est là pour la traçabilité, et parce\nque citer ses sources est la moindre des choses.\n\n${credits.join('\n')}\n`,
  )
}
await rm(TMP, { recursive: true, force: true })

console.log(`\n${written} fichier(s), ${(bytes / 1024).toFixed(0)} ko au total. Coût : 0 €.`)
console.log('Écoute-les avant de câbler : une banque, ça se trie à l’oreille.')
