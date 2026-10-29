import type { BufferGeometry } from 'three'
import { modelGeometry } from './models'

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

export const BOAT_MODELS: readonly VehicleId[] = [
  'raft',
  'canoe',
  'sailboat',
  'caravel',
  'steamer',
  'motorboat',
]

export const UNITS_PER_METRE = 2.2 / 1.7

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

const OFFSET: Record<VehicleId, readonly [number, number, number]> = {
  raft: [0.159, -0.018, 0.005],
  canoe: [0, -0.035, 0],
  sailboat: [-0.059, 0.065, 0],
  caravel: [0.358, 0.09, 0],
  steamer: [0.025, 0.12, 0],
  motorboat: [0.17, 0.126, 0],
  merchant: [0.002, 0.04, 0.008],
  car: [0.01, 0.04, 0],
  plane: [0.04, -0.34, 0],
}

export function vehicleGeometry(id: VehicleId, parentScale = 1): BufferGeometry | null {
  const geo = modelGeometry(id)
  if (!geo) return null
  const [x, y, z] = OFFSET[id]
  const k = 1 / parentScale
  return geo.scale(k, k, k).translate(x * k, y * k, z * k)
}

export function headingYaw(dx: number, dz: number): number {
  return Math.atan2(dx, dz) - Math.PI / 2
}
