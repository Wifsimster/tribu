export const ORBIT = {
  minPolar: 0.18,
  maxPolar: Math.PI * 0.44,
  baseZoom: 34,
  minZoom: 8,
  maxZoom: 58,
  minCamRadii: 1.85,
} as const

export function zoomMin(frameDistance: number, islandRadius: number): number {
  if (!(frameDistance > 0)) return ORBIT.minZoom
  const floor = (ORBIT.baseZoom * ORBIT.minCamRadii * islandRadius) / frameDistance
  return Math.min(ORBIT.minZoom, floor)
}

export function zoomBy(distance: number, factor: number, lo: number): number {
  return clamp(Math.max(distance, lo) * factor, lo, ORBIT.maxZoom)
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
