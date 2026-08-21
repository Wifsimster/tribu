/** tribu-api — le voisinage.
 *
 *  Un service minuscule et SANS DÉPENDANCE (node:http + node:sqlite) dont le
 *  seul rôle est de faire circuler des « instantanés publics » de tribus : de
 *  quoi peupler l'horizon des autres joueurs. Il ne simule rien, ne détient
 *  aucune sauvegarde, et le jeu doit rester parfaitement jouable quand il est
 *  éteint — c'est une PWA hors-ligne d'abord.
 *
 *  La simulation vit dans le navigateur : un instantané n'est donc PAS
 *  vérifiable. C'est assumé — rien ne se gagne aux dépens d'autrui, il n'y a
 *  donc rien à voler en mentant. Pas de classement sérieux pour cette raison.
 */
import { createServer } from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const PORT = Number(process.env.PORT ?? 8080)
const DB_PATH = process.env.DB_PATH ?? '/data/tribu.sqlite'
/** Au-delà, une tribu est considérée endormie et quitte l'horizon des autres. */
const STALE_DAYS = 30
const MAX_BODY = 8 * 1024
/** Requêtes par minute et par IP : large pour un joueur, étroit pour un script. */
const RATE = 60

mkdirSync(dirname(DB_PATH), { recursive: true })
const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL')
db.exec(`
  CREATE TABLE IF NOT EXISTS tribes (
    id      TEXT PRIMARY KEY,
    secret  TEXT NOT NULL,
    name    TEXT NOT NULL,
    age     INTEGER NOT NULL,
    day     INTEGER NOT NULL,
    techs   INTEGER NOT NULL,
    wonders INTEGER NOT NULL,
    feats   INTEGER NOT NULL,
    relics  INTEGER NOT NULL,
    legacy  INTEGER NOT NULL,
    seed    INTEGER NOT NULL,
    created INTEGER NOT NULL,
    seen    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS tribes_seen ON tribes (seen DESC);

  -- La boîte aux lettres : ce que les autres tribus t'ont fait parvenir
  -- pendant que tu n'étais pas là. Vidée à la lecture — le serveur n'est
  -- qu'un relais, il ne garde pas d'historique.
  CREATE TABLE IF NOT EXISTS events (
    seq     INTEGER PRIMARY KEY AUTOINCREMENT,
    dest    TEXT NOT NULL,
    kind    TEXT NOT NULL,
    payload TEXT NOT NULL,
    created INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS events_dest ON events (dest, seq);
`)

const upsert = db.prepare(`
  INSERT INTO tribes (id, secret, name, age, day, techs, wonders, feats, relics, legacy, seed, created, seen)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, age = excluded.age, day = excluded.day,
    techs = excluded.techs, wonders = excluded.wonders, feats = excluded.feats,
    relics = excluded.relics, legacy = excluded.legacy, seed = excluded.seed,
    seen = excluded.seen
`)
const findSecret = db.prepare('SELECT secret FROM tribes WHERE id = ?')
const listNeighbors = db.prepare(`
  SELECT id, name, age, day, techs, wonders, feats, relics, legacy, seed, seen
  FROM tribes WHERE id <> ? AND seen > ? ORDER BY seen DESC LIMIT ?
`)
const countTribes = db.prepare('SELECT COUNT(*) AS n FROM tribes')
const removeTribe = db.prepare('DELETE FROM tribes WHERE id = ?')

const findTribe = db.prepare('SELECT id, name FROM tribes WHERE id = ?')
const pushEvent = db.prepare(
  'INSERT INTO events (dest, kind, payload, created) VALUES (?, ?, ?, ?)',
)
const readEvents = db.prepare('SELECT seq, kind, payload, created FROM events WHERE dest = ? ORDER BY seq LIMIT 50')
const dropEvents = db.prepare('DELETE FROM events WHERE dest = ? AND seq <= ?')
const countEvents = db.prepare('SELECT COUNT(*) AS n FROM events WHERE dest = ?')
const trimEvents = db.prepare(
  'DELETE FROM events WHERE dest = ? AND seq NOT IN (SELECT seq FROM events WHERE dest = ? ORDER BY seq DESC LIMIT ?)',
)
/** Une boîte aux lettres a un fond : au-delà, les plus vieux messages sautent.
 *  Personne ne doit pouvoir remplir le disque d'un autre joueur. */
const MAX_INBOX = 40

const sha = (s) => createHash('sha256').update(s).digest('hex')

/** Vérifie que l'appelant est bien la tribu qu'il prétend être. */
function owner(id, secret) {
  const known = findSecret.get(id)
  return !!known && sameSecret(known.secret, sha(String(secret ?? '')))
}

/** Comparaison à temps constant : le secret d'une tribu ne se devine pas à la
 *  montre. Les deux côtés sont des hex de 64 caractères. */
function sameSecret(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

const buckets = new Map()
function rateLimited(ip) {
  const now = Date.now()
  const b = buckets.get(ip)
  if (!b || now - b.start > 60_000) {
    buckets.set(ip, { start: now, n: 1 })
    // Ménage opportuniste : la table ne doit pas grandir indéfiniment.
    if (buckets.size > 5000)
      for (const [k, v] of buckets) if (now - v.start > 120_000) buckets.delete(k)
    return false
  }
  b.n++
  return b.n > RATE
}

const int = (v, min, max) => {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min
}

/** Un pseudo est du texte affiché chez les autres : ni contrôle, ni roman. */
function cleanName(v) {
  const s = String(v ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20)
  return s || 'Tribu sans nom'
}

function send(res, code, body) {
  const text = JSON.stringify(body)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(text)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  // Derrière Traefik : l'IP réelle arrive dans X-Forwarded-For.
  const ip = (req.headers['x-forwarded-for'] ?? '').toString().split(',')[0].trim() ||
    req.socket.remoteAddress || '?'

  if (rateLimited(ip)) return send(res, 429, { error: 'trop de requêtes' })

  try {
    if (req.method === 'GET' && url.pathname === '/api/health')
      return send(res, 200, { ok: true, tribes: countTribes.get().n })

    if (req.method === 'GET' && url.pathname === '/api/neighbors') {
      const self = String(url.searchParams.get('id') ?? '')
      const n = int(url.searchParams.get('n') ?? 8, 1, 24)
      const since = Date.now() - STALE_DAYS * 86_400_000
      return send(res, 200, { neighbors: listNeighbors.all(self, since, n) })
    }

    if (req.method === 'POST' && url.pathname === '/api/tribe') {
      const body = JSON.parse((await readBody(req)) || '{}')
      const id = String(body.id ?? '')
      const secret = String(body.secret ?? '')
      // Identifiants fabriqués par le client : on exige juste de quoi ne pas
      // se marcher dessus et de quoi ne pas se faire voler son nom.
      if (!/^[a-z0-9-]{8,64}$/.test(id)) return send(res, 400, { error: 'id invalide' })
      if (secret.length < 16) return send(res, 400, { error: 'secret trop court' })

      const hash = sha(secret)
      const known = findSecret.get(id)
      if (known && !sameSecret(known.secret, hash))
        return send(res, 403, { error: 'cette tribu appartient à un autre appareil' })

      const now = Date.now()
      upsert.run(
        id,
        hash,
        cleanName(body.name),
        int(body.age, 0, 20),
        int(body.day, 0, 1_000_000),
        int(body.techs, 0, 200),
        int(body.wonders, 0, 20),
        int(body.feats, 0, 60),
        int(body.relics, 0, 100),
        int(body.legacy, 0, 1000),
        int(body.seed, 0, 0x7fffffff),
        now,
        now,
      )
      return send(res, 200, { ok: true })
    }

    // Une barque étrangère a accosté chez quelqu'un : on le lui dira à son
    // retour. Le message est écrit par le serveur, jamais par l'appelant —
    // sinon n'importe qui écrirait n'importe quoi dans la Chronique d'autrui.
    if (req.method === 'POST' && url.pathname === '/api/visit') {
      const body = JSON.parse((await readBody(req)) || '{}')
      const from = String(body.id ?? '')
      const to = String(body.to ?? '')
      if (!owner(from, body.secret)) return send(res, 403, { error: 'secret invalide' })
      const host = findTribe.get(to)
      const me = findTribe.get(from)
      if (!host || !me) return send(res, 200, { ok: true })
      pushEvent.run(to, 'visit', JSON.stringify({ from: me.name }), Date.now())
      if (countEvents.get(to).n > MAX_INBOX) trimEvents.run(to, to, MAX_INBOX)
      return send(res, 200, { ok: true })
    }

    // Relève du courrier : on lit ET on vide, dans la même requête. Un message
    // lu ne doit pas revenir au prochain réveil.
    if (req.method === 'POST' && url.pathname === '/api/inbox') {
      const body = JSON.parse((await readBody(req)) || '{}')
      const id = String(body.id ?? '')
      if (!owner(id, body.secret)) return send(res, 403, { error: 'secret invalide' })
      const rows = readEvents.all(id)
      if (rows.length > 0) dropEvents.run(id, rows[rows.length - 1].seq)
      return send(res, 200, {
        events: rows.map((r) => ({ kind: r.kind, created: r.created, ...JSON.parse(r.payload) })),
      })
    }

    // Quitter le voisinage EFFACE vraiment : personne ne doit rester exposé
    // sur l'horizon des autres après avoir demandé à en sortir.
    if (req.method === 'POST' && url.pathname === '/api/leave') {
      const body = JSON.parse((await readBody(req)) || '{}')
      const id = String(body.id ?? '')
      const known = findSecret.get(id)
      if (!known) return send(res, 200, { ok: true })
      if (!sameSecret(known.secret, sha(String(body.secret ?? ''))))
        return send(res, 403, { error: 'secret invalide' })
      removeTribe.run(id)
      return send(res, 200, { ok: true })
    }

    send(res, 404, { error: 'inconnu' })
  } catch (e) {
    send(res, 400, { error: String(e?.message ?? e) })
  }
})

server.listen(PORT, () => console.log(`tribu-api sur :${PORT} (db ${DB_PATH})`))

for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => {
    server.close()
    db.close()
    process.exit(0)
  })
