#!/usr/bin/env node

import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'

const [, , imgPath, ...rest] = process.argv
if (!imgPath) {
  console.error('usage: waterline-metrics.mjs <image.png> [--json]')
  process.exit(1)
}
const asJson = rest.includes('--json')
const oi = rest.indexOf('--overlay')
const overlayPath = oi >= 0 ? rest[oi + 1] : null

const browser = await chromium.launch()
const page = await browser.newPage()
const dataUrl = 'data:image/png;base64,' + (await readFile(imgPath)).toString('base64')

const result = await page.evaluate(async ({ src, withOverlay }) => {
  const img = new Image()
  await new Promise((ok, err) => {
    img.onload = ok
    img.onerror = () => err(new Error('image load failed: ' + src))
    img.src = src
  })
  const W = img.width
  const H = img.height
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0)
  const px = ctx.getImageData(0, 0, W, H).data

  const lum = (x, y) => {
    const i = (y * W + x) * 4
    return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
  }
  const median = (a) => {
    const s = [...a].sort((p, q) => p - q)
    return s[s.length >> 1]
  }

  const BANDS = [
    [0.05, 0.1],
    [0.13, 0.19],
    [0.81, 0.87],
    [0.9, 0.95],
  ].map(([a, b]) => [Math.floor(W * a), Math.floor(W * b)])
  const grab = (y, x0, x1) => {
    const rs = []
    const gs = []
    const bs = []
    for (let x = x0; x < x1; x += 4) {
      const i = (y * W + x) * 4
      rs.push(px[i])
      gs.push(px[i + 1])
      bs.push(px[i + 2])
    }
    return [median(rs), median(gs), median(bs)]
  }
  const coef = new Float32Array(H * 9)
  const us = BANDS.map(([a, b]) => (a + b) / 2 / W)
  const S = [0, 0, 0, 0, 0]
  for (const u of us) for (let p = 0; p < 5; p++) S[p] += u ** p
  const M = [
    [S[0], S[1], S[2]],
    [S[1], S[2], S[3]],
    [S[2], S[3], S[4]],
  ]
  const inv3 = (m) => {
    const [[a, b, c], [d, e, f], [g, h, i]] = m
    const A = e * i - f * h
    const B = c * h - b * i
    const C = b * f - c * e
    const det = a * A + d * B + g * C
    return [
      [A / det, B / det, C / det],
      [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
      [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
    ]
  }
  const Mi = inv3(M)
  for (let y = 0; y < H; y++) {
    const samples = BANDS.map(([x0, x1]) => grab(y, x0, x1))
    for (let ch = 0; ch < 3; ch++) {
      let t0 = 0
      let t1 = 0
      let t2 = 0
      samples.forEach((s, k) => {
        t0 += s[ch]
        t1 += s[ch] * us[k]
        t2 += s[ch] * us[k] * us[k]
      })
      const o = y * 9 + ch * 3
      coef[o] = Mi[0][0] * t0 + Mi[0][1] * t1 + Mi[0][2] * t2
      coef[o + 1] = Mi[1][0] * t0 + Mi[1][1] * t1 + Mi[1][2] * t2
      coef[o + 2] = Mi[2][0] * t0 + Mi[2][1] * t1 + Mi[2][2] * t2
    }
  }
  const bg = (x, y, ch) => {
    const u = x / W
    const o = y * 9 + ch * 3
    return coef[o] + coef[o + 1] * u + coef[o + 2] * u * u
  }
  const bgLum = (x, y) => 0.2126 * bg(x, y, 0) + 0.7152 * bg(x, y, 1) + 0.0722 * bg(x, y, 2)

  const T = 14
  const isObj = (x, y) => {
    const i = (y * W + x) * 4
    return (
      Math.max(
        Math.abs(px[i] - bg(x, y, 0)),
        Math.abs(px[i + 1] - bg(x, y, 1)),
        Math.abs(px[i + 2] - bg(x, y, 2)),
      ) > T
    )
  }
  const X0 = Math.floor(W * 0.12)
  const X1 = Math.floor(W * 0.88)
  const extent = (y) => {
    let xl = -1
    let xr = -1
    for (let x = X0; x < X1; x++) {
      if (isObj(x, y) && isObj(x + 1, y) && isObj(x + 2, y)) {
        xl = x
        break
      }
    }
    for (let x = X1 - 1; x >= X0; x--) {
      if (isObj(x, y) && isObj(x - 1, y) && isObj(x - 2, y)) {
        xr = x
        break
      }
    }
    return xl >= 0 && xr > xl ? [xl, xr] : null
  }

  const yA = Math.floor(H * 0.15)
  const yB = Math.floor(H * 0.88)
  const widths = new Int32Array(H)
  for (let y = yA; y < yB; y++) {
    const e = extent(y)
    widths[y] = e ? e[1] - e[0] : 0
  }
  let wMax = 0
  for (let y = yA; y < yB; y++) wMax = Math.max(wMax, widths[y])
  const plateau = []
  for (let y = yA; y < yB; y++) if (widths[y] >= wMax * 0.99) plateau.push(y)
  if (!plateau.length) throw new Error('flottaison introuvable')
  const yWater = plateau[plateau.length >> 1]

  const eW = extent(yWater)
  const span = eW[1] - eW[0]

  const cx0 = Math.floor(eW[0] + span * 0.05)
  const cx1 = Math.floor(eW[1] - span * 0.05)
  const sY0 = Math.max(0, Math.floor(yWater - H * 0.01))
  const sY1 = Math.min(H - 1, Math.floor(yWater + H * 0.18))
  const cols = []
  for (let x = cx0; x <= cx1; x += 2) {
    let peak = 0
    for (let y = sY0; y <= sY1; y++) peak = Math.max(peak, lum(x, y) - bgLum(x, y))
    const bar = Math.max(peak * 0.7, 25)
    let yc = -1
    let crest = 0
    for (let y = sY1; y >= sY0; y--) {
      const d = lum(x, y) - bgLum(x, y)
      if (d >= bar) {
        yc = y
        crest = d
        break
      }
    }
    cols.push({ x, y: yc < 0 ? yWater : yc, peak: crest, valid: yc >= 0 })
  }
  const HALF = 15
  const contour = cols.map((c, i) => {
    const win = []
    for (let k = -HALF; k <= HALF; k++) {
      const o = cols[Math.min(cols.length - 1, Math.max(0, i + k))]
      win.push(o.y)
    }
    return median(win)
  })

  let ride = 0
  const tipN = Math.floor(cols.length * 0.25)
  cols.forEach((c, i) => {
    if (i > tipN && i < cols.length - tipN) return
    if (c.valid && Math.abs(c.y - contour[i]) <= H * 0.01) ride = Math.max(ride, c.peak)
  })

  const bandDelta = (f0, f1) => {
    let sum = 0
    let signed = 0
    let n = 0
    cols.forEach((c, i) => {
      const y0 = Math.min(H - 1, Math.floor(contour[i] + H * f0) + 3)
      const y1 = Math.min(H - 1, Math.floor(contour[i] + H * f1))
      for (let y = y0; y <= y1; y++) {
        const d = lum(c.x, y) - bgLum(c.x, y)
        sum += Math.abs(d)
        signed += d
        n++
      }
    })
    return { mean: sum / n, signed: signed / n }
  }

  const mass = bandDelta(0.0, 0.04)
  const refl = bandDelta(0.04, 0.12)

  let overlay = null
  if (withOverlay) {
    const octx = cv.getContext('2d')
    octx.fillStyle = '#ffff00'
    octx.fillRect(eW[0], yWater - 1, span, 2)
    cols.forEach((c, i) => {
      const yc = contour[i]
      octx.fillStyle = '#ff2020'
      octx.fillRect(c.x, yc - 1, 2, 3)
      octx.fillStyle = '#20ff20'
      octx.fillRect(c.x, Math.min(H - 2, yc + H * 0.04), 2, 2)
      octx.fillStyle = '#4060ff'
      octx.fillRect(c.x, Math.min(H - 2, yc + H * 0.12), 2, 2)
    })
    overlay = cv.toDataURL('image/png')
  }

  return {
    overlay,
    width: W,
    height: H,
    waterlineY: yWater,
    waterlineFrac: +(yWater / H).toFixed(4),
    footprint: { x0: eW[0], x1: eW[1] },
    ride: +ride.toFixed(2),
    mass: +mass.mean.toFixed(2),
    massSigned: +mass.signed.toFixed(2),
    reflect: +refl.mean.toFixed(2),
    reflectSigned: +refl.signed.toFixed(2),
  }
}, { src: dataUrl, withOverlay: !!overlayPath })

await browser.close()

if (overlayPath && result.overlay) {
  const { writeFile } = await import('node:fs/promises')
  await writeFile(overlayPath, Buffer.from(result.overlay.split(',')[1], 'base64'))
}
delete result.overlay

if (asJson) console.log(JSON.stringify(result))
else {
  console.log(`image      ${imgPath} (${result.width}x${result.height})`)
  console.log(`flottaison y=${result.waterlineY} (${(result.waterlineFrac * 100).toFixed(1)} % H)`)
  console.log(`RIDE       ${result.ride}  (delta max de luminance, pourtour)`)
  console.log(`MASSE      ${result.mass}  (|d| moyen 0-4 % sous flottaison, signé ${result.massSigned})`)
  console.log(`REFLET     ${result.reflect}  (|d| moyen 4-12 % sous flottaison, signé ${result.reflectSigned})`)
}
