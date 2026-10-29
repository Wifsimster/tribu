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

export const TOOL_TECHS: readonly string[] = [...new Set(Object.values(TABLE).flatMap((rows) => rows.flatMap(([t]) => (t ? [t] : []))))]

export function toolFor(action: WorkAction, knows: (id: string) => boolean): WorkTool {
  for (const [tech, tool] of TABLE[action]) if (tech === null || knows(tech)) return tool
  return 'hand'
}

export function actionFor(fishing: boolean, tappedBush: boolean, knows: (id: string) => boolean): WorkAction {
  if (fishing) return 'fish'
  if (tappedBush || knows('agriculture') || !knows('spear')) return 'gather'
  return 'hunt'
}

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

export function clipFor(action: WorkAction, tool: WorkTool): 'gather_hand' | 'gather_sickle' | 'gather_scythe' | null {
  if (action !== 'gather') return null
  return tool === 'scythe' ? 'gather_scythe' : tool === 'sickle' ? 'gather_sickle' : 'gather_hand'
}
