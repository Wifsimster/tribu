import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  SRGBColorSpace,
} from 'three'

/** Pastel, low-contrast, faintly desaturated — the palette a toy village is
 *  painted in. Saturated primaries read as "programmer art" at this scale.
 *  Les verts sont volontairement cassés vers l'olive : à côté d'une eau
 *  turquoise sourde, un vert pur vire au fluo. */
export const PALETTE = {
  /** Couleur de l'eau *proche* : la brume se charge d'éclaircir le lointain. */
  water: new Color('#3e7a84'),
  waterDeep: new Color('#1f4c58'),
  waterShallow: new Color('#74a3a3'),
  /** Brume et fond de ciel — même teinte, pour que l'horizon disparaisse. */
  haze: new Color('#85a9ab'),
  sky: new Color('#a9c9cb'),
  foam: new Color('#d3e4dc'),
  sand: new Color('#cfbf97'),
  grass: new Color('#87a566'),
  grassLight: new Color('#9fb878'),
  grassDark: new Color('#6c8c55'),
  /** Terre du socle : ce qui affleure sous l'herbe dans les contre-marches. */
  earth: new Color('#8e8471'),
  earthDark: new Color('#665f52'),
  rock: new Color('#9d968b'),
  rockDark: new Color('#7c766d'),
  dirt: new Color('#a5825e'),
  trunk: new Color('#7d5d41'),
  leafA: new Color('#5a8d51'),
  leafB: new Color('#6e9a5b'),
  leafC: new Color('#47764a'),
  thatch: new Color('#d0aa6a'),
  hide: new Color('#bb8a62'),
  skin: new Color('#dda878'),
  cloth: new Color('#c26b4d'),
  wheat: new Color('#dcbc65'),
  stoneWall: new Color('#c7bfaf'),
} as const

/** Deterministic jitter so a field of instanced trees does not look stamped. */
export function tint(base: Color, seed: number, spread = 0.06): Color {
  const c = base.clone()
  const n = (Math.sin(seed * 12.9898) * 43758.5453) % 1
  const d = (n - Math.floor(n) - 0.5) * 2 * spread
  c.offsetHSL(d * 0.35, d * 0.5, d)
  return c
}

const rampRgb = { r: 0, g: 0, b: 0 }

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
      c.getRGB(rampRgb, SRGBColorSpace)
      const i = (y * width + x) * 4
      data[i] = Math.round(Math.min(1, Math.max(0, rampRgb.r)) * 255)
      data[i + 1] = Math.round(Math.min(1, Math.max(0, rampRgb.g)) * 255)
      data[i + 2] = Math.round(Math.min(1, Math.max(0, rampRgb.b)) * 255)
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
