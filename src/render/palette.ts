import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  SRGBColorSpace,
} from 'three'

/** Palette « maquette peinte » : teintes franches, valeurs tenues.
 *
 *  HISTORIQUE — jusqu'à la v3.3 elle était volontairement pastel et cassée vers
 *  l'olive (un vert pur virait au fluo à côté d'une eau turquoise sourde).
 *  Retour joueur 2026-08-21, référence à l'appui (hex builder saturé) : on va
 *  vers des teintes plus vives. La leçon des rounds pastel reste vraie et
 *  s'applique autrement : ce n'est pas la SATURATION qui faisait « programmer
 *  art », c'est l'absence d'écart de VALEUR. Ici les verts montent en
 *  saturation mais gardent leur hiérarchie clair/moyen/sombre, et l'eau garde
 *  une valeur nettement plus basse que la terre — c'est elle qui détache la
 *  silhouette de l'île. */
export const PALETTE = {
  /** Couleur de l'eau *proche* : la brume se charge d'éclaircir le lointain.
   *  L'eau est franchement bleue et d'une valeur basse : c'est l'écart de
   *  luminosité avec la terre, plus que la teinte, qui détache la silhouette. */
  water: new Color('#2b7fbe'),
  waterDeep: new Color('#17548f'),
  waterShallow: new Color('#5cb8dc'),
  /** Brume et fond de ciel — même teinte, pour que l'horizon disparaisse. */
  haze: new Color('#93b8cc'),
  sky: new Color('#aed3e4'),
  /** La 2e ride, au large : un souffle à peine plus clair que l'eau. */
  foam: new Color('#8ed3ea'),
  /** Le trait de flottaison. Clair, oui — mais c'est sa FINESSE qui le
   *  distingue des halos des rounds passés : un trait dessiné de 2 px collé à
   *  la découpe, jamais un dégradé. La référence a les deux : ce trait ET un
   *  soubassement sombre juste dessous. */
  foamLine: new Color('#f2f9f3'),
  /** Sable et verts poussés vers le chaud et le clair : posés sur une eau
   *  froide, ils lisent comme un objet éclairé, pas comme un morceau de fond. */
  sand: new Color('#e3d3a2'),
  grass: new Color('#5aa84b'),
  grassLight: new Color('#76c25b'),
  grassDark: new Color('#3f8340'),
  /** Terre du socle : ce qui affleure sous l'herbe dans les contre-marches. */
  earth: new Color('#a4906b'),
  earthDark: new Color('#6f6047'),
  rock: new Color('#a49c8e'),
  rockDark: new Color('#807870'),
  /** Terre battue de la clairière, et sa version tassée près du feu. */
  dirt: new Color('#ab8352'),
  dirtDark: new Color('#8a6740'),
  trunk: new Color('#7d5d41'),
  leafA: new Color('#4f9e44'),
  leafB: new Color('#6bbb51'),
  leafC: new Color('#3a7f39'),
  thatch: new Color('#d0aa6a'),
  hide: new Color('#bb8a62'),
  skin: new Color('#dda878'),
  cloth: new Color('#c26b4d'),
  wheat: new Color('#dcbc65'),
  stoneWall: new Color('#c7bfaf'),
  /** L'ardoise bleue des toits tardifs : c'est ELLE la signature de la
   *  référence — un froid saturé posé sur des murs chauds. */
  roof: new Color('#4260c4'),
  roofDark: new Color('#31489b'),
  roofLight: new Color('#6d87dd'),
} as const

/** Direction du soleil, en dur à un seul endroit. `scene.ts` la donne à la
 *  lumière, `island.ts` en déduit de quel côté l'île pose son ombre sur l'eau :
 *  recopiée des deux côtés, elle finissait par diverger. */
export const SUN_DIR = { x: -34, y: 46, z: 24 } as const

/** Deterministic jitter so a field of instanced trees does not look stamped. */
export function tint(base: Color, seed: number, spread = 0.06): Color {
  const c = base.clone()
  const n = (Math.sin(seed * 12.9898) * 43758.5453) % 1
  const d = (n - Math.floor(n) - 0.5) * 2 * spread
  c.offsetHSL(d * 0.35, d * 0.5, d)
  return c
}

/** Encodage sRGB tabulé. `Color.getRGB` fait trois `Math.pow` par pixel : sur la
 *  nappe d'eau, qui se peint en 150 000 pixels, c'est le poste le plus lourd du
 *  chargement. L'index est en racine du linéaire, là où la courbe est presque
 *  droite, donc mille entrées suffisent à rester sous le LSB. */
const ENCODE_N = 1024
const encodeLut = new Float32Array(ENCODE_N + 1)
for (let i = 0; i <= ENCODE_N; i++) {
  const lin = (i / ENCODE_N) ** 2
  encodeLut[i] = lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055
}

function encodeSrgb(lin: number): number {
  if (!(lin > 0)) return 0
  if (lin >= 1) return 255
  const t = Math.sqrt(lin) * ENCODE_N
  const i = t | 0
  const f = t - i
  return (encodeLut[i]! * (1 - f) + encodeLut[i + 1]! * f) * 255
}

/** Dégradés fabriqués en mémoire plutôt qu'avec un canvas 2D : le navigateur
 *  prémultiplie l'alpha d'un canvas, ce qui salit les bords d'un halo. */
export function rampTexture(
  width: number,
  height: number,
  fill: (u: number, v: number, out: Color) => number,
): DataTexture {
  const data = new Uint8Array(width * height * 4)
  const c = new Color()
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = fill((x + 0.5) / width, (y + 0.5) / height, c)
      const i = (y * width + x) * 4
      data[i] = Math.round(encodeSrgb(c.r))
      data[i + 1] = Math.round(encodeSrgb(c.g))
      data[i + 2] = Math.round(encodeSrgb(c.b))
      data[i + 3] = Math.round(Math.min(1, Math.max(0, a)) * 255)
    }
  }
  const tex = new DataTexture(data, width, height, RGBAFormat)
  tex.colorSpace = SRGBColorSpace
  tex.minFilter = LinearFilter
  tex.magFilter = LinearFilter
  tex.wrapS = ClampToEdgeWrapping
  tex.wrapT = ClampToEdgeWrapping
  tex.needsUpdate = true
  return tex
}

/** Interpolation sur une rampe de paliers, en travaillant en linéaire. */
export function ramp(stops: readonly (readonly [number, Color])[], t: number, out: Color): void {
  const first = stops[0]
  if (!first) return
  if (t <= first[0]) {
    out.copy(first[1])
    return
  }
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]!
    const b = stops[i]!
    if (t <= b[0]) {
      const k = (t - a[0]) / Math.max(1e-6, b[0] - a[0])
      out.copy(a[1]).lerp(b[1], k)
      return
    }
  }
  out.copy(stops[stops.length - 1]![1])
}

/** Bornes inversées acceptées : c'est la façon la plus lisible d'écrire une
 *  rampe décroissante. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const span = edge1 - edge0
  if (Math.abs(span) < 1e-6) return x < edge0 ? 0 : 1
  const t = Math.min(1, Math.max(0, (x - edge0) / span))
  return t * t * (3 - 2 * t)
}
