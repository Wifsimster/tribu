import { ORBIT, clamp, zoomBy } from './orbit'

export interface OrbitRig {
  azimuth: number
  polar: number
  distance: number
  readonly zoomMin: number
}

export const AZIMUTH_SPEED = 1.2
export const POLAR_SPEED = 0.7
export const ZOOM_RATE = 1.0
export const RAMP_S = 0.12

const LEFT = 1
const RIGHT = 2
const UP = 4
const DOWN = 8
const ZOOM_IN = 16
const ZOOM_OUT = 32

function actionOf(key: string, code: string): number {
  switch (key) {
    case 'ArrowLeft':
    case 'q':
    case 'Q':
    case 'a':
    case 'A':
      return LEFT
    case 'ArrowRight':
    case 'd':
    case 'D':
      return RIGHT
    case 'ArrowUp':
    case 'z':
    case 'Z':
    case 'w':
    case 'W':
      return UP
    case 'ArrowDown':
    case 's':
    case 'S':
      return DOWN
    case '+':
    case '=':
      return ZOOM_IN
    case '-':
      return ZOOM_OUT
  }
  if (code === 'NumpadAdd') return ZOOM_IN
  if (code === 'NumpadSubtract') return ZOOM_OUT
  return 0
}

export class KeyOrbit {
  private readonly held = new Map<string, number>()
  private mask = 0
  private vAz = 0
  private vPolar = 0
  private vZoom = 0
  private readonly rig: OrbitRig

  constructor(rig: OrbitRig) {
    this.rig = rig
  }

  press(key: string, code: string): boolean {
    const a = actionOf(key, code)
    if (!a) return false
    this.held.set(code || key, a)
    this.recompute()
    return true
  }

  release(key: string, code: string): boolean {
    const id = code || key
    if (!this.held.has(id)) return false
    this.held.delete(id)
    this.recompute()
    return true
  }

  releaseAll(): void {
    this.held.clear()
    this.mask = 0
    this.vAz = this.vPolar = this.vZoom = 0
  }

  get active(): boolean {
    return this.mask !== 0 || this.vAz !== 0 || this.vPolar !== 0 || this.vZoom !== 0
  }

  step(dt: number): boolean {
    const m = this.mask
    const tAz = ((m & RIGHT ? 1 : 0) - (m & LEFT ? 1 : 0)) * AZIMUTH_SPEED
    const tPolar = ((m & DOWN ? 1 : 0) - (m & UP ? 1 : 0)) * POLAR_SPEED
    const tZoom = ((m & ZOOM_OUT ? 1 : 0) - (m & ZOOM_IN ? 1 : 0)) * ZOOM_RATE
    const k = 1 - Math.exp(-dt / RAMP_S)
    this.vAz = settle(this.vAz + (tAz - this.vAz) * k, tAz, AZIMUTH_SPEED)
    this.vPolar = settle(this.vPolar + (tPolar - this.vPolar) * k, tPolar, POLAR_SPEED)
    this.vZoom = settle(this.vZoom + (tZoom - this.vZoom) * k, tZoom, ZOOM_RATE)

    const r = this.rig
    r.azimuth += this.vAz * dt
    r.polar = clamp(r.polar + this.vPolar * dt, ORBIT.minPolar, ORBIT.maxPolar)
    if (this.vZoom !== 0) r.distance = zoomBy(r.distance, Math.exp(this.vZoom * dt), r.zoomMin)
    return this.active
  }

  private recompute(): void {
    let m = 0
    for (const a of this.held.values()) m |= a
    this.mask = m
  }
}

function settle(v: number, target: number, scale: number): number {
  return Math.abs(v - target) < scale * 1e-3 ? target : v
}

export function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true
}

export function attachKeyboard(rig: OrbitRig, blocked: (target: EventTarget | null) => boolean): KeyOrbit {
  const orbit = new KeyOrbit(rig)
  let running = false
  let last = 0

  const tick = (now: number) => {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000))
    last = now
    if (orbit.step(dt)) requestAnimationFrame(tick)
    else running = false
  }
  const wake = () => {
    if (running) return
    running = true
    last = performance.now()
    requestAnimationFrame(tick)
  }

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return
    if (isEditable(e.target) || blocked(e.target)) return
    if (!orbit.press(e.key, e.code)) return
    e.preventDefault()
    wake()
  })
  window.addEventListener('keyup', (e) => {
    if (orbit.release(e.key, e.code)) wake()
  })
  window.addEventListener('blur', () => orbit.releaseAll())
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) orbit.releaseAll()
  })
  return orbit
}
