import { test } from 'node:test'
import assert from 'node:assert/strict'

const { ORBIT, zoomMin, zoomBy } = await import('../src/render/orbit.ts')

const R = 24.43
const DESKTOP = 120.1
const PORTRAIT = 289.8
const camDist = (frame, zoom) => frame * (zoom / ORBIT.baseZoom)

test('écran large : le zoom maxi ne change pas (8)', () => {
  assert.equal(zoomMin(DESKTOP, R), ORBIT.minZoom)
  assert.equal(zoomMin(100, R), ORBIT.minZoom)
})

test('portrait : on zoome nettement plus près qu\'avant', () => {
  const lo = zoomMin(PORTRAIT, R)
  assert.ok(lo < ORBIT.minZoom)
  const before = camDist(PORTRAIT, ORBIT.minZoom)
  const after = camDist(PORTRAIT, lo)
  assert.ok(after < before * 0.7, `${after} vs ${before}`)
  assert.ok(Math.abs(after - ORBIT.minCamRadii * R) < 1e-9)
  const px = (2.28 * 844) / (2 * after * Math.tan((27 * Math.PI) / 360))
  assert.ok(px >= 60 && px <= 100, `${px} px`)
})

test('au plus près et au plus rasant, la caméra reste hors de l\'île et au-dessus du sol', () => {
  for (const perRadius of [DESKTOP / R, PORTRAIT / R, 400 / R, 900 / R]) {
    for (const radius of [R, 30, 40]) {
      const frame = perRadius * radius
      const d = camDist(frame, zoomMin(frame, radius))
      const horizontal = d * Math.sin(ORBIT.maxPolar)
      const height = 1 + d * Math.cos(ORBIT.maxPolar)
      assert.ok(horizontal > radius * 1.13, `horizontale ${horizontal} pour R=${radius}`)
      assert.ok(height > 5, `hauteur ${height}`)
      assert.ok(d > 8 + 10, 'bien au-delà du plan proche (8)')
    }
  }
})

test('cadrage inconnu : retombe sur le 8 historique', () => {
  assert.equal(zoomMin(0, R), ORBIT.minZoom)
  assert.equal(zoomMin(NaN, R), ORBIT.minZoom)
})

test('zoomBy : mêmes bornes pour le doigt, la molette et le clavier', () => {
  assert.equal(zoomBy(20, 0.01, 8), 8)
  assert.equal(zoomBy(20, 100, 8), ORBIT.maxZoom)
  assert.equal(zoomBy(20, 1.1, 8), 22)
  assert.equal(zoomBy(4.7, 1.09, 8), 8 * 1.09)
  assert.equal(zoomBy(4.7, 0.9, 8), 8)
})
