import type { Stage } from './scene'
import { ORBIT, clamp, zoomBy } from './orbit'

const TAP_MS = 250
const TAP_SLOP = 12

/** A deliberately small touch controller instead of OrbitControls: one finger
 *  orbits, two pinch, and a short stationary press is a tap. No panning, so the
 *  village can never be lost off-screen on a phone. */
export function attachControls(
  stage: Stage,
  canvas: HTMLCanvasElement,
  onTap: (x: number, y: number) => void,
): void {
  const pointers = new Map<number, { x: number; y: number }>()
  let downAt = 0
  let downPos = { x: 0, y: 0 }
  let moved = 0
  let pinchDist = 0
  let velocity = 0

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId)
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.size === 1) {
      downAt = performance.now()
      downPos = { x: e.clientX, y: e.clientY }
      moved = 0
      velocity = 0
    } else if (pointers.size === 2) {
      pinchDist = spread(pointers)
    }
  })

  canvas.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId)
    if (!prev) return
    const dx = e.clientX - prev.x
    const dy = e.clientY - prev.y
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    moved += Math.hypot(dx, dy)

    if (pointers.size === 1) {
      const k = 0.0055
      stage.azimuth -= dx * k
      velocity = -dx * k
      stage.polar = clamp(stage.polar - dy * k, ORBIT.minPolar, ORBIT.maxPolar)
    } else if (pointers.size === 2) {
      const d = spread(pointers)
      if (pinchDist > 0) stage.distance = zoomBy(stage.distance, pinchDist / d, stage.zoomMin)
      pinchDist = d
    }
  })

  const end = (e: PointerEvent) => {
    pointers.delete(e.pointerId)
    if (pointers.size === 0) {
      const quick = performance.now() - downAt < TAP_MS
      if (quick && moved < TAP_SLOP) {
        onTap(downPos.x, downPos.y)
        velocity = 0
      }
    }
    if (pointers.size < 2) pinchDist = 0
  }
  canvas.addEventListener('pointerup', end)
  canvas.addEventListener('pointercancel', end)

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      stage.distance = zoomBy(stage.distance, 1 + Math.sign(e.deltaY) * 0.09, stage.zoomMin)
    },
    { passive: false },
  )

  // Gentle drift after a flick, killed quickly so it never feels slippery.
  const spin = () => {
    if (pointers.size === 0 && Math.abs(velocity) > 1e-4) {
      stage.azimuth += velocity
      velocity *= 0.9
    }
    requestAnimationFrame(spin)
  }
  spin()
}

function spread(pointers: Map<number, { x: number; y: number }>): number {
  const [a, b] = [...pointers.values()]
  if (!a || !b) return 0
  return Math.hypot(a.x - b.x, a.y - b.y)
}
