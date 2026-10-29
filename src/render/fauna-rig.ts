import { MeshToonMaterial } from 'three'

export const PART = {
  RIGID: 0,
  FL: 1,
  FR: 2,
  HL: 3,
  HR: 4,
  NECK: 5,
  TAIL: 6,
  ARM_L: 7,
  ARM_R: 8,
  HAND_L: 9,
  HAND_R: 10,
  WING_L: 11,
  WING_R: 12,
  HEAD: 13,
} as const

const TAU = Math.PI * 2
const DEG = Math.PI / 180

export interface Gait {
  leg: number
  kWalk: number
  kTrot: number
  aWalk: number
  aTrotFront: number
  aTrotHind: number
  liftWalk: number
  liftTrot: number
  neckGraze: number
  neckWalk: number
  neckTrot: number
  neckSwell: number
  swellHz: number
  bodyPitch: number
  trotBob: number
  roll: number
  drop: number
  neckSleep: number
  tuck: number
  bobHold: number
  headH: number
  wingLift: number
  tailSwing: number
  headGraze: number
  headSleep: number
  neckAt: readonly [number, number]
}

const NO_EXTRA = { tuck: 0, bobHold: 0, headH: 0, wingLift: 0, tailSwing: 0, headGraze: 0, headSleep: 0, neckAt: [0, 0] as const }

export function stance(leg: number, k: number, amp: number): number {
  return Math.min(0.9, (k * leg * Math.tan(amp)) / Math.PI)
}

export const DEER_GAIT: Gait = {
  leg: 0.59,
  kWalk: 10.2,
  kTrot: 5.6,
  aWalk: 20 * DEG,
  aTrotFront: 28 * DEG,
  aTrotHind: 32 * DEG,
  liftWalk: 0.05,
  liftTrot: 0.08,
  neckGraze: 105 * DEG,
  neckWalk: 4 * DEG,
  neckTrot: 8 * DEG,
  neckSwell: 0.02,
  swellHz: 0.35,
  bodyPitch: 0.3,
  trotBob: 1.6,
  roll: 0.05,
  drop: 0.44,
  neckSleep: 30 * DEG,
  ...NO_EXTRA,
  headGraze: 55 * DEG,
  headSleep: 15 * DEG,
  neckAt: [0.7, 0.18],
}

export const SHEEP_GAIT: Gait = {
  leg: 0.355 * 0.62,
  kWalk: 27,
  kTrot: 16,
  aWalk: 22 * DEG,
  aTrotFront: 28 * DEG,
  aTrotHind: 32 * DEG,
  liftWalk: 0.015,
  liftTrot: 0.025,
  neckGraze: 80 * DEG,
  neckWalk: 5 * DEG,
  neckTrot: 6 * DEG,
  neckSwell: 0.06,
  swellHz: 0.5,
  bodyPitch: 0.5,
  trotBob: 1.5,
  roll: 0.08,
  drop: 0.16 * 0.62,
  neckSleep: 35 * DEG,
  ...NO_EXTRA,
}

export const HORSE_GAIT: Gait = {
  leg: 0.84,
  kWalk: 7.5,
  kTrot: 4.5,
  aWalk: 18 * DEG,
  aTrotFront: 25 * DEG,
  aTrotHind: 28 * DEG,
  liftWalk: 0.07,
  liftTrot: 0.1,
  neckGraze: 100 * DEG,
  neckWalk: 6 * DEG,
  neckTrot: 10 * DEG,
  neckSwell: 0.015,
  swellHz: 0.3,
  bodyPitch: 0.5,
  trotBob: 1.5,
  roll: 0.03,
  drop: 0.6,
  neckSleep: 40 * DEG,
  ...NO_EXTRA,
  tailSwing: 12 * DEG,
  headGraze: 55 * DEG,
  headSleep: 25 * DEG,
  neckAt: [1.0, 0.2],
}

export const HEN_GAIT: Gait = {
  leg: 0.1,
  kWalk: 32,
  kTrot: 20,
  aWalk: 30 * DEG,
  aTrotFront: 35 * DEG,
  aTrotHind: 35 * DEG,
  liftWalk: 0.012,
  liftTrot: 0.016,
  neckGraze: 110 * DEG,
  neckWalk: 0,
  neckTrot: 0,
  neckSwell: 0.3,
  swellHz: 2.5,
  bodyPitch: 0.65,
  trotBob: 1,
  roll: 0.06,
  drop: 0.045,
  neckSleep: 20 * DEG,
  tuck: -0.035,
  bobHold: 0.65,
  headH: 0.03,
  wingLift: 50 * DEG,
  tailSwing: 0,
  headGraze: 0,
  headSleep: 0,
  neckAt: [0, 0],
}

export const HEN_FLAP = { hz: 5, dur: 0.6, waitMin: 7, waitSpan: 10 }

export const SLEEP = { rate: 1 / 1.8, fallMax: 6, wakeMax: 4, breathHz: 0.28, breath: 0.035 }

export const GULL_WING = {
  hz: 2.6,
  shoulder: 45 * DEG,
  hand: 26 * DEG,
  lag: 0.12,
  glideShoulder: 8 * DEG,
  glideHand: -4 * DEG,
  shoulderAt: [0.025, 0, -0.01] as const,
  elbowAt: [0.22, 0.022, -0.015] as const,
  blend: 0.3,
  sink: 0.1,
  climb: 0.25,
  maxDrop: 0.5,
  bodyBob: 0.02,
  bodyRoll: 0.05,
}

export function headBobAmp(g: Gait): number {
  return (g.bobHold * Math.PI) / g.kWalk
}

export function gaitUniform(g: Gait): Float32Array {
  return new Float32Array([
    g.aWalk, stance(g.leg, g.kWalk, g.aWalk), g.aTrotFront, stance(g.leg, g.kTrot, g.aTrotFront),
    g.aTrotHind, stance(g.leg, g.kTrot, g.aTrotHind), g.liftWalk, g.liftTrot,
    g.neckGraze, g.neckWalk, g.neckTrot, headBobAmp(g),
    g.drop / g.leg, g.neckSleep, g.tuck, g.bobHold,
    g.headH, g.wingLift, g.tailSwing, 0,
    g.neckAt[0], g.neckAt[1], g.headGraze, g.headSleep,
  ])
}

export function wingUniform(w: typeof GULL_WING): Float32Array {
  return new Float32Array([
    w.shoulder, w.hand, w.lag, 0,
    w.glideShoulder, w.glideHand, 0, 0,
    w.shoulderAt[0], w.shoulderAt[1], w.shoulderAt[2], 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ])
}

export const RIG_PARS = `
attribute vec4 aPivot;
attribute vec4 aAnim;
attribute vec4 aRest;
uniform vec4 uRig[6];
// Pied le long de la foulée, de +1 (devant) à -1 (derrière). Au sol pendant
// beta : recul linéaire, donc à vitesse constante — le sabot reste planté.
// Puis retour en demi-cosinus, sans à-coup de position.
float rigSweep(float c, float beta) {
  return c < beta ? 1.0 - 2.0 * c / beta : -cos(PI * (c - beta) / (1.0 - beta));
}
float rigLift(float c, float beta) {
  return c < beta ? 0.0 : sin(PI * (c - beta) / (1.0 - beta));
}
vec2 rigRot(vec2 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}
// Hochement de la poule, de +0,5 à -0,5 pendant la tenue (la tête recule
// dans le corps à la vitesse où il avance), puis rattrapage en smoothstep. Le
// pas commence quand une patte se pose : phase π/2 (patte FL, décalage 0,25).
float rigBob(float ph, float hold) {
  float s = fract(ph / PI + 0.5);
  return s < hold ? 0.5 - s / hold : smoothstep(0.0, 1.0, (s - hold) / (1.0 - hold)) - 0.5;
}
vec3 rigPose(vec3 p, inout vec3 n) {
  float id = floor(aPivot.w + 0.5);
  if (id < 0.5) return p;
  vec3 q = p - aPivot.xyz;
  if (id > 12.5) {
    // Tête : contre-rotation à la nuque, puis le cou l'emporte au garrot.
    float b = -(uRig[5].z * aAnim.z + uRig[5].w * aRest.x);
    q.yz = rigRot(q.yz, b);
    n.yz = rigRot(n.yz, b);
    float a = uRig[2].x * aAnim.z + aAnim.y * mix(uRig[2].y * sin(2.0 * aAnim.x), uRig[2].z, aAnim.w) + uRig[3].y * aRest.x;
    vec3 neck = vec3(0.0, uRig[5].x, uRig[5].y);
    q += aPivot.xyz - neck;
    q.yz = rigRot(q.yz, a);
    n.yz = rigRot(n.yz, a);
    return q + neck;
  }
  if (id > 10.5) {
    // Aile de la poule : elle s'écarte du flanc et revient, à chaque battement.
    float side = id < 11.5 ? 1.0 : -1.0;
    float a = side * uRig[4].y * aRest.z * (0.5 - 0.5 * cos(aRest.y));
    q.xy = rigRot(q.xy, a);
    n.xy = rigRot(n.xy, a);
    return q + aPivot.xyz;
  }
  if (id > 5.5 && id < 6.5) {
    float a = uRig[4].z * aAnim.y * sin(aAnim.x);
    q.xy = rigRot(q.xy, a);
    n.xy = rigRot(n.xy, a);
    return q + aPivot.xyz;
  }
  if (id < 4.5) {
    float k = id - 1.0;
    // Décalage = instant où la patte se pose, en part de cycle. Pas latéral
    // PG 0 → AG .25 → PD .5 → AD .75 ; trot diagonal AG+PD 0, AD+PG .5.
    float offW = (k < 1.5 ? 0.25 : 0.0) + mod(k, 2.0) * 0.5;
    float offT = 0.5 * abs(mod(k, 2.0) - floor(k * 0.5));
    float ph = aAnim.x / (2.0 * PI);
    float cW = fract(ph - offW);
    float cT = fract(ph - offT);
    float aT = k < 1.5 ? uRig[0].z : uRig[1].x;
    float bT = k < 1.5 ? uRig[0].w : uRig[1].y;
    float thW = -atan(rigSweep(cW, uRig[0].y) * tan(uRig[0].x));
    float thT = -atan(rigSweep(cT, bT) * tan(aT));
    float th = aAnim.y * mix(thW, thT, aAnim.w);
    // La patte s'allonge de 1/cos θ : le sabot reste sur l'horizontale du sol.
    q.y = q.y / cos(th) + aAnim.y * mix(uRig[1].z * rigLift(cW, uRig[0].y), uRig[1].w * rigLift(cT, bT), aAnim.w);
    // Couchée : la patte se replie dans le corps d'autant que le corps descend.
    q.y *= 1.0 - uRig[3].x * aRest.x;
    q.yz = rigRot(q.yz, th);
    n.yz = rigRot(n.yz, th);
    return q + aPivot.xyz;
  }
  if (id < 5.5) {
    float a = uRig[2].x * aAnim.z + aAnim.y * mix(uRig[2].y * sin(2.0 * aAnim.x), uRig[2].z, aAnim.w) + uRig[3].y * aRest.x;
    if (uRig[4].x > 0.0) {
      // Poule : la tête glisse sur z, le cou se cisaille sous elle.
      float o = uRig[2].w * aAnim.y * rigBob(aAnim.x, uRig[3].w) + uRig[3].z * aRest.x;
      q.z += o * clamp(q.y / uRig[4].x, 0.0, 1.0);
    }
    q.yz = rigRot(q.yz, a);
    n.yz = rigRot(n.yz, a);
    return q + aPivot.xyz;
  }
  float side = mod(id, 2.0) > 0.5 ? 1.0 : -1.0;
  vec3 shoulder = vec3(side * uRig[2].x, uRig[2].y, uRig[2].z);
  float sh = mix(uRig[1].x, uRig[0].x * sin(aAnim.x), aAnim.w);
  vec3 base = aPivot.xyz;
  if (id > 8.5) {
    float hd = mix(uRig[1].y, uRig[0].y * sin(aAnim.x - 2.0 * PI * uRig[0].z), aAnim.w);
    q.xy = rigRot(q.xy, side * hd);
    n.xy = rigRot(n.xy, side * hd);
    q += base - shoulder;
    base = shoulder;
  }
  q.xy = rigRot(q.xy, side * sh);
  n.xy = rigRot(n.xy, side * sh);
  return q + base;
}
`

export const RIG_BEGIN_VERTEX = `
vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif
#ifdef RIG_POSED
transformed = rigPosed;
#else
vec3 rigUnusedNormal = vec3( 0.0, 1.0, 0.0 );
transformed = rigPose( transformed, rigUnusedNormal );
#endif
`

export const RIG_BEGIN_NORMAL = `
vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif
// La pose se calcule une seule fois : begin_vertex, qui suit, la reprend.
vec3 rigPosed = rigPose( vec3( position ), objectNormal );
#define RIG_POSED
`

export function injectRig(shader: { vertexShader: string; uniforms: Record<string, { value: unknown }> }, rig: Float32Array): void {
  shader.uniforms.uRig = { value: rig }
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${RIG_PARS}`)
    .replace('#include <beginnormal_vertex>', RIG_BEGIN_NORMAL)
    .replace('#include <begin_vertex>', RIG_BEGIN_VERTEX)
}

let quiet = 0x9e3779b9
function quietly<T>(make: () => T): T {
  const random = Math.random
  Math.random = () => {
    quiet = (Math.imul(quiet, 1664525) + 1013904223) >>> 0
    return quiet / 4294967296
  }
  try {
    return make()
  } finally {
    Math.random = random
  }
}

export function rigMaterial(rig: Float32Array): MeshToonMaterial {
  const mat = quietly(() => new MeshToonMaterial({ vertexColors: true }))
  mat.onBeforeCompile = (shader) => injectRig(shader, rig)
  mat.customProgramCacheKey = () => 'tribu-fauna-rig'
  return mat
}

function sweep(c: number, beta: number): number {
  return c < beta ? 1 - (2 * c) / beta : -Math.cos((Math.PI * (c - beta)) / (1 - beta))
}
function lift(c: number, beta: number): number {
  return c < beta ? 0 : Math.sin((Math.PI * (c - beta)) / (1 - beta))
}
const fract = (v: number): number => v - Math.floor(v)
const mod = (a: number, b: number): number => a - b * Math.floor(a / b)
const mix = (a: number, b: number, t: number): number => a * (1 - t) + b * t

export function legCycle(id: number, phase: number, trot: boolean): number {
  const k = id - 1
  const off = trot ? 0.5 * Math.abs(mod(k, 2) - Math.floor(k * 0.5)) : (k < 1.5 ? 0.25 : 0) + mod(k, 2) * 0.5
  return fract(phase / TAU - off)
}

const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}

export function headBob(phase: number, hold: number): number {
  const s = fract(phase / Math.PI + 0.5)
  return s < hold ? 0.5 - s / hold : smooth((s - hold) / (1 - hold)) - 0.5
}

const REST0 = [0, 0, 0, 0]

export function rigPose(
  out: number[],
  p: ArrayLike<number>,
  pivot: ArrayLike<number>,
  anim: ArrayLike<number>,
  u: ArrayLike<number>,
  rest: ArrayLike<number> = REST0,
): number[] {
  const id = Math.floor(pivot[3]! + 0.5)
  out[0] = p[0]!
  out[1] = p[1]!
  out[2] = p[2]!
  if (id < 0.5) return out
  let qx = p[0]! - pivot[0]!
  let qy = p[1]! - pivot[1]!
  let qz = p[2]! - pivot[2]!
  const rot = (a: number, b: number, t: number): [number, number] => [
    Math.cos(t) * a - Math.sin(t) * b,
    Math.sin(t) * a + Math.cos(t) * b,
  ]
  if (id > 12.5) {
    const b = -(u[22]! * anim[2]! + u[23]! * rest[0]!)
    ;[qy, qz] = rot(qy, qz, b)
    const a = u[8]! * anim[2]! + anim[1]! * mix(u[9]! * Math.sin(2 * anim[0]!), u[10]!, anim[3]!) + u[13]! * rest[0]!
    qy += pivot[1]! - u[20]!
    qz += pivot[2]! - u[21]!
    ;[qy, qz] = rot(qy, qz, a)
    out[0] = qx + pivot[0]!
    out[1] = qy + u[20]!
    out[2] = qz + u[21]!
    return out
  }
  if (id > 10.5 || (id > 5.5 && id < 6.5)) {
    const a =
      id > 10.5
        ? (id < 11.5 ? 1 : -1) * u[17]! * rest[2]! * (0.5 - 0.5 * Math.cos(rest[1]!))
        : u[18]! * anim[1]! * Math.sin(anim[0]!)
    ;[qx, qy] = rot(qx, qy, a)
    out[0] = qx + pivot[0]!
    out[1] = qy + pivot[1]!
    out[2] = qz + pivot[2]!
    return out
  }
  if (id < 4.5) {
    const k = id - 1
    const cW = legCycle(id, anim[0]!, false)
    const cT = legCycle(id, anim[0]!, true)
    const aT = k < 1.5 ? u[2]! : u[4]!
    const bT = k < 1.5 ? u[3]! : u[5]!
    const thW = -Math.atan(sweep(cW, u[1]!) * Math.tan(u[0]!))
    const thT = -Math.atan(sweep(cT, bT) * Math.tan(aT))
    const th = anim[1]! * mix(thW, thT, anim[3]!)
    qy = qy / Math.cos(th) + anim[1]! * mix(u[6]! * lift(cW, u[1]!), u[7]! * lift(cT, bT), anim[3]!)
    qy *= 1 - u[12]! * rest[0]!
    ;[qy, qz] = rot(qy, qz, th)
    out[0] = qx + pivot[0]!
    out[1] = qy + pivot[1]!
    out[2] = qz + pivot[2]!
    return out
  }
  if (id < 5.5) {
    const a = u[8]! * anim[2]! + anim[1]! * mix(u[9]! * Math.sin(2 * anim[0]!), u[10]!, anim[3]!) + u[13]! * rest[0]!
    if (u[16]! > 0) {
      const o = u[11]! * anim[1]! * headBob(anim[0]!, u[15]!) + u[14]! * rest[0]!
      qz += o * Math.min(1, Math.max(0, qy / u[16]!))
    }
    ;[qy, qz] = rot(qy, qz, a)
    out[0] = qx + pivot[0]!
    out[1] = qy + pivot[1]!
    out[2] = qz + pivot[2]!
    return out
  }
  const side = mod(id, 2) > 0.5 ? 1 : -1
  const sx = side * u[8]!
  const sy = u[9]!
  const sz = u[10]!
  const sh = mix(u[4]!, u[0]! * Math.sin(anim[0]!), anim[3]!)
  let bx = pivot[0]!
  let by = pivot[1]!
  let bz = pivot[2]!
  if (id > 8.5) {
    const hd = mix(u[5]!, u[1]! * Math.sin(anim[0]! - TAU * u[2]!), anim[3]!)
    ;[qx, qy] = rot(qx, qy, side * hd)
    qx += bx - sx
    qy += by - sy
    qz += bz - sz
    bx = sx
    by = sy
    bz = sz
  }
  ;[qx, qy] = rot(qx, qy, side * sh)
  out[0] = qx + bx
  out[1] = qy + by
  out[2] = qz + bz
  return out
}
