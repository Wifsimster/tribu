import { Color } from 'three'

/** Pastel, low-contrast, faintly desaturated — the palette a toy village is
 *  painted in. Saturated primaries read as "programmer art" at this scale. */
export const PALETTE = {
  water: new Color('#79c6d8'),
  waterDeep: new Color('#4f9fb8'),
  foam: new Color('#c8ecf2'),
  sand: new Color('#e8d5a3'),
  grass: new Color('#8cc06a'),
  grassDark: new Color('#6fa653'),
  rock: new Color('#a9a49c'),
  rockDark: new Color('#8b867e'),
  dirt: new Color('#b58a5f'),
  trunk: new Color('#8a6242'),
  leafA: new Color('#5f9e52'),
  leafB: new Color('#7ab663'),
  leafC: new Color('#4e8a49'),
  thatch: new Color('#d9b169'),
  hide: new Color('#c48f63'),
  skin: new Color('#e0a978'),
  cloth: new Color('#c96f4e'),
  wheat: new Color('#e3c264'),
  stoneWall: new Color('#cfc7b6'),
} as const

/** Deterministic jitter so a field of instanced trees does not look stamped. */
export function tint(base: Color, seed: number, spread = 0.06): Color {
  const c = base.clone()
  const n = (Math.sin(seed * 12.9898) * 43758.5453) % 1
  const d = (n - Math.floor(n) - 0.5) * 2 * spread
  c.offsetHSL(d * 0.35, d * 0.5, d)
  return c
}
