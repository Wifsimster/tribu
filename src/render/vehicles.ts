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

/** L'étalon : le colon debout fait 2,2 u en jeu (pieds au sommet du crâne,
 *  mesuré en 3.61.0), qu'on lit comme 1,70 m. Une unité vaut donc 0,77 m. */
export const UNITS_PER_METRE = 2.2 / 1.7

/** La plus grande cote du fichier livré (longueur, ou envergure pour
 *  l'avion), en unités monde : la taille de jeu jusqu'à la 3.61.0. */
export const FILE_SIZE: Record<VehicleId, number> = {
  raft: 1.57,
  canoe: 2.4,
  sailboat: 2.938,
  caravel: 5.014,
  steamer: 4.45,
  motorboat: 3.6,
  merchant: 4.286,
  car: 2.47,
  plane: 2.24,
}

/** La même cote dans la réalité, en mètres : radeau de rondins, pirogue
 *  monoxyle, barque à voile, caravelle (la Niña : ~20 m), petit vapeur à
 *  roues côtier, hors-bord, caboteur marchand de l'âge du Bronze (l'épave
 *  d'Uluburun : ~15 m), Ford T (3,4 m sur 1,68 m) et monoplan à aile haute (Piper Cub :
 *  10,7 m d'envergure). */
export const REAL_SIZE_M: Record<VehicleId, number> = {
  raft: 3,
  canoe: 5.5,
  sailboat: 6.5,
  caravel: 22,
  steamer: 25,
  motorboat: 5,
  merchant: 15,
  car: 3.4,
  plane: 9,
}

/** Le facteur appliqué au fichier, sur la taille de jeu 3.61.0. C'est le
 *  réel (REAL_SIZE_M × UNITS_PER_METRE / FILE_SIZE) partout où il tient —
 *  l'auto, plus trapue que la Ford T, est calée sur sa largeur (1,66 m) : sa
 *  longueur tombe à 3,2 m ; ailleurs, la plus grande taille qui tient :
 *  - caravelle, vapeur, caboteur : au réel, la caravelle ferait 28 u, plus que
 *    le rayon de l'île (24,4 u), et masquerait le bourg depuis la caméra par
 *    défaut (le ponton lui fait face). Plafond de lisibilité : 12,5 u de long ;
 *  - avion : au réel (×5,2, 11,6 u d'envergure), il touche un bâtiment sur
 *    les cinq bourgs du test, roues sur la terre ; à ×3, sur deux. À ×2,5, il
 *    garde 0,5 u de marge sur quatre ; sur le cinquième, trop serré, il
 *    reprend sa taille 3.62.0 (Village.PLANE_SIZES). */
export const VEHICLE_SCALE: Record<VehicleId, number> = {
  raft: 2.5,
  canoe: 3,
  sailboat: 2.85,
  caravel: 2.49,
  steamer: 2.8,
  motorboat: 1.8,
  merchant: 2.9,
  car: 1.7,
  plane: 2.5,
}

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
