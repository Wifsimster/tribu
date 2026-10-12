import { BufferAttribute, BufferGeometry } from 'three'

/** Un maillage venu de Blender, mis au format des pièces du village.
 *
 *  Le village fond tout son bâti en une seule géométrie, et la fusion refuse le
 *  lot entier dès qu'un attribut diverge : il faut donc exactement ce que
 *  sortent les primitives de three passées par `part()` — position, normale,
 *  uv, et une couleur en flottants RGB. Le glTF, lui, livre ses couleurs en
 *  octets RGBA normalisés et pas d'uv. Les couleurs sont déjà linéaires (c'est
 *  la norme glTF), comme celles des `Color` du village : aucune conversion.
 *
 *  `stage` : les Merveilles portent un attribut `_STAGE` (que le chargeur
 *  glTF renomme `_stage`) — le stade de chantier, 0 à 4, à partir duquel
 *  chaque pièce apparaît. Au stade s on garde les triangles dont les trois
 *  sommets ont `_stage <= s` : UN fichier pour les cinq stades, au lieu de
 *  cinq téléchargements. Sans l'attribut, ou sans stade demandé, tout reste.
 *  Les sommets que plus aucun triangle n'utilise sont retirés : la mesure de
 *  hauteur et d'emprise porte sur ce qui se voit vraiment.
 *
 *  Renvoie null si le maillage n'a pas de quoi être dessiné : l'appelant garde
 *  sa primitive. Module sans import d'asset, pour que les tests le chargent en
 *  Node. */
export function asPart(source: BufferGeometry, stage = Infinity): BufferGeometry | null {
  const pos = source.getAttribute('position')
  const nor = source.getAttribute('normal')
  if (!pos || !nor || pos.count === 0) return null
  const col = source.getAttribute('color')
  const st = source.getAttribute('_stage')
  const n = pos.count

  // Les triangles, indexés ou non : un glTF sans index en a quand même.
  const all = source.index ? Array.from(source.index.array) : Array.from({ length: n }, (_, i) => i)
  let tris = all
  if (st && Number.isFinite(stage)) {
    tris = []
    for (let t = 0; t + 2 < all.length; t += 3) {
      const a = all[t]!
      const b = all[t + 1]!
      const c = all[t + 2]!
      if (Math.max(st.getX(a), st.getX(b), st.getX(c)) <= stage) tris.push(a, b, c)
    }
  }
  if (tris.length === 0) return null

  // Ne garder que les sommets utilisés, dans leur ordre d'apparition.
  const remap = new Int32Array(n).fill(-1)
  const used: number[] = []
  const index = tris.map((v) => {
    if (remap[v]! < 0) {
      remap[v] = used.length
      used.push(v)
    }
    return remap[v]!
  })
  const m = used.length

  const p = new Float32Array(m * 3)
  const q = new Float32Array(m * 3)
  const rgb = new Float32Array(m * 3)
  for (let k = 0; k < m; k++) {
    const i = used[k]!
    p[k * 3] = pos.getX(i)
    p[k * 3 + 1] = pos.getY(i)
    p[k * 3 + 2] = pos.getZ(i)
    q[k * 3] = nor.getX(i)
    q[k * 3 + 1] = nor.getY(i)
    q[k * 3 + 2] = nor.getZ(i)
    // getX/Y/Z dénormalisent les octets : on récupère des 0–1. Sans couleur, un
    // gris clair plutôt qu'un noir qui ferait un trou dans la vitrine.
    rgb[k * 3] = col ? col.getX(i) : 0.8
    rgb[k * 3 + 1] = col ? col.getY(i) : 0.8
    rgb[k * 3 + 2] = col ? col.getZ(i) : 0.8
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(p, 3))
  geo.setAttribute('normal', new BufferAttribute(q, 3))
  // Une uv nulle : le matériau toon n'en lit aucune, mais la fusion l'exige.
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(m * 2), 2))
  geo.setAttribute('color', new BufferAttribute(rgb, 3))
  // Toujours indexé : la fusion du village veut tout indexé ou rien, et les
  // primitives de part() le sont.
  geo.setIndex(index)
  return geo
}

/** Hauteur du maillage, base comprise. Les modèles sont livrés base à y = 0. */
export function heightOf(geo: BufferGeometry): number {
  geo.computeBoundingBox()
  const b = geo.boundingBox
  return b ? b.max.y - b.min.y : 0
}

/** Demi-côté du carré, centré sur l'axe, qui contient le maillage en plan :
 *  c'est ce qui doit tenir entre les perches d'échafaudage. */
export function halfSpanOf(geo: BufferGeometry): number {
  geo.computeBoundingBox()
  const b = geo.boundingBox
  if (!b) return 0
  return Math.max(-b.min.x, b.max.x, -b.min.z, b.max.z)
}
