#!/usr/bin/env node
/**
 * fetch-cc-sfx.mjs — des sons réels pour Tribu, SANS AUCUN COMPTE.
 *
 * ElevenLabs et Freesound demandent tous deux une inscription (vérification
 * d'e-mail, conditions à accepter) : impossible de la faire à la place du
 * joueur. Wikimedia Commons, lui, s'interroge sans clé et sans compte, et
 * expose la licence de chaque fichier dans ses métadonnées.
 *
 * On ne prend QUE ce qui bat franchement le synthétiseur maison : une vraie
 * cloche, de vrais oiseaux, de vrais grillons. Le reste de l'ambiance reste
 * synthétisé — il est paramétrique (le feu suit le foyer, la houle enfle) et
 * un échantillon ne sait pas faire ça.
 *
 *   node tools/fetch-cc-sfx.mjs --dry-run
 *   node tools/fetch-cc-sfx.mjs
 *   node tools/fetch-cc-sfx.mjs --only=cloche --force
 *
 * Les licences acceptées sont classées par ordre de préférence : CC0 d'abord
 * (rien à respecter), puis CC BY / CC BY-SA (attribution obligatoire, écrite
 * dans public/audio/CREDITS.md). Tout le reste est ignoré.
 */
import { mkdir, writeFile, stat, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'audio')
const TMP = '/tmp/tribu-cc-sfx'
const API = 'https://commons.wikimedia.org/w/api.php'
const UA = 'tribu-sfx/1.0 (jeu personnel; https://tribu.battistella.ovh)'

const BED = { rate: 22050, bitrate: '32k' }
const SHOT = { rate: 44100, bitrate: '96k' }
const CROSSFADE = 1.5

/** Ordre de préférence : plus l'indice est bas, mieux c'est. */
const LICENSES = [/^cc0/i, /^public domain/i, /^cc by 4/i, /^cc by 3/i, /^cc by-sa 4/i, /^cc by-sa 3/i]
const licenseRank = (l) => {
  const i = LICENSES.findIndex((re) => re.test(l ?? ''))
  return i < 0 ? 99 : i
}

/** Commons est d'abord une médiathèque encyclopédique : ses fichiers audio
 *  sont majoritairement des prononciations (Lingua Libre, préfixe « LL-Q »),
 *  des lectures d'articles et de la musique. Sans ce filtre, « mer » ramène
 *  un fichier de prononciation intitulé « surf rock ». */
const BANNED = /(ISRC|^LL-Q|pronunciation|prononciation|spoken|wikipedia|song|music|rock|guitar|piano|interview|speech|voice|reading|hymn|anthem)/i

const SOUNDS = [
  {
    id: 'cloche',
    kind: 'shot',
    seconds: 6,
    queries: ['church bell single strike', 'church bell', 'bell tower ringing'],
    // Une cloche d'église enregistrée : le synthé n'approchera jamais ça.
    want: /bell/i,
    dur: [2, 30],
  },
  {
    id: 'oiseaux',
    kind: 'bed',
    seconds: 12,
    queries: ['birdsong morning', 'forest birds ambience', 'dawn chorus'],
    want: /(birdsong|birds|dawn chorus)/i,
    avoid: /(traffic|car|city|urban|plane|aircraft|people|talk)/i,
    dur: [10, 240],
  },
  {
    id: 'nuit',
    kind: 'bed',
    seconds: 12,
    queries: ['crickets night ambience', 'cricket chirping field', 'crickets night', 'field cricket', 'cricket'],
    want: /cricket/i,
    // Commons intitule honnêtement ses prises : « cricket and dogs » annonce
    // des aboiements, et un chien n'a rien à faire sur une île du Paléolithique.
    avoid: /(dog|traffic|car|city|urban|human|people|talk)/i,
    dur: [8, 240],
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
  // PAS DE « mer » : Commons n'a aucune prise de ressac exploitable — la
  // recherche ne ramène que de la musique (« Surf Shimmy ») ou des fichiers
  // douteux. Le ressac reste synthétisé, et c'est très bien : il ENFLE avec
  // la météo et la nuit, ce qu'un échantillon ne saurait pas faire.
]

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const val = (f) => args.find((a) => a.startsWith(`${f}=`))?.split('=')[1]
const only = val('--only')?.split(',').map((s) => s.trim())
const force = has('--force')
const wanted = only ? SOUNDS.filter((s) => only.includes(s.id)) : SOUNDS

/** Recherche Commons : pas de clé, mais un user-agent honnête est exigé. */
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
      author: (meta.Artist?.value ?? '').replace(/<[^>]*>/g, '').trim().slice(0, 60),
      page: `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}`,
    }
  })
}

async function pick(s) {
  const seen = new Map()
  for (const q of s.queries) {
    for (const r of await search(q)) {
      // Commons sert ses .ogg en « application/ogg » : filtrer sur « audio »
      // écartait en silence la moitié du catalogue sonore (dont tous les
      // enregistrements d'insectes, qui sont presque tous en ogg).
      if (!r.url || !/(audio|ogg)/.test(r.mime ?? '')) continue
      if (licenseRank(r.license) >= 99) continue
      if (BANNED.test(r.title)) continue
      if (s.want && !s.want.test(r.title)) continue
      if (s.avoid && s.avoid.test(r.title)) continue
      // Un fichier énorme est une prise longue : coûteux à télécharger pour en
      // garder douze secondes. On plafonne à 40 Mo.
      if (r.size > 60 * 1024 * 1024) continue
      if (!seen.has(r.title)) seen.set(r.title, r)
    }
  }
  return [...seen.values()].sort((a, b) => licenseRank(a.license) - licenseRank(b.license))[0] ?? null
}

/** Durée réelle du fichier : une prise de quatre secondes et une prise de
 *  quatre minutes ne se découpent pas pareil. */
async function duration(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
  ])
  return Number.parseFloat(stdout.trim()) || 0
}

async function postProcess(inFile, outFile, s) {
  const p = s.kind === 'bed' ? BED : SHOT
  const total = await duration(inFile)
  if (s.kind === 'bed') {
    const x = CROSSFADE
    // La prise commence souvent par un blanc ou un bruit de manipulation : on
    // entre plus loin quand la durée le permet, jamais au point de manquer de
    // matière — une prise de six secondes ne supporte aucun saut.
    const skip = Math.max(0, Math.min(5, total - s.seconds - 0.5))
    // Trop courte pour la boucle demandée : on la répète d'abord.
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
      console.error(`✗ ${s.id} — aucun candidat sous licence libre`)
      continue
    }
    const raw = join(TMP, `${s.id}-raw`)
    const dl = await fetch(hit.url, { headers: { 'user-agent': UA } })
    if (!dl.ok) throw new Error(`téléchargement HTTP ${dl.status}`)
    await writeFile(raw, Buffer.from(await dl.arrayBuffer()))
    await postProcess(raw, outFile, s)
    const st = await stat(outFile)
    written++
    bytes += st.size
    credits.push(
      `- **${s.id}** — « ${hit.title} »${hit.author ? ` par ${hit.author}` : ''} · ${hit.license} · ${hit.page}`,
    )
    console.log(`✓ ${s.id.padEnd(8)} ${(st.size / 1024).toFixed(0).padStart(4)} ko  [${hit.license}] ${hit.title.slice(0, 45)}`)
  } catch (e) {
    console.error(`✗ ${s.id} — ${e.message}`)
  }
}

if (credits.length > 0) {
  await writeFile(
    join(OUT, 'CREDITS.md'),
    '# Origine des sons\n\n' +
      'Ces fichiers viennent de Wikimedia Commons et ont été retaillés par\n' +
      '`tools/fetch-cc-sfx.mjs` (boucle sans couture pour les nappes, détourage\n' +
      "et fondu pour les coups). Les licences CC BY et CC BY-SA **exigent** cette\n" +
      'attribution ; elle vaut aussi pour les fichiers dérivés publiés avec le jeu.\n\n' +
      `${credits.join('\n')}\n`,
  )
}
await rm(TMP, { recursive: true, force: true })
console.log(`\n${written} fichier(s), ${(bytes / 1024).toFixed(0)} ko. Aucun compte, aucun euro.`)
