#!/usr/bin/env node
import { mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { mergeCredits } from './credits-file.mjs'

const run = promisify(execFile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'audio')
const TMP = '/tmp/tribu-cc-sfx'
const API = 'https://commons.wikimedia.org/w/api.php'
const UA = 'tribu-sfx/1.0 (jeu personnel; https://tribu.battistella.ovh)'

const BED = { rate: 22050, bitrate: '32k' }
const SHOT = { rate: 44100, bitrate: '96k' }
const CROSSFADE = 1.5

const LICENSES = [/^cc0/i, /^public domain/i, /^cc by 4/i, /^cc by 3/i, /^cc by-sa 4/i, /^cc by-sa 3/i]
const licenseRank = (l) => {
  const i = LICENSES.findIndex((re) => re.test(l ?? ''))
  return i < 0 ? 99 : i
}

const BANNED = /(ISRC|^LL-Q|pronunciation|prononciation|spoken|wikipedia|song|music|rock|guitar|piano|interview|speech|voice|reading|hymn|anthem)/i

const SOUNDS = [
  {
    id: 'cloche',
    kind: 'shot',
    seconds: 6,
    queries: ['church bell single strike', 'church bell', 'bell tower ringing'],
    want: /bell/i,
    dur: [2, 30],
  },
  {
    id: 'oiseaux',
    kind: 'bed',
    source: {
      title: 'Dawn Chorus - Gloucestershire - May 2016',
      author: 'mike_stranks',
      license: 'CC0 1.0',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      page: 'https://freesound.org/people/mike_stranks/sounds/345484/',
      url: 'https://cdn.freesound.org/previews/345/345484_5385809-hq.mp3',
      sha256: '1132530ea48a1dd55d28dee4f759e51adc2b2b0a83d362d2e67da94cf70296b4',
    },
    loop: { start: 290, seconds: 18, crossfade: 2, highpass: 250 },
  },
  {
    id: 'nuit',
    kind: 'bed',
    source: {
      title: 'Crickets Ambient Noise - loopable (crickets-oneloop.mp3)',
      author: 'Ted Kerr (wolfgang)',
      license: 'CC0 1.0',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      page: 'https://opengameart.org/content/crickets-ambient-noise-loopable',
      url: 'https://opengameart.org/sites/default/files/crickets-oneloop.mp3',
      sha256: '3b26c4d529c722716eac9eab52f64cf4e7507d35f8cd4e01ff08b097a2746cbd',
    },
    loop: { start: 1, period: 505036 / 44100 },
  },
  {
    id: 'pluie',
    kind: 'bed',
    seconds: 12,
    queries: ['rain ambience', 'rain on leaves'],
    want: /rain/i,
    avoid: /(thunder|storm|traffic|car|city|urban)/i,
    dur: [10, 240],
  },
]

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const val = (f) => args.find((a) => a.startsWith(`${f}=`))?.split('=')[1]
const only = val('--only')?.split(',').map((s) => s.trim())
const force = has('--force')
const wanted = only ? SOUNDS.filter((s) => only.includes(s.id)) : SOUNDS

async function search(term) {
  const u = new URL(API)
  u.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: `filetype:audio ${term}`,
    gsrlimit: '20',
    gsrnamespace: '6',
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
  })
  const res = await fetch(u, { headers: { 'user-agent': UA } })
  if (!res.ok) throw new Error(`Commons HTTP ${res.status}`)
  const json = await res.json()
  return Object.values(json.query?.pages ?? {}).map((p) => {
    const ii = p.imageinfo?.[0] ?? {}
    const meta = ii.extmetadata ?? {}
    return {
      title: p.title.replace(/^File:/, ''),
      url: ii.url,
      mime: ii.mime,
      size: ii.size ?? 0,
      license: meta.LicenseShortName?.value ?? '?',
      licenseUrl: meta.LicenseUrl?.value ?? '',
      author: (meta.Artist?.value ?? '').replace(/<[^>]*>/g, '').trim().slice(0, 60),
      page: `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}`,
    }
  })
}

async function pick(s) {
  if (s.source) return s.source
  const seen = new Map()
  for (const q of s.queries) {
    for (const r of await search(q)) {
      if (!r.url || !/(audio|ogg)/.test(r.mime ?? '')) continue
      if (licenseRank(r.license) >= 99) continue
      if (BANNED.test(r.title)) continue
      if (s.want && !s.want.test(r.title)) continue
      if (s.avoid && s.avoid.test(r.title)) continue
      if (r.size > 60 * 1024 * 1024) continue
      if (!seen.has(r.title)) seen.set(r.title, r)
    }
  }
  return [...seen.values()].sort((a, b) => licenseRank(a.license) - licenseRank(b.license))[0] ?? null
}

async function duration(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
  ])
  return Number.parseFloat(stdout.trim()) || 0
}

async function loudness(file) {
  const { stderr } = await run('ffmpeg', ['-nostats', '-hide_banner', '-i', file, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'])
  const m = /I:\s+(-?[\d.]+) LUFS/.exec(stderr.slice(stderr.lastIndexOf('Summary')))
  if (!m) throw new Error(`sonie illisible pour ${file}`)
  return Number(m[1])
}

async function pinnedLoop(inFile, outFile, s) {
  const { start, seconds, crossfade: x, highpass, period } = s.loop
  const r = BED.rate
  const pre = `aformat=channel_layouts=mono,aresample=${r}${highpass ? `,highpass=f=${highpass}` : ''}`
  const window = `${pre},atrim=start=${start}:end=${start + seconds + x},asetpts=PTS-STARTPTS`
  const graph = period
    ?
      `[0:a]${pre},atrim=start_sample=${Math.round(start * r)}:end_sample=${Math.round(start * r) + Math.round(period * r)},asetpts=PTS-STARTPTS[out]`
    :
      `[0:a]${window},atrim=start=${x},asetpts=PTS-STARTPTS[body];` +
      `[1:a]${window},atrim=end=${x},asetpts=PTS-STARTPTS[head];` +
      `[body][head]acrossfade=d=${x}:c1=qsin:c2=qsin[out]`
  const wav = `${inFile}.wav`
  const inputs = period ? ['-i', inFile] : ['-i', inFile, '-i', inFile]
  await run('ffmpeg', ['-y', ...inputs, '-filter_complex', graph, '-map', '[out]', '-c:a', 'pcm_f32le', wav])
  const gain = -23 - (await loudness(wav))
  await run('ffmpeg', ['-y', '-i', wav, '-af', `volume=${gain.toFixed(2)}dB`, '-ar', String(r), '-ac', '1', '-b:a', BED.bitrate, outFile])
  const got = await duration(outFile)
  if (got < (period ?? seconds) - 0.1) throw new Error(`boucle de ${got.toFixed(2)} s, ${period ?? seconds} s attendues`)
}

async function postProcess(inFile, outFile, s) {
  if (s.loop) return pinnedLoop(inFile, outFile, s)
  const p = s.kind === 'bed' ? BED : SHOT
  const total = await duration(inFile)
  if (s.kind === 'bed') {
    const x = CROSSFADE
    const skip = Math.max(0, Math.min(5, total - s.seconds - 0.5))
    const need = s.seconds + 1
    const pre = total - skip < need ? `aloop=loop=${Math.ceil(need / Math.max(1, total - skip))}:size=2e9,` : ''
    await run('ffmpeg', [
      '-y', '-ss', String(skip), '-i', inFile, '-ss', String(skip), '-i', inFile,
      '-filter_complex',
      `[0:a]${pre}atrim=start=${x}:end=${s.seconds},asetpts=PTS-STARTPTS[body];` +
        `[1:a]${pre}atrim=start=0:end=${x},asetpts=PTS-STARTPTS[head];` +
        `[body][head]acrossfade=d=${x}:c1=tri:c2=tri,loudnorm=I=-23:LRA=7[out]`,
      '-map', '[out]', '-ar', String(p.rate), '-ac', '1', '-b:a', p.bitrate, outFile,
    ])
  } else {
    await run('ffmpeg', [
      '-y', '-i', inFile,
      '-af',
      'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,' +
        `atrim=end=${Math.min(s.seconds, Math.max(1, total))},asetpts=PTS-STARTPTS,` +
        `afade=t=out:st=${Math.max(0.3, Math.min(s.seconds, total) - 1)}:d=1,` +
        'loudnorm=I=-18:LRA=7',
      '-ar', String(p.rate), '-ac', '1', '-b:a', p.bitrate, outFile,
    ])
  }
}

if (has('--dry-run')) {
  for (const s of wanted) {
    const hit = await pick(s)
    console.log(
      `· ${s.id.padEnd(8)} ${hit ? `[${hit.license}] ${hit.title.slice(0, 55)}` : 'AUCUN CANDIDAT'}`,
    )
  }
  console.log('\nRien n’a été téléchargé (--dry-run). Coût : 0 €, aucun compte.')
  process.exit(0)
}

await mkdir(OUT, { recursive: true })
await mkdir(TMP, { recursive: true })

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
      console.error(`✗ ${s.id} — aucun candidat sous licence libre`)
      continue
    }
    const raw = join(TMP, `${s.id}-raw`)
    const dl = await fetch(hit.url, { headers: { 'user-agent': UA } })
    if (!dl.ok) throw new Error(`téléchargement HTTP ${dl.status}`)
    const body = Buffer.from(await dl.arrayBuffer())
    if (hit.sha256) {
      const got = createHash('sha256').update(body).digest('hex')
      if (got !== hit.sha256) throw new Error(`empreinte inattendue (${got}) : la source a changé`)
    }
    await writeFile(raw, body)
    await postProcess(raw, outFile, s)
    const st = await stat(outFile)
    written++
    bytes += st.size
    credits[s.id] =
      `- **${s.id}** — « ${hit.title} »${hit.author ? ` par ${hit.author}` : ''} · ` +
      `${hit.license}${hit.licenseUrl ? ` (${hit.licenseUrl})` : ''} · ${hit.page} · ` +
      (s.loop
        ? `fichier ${hit.url} · retaillé (${s.loop.period ? 'une période exacte' : `extrait de ${s.loop.start} s, boucle par fondu`}, mono, gain linéaire) par tools/fetch-cc-sfx.mjs`
        : `retaillé (${s.kind === 'bed' ? 'boucle et fondu' : 'détourage et fondu'}) par tools/fetch-cc-sfx.mjs`)
    console.log(`✓ ${s.id.padEnd(8)} ${(st.size / 1024).toFixed(0).padStart(4)} ko  [${hit.license}] ${hit.title.slice(0, 45)}`)
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
console.log(`\n${written} fichier(s), ${(bytes / 1024).toFixed(0)} ko. Aucun compte, aucun euro.`)
