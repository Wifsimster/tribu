import type { SaveV1 } from './state'

/** Transfert de tribu : une sauvegarde entière tient dans un texte que le
 *  joueur peut télécharger, coller dans un mail, et rouvrir sur un autre
 *  appareil. Tout est local — aucun serveur ne voit jamais la partie.
 *
 *  Format : `TRIBU1G.<base64url(gzip(json))>.<somme>` — ou `TRIBU1.` quand le
 *  navigateur n'a pas CompressionStream. La somme de contrôle rattrape la
 *  faute la plus banale : un code tronqué au copier-coller. */

const MAGIC_PLAIN = 'TRIBU1'
const MAGIC_GZIP = 'TRIBU1G'

/** Somme de contrôle FNV-1a sur le payload encodé, en base 36. */
function checksum(payload: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

function bytesToBase64Url(bytes: Uint8Array): string {
  // Par tranches : un spread de 60 000 arguments fait sauter la pile.
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function pipe(
  bytes: Uint8Array,
  stream: ReadableWritablePair,
): Promise<Uint8Array<ArrayBuffer>> {
  const blob = new Blob([bytes as BlobPart])
  const res = new Response(blob.stream().pipeThrough(stream))
  return new Uint8Array(await res.arrayBuffer())
}

/** Encode une sauvegarde en code de transfert. Compressé si possible. */
export async function encodeSave(save: SaveV1): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(save))
  let magic = MAGIC_PLAIN
  let bytes = json
  if (typeof CompressionStream !== 'undefined') {
    try {
      bytes = await pipe(json, new CompressionStream('gzip'))
      magic = MAGIC_GZIP
    } catch {
      // Compression indisponible : le code sera juste plus long.
    }
  }
  const payload = bytesToBase64Url(bytes)
  return `${magic}.${payload}.${checksum(payload)}`
}

export type DecodeResult =
  | { ok: true; save: SaveV1 }
  | { ok: false; reason: 'format' | 'tronque' | 'illisible' }

/** Relit un code de transfert. Tolère les retours à la ligne et les espaces
 *  ajoutés par les messageries, qui coupent volontiers les longues lignes. */
export async function decodeSave(raw: string): Promise<DecodeResult> {
  const code = raw.replace(/\s+/g, '')
  const parts = code.split('.')
  // Un code coupé par une messagerie perd sa somme finale : il ressemble alors
  // à « pas un code du tout ». S'il commence bien par notre en-tête, c'est une
  // troncature — le joueur doit reprendre son texte, pas chercher ailleurs.
  if (parts.length !== 3)
    return { ok: false, reason: code.startsWith(MAGIC_PLAIN) ? 'tronque' : 'format' }
  const [magic, payload, sum] = parts as [string, string, string]
  if (magic !== MAGIC_PLAIN && magic !== MAGIC_GZIP) return { ok: false, reason: 'format' }
  if (checksum(payload) !== sum) return { ok: false, reason: 'tronque' }

  try {
    let bytes = base64UrlToBytes(payload)
    if (magic === MAGIC_GZIP) {
      if (typeof DecompressionStream === 'undefined') return { ok: false, reason: 'illisible' }
      bytes = await pipe(bytes, new DecompressionStream('gzip'))
    }
    const save = JSON.parse(new TextDecoder().decode(bytes)) as SaveV1
    // Garde-fou minimal : c'est bien une sauvegarde de Tribu, pas un autre texte
    // qui aurait par malheur la bonne somme.
    if (save?.v !== 1 || !Array.isArray(save.techs) || typeof save.seed !== 'number')
      return { ok: false, reason: 'illisible' }
    return { ok: true, save }
  } catch {
    return { ok: false, reason: 'illisible' }
  }
}

/** Nom de fichier parlant : l'âge et le jour de la tribu, pas un identifiant. */
export function transferFilename(ageName: string, day: number): string {
  const slug = ageName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `tribu-${slug}-jour-${day}.txt`
}
