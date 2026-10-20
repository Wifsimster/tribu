/** Bornes de l'orbite, au même endroit pour le doigt, la molette, le clavier
 *  et la scène. `distance` est RELATIVE : la caméra se tient à
 *  `frameDistance() × distance / baseZoom` du point visé, et le cadrage
 *  calculé recule beaucoup sur un écran étroit. */
export const ORBIT = {
  /** Inclinaison : de presque à la verticale à presque rasant. */
  minPolar: 0.18,
  maxPolar: Math.PI * 0.44,
  /** Valeur historique de `distance` : le cadrage par défaut. */
  baseZoom: 34,
  /** Zoom relatif. 8 suffit sur un écran large (1440×900 : 28 unités du point
   *  visé) ; sur un téléphone en portrait, le cadrage recule 2,4 fois plus et
   *  ce 8 laissait la caméra à 68 unités, le colon à une cinquantaine de px. */
  minZoom: 8,
  maxZoom: 58,
  /** Plancher RÉEL de la distance caméra–point visé, en rayons d'île : c'est
   *  lui qui borne le zoom sur un écran étroit. Mesuré en 390×844 : 45 unités
   *  au lieu de 68, un colon de 86 px de haut au lieu de 54. Au plus rasant
   *  (maxPolar), la caméra reste au-dessus de la mer, à 1,8 R du centre à
   *  l'horizontale (la côte est à 1 R) et à 9,5 unités de haut : ni sous le
   *  sol, ni dans un bâtiment, rien à moins de 8 (plan proche). Un écran large
   *  (1440×900 : 1,16 R avec son 8) n'est pas concerné. */
  minCamRadii: 1.85,
} as const

/** Zoom relatif le plus proche permis pour ce cadrage : le 8 historique, ou
 *  moins là où le cadrage recule (portrait), sans jamais approcher la caméra
 *  à moins de `minCamRadii` rayons d'île. Un écran large garde exactement 8. */
export function zoomMin(frameDistance: number, islandRadius: number): number {
  if (!(frameDistance > 0)) return ORBIT.minZoom
  const floor = (ORBIT.baseZoom * ORBIT.minCamRadii * islandRadius) / frameDistance
  return Math.min(ORBIT.minZoom, floor)
}

/** Applique un facteur de zoom (doigt, molette, clavier) dans les bornes.
 *  Part de la distance effective : sous un plancher remonté (téléphone passé
 *  en paysage), le premier cran vers l'arrière recule vraiment. */
export function zoomBy(distance: number, factor: number, lo: number): number {
  return clamp(Math.max(distance, lo) * factor, lo, ORBIT.maxZoom)
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
