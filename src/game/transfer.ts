import type { SaveV1 } from './state'

const MAGIC_PLAIN = 'TRIBU1'
const MAGIC_GZIP = 'TRIBU1G'

function checksum(payload: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

function bytesToBase64Url(bytes: Uint8Array): string {
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

export async function encodeSave(save: SaveV1): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(save))
  let magic = MAGIC_PLAIN
  let bytes = json
  if (typeof CompressionStream !== 'undefined') {
    try {
      bytes = await pipe(json, new CompressionStream('gzip'))
      magic = MAGIC_GZIP
    } catch {
    }
  }
  const payload = bytesToBase64Url(bytes)
  return `${magic}.${payload}.${checksum(payload)}`
}

export type DecodeResult =
  | { ok: true; save: SaveV1 }
  | { ok: false; reason: 'format' | 'tronque' | 'illisible' }

export async function decodeSave(raw: string): Promise<DecodeResult> {
  const code = raw.replace(/\s+/g, '')
  const parts = code.split('.')
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
    if (save?.v !== 1 || !Array.isArray(save.techs) || typeof save.seed !== 'number')
      return { ok: false, reason: 'illisible' }
    return { ok: true, save }
  } catch {
    return { ok: false, reason: 'illisible' }
  }
}

export function transferFilename(ageName: string, day: number, ext = 'txt'): string {
  const slug = ageName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `tribu-${slug}-jour-${day}.${ext}`
}
