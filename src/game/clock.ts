import { DAY_SECONDS } from './content'

export const DAY_SHARE = 2 / 3
const STRETCH = DAY_SHARE - 0.5

export const DUSK_HOUR = 0.5
export const DAWN_HOUR = 0

export function isNightHour(u: number): boolean {
  return frac(u) >= DUSK_HOUR
}

export const NIGHT_SECONDS = (1 - DAY_SHARE) * DAY_SECONDS

const FIRST_HOUR = 0.32

function frac(x: number): number {
  return x - Math.floor(x)
}

export function clockOfDayHour(u: number): number {
  const s = Math.sin(Math.PI * u)
  return u + STRETCH * s * s
}

export function dayHourOfClock(c: number): number {
  const p = frac(c)
  let u = p
  for (let i = 0; i < 6; i++) {
    const f = clockOfDayHour(u) - p
    u -= f / (1 + STRETCH * Math.PI * Math.sin(2 * Math.PI * u))
  }
  return frac(u)
}

const CLOCK_START = clockOfDayHour(FIRST_HOUR)

function clockAt(totalPlaySeconds: number): number {
  return frac(CLOCK_START + totalPlaySeconds / DAY_SECONDS)
}

export function dayPhaseAt(totalPlaySeconds: number): number {
  return dayHourOfClock(clockAt(totalPlaySeconds))
}

export function secondsUntilDayHour(totalPlaySeconds: number, u: number): number {
  return frac(clockOfDayHour(u) - clockAt(totalPlaySeconds)) * DAY_SECONDS
}

export function cycleMean(f: (u: number) => number, steps = 720): number {
  let sum = 0
  for (let i = 0; i < steps; i++) {
    const u = (i + 0.5) / steps
    sum += f(u) * (1 + STRETCH * Math.PI * Math.sin(2 * Math.PI * u))
  }
  return sum / steps
}
