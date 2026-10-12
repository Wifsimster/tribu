import type { BufferGeometry, Mesh } from 'three'
// `?url` et non un import du fichier : Vite le hache sous /assets/, et le
// service worker comme nginx le servent alors en cache immuable.
import amphoreUrl from '../assets/models/amphore.glb?url'
import nebraUrl from '../assets/models/nebra.glb?url'
import etainUrl from '../assets/models/etain.glb?url'
// Les douze autres reliques du musée et les huit autres lots du marchand :
// même format que l'amphore et l'étain (un maillage, couleurs aux sommets).
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
// Les onze Merveilles, une par âge. Chacune porte ses cinq stades de chantier
// dans un seul fichier (attribut `_STAGE`, voir model-geo.ts).
import menhirsUrl from '../assets/models/menhirs.glb?url'
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
import { asPart } from './model-geo'

/** Les modèles faits dans Blender, par identifiant de jeu (relique, outil ou
 *  Merveille). Tout le reste du village reste en primitives. */
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
  menhirs: menhirsUrl,
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
}

/** Le maillage tel que livré par le chargeur, attribut `_stage` compris. On
 *  garde la source brute et non la pièce déjà convertie : une Merveille en
 *  tire une géométrie par stade. */
const sources = new Map<string, BufferGeometry>()
/** Les pièces déjà converties, par modèle et stade : un chantier redessiné à
 *  chaque stade ne refait pas la conversion. */
const parts = new Map<string, BufferGeometry>()
const loading = new Map<string, Promise<boolean>>()

/** Une copie du modèle prête à fondre, ou null s'il n'est pas (encore) là :
 *  l'appelant garde alors sa géométrie de toujours. `stage` ne sert qu'aux
 *  Merveilles : les pièces apparues jusqu'à ce stade de chantier. */
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

/** Le modèle est-il là ? Sans copie : sert de clé de redessin. */
export function modelGeometryReady(id: string): boolean {
  return sources.has(id)
}

/** Range un maillage déjà lu. Le chargement passe par ici, et les tests aussi :
 *  sous Node, ils lisent le fichier eux-mêmes et le confient au module, sans
 *  réseau ni navigateur. Refuse ce qui ne se dessinerait pas. */
export function adoptModel(id: string, source: BufferGeometry): boolean {
  if (!asPart(source)) return false
  sources.set(id, source)
  for (const k of [...parts.keys()]) if (k.startsWith(`${id}@`)) parts.delete(k)
  return true
}

/** Charge, en tâche de fond, les modèles qu'exige ce que la tribu possède.
 *  Rien n'attend ce chargement : la partie démarre avec les primitives, et la
 *  promesse dit seulement s'il y a du neuf à redessiner. Un fichier absent ou
 *  abîmé ne coûte qu'un avertissement — le jeu ne plante jamais pour un
 *  décor. Le chargeur glTF n'est importé qu'ici, à la demande : une tribu sans
 *  amphore ni étain ne le télécharge pas. */
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
