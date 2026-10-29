export const DEFAULT_HEADER =
  '# Origine des sons\n\n' +
  'Une ligne par fichier de ce dossier. Les licences CC BY et CC BY-SA\n' +
  '**exigent** cette attribution ; elle vaut aussi pour les fichiers dérivés\n' +
  'publiés avec le jeu.\n'

const LINE = /^- \*\*([^*]+)\*\*/

export function creditId(line) {
  return LINE.exec(line)?.[1] ?? null
}

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
    const last = out.findLastIndex((l) => creditId(l) !== null)
    if (last >= 0) out.splice(last + 1, 0, ...pending.values())
    else out.push(...(out.at(-1) === '' ? [] : ['']), ...pending.values())
  }
  return `${out.join('\n')}\n`
}
