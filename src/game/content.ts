// Game content: resources, ages, technologies. Each technology carries a real
// historical fact — the dates are the currently accepted archaeological ranges,
// deliberately hedged ("vers", "il y a environ") where the record is a range.

export type ResourceId =
  | 'food'
  | 'wood'
  | 'stone'
  | 'fiber'
  | 'clay'
  | 'copper'
  | 'iron'
  | 'insight'

export interface ResourceDef {
  id: ResourceId
  name: string
  icon: string
  /** Hidden from the HUD until the player first owns some. */
  hidden: boolean
}

export const RESOURCES: Record<ResourceId, ResourceDef> = {
  food: { id: 'food', name: 'Nourriture', icon: '🍖', hidden: false },
  wood: { id: 'wood', name: 'Bois', icon: '🪵', hidden: false },
  stone: { id: 'stone', name: 'Pierre', icon: '🪨', hidden: false },
  fiber: { id: 'fiber', name: 'Fibres', icon: '🌾', hidden: true },
  clay: { id: 'clay', name: 'Argile', icon: '🏺', hidden: true },
  copper: { id: 'copper', name: 'Cuivre', icon: '🟠', hidden: true },
  iron: { id: 'iron', name: 'Fer', icon: '⚙️', hidden: true },
  insight: { id: 'insight', name: 'Savoir', icon: '✨', hidden: false },
}

export interface AgeDef {
  id: number
  name: string
  period: string
  /** Technologies of this age that must be known before the next age opens. */
  techsToAdvance: number
  /** Sky and ground shift subtly per age so progression is felt, not just read. */
  sky: number
  fog: number
  ground: number
}

export const AGES: AgeDef[] = [
  {
    id: 0,
    name: 'Paléolithique',
    period: '−300 000 à −10 000',
    techsToAdvance: 4,
    sky: 0x9fd4e8,
    fog: 0xbfe0ee,
    ground: 0x7fa65a,
  },
  {
    id: 1,
    name: 'Néolithique',
    period: '−10 000 à −3 300',
    techsToAdvance: 4,
    sky: 0xa8dcea,
    fog: 0xc9e6ef,
    ground: 0x8cb45f,
  },
  {
    id: 2,
    name: 'Âge du bronze',
    period: '−3 300 à −1 200',
    techsToAdvance: 4,
    sky: 0xb6dfe4,
    fog: 0xd4e8e6,
    ground: 0x94b862,
  },
  {
    id: 3,
    name: 'Âge du fer',
    period: '−1 200 à −50',
    techsToAdvance: 5,
    sky: 0xc2e0dd,
    fog: 0xdcebe4,
    ground: 0x9bbb66,
  },
]

/** Une journée complète en secondes de jeu, et l'heure de la première aube.
 *  Vivent ici parce que la nuit est une règle du jeu, pas un habillage. */
export const DAY_SECONDS = 240
export const DAY_START = 0.32

export type Effect =
  | { kind: 'gatherRate'; resource: ResourceId; mult: number }
  | { kind: 'unlockResource'; resource: ResourceId }
  | { kind: 'insightRate'; add: number }
  | { kind: 'carry'; add: number }
  | { kind: 'expeditionSpeed'; mult: number }
  | { kind: 'building'; building: string }
  /** Part du rendement conservée en pleine nuit (la meilleure source l'emporte). */
  | { kind: 'nightFloor'; value: number }

export interface TechDef {
  id: string
  name: string
  age: number
  cost: number
  requires: string[]
  /** The payload the whole game exists to deliver. */
  fact: string
  effects: Effect[]
}

export const TECHS: TechDef[] = [
  // ── Paléolithique ────────────────────────────────────────────────────────
  {
    id: 'flint',
    name: 'Taille du silex',
    age: 0,
    cost: 8,
    requires: [],
    fact: "Les plus anciens outils de pierre taillée connus, à Lomekwi au Kenya, ont environ 3,3 millions d'années — soit bien avant l'apparition d'Homo sapiens.",
    effects: [{ kind: 'gatherRate', resource: 'stone', mult: 1.6 }],
  },
  {
    id: 'fire',
    name: 'Maîtrise du feu',
    age: 0,
    cost: 18,
    requires: ['flint'],
    fact: "À Gesher Benot Ya'aqov, en Israël, des foyers vieux de 780 000 ans montrent un feu entretenu volontairement, pas un incendie naturel.",
    effects: [
      { kind: 'gatherRate', resource: 'food', mult: 1.5 },
      { kind: 'insightRate', add: 0.05 },
      { kind: 'nightFloor', value: 0.55 },
    ],
  },
  {
    id: 'lamp',
    name: 'Lampe à graisse',
    age: 0,
    cost: 55,
    requires: ['fire'],
    fact: "À Lascaux, plus d'une centaine de lampes de pierre brûlaient de la graisse animale avec des mèches de genévrier : les peintres travaillaient sous terre, en pleine nuit.",
    effects: [{ kind: 'nightFloor', value: 0.85 }],
  },
  {
    id: 'shelter',
    name: 'Abri de branchages',
    age: 0,
    cost: 30,
    requires: ['fire'],
    fact: "À Terra Amata, près de Nice, des trous de poteaux vieux de 400 000 ans dessinent des huttes ovales de 8 à 15 mètres de long.",
    effects: [{ kind: 'building', building: 'hut' }, { kind: 'carry', add: 4 }],
  },
  {
    id: 'spear',
    name: 'Épieu de chasse',
    age: 0,
    cost: 45,
    requires: ['fire'],
    fact: "Les épieux de Schöningen, en Allemagne, ont 300 000 ans. Taillés dans l'épicéa, ils sont équilibrés comme des javelots de compétition.",
    effects: [
      { kind: 'gatherRate', resource: 'food', mult: 1.7 },
      { kind: 'expeditionSpeed', mult: 1.25 },
    ],
  },
  {
    id: 'cordage',
    name: 'Cordage végétal',
    age: 0,
    cost: 70,
    requires: ['spear'],
    fact: "Un fragment de corde à trois brins retrouvé à l'Abri du Maras, en Ardèche, a 50 000 ans : il a été fabriqué par des Néandertaliens.",
    effects: [
      { kind: 'unlockResource', resource: 'fiber' },
      { kind: 'carry', add: 6 },
    ],
  },

  // ── Néolithique ──────────────────────────────────────────────────────────
  {
    id: 'agriculture',
    name: 'Agriculture',
    age: 1,
    cost: 110,
    requires: ['cordage'],
    fact: "Le blé amidonnier et l'orge sont domestiqués dans le Croissant fertile vers −9500. Il a fallu près d'un millénaire pour que l'épi cesse de s'égrener tout seul.",
    effects: [
      { kind: 'gatherRate', resource: 'food', mult: 2.2 },
      { kind: 'building', building: 'field' },
    ],
  },
  {
    id: 'pottery',
    name: 'Poterie',
    age: 1,
    cost: 150,
    requires: ['agriculture'],
    fact: "Les plus vieux pots du monde viennent de la grotte de Xianrendong, en Chine : 20 000 ans, soit 10 000 ans avant l'agriculture.",
    effects: [
      { kind: 'unlockResource', resource: 'clay' },
      { kind: 'carry', add: 10 },
    ],
  },
  {
    id: 'weaving',
    name: 'Tissage',
    age: 1,
    cost: 200,
    requires: ['pottery'],
    fact: "Des empreintes de textiles tissés sur argile, à Dolní Věstonice en Moravie, datent de 27 000 ans — le tissu précède de loin le métier à tisser retrouvé.",
    effects: [{ kind: 'insightRate', add: 0.15 }],
  },
  {
    id: 'polished_axe',
    name: 'Hache polie',
    age: 1,
    cost: 260,
    requires: ['pottery'],
    fact: "La plus ancienne hache à tranchant poli connue vient d'Australie et a 49 000 ans. En Europe, la technique n'arrive qu'au Néolithique.",
    effects: [{ kind: 'gatherRate', resource: 'wood', mult: 2.0 }],
  },
  {
    id: 'granary',
    name: 'Grenier',
    age: 1,
    cost: 340,
    requires: ['agriculture', 'weaving'],
    fact: "À Dhra', en Jordanie, des greniers surélevés vieux de 11 300 ans stockaient l'orge sauvage : on a stocké les céréales avant de savoir les cultiver.",
    effects: [
      { kind: 'building', building: 'granary' },
      { kind: 'carry', add: 20 },
    ],
  },

  // ── Âge du bronze ────────────────────────────────────────────────────────
  {
    id: 'copper',
    name: 'Métallurgie du cuivre',
    age: 2,
    cost: 450,
    requires: ['granary'],
    fact: "Ötzi, l'homme des glaces mort vers −3300, portait une hache en cuivre pur à 99,7 %. Son minerai vient de Toscane, à 500 km de là.",
    effects: [
      { kind: 'unlockResource', resource: 'copper' },
      { kind: 'gatherRate', resource: 'stone', mult: 1.5 },
    ],
  },
  {
    id: 'bronze',
    name: 'Alliage de bronze',
    age: 2,
    cost: 600,
    requires: ['copper'],
    fact: "Le bronze demande du cuivre et de l'étain, qu'on ne trouve presque jamais au même endroit. L'âge du bronze est donc d'abord un âge du commerce longue distance.",
    effects: [
      { kind: 'gatherRate', resource: 'wood', mult: 1.6 },
      { kind: 'gatherRate', resource: 'food', mult: 1.4 },
    ],
  },
  {
    id: 'wheel',
    name: 'Roue',
    age: 2,
    cost: 780,
    requires: ['bronze'],
    fact: "La roue apparaît vers −3500, d'abord comme tour de potier. Les Mésoaméricains la connaissaient : ils l'ont mise sur des jouets, faute d'animaux de trait.",
    effects: [
      { kind: 'carry', add: 40 },
      { kind: 'expeditionSpeed', mult: 1.5 },
    ],
  },
  {
    id: 'writing',
    name: 'Écriture',
    age: 2,
    cost: 950,
    requires: ['bronze'],
    fact: "Le cunéiforme naît vers −3400 à Uruk pour compter des sacs d'orge et des têtes de bétail. La comptabilité précède la littérature de plusieurs siècles.",
    effects: [{ kind: 'insightRate', add: 0.6 }],
  },
  {
    id: 'sail',
    name: 'Voile',
    age: 2,
    cost: 1200,
    requires: ['wheel', 'weaving'],
    fact: "Les premières voiles attestées sont peintes sur des vases égyptiens vers −3100 : un carré de lin tendu, qui ne sait remonter au vent qu'à peine.",
    effects: [{ kind: 'expeditionSpeed', mult: 1.6 }],
  },

  // ── Âge du fer ───────────────────────────────────────────────────────────
  {
    id: 'ironworking',
    name: 'Forge du fer',
    age: 3,
    cost: 1600,
    requires: ['sail', 'writing'],
    fact: "Les plus anciens objets en fer sont des perles égyptiennes de −3200, martelées dans une météorite. Le mot hiéroglyphique signifie « fer du ciel ».",
    effects: [
      { kind: 'unlockResource', resource: 'iron' },
      { kind: 'gatherRate', resource: 'stone', mult: 1.8 },
    ],
  },
  {
    id: 'plough',
    name: 'Charrue',
    age: 3,
    cost: 2100,
    requires: ['ironworking'],
    fact: "Le soc en fer permet de retourner les sols lourds du nord de l'Europe, restés incultes tant qu'on n'avait que l'araire en bois.",
    effects: [{ kind: 'gatherRate', resource: 'food', mult: 2.4 }],
  },
  {
    id: 'alphabet',
    name: 'Alphabet',
    age: 3,
    cost: 2700,
    requires: ['ironworking'],
    fact: "L'alphabet proto-sinaïtique, vers −1800, réduit l'écriture à une trentaine de signes. Pour la première fois, écrire n'est plus un métier.",
    effects: [{ kind: 'insightRate', add: 1.5 }],
  },
  {
    id: 'coinage',
    name: 'Monnaie frappée',
    age: 3,
    cost: 3400,
    requires: ['alphabet'],
    fact: "Les premières pièces sont frappées en Lydie vers −630, en électrum, un alliage naturel d'or et d'argent trouvé dans la rivière Pactole.",
    effects: [{ kind: 'expeditionSpeed', mult: 1.8 }],
  },
  {
    id: 'aqueduct',
    name: 'Aqueduc',
    age: 3,
    cost: 4200,
    requires: ['coinage', 'plough'],
    fact: "L'Aqua Appia, à Rome en −312, descend de 10 mètres sur 16 kilomètres. Une pente de 0,06 % tenue à la main, sans niveau à bulle.",
    effects: [
      { kind: 'building', building: 'aqueduct' },
      { kind: 'insightRate', add: 2.5 },
    ],
  },
]

export const TECH_BY_ID = new Map(TECHS.map((t) => [t.id, t]))
