import type { BufferGeometry, Mesh } from 'three'
import amphoreUrl from '../assets/models/amphore.glb?url'
import nebraUrl from '../assets/models/nebra.glb?url'
import etainUrl from '../assets/models/etain.glb?url'
import venusUrl from '../assets/models/venus.glb?url'
import lionmanUrl from '../assets/models/lionman.glb?url'
import fluteUrl from '../assets/models/flute.glb?url'
import ambreUrl from '../assets/models/ambre.glb?url'
import tabletteUrl from '../assets/models/tablette.glb?url'
import monnaieUrl from '../assets/models/monnaie.glb?url'
import anticythereUrl from '../assets/models/anticythere.glb?url'
import astrolabeUrl from '../assets/models/astrolabe.glb?url'
import boussoleUrl from '../assets/models/boussole.glb?url'
import sextantUrl from '../assets/models/sextant.glb?url'
import daguerreotypeUrl from '../assets/models/daguerreotype.glb?url'
import transistorUrl from '../assets/models/transistor.glb?url'
import selUrl from '../assets/models/sel.glb?url'
import papyrusUrl from '../assets/models/papyrus.glb?url'
import gouvernailUrl from '../assets/models/gouvernail.glb?url'
import realUrl from '../assets/models/real.glb?url'
import caoutchoucUrl from '../assets/models/caoutchouc.glb?url'
import roulementUrl from '../assets/models/roulement.glb?url'
import conteneurUrl from '../assets/models/conteneur.glb?url'
import terresraresUrl from '../assets/models/terresrares.glb?url'
import dolmenUrl from '../assets/models/dolmen.glb?url'
import ziggouratUrl from '../assets/models/ziggurat.glb?url'
import tropheeUrl from '../assets/models/trophee.glb?url'
import phareUrl from '../assets/models/phare.glb?url'
import cathedraleUrl from '../assets/models/cathedrale.glb?url'
import domeUrl from '../assets/models/dome.glb?url'
import tourUrl from '../assets/models/tour.glb?url'
import grattecielUrl from '../assets/models/gratteciel.glb?url'
import fuseeUrl from '../assets/models/fusee.glb?url'
import fusionUrl from '../assets/models/fusion.glb?url'
import raftUrl from '../assets/models/raft.glb?url'
import canoeUrl from '../assets/models/canoe.glb?url'
import sailboatUrl from '../assets/models/sailboat.glb?url'
import caravelUrl from '../assets/models/caravel.glb?url'
import steamerUrl from '../assets/models/steamer.glb?url'
import motorboatUrl from '../assets/models/motorboat.glb?url'
import merchantUrl from '../assets/models/merchant.glb?url'
import carUrl from '../assets/models/car.glb?url'
import planeUrl from '../assets/models/plane.glb?url'
import locoUrl from '../assets/models/loco.glb?url'
import wagonCoachUrl from '../assets/models/wagon_coach.glb?url'
import wagonWoodUrl from '../assets/models/wagon_wood.glb?url'
import wagonStoneUrl from '../assets/models/wagon_stone.glb?url'
import wagonFoodUrl from '../assets/models/wagon_food.glb?url'
import wagonFiberUrl from '../assets/models/wagon_fiber.glb?url'
import wagonClayUrl from '../assets/models/wagon_clay.glb?url'
import wagonCopperUrl from '../assets/models/wagon_copper.glb?url'
import wagonIronUrl from '../assets/models/wagon_iron.glb?url'
import wagonEmptyUrl from '../assets/models/wagon_empty.glb?url'
import { asPart } from './model-geo'

const URLS: Record<string, string> = {
  amphore: amphoreUrl,
  disquenebra: nebraUrl,
  etain: etainUrl,
  venus: venusUrl,
  lionman: lionmanUrl,
  flute: fluteUrl,
  ambre: ambreUrl,
  tablette: tabletteUrl,
  monnaie: monnaieUrl,
  anticythere: anticythereUrl,
  astrolabe: astrolabeUrl,
  boussole: boussoleUrl,
  sextant: sextantUrl,
  daguerreotype: daguerreotypeUrl,
  transistor: transistorUrl,
  sel: selUrl,
  papyrus: papyrusUrl,
  gouvernail: gouvernailUrl,
  real: realUrl,
  caoutchouc: caoutchoucUrl,
  roulement: roulementUrl,
  conteneur: conteneurUrl,
  terresrares: terresraresUrl,
  dolmen: dolmenUrl,
  ziggurat: ziggouratUrl,
  trophee: tropheeUrl,
  phare: phareUrl,
  cathedrale: cathedraleUrl,
  dome: domeUrl,
  tour: tourUrl,
  gratteciel: grattecielUrl,
  fusee: fuseeUrl,
  fusion: fusionUrl,
  raft: raftUrl,
  canoe: canoeUrl,
  sailboat: sailboatUrl,
  caravel: caravelUrl,
  steamer: steamerUrl,
  motorboat: motorboatUrl,
  merchant: merchantUrl,
  car: carUrl,
  plane: planeUrl,
  loco: locoUrl,
  wagon_coach: wagonCoachUrl,
  wagon_wood: wagonWoodUrl,
  wagon_stone: wagonStoneUrl,
  wagon_food: wagonFoodUrl,
  wagon_fiber: wagonFiberUrl,
  wagon_clay: wagonClayUrl,
  wagon_copper: wagonCopperUrl,
  wagon_iron: wagonIronUrl,
  wagon_empty: wagonEmptyUrl,
}

const sources = new Map<string, BufferGeometry>()
const parts = new Map<string, BufferGeometry>()
const loading = new Map<string, Promise<boolean>>()

export function modelGeometry(id: string, stage = Infinity): BufferGeometry | null {
  const src = sources.get(id)
  if (!src) return null
  const key = `${id}@${stage}`
  let geo = parts.get(key)
  if (!geo) {
    const made = asPart(src, stage)
    if (!made) return null
    geo = made
    parts.set(key, geo)
  }
  return geo.clone()
}

export function modelGeometryReady(id: string): boolean {
  return sources.has(id)
}

export function adoptModel(id: string, source: BufferGeometry): boolean {
  if (!asPart(source)) return false
  sources.set(id, source)
  for (const k of [...parts.keys()]) if (k.startsWith(`${id}@`)) parts.delete(k)
  return true
}

export async function loadModels(ids: readonly string[]): Promise<boolean> {
  const wanted = [...new Set(ids)].filter((id) => URLS[id] && !sources.has(id))
  if (wanted.length === 0) return false
  const results = await Promise.all(wanted.map((id) => loadOne(id)))
  return results.some(Boolean)
}

function loadOne(id: string): Promise<boolean> {
  let p = loading.get(id)
  if (!p) {
    p = (async () => {
      try {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
        const gltf = await new GLTFLoader().loadAsync(URLS[id]!)
        let source: BufferGeometry | null = null
        gltf.scene.traverse((o) => {
          if (!source && (o as Mesh).isMesh) source = (o as Mesh).geometry
        })
        if (!source || !adoptModel(id, source)) throw new Error('aucun maillage exploitable')
        return true
      } catch (err) {
        console.warn(`[tribu] modèle « ${id} » indisponible, primitive conservée :`, err)
        return false
      }
    })()
    loading.set(id, p)
  }
  return p
}
