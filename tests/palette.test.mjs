// La palette A (v3.60.0) figée : un changement de couleur doit être voulu,
// donc passer par ce test, pas glisser au détour d'un autre chantier.
//   corepack pnpm test
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { PALETTE, LIGHT, AGE_SKY_MIX, AGE_HAZE_MIX } = await import('../src/render/palette.ts')
const { AGES } = await import('../src/game/content.ts')

test('palette A : valeurs clés figées', () => {
  const expected = {
    sky: '5db3ee',
    haze: 'b4dcf2',
    water: '1f98cf',
    waterDeep: '1572ae',
    waterShallow: '4fdccd',
    foam: 'bff3f0',
    sand: 'efd98e',
    grass: '5cbb2e',
    grassLight: '8cd83e',
    grassDark: '34952e',
    leafA: '46a82f',
    leafB: '6cc63a',
    leafC: '2f8a2c',
    thatch: 'e0b25a',
  }
  for (const [name, hex] of Object.entries(expected)) {
    assert.equal(PALETTE[name].getHexString(), hex, name)
  }
})

test('palette A : lumière figée', () => {
  assert.equal(LIGHT.sunDay.getHexString(), 'ffe2b0')
  assert.equal(LIGHT.sunIntensity, 2.55)
  assert.equal(LIGHT.hemiSky.getHexString(), 'd2e9ff')
  assert.equal(LIGHT.hemiGround.getHexString(), '7d7d5c')
  assert.equal(LIGHT.hemiIntensity, 0.62)
  assert.equal(LIGHT.exposure, 1.1)
})

test('ciel et brume ne prennent plus la teinte d’âge', () => {
  assert.equal(AGE_SKY_MIX, 0)
  assert.equal(AGE_HAZE_MIX, 0)
  // Mélange tel que le fait scene.ts : quel que soit l'âge, le ciel et la
  // brume restent exactement ceux de la palette.
  for (const age of AGES) {
    const top = PALETTE.sky.clone().lerp(PALETTE.sky.clone().setHex(age.sky), AGE_SKY_MIX)
    const haze = PALETTE.haze.clone().lerp(PALETTE.haze.clone().setHex(age.fog), AGE_HAZE_MIX)
    assert.equal(top.getHexString(), PALETTE.sky.getHexString(), `ciel, âge ${age.id}`)
    assert.equal(haze.getHexString(), PALETTE.haze.getHexString(), `brume, âge ${age.id}`)
  }
})

test("l'eau garde son écart de valeur avec la terre", () => {
  // La leçon de la v3.3 : c'est la VALEUR, pas la teinte, qui détache l'île.
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
  assert.ok(lum(PALETTE.sand) > lum(PALETTE.water) * 2, 'sable nettement plus clair que l’eau')
  assert.ok(lum(PALETTE.waterDeep) < lum(PALETTE.water), 'le profond fonce')
  assert.ok(lum(PALETTE.waterShallow) > lum(PALETTE.water), 'le haut-fond éclaircit')
})
