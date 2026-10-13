import type { BufferGeometry } from 'three'
import { modelGeometry } from './models'

/** Les véhicules modelés dans Blender, par identifiant de modèle. Le train
 *  n'en est plus : sa rame se compose wagon par wagon (consist.ts). */
export type VehicleId =
  | 'raft'
  | 'canoe'
  | 'sailboat'
  | 'caravel'
  | 'steamer'
  | 'motorboat'
  | 'merchant'
  | 'car'
  | 'plane'

/** Les six paliers de la barque d'expédition, dans l'ordre de `setTier`. */
export const BOAT_MODELS: readonly VehicleId[] = [
  'raft',
  'canoe',
  'sailboat',
  'caravel',
  'steamer',
  'motorboat',
]

/** Les fichiers sont livrés base à y = 0 et centrés en x/z, déjà à leur taille
 *  de jeu. Les primitives, elles, avaient leur origine ailleurs (la quille du
 *  radeau sous zéro, la caravelle décalée vers sa proue…). Ce décalage remet le modèle dans le repère de la
 *  primitive : passager, voile, pivot d'animation et hauteur sur l'eau
 *  restent là où ils étaient réglés. Relevé par l'artiste sur les deux
 *  boîtes englobantes, en unités du MONDE. */
const OFFSET: Record<VehicleId, readonly [number, number, number]> = {
  raft: [0.159, -0.018, 0.005],
  canoe: [0, -0.035, 0],
  sailboat: [-0.059, 0.065, 0],
  caravel: [0.358, 0.09, 0],
  steamer: [0.025, 0.12, 0],
  motorboat: [0.17, 0.126, 0],
  // Mesuré : la vergue tombe sur celle de la primitive (2,925 au-dessus de
  // l'eau) avec ce décalage pris APRÈS le ×1,5 du groupe, pas avant.
  merchant: [0.002, 0.04, 0.008],
  car: [0.01, 0.04, 0],
  plane: [0.04, -0.34, 0],
}

/** Le modèle du véhicule, posé dans le repère de sa primitive, ou null s'il
 *  n'est pas (encore) là : l'appelant garde alors sa primitive.
 *
 *  `parentScale` : l'échelle que porte déjà le parent. La barque marchande
 *  garde son ×1,5 sur le GROUPE (la houle et la voile animée en dépendent),
 *  alors que le fichier est livré à sa taille finale : sans ce facteur elle
 *  serait agrandie deux fois. */
export function vehicleGeometry(id: VehicleId, parentScale = 1): BufferGeometry | null {
  const geo = modelGeometry(id)
  if (!geo) return null
  const [x, y, z] = OFFSET[id]
  const k = 1 / parentScale
  return geo.scale(k, k, k).translate(x * k, y * k, z * k)
}

/** Le cap à donner (rotation.y) à un véhicule dont le nez est en +X local
 *  pour qu'il avance vers (dx, dz).
 *
 *  three tourne +X local vers (cos θ, −sin θ) en x/z : pour tomber sur la
 *  direction du trajet il faut θ = atan2(dx, dz) − π/2. Le code d'avant
 *  ajoutait π/2 au lieu de le retrancher : mesuré en jeu (v3.55.0), la proue
 *  de l'auto, des barques et du hors-bord pointait à 180° du trajet — tous
 *  roulaient et naviguaient à reculons — et le nez de l'avion, qui prenait le
 *  cap brut, à 90° : il volait de côté. Le train, dont l'avant est en +Z,
 *  prend atan2 sans correction et n'était pas touché. */
export function headingYaw(dx: number, dz: number): number {
  return Math.atan2(dx, dz) - Math.PI / 2
}
