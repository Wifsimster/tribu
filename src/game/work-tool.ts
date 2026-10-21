// ── Le bon outil pour la nourriture ────────────────────────────────────────
// Spec docs/specs/actions-peche-chasse-cueillette.md, §2. Un outil n'apparaît
// qu'avec un savoir qui existe (content.ts) : pas de savoir créé pour l'arc,
// le filet, la faux ou le moulinet, ce sont des lectures de savoirs existants.
// Pour chaque action, la première ligne vraie gagne, de la plus avancée à la
// plus simple.

export type WorkAction = 'fish' | 'hunt' | 'gather'
export type WorkTool = 'hand' | 'foene' | 'line' | 'net' | 'reel' | 'spear' | 'bow' | 'sickle' | 'scythe'

const TABLE: Record<WorkAction, readonly (readonly [string | null, WorkTool])[]> = {
  fish: [
    ['bessemer', 'reel'],
    ['weaving', 'net'],
    ['cordage', 'line'],
    ['spear', 'foene'],
    [null, 'hand'],
  ],
  hunt: [
    ['cordage', 'bow'],
    ['spear', 'spear'],
    [null, 'hand'],
  ],
  gather: [
    ['threefield', 'scythe'],
    ['agriculture', 'sickle'],
    [null, 'hand'],
  ],
}

/** Les savoirs que la table interroge (le test les retrouve tous dans TECHS). */
export const TOOL_TECHS: readonly string[] = [...new Set(Object.values(TABLE).flatMap((rows) => rows.flatMap(([t]) => (t ? [t] : []))))]

export function toolFor(action: WorkAction, knows: (id: string) => boolean): WorkTool {
  for (const [tech, tool] of TABLE[action]) if (tech === null || knows(tech)) return tool
  return 'hand'
}

/** Ce que fait le colon quand le focus est la nourriture. La pêche est un état
 *  de surface (tap sur l'eau). Sinon : un tap sur un buisson, ou l'agriculture,
 *  c'est la cueillette ; avant l'agriculture, un colon qui a l'épieu chasse
 *  (pour l'instant au buisson, comme avant : la lisière viendra en 3.71). */
export function actionFor(fishing: boolean, tappedBush: boolean, knows: (id: string) => boolean): WorkAction {
  if (fishing) return 'fish'
  if (tappedBush || knows('agriculture') || !knows('spear')) return 'gather'
  return 'hunt'
}

/** L'outil tel que le colon sait le dessiner aujourd'hui : les outils de la
 *  pêche et de la chasse arrivent avec leurs clips (3.70, 3.71) ; d'ici là,
 *  la ligne, le filet et le moulinet se montrent en canne, la foëne et l'arc en
 *  épieu. */
export function visualTool(tool: WorkTool): 'hand' | 'spear' | 'sickle' | 'scythe' | 'rod' {
  switch (tool) {
    case 'line':
    case 'net':
    case 'reel':
      return 'rod'
    case 'foene':
    case 'bow':
      return 'spear'
    default:
      return tool
  }
}

/** Le geste Blender d'une action, ou null quand il n'existe pas encore (le
 *  colon garde alors son geste procédural). */
export function clipFor(action: WorkAction, tool: WorkTool): 'gather_hand' | 'gather_sickle' | 'gather_scythe' | null {
  if (action !== 'gather') return null
  return tool === 'scythe' ? 'gather_scythe' : tool === 'sickle' ? 'gather_sickle' : 'gather_hand'
}
