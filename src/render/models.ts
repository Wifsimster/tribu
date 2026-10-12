import type { BufferGeometry, Mesh } from 'three'
// `?url` et non un import du fichier : Vite le hache sous /assets/, et le
// service worker comme nginx le servent alors en cache immuable.
import amphoreUrl from '../assets/models/amphore.glb?url'
import nebraUrl from '../assets/models/nebra.glb?url'
import etainUrl from '../assets/models/etain.glb?url'
import { asPart } from './model-geo'

/** Les modèles faits dans Blender, par identifiant de jeu (relique ou outil).
 *  Tout le reste du village reste en primitives. */
const URLS: Record<string, string> = {
  amphore: amphoreUrl,
  disquenebra: nebraUrl,
  etain: etainUrl,
}

const ready = new Map<string, BufferGeometry>()
const loading = new Map<string, Promise<boolean>>()

/** Une copie du modèle prête à fondre, ou null s'il n'est pas (encore) là :
 *  l'appelant garde alors sa géométrie de toujours. */
export function modelGeometry(id: string): BufferGeometry | null {
  return ready.get(id)?.clone() ?? null
}

/** Charge, en tâche de fond, les modèles qu'exige ce que la tribu possède.
 *  Rien n'attend ce chargement : la partie démarre avec les primitives, et la
 *  promesse dit seulement s'il y a du neuf à redessiner. Un fichier absent ou
 *  abîmé ne coûte qu'un avertissement — le jeu ne plante jamais pour un
 *  décor. Le chargeur glTF n'est importé qu'ici, à la demande : une tribu sans
 *  amphore ni étain ne le télécharge pas. */
export async function loadModels(ids: readonly string[]): Promise<boolean> {
  const wanted = [...new Set(ids)].filter((id) => URLS[id] && !ready.has(id))
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
        const geo = source ? asPart(source) : null
        if (!geo) throw new Error('aucun maillage exploitable')
        ready.set(id, geo)
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
