import { BufferAttribute, BufferGeometry } from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** Un maillage venu de Blender, mis au format des pièces du village.
 *
 *  Le village fond tout son bâti en une seule géométrie, et la fusion refuse le
 *  lot entier dès qu'un attribut diverge : il faut donc exactement ce que
 *  sortent les primitives de three passées par `part()` — position, normale,
 *  uv, et une couleur en flottants RGB. Le glTF, lui, livre ses couleurs en
 *  octets RGBA normalisés et pas d'uv. Les couleurs sont déjà linéaires (c'est
 *  la norme glTF), comme celles des `Color` du village : aucune conversion.
 *
 *  Renvoie null si le maillage n'a pas de quoi être dessiné : l'appelant garde
 *  sa primitive. Module sans import d'asset, pour que les tests le chargent en
 *  Node. */
export function asPart(source: BufferGeometry): BufferGeometry | null {
  const pos = source.getAttribute('position')
  const nor = source.getAttribute('normal')
  if (!pos || !nor || pos.count === 0) return null
  const col = source.getAttribute('color')
  const n = pos.count

  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(Float32Array.from({ length: n * 3 }, (_, k) => pos.getComponent(Math.floor(k / 3), k % 3)), 3))
  geo.setAttribute('normal', new BufferAttribute(Float32Array.from({ length: n * 3 }, (_, k) => nor.getComponent(Math.floor(k / 3), k % 3)), 3))
  // Une uv nulle : le matériau toon n'en lit aucune, mais la fusion l'exige.
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(n * 2), 2))
  const rgb = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    // getX/Y/Z dénormalisent les octets : on récupère des 0–1. Sans couleur, un
    // gris clair plutôt qu'un noir qui ferait un trou dans la vitrine.
    rgb[i * 3] = col ? col.getX(i) : 0.8
    rgb[i * 3 + 1] = col ? col.getY(i) : 0.8
    rgb[i * 3 + 2] = col ? col.getZ(i) : 0.8
  }
  geo.setAttribute('color', new BufferAttribute(rgb, 3))
  if (source.index) geo.setIndex(Array.from(source.index.array))
  // Même règle que part() : la fusion veut tout indexé ou rien.
  return geo.index ? geo : mergeVertices(geo)
}

/** Hauteur du maillage, base comprise. Les modèles sont livrés base à y = 0. */
export function heightOf(geo: BufferGeometry): number {
  geo.computeBoundingBox()
  const b = geo.boundingBox
  return b ? b.max.y - b.min.y : 0
}
