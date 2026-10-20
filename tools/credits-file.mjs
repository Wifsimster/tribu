/**
 * credits-file.mjs — fusion des lignes de public/audio/CREDITS.md.
 *
 * Chaque outil de récupération ne traite qu'une partie des sons (`--only`,
 * fichiers déjà présents sautés). Réécrire CREDITS.md avec la seule passe en
 * cours efface l'attribution des autres fichiers, ce que CC BY et CC BY-SA
 * interdisent. Les outils passent donc par `mergeCredits()` : il remplace la
 * ligne de chaque son traité et garde tout le reste tel quel.
 *
 * Format d'une ligne : `- **<id>** — <provenance>`, `<id>` étant le nom du
 * fichier sans `.mp3`.
 */

export const DEFAULT_HEADER =
  '# Origine des sons\n\n' +
  'Une ligne par fichier de ce dossier. Les licences CC BY et CC BY-SA\n' +
  '**exigent** cette attribution ; elle vaut aussi pour les fichiers dérivés\n' +
  'publiés avec le jeu.\n'

const LINE = /^- \*\*([^*]+)\*\*/

/** Identifiant crédité par une ligne, ou null si la ligne n'est pas un crédit. */
export function creditId(line) {
  return LINE.exec(line)?.[1] ?? null
}

/**
 * @param {string | null} existing  contenu actuel de CREDITS.md (null s'il n'existe pas)
 * @param {Record<string, string>} entries  id → ligne complète (`- **id** — …`)
 * @returns {string} le nouveau contenu
 */
export function mergeCredits(existing, entries) {
  for (const [id, line] of Object.entries(entries)) {
    if (creditId(line) !== id) throw new Error(`ligne de crédit mal formée pour « ${id} » : ${line}`)
  }
  const lines = (existing ?? DEFAULT_HEADER).replace(/\n+$/, '').split('\n')
  const pending = new Map(Object.entries(entries))
  const out = lines.map((l) => {
    const id = creditId(l)
    if (id === null || !pending.has(id)) return l
    const next = pending.get(id)
    pending.delete(id)
    return next
  })
  if (pending.size > 0) {
    // Les nouveaux sons vont après le dernier crédit, sinon en fin de fichier
    // après une ligne vide.
    const last = out.findLastIndex((l) => creditId(l) !== null)
    if (last >= 0) out.splice(last + 1, 0, ...pending.values())
    else out.push(...(out.at(-1) === '' ? [] : ['']), ...pending.values())
  }
  return `${out.join('\n')}\n`
}
