import { DAY_SECONDS } from './content'

/** L'heure de l'île. TOUT ce qui dérive l'heure du temps de jeu passe par ici
 *  — soleil, lune, cadran du HUD, campanile, sommeil, événements, rendement :
 *  une seule horloge, sinon le soleil et le village finissent par ne plus
 *  s'accorder (un test refuse toute copie de la formule ailleurs).
 *
 *  Deux temps cohabitent :
 *  - l'horloge `c` ∈ [0,1) avance d'un pas régulier (un tour en DAY_SECONDS) ;
 *  - l'heure `u` ∈ [0,1) est celle du soleil : lever à 0, zénith à 0,25,
 *    coucher à 0,5, minuit à 0,75 — sa hauteur vaut sin(2πu).
 *
 *  c(u) = u + (DAY_SHARE − ½)·sin²(πu) : le jour (u < ½) couvre DAY_SHARE du
 *  tour, la nuit le reste. La pente dc/du vaut 1 au lever et au coucher :
 *  l'aube et le crépuscule passent à la vitesse d'avant, c'est le cœur de la
 *  journée qui s'étire et le cœur de la nuit qui file. Lisse, monotone,
 *  périodique : ni le soleil ni la lune ne sautent. */

/** Part du tour où le soleil est au-dessus de l'horizon. */
export const DAY_SHARE = 2 / 3
const STRETCH = DAY_SHARE - 0.5

/** Le coucher et le lever, en heure du soleil. */
export const DUSK_HOUR = 0.5
export const DAWN_HOUR = 0

/** LA nuit du jeu, la seule : le soleil sous l'horizon (u ≥ ½). C'est elle que
 *  disent le cadran, ses comptes à rebours et le journal des versions, et
 *  c'est elle qui ferme la mer (sim.isNight). Le rendement, lui, suit la part
 *  de jour, qui décline en douceur autour du coucher. */
export function isNightHour(u: number): boolean {
  return frac(u) >= DUSK_HOUR
}

/** Durée d'une nuit en secondes de jeu : 1 min 20 s sur une journée de 4 min. */
export const NIGHT_SECONDS = (1 - DAY_SHARE) * DAY_SECONDS

/** L'heure de la première aube d'une partie neuve : peu après midi. */
const FIRST_HOUR = 0.32

function frac(x: number): number {
  return x - Math.floor(x)
}

/** Horloge régulière d'une heure du soleil (la réciproque de dayHourOfClock). */
export function clockOfDayHour(u: number): number {
  const s = Math.sin(Math.PI * u)
  return u + STRETCH * s * s
}

/** Heure du soleil d'un point de l'horloge régulière. c(u) n'a pas de forme
 *  inverse simple : quelques pas de Newton suffisent (dc/du ≥ 1 − π/6). */
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

/** L'heure du soleil après `totalPlaySeconds` de jeu. */
export function dayPhaseAt(totalPlaySeconds: number): number {
  return dayHourOfClock(clockAt(totalPlaySeconds))
}

/** Secondes de jeu avant que le soleil n'atteigne l'heure `u`. */
export function secondsUntilDayHour(totalPlaySeconds: number, u: number): number {
  return frac(clockOfDayHour(u) - clockAt(totalPlaySeconds)) * DAY_SECONDS
}

/** Moyenne dans le TEMPS, sur un tour complet, d'une grandeur fonction de
 *  l'heure : on intègre en u, pondéré par dc/du (l'heure s'attarde là où la
 *  pente est forte). */
export function cycleMean(f: (u: number) => number, steps = 720): number {
  let sum = 0
  for (let i = 0; i < steps; i++) {
    const u = (i + 0.5) / steps
    sum += f(u) * (1 + STRETCH * Math.PI * Math.sin(2 * Math.PI * u))
  }
  return sum / steps
}
