import { MeshToonMaterial } from 'three'

// ── Squelette procédural de la faune (v3.60.0) ─────────────────────────────
// Pas d'os, pas de texture : chaque sommet d'un animal porte l'identifiant de
// sa pièce et le pivot autour duquel elle tourne (`aPivot`), chaque bête quatre
// nombres d'état (`aAnim`), et le vertex shader plie les pièces. Pourquoi pas
// une animation cuite dans Blender : à 3–40 px on ne verrait pas la finesse
// d'un rig, et chaque retouche de silhouette (fréquentes) obligerait à
// recuire. Ici la géométrie reste en TS ; on bouge les pattes, le cou, les
// ailes — les seules pièces qui se lisent à cette taille.
//
// Le même morceau de GLSL et sa copie TS (`rigPose`) vivent dans ce fichier,
// côte à côte : les tests mesurent le patinage et les jonctions avec la copie
// TS, il faut donc qu'elle calcule EXACTEMENT ce que fait le shader.

/** Identifiant de pièce, stocké en `aPivot.w`. 0 = rigide : le sommet n'est
 *  pas touché (mouton, poule, cheval en entier dans la 3.60.0). */
export const PART = {
  RIGID: 0,
  /** Pattes avant gauche, avant droite, arrière gauche, arrière droite. La
   *  gauche de la bête est +x (elle regarde +z). */
  FL: 1,
  FR: 2,
  HL: 3,
  HR: 4,
  NECK: 5,
  /** Réservé (queue du cheval, incrément 3) : rigide pour l'instant. */
  TAIL: 6,
  /** Aile gauche/droite, du corps au coude : tourne à l'épaule. */
  ARM_L: 7,
  ARM_R: 8,
  /** Main gauche/droite, du coude au bout : tourne au coude, puis à l'épaule. */
  HAND_L: 9,
  HAND_R: 10,
} as const

const TAU = Math.PI * 2
const DEG = Math.PI / 180

/** L'allure d'un quadrupède, en paramètres physiques. La foulée ne se règle
 *  pas à l'œil : elle se DÉDUIT de la longueur de patte et de l'amplitude,
 *  sinon le sabot glisse sur l'herbe (« la statue qui patine » de la 3.58). */
export interface Gait {
  /** Hanche → dessous du sabot, en unités objet. */
  leg: number
  /** Cadence : radians de cycle par unité parcourue (marche, puis trot). */
  kWalk: number
  kTrot: number
  /** Amplitude crête de la patte à la marche, au trot (avant, arrière). */
  aWalk: number
  aTrotFront: number
  aTrotHind: number
  /** De combien la patte se rétracte dans le corps au milieu du retour : le
   *  sabot se lève au lieu de raser l'herbe. */
  liftWalk: number
  liftTrot: number
  /** Cou : plongée au broutage, balancier à la marche, port en fuite. */
  neckGraze: number
  neckWalk: number
  neckTrot: number
  /** Houle du cou au broutage, en part de `neckGraze`, et sa fréquence (Hz). */
  neckSwell: number
  swellHz: number
  /** Part du tangage de broutage (`grazePitch`) que garde le corps : le cou
   *  fait le reste. */
  bodyPitch: number
  /** Rebond en fuite, en multiple de `bobAmp`. */
  trotBob: number
}

/** Fraction du cycle où le sabot est au sol. Pendant l'appui le pied recule
 *  en ligne droite à vitesse constante (voir `sweep`) — 2·L·tan(A) en β de
 *  cycle — et il ne glisse pas si ce recul vaut exactement la foulée 2π/k.
 *  D'où β = k·L·tan(A)/π : c'est la cadence qui fixe l'appui, pas l'inverse.
 *  La tangente (et non le sinus) parce que la patte s'allonge de 1/cos θ pour
 *  garder le sabot AU SOL : une patte rigide qui pivote décolle le sabot aux
 *  deux bouts de l'appui. */
export function stance(leg: number, k: number, amp: number): number {
  return Math.min(0.9, (k * leg * Math.tan(amp)) / Math.PI)
}

/** Le chevreuil (§4 de la conception) : 10,2 rad/u au pas, 5,6 au trot de
 *  fuite. Le trot remplace le galop : à 8 px, un galop ne se lirait pas. */
export const DEER_GAIT: Gait = {
  // Hanche (y 0,60, dans le corps) → dessous du sabot (y 0,01).
  leg: 0.59,
  kWalk: 10.2,
  kTrot: 5.6,
  aWalk: 20 * DEG,
  aTrotFront: 28 * DEG,
  aTrotHind: 32 * DEG,
  liftWalk: 0.05,
  liftTrot: 0.08,
  // Le cou plonge de 75° depuis le garrot : avec 30 % du tangage d'avant
  // (`grazePitch`), le museau passe sous la ligne du ventre.
  neckGraze: 75 * DEG,
  neckWalk: 4 * DEG,
  // Tête portée en avant dans la fuite (même sens que la plongée du broutage).
  neckTrot: 8 * DEG,
  neckSwell: 6 / 75,
  swellHz: 0.35,
  bodyPitch: 0.3,
  trotBob: 1.6,
}

/** La mouette : 2,6 battements par seconde à l'horloge (elle vole, la
 *  distance n'y fait rien), la main en retard sur l'épaule. */
export const GULL_WING = {
  hz: 2.6,
  shoulder: 30 * DEG,
  hand: 18 * DEG,
  /** Retard de la main, en part de cycle. */
  lag: 0.12,
  glideShoulder: 8 * DEG,
  glideHand: -4 * DEG,
  /** Épaule droite (la gauche en miroir sur x) : DANS le corps, à 0,025 du
   *  bord de la capsule — une épaule hors du corps ouvrirait un jour. */
  shoulderAt: [0.025, 0, -0.01] as const,
  elbowAt: [0.22, 0.022, -0.015] as const,
  /** Fondu battu ↔ plané (τ, s). */
  blend: 0.3,
  /** Descente en plané, remontée en battu (u/s), perte maximale (u). */
  sink: 0.1,
  climb: 0.25,
  maxDrop: 0.5,
  /** Corps en opposition aux ailes (u), et ce qui reste de son roulis (rad). */
  bodyBob: 0.015,
  bodyRoll: 0.05,
}

/** Les 12 flottants de `uRig` (3 × vec4). Leur sens dépend des pièces que
 *  porte l'espèce : pattes et cou pour un quadrupède, ailes pour un oiseau. */
export function gaitUniform(g: Gait): Float32Array {
  return new Float32Array([
    g.aWalk, stance(g.leg, g.kWalk, g.aWalk), g.aTrotFront, stance(g.leg, g.kTrot, g.aTrotFront),
    g.aTrotHind, stance(g.leg, g.kTrot, g.aTrotHind), g.liftWalk, g.liftTrot,
    g.neckGraze, g.neckWalk, g.neckTrot, 0,
  ])
}

export function wingUniform(w: typeof GULL_WING): Float32Array {
  return new Float32Array([
    w.shoulder, w.hand, w.lag, 0,
    w.glideShoulder, w.glideHand, 0, 0,
    w.shoulderAt[0], w.shoulderAt[1], w.shoulderAt[2], 0,
  ])
}

// ── Le shader ──────────────────────────────────────────────────────────────
// `aAnim` = (phase, allure 0–1, broutage, trot 0–1) pour un quadrupède ;
// (phase du battement, –, –, battu 0–1) pour un oiseau. La déformation se fait
// dans l'espace OBJET, avant `instanceMatrix` : le fondu de repositionnement
// (échelle → 0, v3.58.0) écrase donc aussi les pièces pliées.

export const RIG_PARS = /* glsl */ `
attribute vec4 aPivot;
attribute vec4 aAnim;
uniform vec4 uRig[3];
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
vec3 rigPose(vec3 p, inout vec3 n) {
  float id = floor(aPivot.w + 0.5);
  if (id < 0.5 || id == 6.0) return p;
  vec3 q = p - aPivot.xyz;
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
    q.yz = rigRot(q.yz, th);
    n.yz = rigRot(n.yz, th);
    return q + aPivot.xyz;
  }
  if (id < 5.5) {
    float a = uRig[2].x * aAnim.z + aAnim.y * mix(uRig[2].y * sin(2.0 * aAnim.x), uRig[2].z, aAnim.w);
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

/** À la place de `begin_vertex` : sert aussi tel quel au matériau de
 *  profondeur des ombres (incrément 3), qui n'a pas de normale. */
export const RIG_BEGIN_VERTEX = /* glsl */ `
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

/** À la place de `beginnormal_vertex` : la normale tourne avec la pièce,
 *  sinon les bandes du toon resteraient peintes à la pose de repos. */
export const RIG_BEGIN_NORMAL = /* glsl */ `
vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif
// La pose se calcule une seule fois : begin_vertex, qui suit, la reprend.
vec3 rigPosed = rigPose( vec3( position ), objectNormal );
#define RIG_POSED
`

/** Branche le squelette dans un shader three (toon ou profondeur). */
export function injectRig(shader: { vertexShader: string; uniforms: Record<string, { value: unknown }> }, rig: Float32Array): void {
  shader.uniforms.uRig = { value: rig }
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${RIG_PARS}`)
    .replace('#include <beginnormal_vertex>', RIG_BEGIN_NORMAL)
    .replace('#include <begin_vertex>', RIG_BEGIN_VERTEX)
}

let quiet = 0x9e3779b9
/** Un matériau tire son uuid à `Math.random`. En créer un de plus décalerait
 *  tout le hasard de la faune qui suit (troupeaux, étapes, trajets) : les
 *  bêtes ne marcheraient plus où elles marchaient en 3.58.0. Le temps de la
 *  construction, `Math.random` est donc un petit générateur à part. */
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

/** Un matériau toon animé par espèce, tous sur le MÊME programme (même clé de
 *  cache) : un seul programme de plus pour toute la faune, et un draw call
 *  par espèce comme avant. Seul `uRig` diffère d'une espèce à l'autre. */
export function rigMaterial(rig: Float32Array): MeshToonMaterial {
  const mat = quietly(() => new MeshToonMaterial({ vertexColors: true }))
  mat.onBeforeCompile = (shader) => injectRig(shader, rig)
  mat.customProgramCacheKey = () => 'tribu-fauna-rig'
  return mat
}

// ── Copie TS du shader ─────────────────────────────────────────────────────
// Ligne pour ligne la même chose que `rigPose` en GLSL, en double précision.
// Pour les tests (patinage, jonctions) — le jeu, lui, ne s'en sert pas.

function sweep(c: number, beta: number): number {
  return c < beta ? 1 - (2 * c) / beta : -Math.cos((Math.PI * (c - beta)) / (1 - beta))
}
function lift(c: number, beta: number): number {
  return c < beta ? 0 : Math.sin((Math.PI * (c - beta)) / (1 - beta))
}
const fract = (v: number): number => v - Math.floor(v)
const mod = (a: number, b: number): number => a - b * Math.floor(a / b)
const mix = (a: number, b: number, t: number): number => a * (1 - t) + b * t

/** Où en est la patte `id` (1–4) de son cycle, de 0 (le sabot se pose) à 1 :
 *  au pas (`trot` faux) ou au trot. Même calcul que `cW`/`cT` du shader ; les
 *  tests s'en servent pour savoir quand le sabot est en appui (cycle < β). */
export function legCycle(id: number, phase: number, trot: boolean): number {
  const k = id - 1
  const off = trot ? 0.5 * Math.abs(mod(k, 2) - Math.floor(k * 0.5)) : (k < 1.5 ? 0.25 : 0) + mod(k, 2) * 0.5
  return fract(phase / TAU - off)
}

/** Pose un point `p` (espace objet) comme le ferait le shader, dans `out`. */
export function rigPose(
  out: number[],
  p: ArrayLike<number>,
  pivot: ArrayLike<number>,
  anim: ArrayLike<number>,
  u: ArrayLike<number>,
): number[] {
  const id = Math.floor(pivot[3]! + 0.5)
  out[0] = p[0]!
  out[1] = p[1]!
  out[2] = p[2]!
  if (id < 0.5 || id === 6) return out
  let qx = p[0]! - pivot[0]!
  let qy = p[1]! - pivot[1]!
  let qz = p[2]! - pivot[2]!
  const rot = (a: number, b: number, t: number): [number, number] => [
    Math.cos(t) * a - Math.sin(t) * b,
    Math.sin(t) * a + Math.cos(t) * b,
  ]
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
    ;[qy, qz] = rot(qy, qz, th)
    out[0] = qx + pivot[0]!
    out[1] = qy + pivot[1]!
    out[2] = qz + pivot[2]!
    return out
  }
  if (id < 5.5) {
    const a = u[8]! * anim[2]! + anim[1]! * mix(u[9]! * Math.sin(2 * anim[0]!), u[10]!, anim[3]!)
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
