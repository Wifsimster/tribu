import { BufferAttribute, BufferGeometry, Color, Quaternion, Vector3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { readGlb } from './fauna-glb'
import clipsUrl from '../assets/models/settler-clips.glb?url'
import toolsUrl from '../assets/models/settler-tools.glb?url'

// ── Les gestes du colon, animés dans Blender (v3.69.0) ─────────────────────
// settler-clips.glb : les nœuds du squelette du colon (body head armL armR
// legL legR toolR toolL prop cast, pivots de settler-rig.json) et une
// animation glTF par geste — translation et rotation de chaque nœud, clés
// LINEAR. settler-tools.glb : les outils et accessoires, au format compact de
// la faune. Les deux viennent de tools/blender/ (build_settler.py), sont lus
// à la main comme fauna-glb.ts — ni GLTFLoader, ni AnimationMixer : rien de
// plus à télécharger, et les tests les lisent sous Node.
//
// Un clip se joue : intro, puis la boucle [loop_in, loop_out] `loops` fois,
// puis la sortie. Ses événements (strike, fill) se déplient sur cette durée.

export const NODES = ['body', 'head', 'armL', 'armR', 'legL', 'legR', 'toolR', 'toolL', 'prop', 'cast'] as const
export type NodeName = (typeof NODES)[number]
export const CLIP_NAMES = ['gather_hand', 'gather_sickle', 'gather_scythe'] as const
export type ClipName = (typeof CLIP_NAMES)[number]

export interface ClipEvent {
  name: string
  t: number
}
/** Positions mesurées par Blender (espace du colon) : référence de parité. */
export interface CheckRow {
  t: number
  hand: number[]
  tip: number[]
  footL: number[]
  footR: number[]
}
interface Track {
  times: Float32Array
  values: Float32Array
}
export interface Carry {
  node: 'toolL' | 'prop'
  kind: 'basket' | 'sheaf'
}
export interface Clip {
  name: string
  /** Durée du clip dans Blender (intro + une boucle + sortie). */
  duration: number
  loopIn: number
  loopOut: number
  loops: number
  /** Durée jouée : intro + `loops` boucles + sortie. */
  length: number
  events: ClipEvent[]
  /** Les événements de jeu (ni loop_in ni loop_out) dépliés sur `length`. */
  timeline: ClipEvent[]
  tool: string
  carry: Carry
  check: CheckRow[]
  rest: Pose
  translation: Partial<Record<NodeName, Track>>
  rotation: Partial<Record<NodeName, Track>>
}
export type Pose = Record<NodeName, { p: Vector3; q: Quaternion }>

export function newPose(): Pose {
  const out = {} as Pose
  for (const n of NODES) out[n] = { p: new Vector3(), q: new Quaternion() }
  return out
}

interface Accessor {
  bufferView: number
  byteOffset?: number
  componentType: number
  count: number
  type: string
}
interface GltfNode {
  name?: string
  mesh?: number
  translation?: number[]
  rotation?: number[]
  children?: number[]
  extras?: { node?: string; tip?: number[]; edge?: number[] }
}
interface Gltf {
  accessors: Accessor[]
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[]
  nodes: GltfNode[]
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[] }[]
  animations?: {
    name: string
    samplers: { input: number; output: number; interpolation?: string }[]
    channels: { sampler: number; target: { node: number; path: string } }[]
    extras?: { tool?: string; carry?: Carry; loops?: number; events?: ClipEvent[]; check?: CheckRow[] }
  }[]
}

const FLOAT = 5126
const USHORT = 5123
const WIDTH: Record<string, number> = { SCALAR: 1, VEC3: 3, VEC4: 4 }

function reader(glb: ArrayBuffer) {
  const { json, bin } = readGlb<Gltf>(glb)
  const read = (i: number, ct: number, type: string): Float32Array | Uint16Array => {
    const a = json.accessors[i]
    if (!a) throw new Error(`accesseur ${i} absent`)
    const bv = json.bufferViews[a.bufferView]!
    if (a.componentType !== ct || a.type !== type) throw new Error(`accesseur ${i} : ${a.componentType}/${a.type}, ${ct}/${type} attendu`)
    const bytes = ct === FLOAT ? 4 : 2
    if (bv.byteStride && bv.byteStride !== bytes * WIDTH[type]!) throw new Error(`accesseur ${i} entrelacé`)
    const at = bin + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0)
    const n = a.count * WIDTH[type]!
    return ct === FLOAT ? new Float32Array(glb.slice(at, at + n * 4)) : new Uint16Array(glb.slice(at, at + n * 2))
  }
  return { json, read }
}

/** Les clips d'un settler-clips.glb. Lève une erreur sur tout ce qui sort du
 *  format (nœud manquant, interpolation autre que LINEAR, événements absents)
 *  plutôt que de jouer un geste de travers. */
export function readClips(glb: ArrayBuffer): Map<string, Clip> {
  const { json, read } = reader(glb)
  const index = new Map<string, number>()
  json.nodes.forEach((n, i) => n.name && index.set(n.name, i))
  const rest = newPose()
  for (const name of NODES) {
    const i = index.get(name)
    if (i === undefined) throw new Error(`nœud ${name} absent`)
    const n = json.nodes[i]!
    rest[name].p.fromArray(n.translation ?? [0, 0, 0])
    rest[name].q.fromArray(n.rotation ?? [0, 0, 0, 1])
  }
  const byIndex = new Map([...index].map(([k, v]) => [v, k]))
  const out = new Map<string, Clip>()
  for (const a of json.animations ?? []) {
    const translation: Partial<Record<NodeName, Track>> = {}
    const rotation: Partial<Record<NodeName, Track>> = {}
    let duration = 0
    for (const ch of a.channels) {
      const s = a.samplers[ch.sampler]!
      if ((s.interpolation ?? 'LINEAR') !== 'LINEAR') throw new Error(`${a.name} : interpolation ${s.interpolation}`)
      const node = byIndex.get(ch.target.node) as NodeName | undefined
      if (!node || !NODES.includes(node)) throw new Error(`${a.name} : canal sur un nœud inconnu`)
      const times = read(s.input, FLOAT, 'SCALAR') as Float32Array
      if (ch.target.path === 'translation') translation[node] = { times, values: read(s.output, FLOAT, 'VEC3') as Float32Array }
      else if (ch.target.path === 'rotation') rotation[node] = { times, values: read(s.output, FLOAT, 'VEC4') as Float32Array }
      else throw new Error(`${a.name} : canal ${ch.target.path}`)
      duration = Math.max(duration, times[times.length - 1]!)
    }
    const x = a.extras ?? {}
    const events = x.events ?? []
    const loopIn = events.find((e) => e.name === 'loop_in')?.t
    const loopOut = events.find((e) => e.name === 'loop_out')?.t
    if (loopIn === undefined || loopOut === undefined || !(loopOut > loopIn)) throw new Error(`${a.name} : boucle absente`)
    if (!x.carry || !x.tool) throw new Error(`${a.name} : outil ou accessoire absent`)
    const loops = Math.max(1, x.loops ?? 1)
    const span = loopOut - loopIn
    const timeline: ClipEvent[] = []
    for (const e of events) {
      if (e.name === 'loop_in' || e.name === 'loop_out') continue
      if (e.t < loopIn) timeline.push({ ...e })
      else if (e.t < loopOut) for (let k = 0; k < loops; k++) timeline.push({ name: e.name, t: e.t + k * span })
      else timeline.push({ name: e.name, t: e.t + (loops - 1) * span })
    }
    timeline.sort((p, q) => p.t - q.t)
    out.set(a.name, {
      name: a.name,
      duration,
      loopIn,
      loopOut,
      loops,
      length: duration + (loops - 1) * span,
      events,
      timeline,
      tool: x.tool,
      carry: x.carry,
      check: x.check ?? [],
      rest,
      translation,
      rotation,
    })
  }
  return out
}

/** Temps du clip pour `e` secondes de jeu depuis son début, boucles dépliées. */
export function clipTime(clip: Clip, e: number): number {
  if (e <= clip.loopIn) return Math.max(0, e)
  const span = clip.loopOut - clip.loopIn
  const inside = e - clip.loopIn
  if (inside < span * clip.loops) return clip.loopIn + (inside % span)
  return Math.min(clip.duration, clip.loopOut + inside - span * clip.loops)
}

/** Les événements franchis entre e0 (exclu) et e1 (inclus), en temps de jeu. */
export function eventsBetween(clip: Clip, e0: number, e1: number): ClipEvent[] {
  return clip.timeline.filter((ev) => ev.t > e0 && ev.t <= e1)
}

const qa = new Quaternion()
const qb = new Quaternion()

function key(times: Float32Array, t: number): [number, number, number] {
  const n = times.length
  if (t <= times[0]! || n === 1) return [0, 0, 0]
  if (t >= times[n - 1]!) return [n - 1, n - 1, 0]
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (times[mid]! <= t) lo = mid
    else hi = mid
  }
  return [lo, hi, (t - times[lo]!) / (times[hi]! - times[lo]!)]
}

/** La pose du clip au temps `t` (temps du clip, pas de jeu) : interpolation
 *  linéaire des translations, slerp des rotations ; un nœud sans canal garde
 *  sa pose de repos. */
export function sampleClip(clip: Clip, t: number, out: Pose): Pose {
  for (const n of NODES) {
    const tr = clip.translation[n]
    if (tr) {
      const [i, j, k] = key(tr.times, t)
      const v = tr.values
      out[n].p.set(
        v[i * 3]! + (v[j * 3]! - v[i * 3]!) * k,
        v[i * 3 + 1]! + (v[j * 3 + 1]! - v[i * 3 + 1]!) * k,
        v[i * 3 + 2]! + (v[j * 3 + 2]! - v[i * 3 + 2]!) * k,
      )
    } else out[n].p.copy(clip.rest[n].p)
    const ro = clip.rotation[n]
    if (ro) {
      const [i, j, k] = key(ro.times, t)
      qa.fromArray(ro.values, i * 4)
      qb.fromArray(ro.values, j * 4)
      out[n].q.slerpQuaternions(qa, qb, k)
    } else out[n].q.copy(clip.rest[n].q)
  }
  return out
}

// ── Les outils ─────────────────────────────────────────────────────────────

export interface SettlerTool {
  geometry: BufferGeometry
  node: string
  /** Bout de l'outil, repère du nœud : là où partent les brins coupés. */
  tip: Vector3 | null
  /** Couleur (linéaire) des sommets du tranchant, reteintés selon l'âge. */
  edge: Color | null
}

export function readTools(glb: ArrayBuffer): Map<string, SettlerTool> {
  const { json, read } = reader(glb)
  const out = new Map<string, SettlerTool>()
  for (const n of json.nodes) {
    if (n.mesh === undefined || !n.name) continue
    const prims = json.meshes?.[n.mesh]?.primitives
    if (!prims || prims.length !== 1 || (prims[0]!.mode ?? 4) !== 4 || prims[0]!.indices === undefined)
      throw new Error(`${n.name} : une primitive de triangles indexée attendue`)
    const p = prims[0]!
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(read(p.attributes.POSITION!, FLOAT, 'VEC3'), 3))
    geo.setAttribute('normal', new BufferAttribute(read(p.attributes.NORMAL!, FLOAT, 'VEC3'), 3))
    geo.setAttribute('color', new BufferAttribute(read(p.attributes.COLOR_0!, FLOAT, 'VEC3'), 3))
    geo.setIndex(new BufferAttribute(read(p.indices!, USHORT, 'SCALAR'), 1))
    geo.computeBoundingSphere()
    const x = n.extras ?? {}
    out.set(n.name, {
      geometry: geo,
      node: x.node ?? 'toolR',
      tip: x.tip ? new Vector3().fromArray(x.tip) : null,
      edge: x.edge ? new Color().fromArray(x.edge) : null,
    })
  }
  return out
}

/** Une copie de l'outil, le tranchant reteinté (silex, cuivre, fer, acier). */
export function tintedTool(tool: SettlerTool, edge: Color): BufferGeometry {
  const geo = tool.geometry.clone()
  if (!tool.edge) return geo
  const col = geo.getAttribute('color') as BufferAttribute
  for (let i = 0; i < col.count; i++) {
    if (Math.abs(col.getX(i) - tool.edge.r) + Math.abs(col.getY(i) - tool.edge.g) + Math.abs(col.getZ(i) - tool.edge.b) < 1e-3)
      col.setXYZ(i, edge.r, edge.g, edge.b)
  }
  return geo
}

// ── Chargement ─────────────────────────────────────────────────────────────
// Comme la faune : le colon naît avec ses gestes procéduraux, et passe aux
// clips dès qu'ils sont là. Un fichier absent ou abîmé ne coûte qu'un
// avertissement ; animateWork reste le repli.

let clips: Map<string, Clip> | null = null
let tools: Map<string, SettlerTool> | null = null
const carries = new Map<string, BufferGeometry | null>()
let loading: Promise<boolean> | null = null

/** Range les deux fichiers déjà lus (le chargement passe par ici ; les tests,
 *  sous Node, lisent les fichiers eux-mêmes). Lève une erreur si l'un n'est
 *  pas lisible, ou s'il manque un clip ou un outil promis. */
export function adoptSettlerModels(clipsGlb: ArrayBuffer, toolsGlb: ArrayBuffer): void {
  const c = readClips(clipsGlb)
  const t = readTools(toolsGlb)
  for (const name of CLIP_NAMES) {
    const clip = c.get(name)
    if (!clip) throw new Error(`clip ${name} absent`)
    if (clip.tool !== 'hand' && !t.has(clip.tool)) throw new Error(`${name} : outil ${clip.tool} absent`)
  }
  for (const name of ['basket', 'basket_fill_1', 'basket_fill_2', 'basket_fill_3', 'sheaf_1', 'sheaf_2', 'sheaf_3'])
    if (!t.has(name)) throw new Error(`accessoire ${name} absent`)
  clips = c
  tools = t
  carries.clear()
}

/** Pour les tests : revenir au colon sans modèles (le repli). */
export function forgetSettlerModels(): void {
  clips = null
  tools = null
  carries.clear()
}

export function settlerClip(name: string): Clip | null {
  return clips?.get(name) ?? null
}

export function settlerTool(name: string): SettlerTool | null {
  return tools?.get(name) ?? null
}

/** Le panier ou la gerbe à un cran (0 à 3), soudé une fois puis partagé ;
 *  null pour la gerbe vide. */
export function carryGeometry(kind: Carry['kind'], level: number): BufferGeometry | null {
  if (!tools) return null
  const key = kind + level
  if (carries.has(key)) return carries.get(key)!
  let geo: BufferGeometry | null = null
  if (kind === 'basket') {
    const base = tools.get('basket')!.geometry
    geo = level === 0 ? base : mergeGeometries([base, tools.get(`basket_fill_${level}`)!.geometry])
  } else if (level > 0) geo = tools.get(`sheaf_${level}`)!.geometry
  carries.set(key, geo)
  return geo
}

/** Charge les deux fichiers en tâche de fond, une seule fois. */
export function loadSettlerModels(): Promise<boolean> {
  loading ??= (async () => {
    try {
      const [a, b] = await Promise.all(
        [clipsUrl, toolsUrl].map(async (url) => {
          const res = await fetch(url)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return res.arrayBuffer()
        }),
      )
      adoptSettlerModels(a!, b!)
      return true
    } catch (err) {
      console.warn('[tribu] gestes du colon indisponibles, animation procédurale conservée :', err)
      return false
    }
  })()
  return loading
}
