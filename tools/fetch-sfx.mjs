#!/usr/bin/env node
import { mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mergeCredits } from './credits-file.mjs'

const run = promisify(execFile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'audio')
const TMP = '/tmp/tribu-sfx'
const API = 'https://freesound.org/apiv2/search/text/'

const BED = { rate: 22050, bitrate: '32k' }
const SHOT = { rate: 44100, bitrate: '96k' }
const CROSSFADE = 1.5

const SOUNDS = [
  { id: 'mer', kind: 'bed', seconds: 12, query: 'calm sea waves small shore', dur: [10, 90] },
  { id: 'feu', kind: 'bed', seconds: 10, query: 'campfire crackling close', dur: [8, 90] },
  { id: 'pluie', kind: 'bed', seconds: 12, query: 'light rain leaves no thunder', dur: [10, 90] },
  { id: 'bourdon', kind: 'bed', seconds: 8, query: 'electric hum lamp buzz', dur: [5, 60] },
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

const credits = {}
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
    credits[s.id] = `- **${s.id}** — « ${hit.name} » par ${hit.username} · CC0 · freesound #${hit.id} · ${hit.url}`
    console.log(`✓ ${s.id.padEnd(9)} ${(st.size / 1024).toFixed(0).padStart(4)} ko  ← #${hit.id} ${hit.name.slice(0, 40)}`)
  } catch (e) {
    console.error(`✗ ${s.id} — ${e.message}`)
  }
}

if (Object.keys(credits).length > 0) {
  const file = join(OUT, 'CREDITS.md')
  const existing = await readFile(file, 'utf8').catch(() => null)
  await writeFile(file, mergeCredits(existing, credits))
}
await rm(TMP, { recursive: true, force: true })

console.log(`\n${written} fichier(s), ${(bytes / 1024).toFixed(0)} ko au total. Coût : 0 €.`)
console.log('Écoute-les avant de câbler : une banque, ça se trie à l’oreille.')
