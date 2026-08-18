#!/usr/bin/env node
// Mesure OBJECTIVE du contact avec l'eau sur une capture PNG.
//
//   NODE_PATH=/tmp/node_modules node tools/waterline-metrics.mjs <image.png> [--json]
//
// Sept rounds ont perdu parce que l'amplitude du contact était réglée à l'œil.
// Ce script remplace l'œil par trois chiffres, mesurés de la même façon sur la
// référence (Townscaper) et sur notre capture :
//
//   RIDE    delta MAX de luminance entre la couronne de ride et l'eau libre
//           voisine, le long du pourtour (rows flottaison ± 2 % de hauteur).
//   MASSE   delta MOYEN |L - L_eau| dans la bande 0-4 % de hauteur d'image sous
//           la flottaison, sous l'objet (colonnes centrales de l'empreinte).
//   REFLET  delta MOYEN |L - L_eau| dans la bande 4-12 % sous la flottaison.
//
// L_eau est la luminance médiane de l'eau libre DE LA MÊME LIGNE (bandes 5-10 %
// et 90-95 % de largeur), donc la brume verticale ne fausse rien. La flottaison
// est détectée comme la ligne la plus large de l'objet : sur une île posée sur
// l'eau, les points extrêmes gauche/droite de la silhouette sont au niveau de
// l'eau. Luminance en 0-255 (Rec. 709 sur les octets sRGB du PNG).

import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'

const [, , imgPath, ...rest] = process.argv
if (!imgPath) {
  console.error('usage: waterline-metrics.mjs <image.png> [--json]')
  process.exit(1)
}
const asJson = rest.includes('--json')
// --overlay <out.png> : la capture avec le contour détecté (rouge) et les
// limites des bandes 0-4 % (vert) et 4-12 % (bleu) — pour vérifier À L'ŒIL que
// les chiffres mesurent bien la flottaison et pas de l'herbe.
const oi = rest.indexOf('--overlay')
const overlayPath = oi >= 0 ? rest[oi + 1] : null

const browser = await chromium.launch()
const page = await browser.newPage()
// L'image passe en data:URL : un file:// taint le canvas et bloque getImageData.
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

  // --- Eau libre : l'eau des deux jeux porte un vignettage RADIAL — un fond
  // par ligne seule fait passer tout le centre de l'image pour de l'objet.
  // Par ligne et par canal, une parabole est ajustée (moindres carrés) sur
  // quatre bandes d'eau franche des deux côtés de l'île ; c'est elle qui donne
  // « l'eau libre à même hauteur » sous l'objet.
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
  // Coefficients [a, b, c] de a + b·u + c·u² (u = x/W), par ligne et canal.
  const coef = new Float32Array(H * 9)
  const us = BANDS.map(([a, b]) => (a + b) / 2 / W)
  // Normales du système 4 points → 3 inconnues, identiques pour toutes les
  // lignes : inversée une fois.
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

  // --- Masque objet : écart couleur franc à l'eau libre au même endroit.
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
  // Étendue [xl, xr] du masque sur une ligne (runs d'au moins 3 px, colonnes
  // centrales 12-88 % pour ignorer l'UI des deux jeux).
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

  // --- Flottaison : sur une île posée sur l'eau, la silhouette (couronne de
  // ride comprise) est LA PLUS LARGE au niveau de l'eau — au-dessus, l'objet
  // rentre ; en dessous, reflet et masse immergée rétrécissent. L'ancre est la
  // médiane du plateau des lignes à ≥ 99 % de la largeur max.
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

  // --- Ligne de flottaison PAR COLONNE, le long du contour bas de l'île.
  // L'ancre ne vaut qu'aux pointes gauche/droite : au centre, la caméra
  // plongeante garde l'objet émergé bien en dessous de cette ligne, et une
  // bande « 0-4 % sous l'ancre » y mesurerait de l'herbe. Le repère fiable est
  // la couronne de ride : dans les deux jeux, le contact eau/objet est le pic
  // de luminance POSITIVE le plus franc du bas de la silhouette. On le cherche
  // par colonne puis on médian-filtre le contour (les colonnes où la ride est
  // hachée héritent de leurs voisines).
  const cx0 = Math.floor(eW[0] + span * 0.05)
  const cx1 = Math.floor(eW[1] - span * 0.05)
  const sY0 = Math.max(0, Math.floor(yWater - H * 0.01))
  const sY1 = Math.min(H - 1, Math.floor(yWater + H * 0.18))
  const cols = []
  for (let x = cx0; x <= cx1; x += 2) {
    let peak = 0
    for (let y = sY0; y <= sY1; y++) peak = Math.max(peak, lum(x, y) - bgLum(x, y))
    // Le contour est le pixel clair LE PLUS PROFOND encore franc (≥ 70 % du pic
    // de la colonne) : au-dessus il y a l'objet (sable, maçonnerie — clairs eux
    // aussi), en dessous il n'y a plus que reflet et masse noyée, toujours plus
    // sourds que la couronne. Le pic global, lui, dérivait dans l'objet.
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

  // --- RIDE : delta max entre la couronne et l'eau libre voisine, le long du
  // pourtour — mesuré sur les POINTES (25 % du span de chaque côté), la seule
  // zone où la couronne borde de l'eau libre sans que l'objet (fenêtres,
  // maçonnerie claire) puisse contaminer le pic. Pics posés sur le contour
  // lissé (± 1 % H) uniquement.
  let ride = 0
  const tipN = Math.floor(cols.length * 0.25)
  cols.forEach((c, i) => {
    if (i > tipN && i < cols.length - tipN) return
    if (c.valid && Math.abs(c.y - contour[i]) <= H * 0.01) ride = Math.max(ride, c.peak)
  })

  // --- Bandes sous la flottaison, par colonne, en % de hauteur d'image.
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
