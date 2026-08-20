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
  {
    id: 4,
    name: 'Antiquité',
    period: '−50 à 476',
    techsToAdvance: 5,
    sky: 0xcde0d8,
    fog: 0xe2ece0,
    ground: 0xa1bd6b,
  },
  {
    id: 5,
    name: 'Moyen Âge',
    period: '476 à 1450',
    techsToAdvance: 5,
    sky: 0xd6e2d2,
    fog: 0xe9eddc,
    ground: 0xa8bf70,
  },
  {
    id: 6,
    name: 'Renaissance',
    period: '1450 à 1700',
    techsToAdvance: 5,
    sky: 0xd9e4de,
    fog: 0xecf0e2,
    ground: 0xaec272,
  },
  {
    id: 7,
    name: 'Ère industrielle',
    period: '1700 à 1900',
    techsToAdvance: 5,
    sky: 0xd2dcdc,
    fog: 0xe4e8e0,
    ground: 0xa3b76d,
  },
  {
    id: 8,
    name: 'Ère moderne',
    period: '1900 à 1970',
    techsToAdvance: 5,
    sky: 0xcfdde6,
    fog: 0xe2eaea,
    ground: 0xa9bd74,
  },
  {
    id: 9,
    name: 'Ère contemporaine',
    period: '1970 à nos jours',
    techsToAdvance: 5,
    sky: 0xcbdcea,
    fog: 0xdfe9ee,
    ground: 0xafc178,
  },
]

/** Une journée complète en secondes de jeu, et l'heure de la première aube.
 *  Vivent ici parce que la nuit est une règle du jeu, pas un habillage. */
export const DAY_SECONDS = 240
export const DAY_START = 0.32

/** Une saison dure trois jours de jeu : l'année entière tient en 48 minutes.
 *  Les saisons sont une règle (la récolte suit) autant qu'un décor. */
export const SEASON_DAYS = 3

export interface SeasonDef {
  id: number
  name: string
  /** Multiplicateur de récolte de nourriture — l'hiver mord, le grenier aide. */
  food: number
  fact: string
}

export const SEASONS: SeasonDef[] = [
  {
    id: 0,
    name: 'Le printemps',
    food: 1.05,
    fact: "Le calendrier julien (−45) recale l'année sur le soleil : 365 jours un quart. Pour rattraper le retard accumulé, César dut allonger l'an −46 à 445 jours — « l'année de la confusion ».",
  },
  {
    id: 1,
    name: "L'été",
    food: 1.12,
    fact: "À Stonehenge, vers −2500, l'axe du monument vise le lever du soleil au solstice d'été : l'architecture servait déjà de calendrier.",
  },
  {
    id: 2,
    name: "L'automne",
    food: 1.0,
    fact: 'Le calendrier républicain de 1792 renomma l’automne en vendémiaire, brumaire et frimaire — les mois des vendanges, des brumes et des premiers froids.',
  },
  {
    id: 3,
    name: "L'hiver",
    food: 0.8,
    fact: "L'hiver 1709, le « Grand Hyver », gela la Seine et les oliviers de Provence en quelques nuits. On sonnait les cloches et allumait des feux dans les vignes pour briser le gel.",
  },
]

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
  /** Ressources d'époque consommées en plus du savoir : c'est le puits qui
   *  donne un sens à la récolte et au troc. */
  materials?: Partial<Record<ResourceId, number>>
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
    materials: { stone: 12 },
    requires: [],
    fact: "Les plus anciens outils de pierre taillée connus, à Lomekwi au Kenya, ont environ 3,3 millions d'années — soit bien avant l'apparition d'Homo sapiens.",
    effects: [
      { kind: 'building', building: 'knapping' },{ kind: 'gatherRate', resource: 'stone', mult: 1.6 }],
  },
  {
    id: 'fire',
    name: 'Maîtrise du feu',
    age: 0,
    cost: 18,
    materials: { wood: 15 },
    requires: ['flint'],
    fact: "À Gesher Benot Ya'aqov, en Israël, des foyers vieux de 780 000 ans montrent un feu entretenu volontairement, pas un incendie naturel.",
    effects: [
      { kind: 'building', building: 'woodpile' },
      { kind: 'gatherRate', resource: 'food', mult: 1.5 },
      { kind: 'insightRate', add: 0.05 },
      { kind: 'nightFloor', value: 0.55 },
    ],
  },
  {
    id: 'shelter',
    name: 'Abri de branchages',
    age: 0,
    cost: 30,
    materials: { wood: 30, stone: 10 },
    requires: ['fire'],
    fact: "À Terra Amata, près de Nice, des trous de poteaux vieux de 400 000 ans dessinent des huttes ovales de 8 à 15 mètres de long.",
    effects: [{ kind: 'building', building: 'hut' }, { kind: 'carry', add: 4 }],
  },
  {
    id: 'spear',
    name: 'Épieu de chasse',
    age: 0,
    cost: 45,
    materials: { wood: 20, stone: 15 },
    requires: ['fire'],
    fact: "Les épieux de Schöningen, en Allemagne, ont 300 000 ans. Taillés dans l'épicéa, ils sont équilibrés comme des javelots de compétition.",
    effects: [
      { kind: 'building', building: 'spearrack' },
      { kind: 'gatherRate', resource: 'food', mult: 1.7 },
      { kind: 'expeditionSpeed', mult: 1.25 },
    ],
  },
  {
    id: 'lamp',
    name: 'Lampe à graisse',
    age: 0,
    cost: 55,
    materials: { stone: 12, food: 25 },
    requires: ['fire'],
    fact: "À Lascaux, plus d'une centaine de lampes de pierre brûlaient de la graisse animale avec des mèches de genévrier : les peintres travaillaient sous terre, en pleine nuit.",
    effects: [
      { kind: 'building', building: 'lamps' },{ kind: 'nightFloor', value: 0.85 }],
  },
  {
    id: 'cordage',
    name: 'Cordage végétal',
    age: 0,
    cost: 70,
    materials: { wood: 30 },
    requires: ['spear'],
    fact: "Un fragment de corde à trois brins retrouvé à l'Abri du Maras, en Ardèche, a environ 45 000 à 50 000 ans : il a été fabriqué par des Néandertaliens.",
    effects: [
      { kind: 'building', building: 'ropes' },
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
    materials: { wood: 40, fiber: 25 },
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
    materials: { wood: 50 },
    requires: ['agriculture'],
    fact: "Les plus vieux pots du monde viennent de la grotte de Xianrendong, en Chine : 20 000 ans, soit près de 8 500 ans avant l'agriculture.",
    effects: [
      { kind: 'building', building: 'jars' },
      { kind: 'unlockResource', resource: 'clay' },
      { kind: 'carry', add: 10 },
    ],
  },
  {
    id: 'weaving',
    name: 'Tissage',
    age: 1,
    cost: 200,
    materials: { fiber: 60 },
    requires: ['pottery'],
    fact: "Des empreintes de textiles tissés sur argile, à Dolní Věstonice en Moravie, datent de 27 000 ans — le tissu précède de loin le métier à tisser retrouvé.",
    effects: [
      { kind: 'building', building: 'loom' },{ kind: 'insightRate', add: 0.15 }],
  },
  {
    id: 'polished_axe',
    name: 'Hache polie',
    age: 1,
    cost: 260,
    materials: { stone: 50, wood: 30 },
    requires: ['pottery'],
    fact: "La plus ancienne hache à tranchant poli connue vient d'Australie et a entre 44 000 et 49 000 ans. En Europe, la technique n'arrive qu'au Néolithique.",
    effects: [
      { kind: 'building', building: 'chopping' },{ kind: 'gatherRate', resource: 'wood', mult: 2.0 }],
  },
  {
    id: 'granary',
    name: 'Grenier',
    age: 1,
    cost: 340,
    materials: { wood: 80, fiber: 40 },
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
    materials: { stone: 60, wood: 40 },
    requires: ['granary'],
    fact: "Ötzi, l'homme des glaces mort vers −3300, portait une hache en cuivre pur à 99,7 %. Son minerai vient de Toscane, à 500 km de là.",
    effects: [
      { kind: 'building', building: 'orepile' },
      { kind: 'unlockResource', resource: 'copper' },
      { kind: 'gatherRate', resource: 'stone', mult: 1.5 },
    ],
  },
  {
    id: 'bronze',
    name: 'Alliage de bronze',
    age: 2,
    cost: 600,
    materials: { copper: 60 },
    requires: ['copper'],
    fact: "Le bronze demande du cuivre et de l'étain, qu'on ne trouve presque jamais au même endroit. L'âge du bronze est donc d'abord un âge du commerce longue distance.",
    effects: [
      { kind: 'building', building: 'furnace' },
      { kind: 'gatherRate', resource: 'wood', mult: 1.6 },
      { kind: 'gatherRate', resource: 'food', mult: 1.4 },
      { kind: 'gatherRate', resource: 'copper', mult: 1.6 },
    ],
  },
  {
    id: 'wheel',
    name: 'Roue',
    age: 2,
    cost: 780,
    materials: { wood: 100, copper: 30 },
    requires: ['bronze'],
    fact: "La roue apparaît d'abord comme tour de potier vers −4000 ; vers −3500 elle porte les premiers chariots. Les Mésoaméricains l'ont mise sur des jouets, faute d'animaux de trait.",
    effects: [
      { kind: 'building', building: 'cart' },
      { kind: 'carry', add: 40 },
      { kind: 'expeditionSpeed', mult: 1.5 },
    ],
  },
  {
    id: 'writing',
    name: 'Écriture',
    age: 2,
    cost: 950,
    materials: { clay: 60 },
    requires: ['bronze'],
    fact: "Le cunéiforme naît vers −3400 à Uruk pour compter des sacs d'orge et des têtes de bétail. La comptabilité précède la littérature de plusieurs siècles.",
    effects: [
      { kind: 'building', building: 'tablets' },{ kind: 'insightRate', add: 0.6 }],
  },
  {
    id: 'sail',
    name: 'Voile',
    age: 2,
    cost: 1200,
    materials: { fiber: 120, wood: 60 },
    requires: ['wheel', 'weaving'],
    fact: "Les premières voiles attestées sont peintes sur des vases égyptiens vers −3100 : un carré de lin tendu, qui ne sait remonter au vent qu'à peine.",
    effects: [
      { kind: 'building', building: 'sailframe' },{ kind: 'expeditionSpeed', mult: 1.6 }],
  },

  // ── Âge du fer ───────────────────────────────────────────────────────────
  {
    id: 'ironworking',
    name: 'Forge du fer',
    age: 3,
    cost: 1600,
    materials: { stone: 90, copper: 60 },
    requires: ['sail', 'writing'],
    fact: "Les plus anciens objets en fer sont des perles égyptiennes de −3200, martelées dans une météorite. Le mot hiéroglyphique signifie « fer du ciel ».",
    effects: [
      { kind: 'building', building: 'forge' },
      { kind: 'unlockResource', resource: 'iron' },
      { kind: 'gatherRate', resource: 'stone', mult: 1.8 },
    ],
  },
  {
    id: 'plough',
    name: 'Charrue',
    age: 3,
    cost: 2100,
    materials: { iron: 50, wood: 60 },
    requires: ['ironworking'],
    fact: "Le soc en fer permet de retourner les sols lourds du nord de l'Europe, restés incultes tant qu'on n'avait que l'araire en bois.",
    effects: [
      { kind: 'building', building: 'plough' },{ kind: 'gatherRate', resource: 'food', mult: 2.4 }],
  },
  {
    id: 'alphabet',
    name: 'Alphabet',
    age: 3,
    cost: 2700,
    materials: { clay: 40 },
    requires: ['ironworking'],
    fact: "L'alphabet proto-sinaïtique, vers −1800, réduit l'écriture à une trentaine de signes. Pour la première fois, écrire n'est plus un métier.",
    effects: [
      { kind: 'building', building: 'stele' },{ kind: 'insightRate', add: 1.5 }],
  },
  {
    id: 'coinage',
    name: 'Monnaie frappée',
    age: 3,
    cost: 3400,
    materials: { copper: 40, iron: 30 },
    requires: ['alphabet'],
    fact: "Les premières pièces sont frappées en Lydie vers −630, en électrum, un alliage naturel d'or et d'argent trouvé dans la rivière Pactole.",
    effects: [
      { kind: 'building', building: 'market' },
      { kind: 'expeditionSpeed', mult: 1.8 },
      { kind: 'gatherRate', resource: 'iron', mult: 1.5 },
    ],
  },
  {
    id: 'aqueduct',
    name: 'Aqueduc',
    age: 3,
    cost: 4200,
    materials: { stone: 150, iron: 60 },
    requires: ['coinage', 'plough'],
    fact: "L'Aqua Appia, à Rome en −312, descend de 10 mètres sur 16 kilomètres. Une pente de 0,06 % tenue à la main, sans niveau à bulle.",
    effects: [
      { kind: 'building', building: 'aqueduct' },
      { kind: 'insightRate', add: 2.5 },
    ],
  },

  // ── Antiquité ────────────────────────────────────────────────────────────
  {
    id: 'concrete',
    name: 'Béton romain',
    age: 4,
    cost: 4800,
    materials: { stone: 200, clay: 80 },
    requires: ['aqueduct'],
    fact: "Chaux, eau de mer et cendre volcanique de Pouzzoles : le béton romain durcit encore aujourd'hui — les jetées antiques se sont renforcées avec les siècles au lieu de s'éroder.",
    effects: [
      { kind: 'building', building: 'villa' },
      { kind: 'gatherRate', resource: 'stone', mult: 1.7 },
      { kind: 'carry', add: 40 },
    ],
  },
  {
    id: 'watermill',
    name: 'Moulin à eau',
    age: 4,
    cost: 6000,
    materials: { wood: 180, iron: 50 },
    requires: ['concrete'],
    fact: "Décrit par Vitruve vers −25, le moulin à eau culmine au IIe siècle à Barbegal, près d'Arles : seize roues alignées, de quoi moudre pour dix mille personnes.",
    effects: [
      { kind: 'building', building: 'watermill' },
      { kind: 'gatherRate', resource: 'food', mult: 2.0 },
    ],
  },
  {
    id: 'glass',
    name: 'Verre soufflé',
    age: 4,
    cost: 7500,
    materials: { clay: 120, copper: 60 },
    requires: ['concrete'],
    fact: "Le soufflage du verre naît en Syrie au Ier siècle avant notre ère : une bulle d'air au bout d'une canne, et le verre cesse d'être un luxe de rois.",
    effects: [
      { kind: 'building', building: 'glassworks' },
      { kind: 'insightRate', add: 4 },
    ],
  },
  {
    id: 'roads',
    name: 'Voies romaines',
    age: 4,
    cost: 9000,
    materials: { stone: 300, iron: 60 },
    requires: ['watermill'],
    fact: "Quatre-vingt mille kilomètres de voies dallées, une borne tous les mille pas — le mille — et certaines portent encore du trafic deux mille ans plus tard.",
    effects: [
      { kind: 'building', building: 'milestone' },
      { kind: 'expeditionSpeed', mult: 1.5 },
      { kind: 'carry', add: 60 },
    ],
  },
  {
    id: 'codex',
    name: 'Codex',
    age: 4,
    cost: 11000,
    materials: { fiber: 200, clay: 60 },
    requires: ['glass'],
    fact: "À partir du IIe siècle, le codex — des pages cousues — supplante peu à peu le rouleau : on peut enfin ouvrir un livre au milieu, chercher, comparer, annoter.",
    effects: [
      { kind: 'building', building: 'lectern' },
      { kind: 'insightRate', add: 3 },
    ],
  },

  // ── Moyen Âge ────────────────────────────────────────────────────────────
  {
    id: 'horsecollar',
    name: "Collier d'épaule",
    age: 5,
    cost: 13000,
    materials: { fiber: 180, iron: 80 },
    requires: ['roads'],
    fact: "Venu de Chine, le collier d'épaule augmente fortement la traction utile du cheval : il appuie sur les épaules là où l'attelage antique comprimait la gorge.",
    effects: [
      { kind: 'building', building: 'collar' },
      { kind: 'gatherRate', resource: 'food', mult: 1.6 },
      { kind: 'gatherRate', resource: 'wood', mult: 1.5 },
    ],
  },
  {
    id: 'threefield',
    name: 'Assolement triennal',
    age: 5,
    cost: 16000,
    materials: { wood: 150, food: 400 },
    requires: ['horsecollar'],
    fact: "Blé d'hiver, avoine de printemps, jachère : la rotation triennale nourrit chevaux et paysans, et les famines reculent dans l'Europe du Nord.",
    effects: [
      { kind: 'building', building: 'threefield' },
      { kind: 'gatherRate', resource: 'food', mult: 1.7 },
    ],
  },
  {
    id: 'windmill',
    name: 'Moulin à vent',
    age: 5,
    cost: 20000,
    materials: { wood: 300, stone: 150 },
    requires: ['threefield'],
    fact: "Les premiers moulins à vent d'Europe apparaissent vers 1180 face à la Manche : des moulins-pivots dont le corps entier tourne pour chercher le vent.",
    effects: [
      { kind: 'building', building: 'windmill' },
      { kind: 'gatherRate', resource: 'food', mult: 1.5 },
      { kind: 'insightRate', add: 5 },
    ],
  },
  {
    id: 'clock',
    name: 'Horloge mécanique',
    age: 5,
    cost: 24000,
    materials: { iron: 150, copper: 80 },
    requires: ['windmill'],
    fact: "Vers 1300, l'échappement découpe le temps en battements égaux : les beffrois sonnent des heures fixes, et la journée de travail change de maître.",
    effects: [
      { kind: 'building', building: 'clock' },
      { kind: 'insightRate', add: 7 },
      { kind: 'nightFloor', value: 0.92 },
    ],
  },
  {
    id: 'press',
    name: 'Imprimerie',
    age: 5,
    cost: 30000,
    materials: { iron: 120, fiber: 150 },
    requires: ['clock', 'codex'],
    fact: "Vers 1450 à Mayence, Gutenberg marie caractères mobiles, alliage plomb-étain et presse à vis : en cinquante ans, l'Europe imprime plus de livres qu'elle n'en avait copiés en mille ans.",
    effects: [
      { kind: 'building', building: 'press' },
      { kind: 'insightRate', add: 12 },
    ],
  },

  // ── Renaissance ──────────────────────────────────────────────────────────
  {
    id: 'caravel',
    name: 'Caravelle',
    age: 6,
    cost: 38000,
    materials: { wood: 400, fiber: 250 },
    requires: ['press'],
    fact: "La caravelle portugaise mêle voiles carrées et latines : elle remonte au vent et revient. C'est elle qui ouvre les caps de l'Afrique, puis l'Atlantique.",
    effects: [
      { kind: 'building', building: 'caravel' },
      { kind: 'expeditionSpeed', mult: 1.6 },
    ],
  },
  {
    id: 'perspective',
    name: 'Perspective',
    age: 6,
    cost: 46000,
    materials: { wood: 200, clay: 150 },
    requires: ['press'],
    fact: "Vers 1425, Brunelleschi fait regarder Florence à travers un trou percé dans un panneau peint : la perspective géométrique naît en place publique, démonstration à l'appui.",
    effects: [
      { kind: 'building', building: 'easel' },
      { kind: 'insightRate', add: 15 },
    ],
  },
  {
    id: 'observatory',
    name: 'Lunette astronomique',
    age: 6,
    cost: 56000,
    materials: { copper: 300, clay: 200 },
    requires: ['perspective'],
    fact: "Galilée pointe fin 1609 une lunette de foire vers le ciel ; en janvier 1610, quatre lunes tournent autour de Jupiter — tout ne tourne donc pas autour de la Terre.",
    effects: [
      { kind: 'building', building: 'observatory' },
      { kind: 'insightRate', add: 20 },
    ],
  },
  {
    id: 'bank',
    name: 'Lettre de change',
    age: 6,
    cost: 68000,
    materials: { fiber: 300, copper: 250 },
    requires: ['caravel'],
    fact: "Les banquiers florentins font voyager l'argent sans or : une lettre signée à Florence se paie à Bruges. Le crédit devient une infrastructure.",
    effects: [
      { kind: 'building', building: 'bank' },
      { kind: 'carry', add: 150 },
      { kind: 'insightRate', add: 10 },
    ],
  },
  {
    id: 'anatomy',
    name: 'Anatomie',
    age: 6,
    cost: 82000,
    materials: { fiber: 250, iron: 200 },
    requires: ['perspective'],
    fact: "En 1543, Vésale dissèque et dessine lui-même : son De fabrica corrige Galien sur plus de deux cents points. Le corps devient un territoire cartographié.",
    effects: [
      { kind: 'building', building: 'anatomy' },
      { kind: 'gatherRate', resource: 'food', mult: 1.4 },
      { kind: 'insightRate', add: 18 },
    ],
  },

  // ── Ère industrielle ─────────────────────────────────────────────────────
  {
    id: 'steamengine',
    name: 'Machine à vapeur',
    age: 7,
    cost: 100000,
    materials: { iron: 400, copper: 250 },
    requires: ['bank'],
    fact: "La machine de Watt (1769) ajoute un condenseur séparé à celle de Newcomen : quatre fois moins de charbon, et l'usine cesse de dépendre des rivières.",
    effects: [
      { kind: 'building', building: 'steamengine' },
      { kind: 'gatherRate', resource: 'stone', mult: 2.0 },
      { kind: 'gatherRate', resource: 'wood', mult: 1.8 },
    ],
  },
  {
    id: 'railway',
    name: 'Chemin de fer',
    age: 7,
    cost: 120000,
    materials: { iron: 600, wood: 400 },
    requires: ['steamengine'],
    fact: "En 1830, la ligne Liverpool–Manchester inaugure l'horaire régulier ; dix ans plus tard, les compagnies imposent une heure unique et les villes règlent leurs horloges les unes sur les autres.",
    effects: [
      { kind: 'building', building: 'railway' },
      { kind: 'expeditionSpeed', mult: 1.7 },
      { kind: 'carry', add: 250 },
    ],
  },
  {
    id: 'gaslight',
    name: 'Éclairage au gaz',
    age: 7,
    cost: 145000,
    materials: { iron: 350, stone: 400 },
    requires: ['steamengine'],
    fact: "Londres allume ses premiers réverbères au gaz en 1807, sur Pall Mall : la nuit urbaine devient un espace public, et les théâtres jouent plus tard.",
    effects: [
      { kind: 'building', building: 'gaslamp' },
      { kind: 'nightFloor', value: 0.96 },
    ],
  },
  {
    id: 'bessemer',
    name: 'Acier Bessemer',
    age: 7,
    cost: 175000,
    materials: { iron: 800, stone: 300 },
    requires: ['railway'],
    fact: "Le convertisseur Bessemer (1856) souffle de l'air à travers la fonte en fusion : l'acier tombe à un dixième de son prix — les rails, les ponts et les charpentes suivent.",
    effects: [
      { kind: 'building', building: 'bessemer' },
      { kind: 'gatherRate', resource: 'iron', mult: 2.2 },
    ],
  },
  {
    id: 'telegraph',
    name: 'Télégraphe',
    age: 7,
    cost: 210000,
    materials: { copper: 600, wood: 300 },
    requires: ['railway'],
    fact: "1844 : Morse télégraphie de Washington à Baltimore. L'information voyage désormais plus vite que n'importe quel messager.",
    effects: [
      { kind: 'building', building: 'telegraph' },
      { kind: 'insightRate', add: 30 },
    ],
  },

  // ── Ère moderne ──────────────────────────────────────────────────────────
  {
    id: 'electricity',
    name: 'Électricité',
    age: 8,
    cost: 250000,
    materials: { copper: 900, iron: 500 },
    requires: ['telegraph', 'gaslight'],
    fact: "Pearl Street, 1882 : la centrale d'Edison allume quatre cents lampes dans Manhattan. En une génération, la nuit domestique disparaît.",
    effects: [
      { kind: 'building', building: 'electric' },
      { kind: 'nightFloor', value: 1 },
      { kind: 'insightRate', add: 15 },
    ],
  },
  {
    id: 'automobile',
    name: 'Automobile',
    age: 8,
    cost: 300000,
    materials: { iron: 900, copper: 400 },
    requires: ['bessemer'],
    fact: "La Ford T sort en 1908 ; la chaîne d'assemblage de 1913 fait tomber son temps de montage de douze heures à quatre-vingt-treize minutes.",
    effects: [
      { kind: 'building', building: 'garage' },
      { kind: 'expeditionSpeed', mult: 1.6 },
      { kind: 'carry', add: 400 },
    ],
  },
  {
    id: 'radio',
    name: 'Radio',
    age: 8,
    cost: 360000,
    materials: { copper: 800, wood: 300 },
    requires: ['electricity'],
    fact: "En 1901, Marconi fait traverser l'Atlantique à trois points Morse. Trente ans plus tard, une voix parle en direct dans des millions de foyers.",
    effects: [
      { kind: 'building', building: 'radio' },
      { kind: 'insightRate', add: 40 },
    ],
  },
  {
    id: 'flight',
    name: 'Aviation',
    age: 8,
    cost: 430000,
    materials: { iron: 700, fiber: 400 },
    requires: ['automobile'],
    fact: "Le 17 décembre 1903, le Flyer des frères Wright tient l'air douze secondes et trente-six mètres — moins que l'envergure d'un 747.",
    effects: [
      { kind: 'building', building: 'plane' },
      { kind: 'expeditionSpeed', mult: 2.0 },
    ],
  },
  {
    id: 'penicillin',
    name: 'Pénicilline',
    age: 8,
    cost: 520000,
    materials: { clay: 500, food: 2000 },
    requires: ['electricity'],
    fact: "Une moisissure contamine une boîte de Petri en 1928 ; en 1944, la pénicilline sort par tonnes des cuves. Les blessures cessent d'être des condamnations.",
    effects: [
      { kind: 'building', building: 'clinic' },
      { kind: 'gatherRate', resource: 'food', mult: 1.5 },
      { kind: 'insightRate', add: 20 },
    ],
  },

  // ── Ère contemporaine ────────────────────────────────────────────────────
  {
    id: 'computer',
    name: 'Ordinateur personnel',
    age: 9,
    cost: 620000,
    materials: { copper: 1200, iron: 600 },
    requires: ['radio'],
    fact: "En 1977, l'Apple II arrive assemblé, clavier compris : l'ordinateur quitte les centres de calcul pour la table de la cuisine.",
    effects: [
      { kind: 'building', building: 'computer' },
      { kind: 'insightRate', add: 60 },
    ],
  },
  {
    id: 'satellite',
    name: 'Satellites',
    age: 9,
    cost: 750000,
    materials: { iron: 1000, copper: 800 },
    requires: ['flight'],
    fact: "Le GPS doit sa précision à Einstein : sans corriger la relativité, ses horloges dériveraient de dix kilomètres par jour.",
    effects: [
      { kind: 'building', building: 'dish' },
      { kind: 'expeditionSpeed', mult: 1.8 },
    ],
  },
  {
    id: 'internet',
    name: 'Internet',
    age: 9,
    cost: 900000,
    materials: { copper: 1500, iron: 800 },
    requires: ['computer'],
    fact: "En 1969, le premier message d'ARPANET plante après deux lettres : « LO ». Le réseau qui relie aujourd'hui la moitié de l'humanité a commencé par un crash.",
    effects: [
      { kind: 'building', building: 'server' },
      { kind: 'insightRate', add: 80 },
    ],
  },
  {
    id: 'solar',
    name: 'Énergie solaire',
    age: 9,
    cost: 1100000,
    materials: { copper: 1800, stone: 800 },
    requires: ['internet'],
    fact: "Les cellules de Bell (1954) convertissaient 6 % de la lumière ; les panneaux courants dépassent 20 %, et le solaire est devenu l'électricité la moins chère de l'histoire.",
    effects: [
      { kind: 'building', building: 'solar' },
      { kind: 'gatherRate', resource: 'food', mult: 1.4 },
      { kind: 'gatherRate', resource: 'wood', mult: 1.4 },
      { kind: 'gatherRate', resource: 'stone', mult: 1.4 },
      { kind: 'insightRate', add: 30 },
    ],
  },
  {
    id: 'smartphone',
    name: 'Smartphone',
    age: 9,
    cost: 1350000,
    materials: { copper: 2000, iron: 1000 },
    requires: ['internet', 'satellite'],
    fact: "En 2007, le téléphone avale l'appareil photo, le GPS, le baladeur et l'ordinateur : l'humanité met l'essentiel de son savoir dans sa poche.",
    effects: [
      { kind: 'building', building: 'phone' },
      { kind: 'insightRate', add: 100 },
    ],
  },
]

export const TECH_BY_ID = new Map(TECHS.map((t) => [t.id, t]))

// ── Expéditions : destinations et reliques ───────────────────────────────────

export interface DestinationDef {
  id: 'ilot' | 'cote' | 'large'
  name: string
  /** Une ligne d'intention : le joueur choisit un tempérament, pas des chiffres. */
  blurb: string
  durationK: number
  lootK: number
  /** Probabilité d'un revers en route (le butin en souffre, jamais le colon). */
  risk: number
  relicChance: number
  /** Azimut monde de la silhouette à l'horizon — la destination se VOIT. */
  azimuth: number
  /** Palier de bateau minimal (0 radeau, 1 pirogue, 2 voile…) : on ne
   *  traverse pas le grand large sur trois rondins. */
  minTier: number
  /** Ce qu'il faut construire pour y aller, en toutes lettres. */
  needs: string
}

export const DESTINATIONS: DestinationDef[] = [
  {
    id: 'ilot',
    name: "L'îlot voisin",
    blurb: 'Court et sûr — on rentre avant la nuit.',
    durationK: 0.65,
    lootK: 0.65,
    risk: 0,
    relicChance: 0.18,
    azimuth: 3.95,
    minTier: 0,
    needs: '',
  },
  {
    id: 'cote',
    name: 'La côte lointaine',
    blurb: 'La traversée raisonnable des marins prudents.',
    durationK: 1,
    lootK: 1.12,
    risk: 0.14,
    relicChance: 0.34,
    azimuth: 4.7,
    minTier: 1,
    needs: 'la pirogue',
  },
  {
    id: 'large',
    name: 'Le grand large',
    blurb: 'Long et risqué — mais le large paie ses audacieux.',
    durationK: 1.6,
    lootK: 1.85,
    risk: 0.28,
    relicChance: 0.55,
    azimuth: 5.35,
    minTier: 2,
    needs: 'la barque à voile',
  },
]

export const DESTINATION_BY_ID = new Map<string, DestinationDef>(
  DESTINATIONS.map((d) => [d.id, d]),
)

export interface RelicDef {
  id: string
  name: string
  fact: string
}

/** Les reliques rapportées d'expédition : chacune expose un vrai objet de
 *  l'archéologie — le musée du village est un musée d'histoire miniature. */
export const RELICS: RelicDef[] = [
  { id: 'venus', name: 'Une figurine d’ivoire', fact: 'La Dame de Brassempouy, sculptée dans l’ivoire de mammouth il y a ~25 000 ans, est l’une des plus anciennes représentations de visage humain.' },
  { id: 'lionman', name: 'Une statuette mi-homme mi-lion', fact: 'L’Homme-lion de Hohlenstein-Stadel (~40 000 ans) est la plus ancienne sculpture d’un être imaginaire — preuve d’un esprit qui raconte déjà des histoires.' },
  { id: 'flute', name: 'Une flûte en os de vautour', fact: 'Les flûtes de Geissenklösterle (~42 000 ans) sont les plus anciens instruments de musique connus : la musique a l’âge des grottes.' },
  { id: 'ambre', name: 'Un morceau d’ambre poli', fact: 'L’ambre de la Baltique circulait sur des milliers de kilomètres dès le Néolithique — la première « route commerciale » d’Europe.' },
  { id: 'tablette', name: 'Une tablette d’argile griffée', fact: 'À Uruk, vers −3300, on comptait moutons et grain sur l’argile : l’écriture est née de la comptabilité, pas de la poésie.' },
  { id: 'disquenebra', name: 'Un disque de bronze étoilé', fact: 'Le disque de Nebra (~−1600) est la plus ancienne représentation connue du ciel : soleil, croissant et les Pléiades en or incrusté.' },
  { id: 'amphore', name: 'Une amphore incrustée de sel', fact: 'L’épave d’Uluburun (~−1300) portait dix tonnes de cuivre, une tonne d’étain et de l’ambre balte : la mondialisation a 3 300 ans.' },
  { id: 'monnaie', name: 'Une pièce d’électrum frappée', fact: 'Les premières monnaies frappées apparaissent en Lydie vers −620, en électrum, alliage naturel d’or et d’argent du fleuve Pactole.' },
  { id: 'anticythere', name: 'Un mécanisme aux engrenages verdis', fact: 'La machine d’Anticythère (~−100) calculait éclipses et positions planétaires avec ~30 engrenages de bronze — un ordinateur antique retrouvé dans une épave.' },
  { id: 'astrolabe', name: 'Un astrolabe gravé', fact: 'Perfectionné par les astronomes du monde islamique, l’astrolabe donnait l’heure, la latitude et la direction de La Mecque — le smartphone du IXe siècle.' },
  { id: 'boussole', name: 'Une aiguille aimantée sur liège', fact: 'La boussole, née en Chine (aiguille flottante décrite en 1088), a atteint la Méditerranée en un siècle et ouvert la navigation hauturière.' },
  { id: 'sextant', name: 'Un sextant de laiton', fact: 'Avec le sextant (1757) et les chronomètres de Harrison, la longitude cessa d’être le grand mystère qui jetait les flottes sur les récifs.' },
  { id: 'daguerreotype', name: 'Une plaque d’argent imagée', fact: 'Le daguerréotype (1839) fixait une image en quelques minutes de pose : la première photographie commercialisée au monde.' },
  { id: 'transistor', name: 'Un petit composant à trois pattes', fact: 'Le transistor (Bell Labs, 1947) a remplacé les tubes à vide : il y en a aujourd’hui plus de cent milliards de milliards en service — l’objet le plus fabriqué de l’histoire.' },
]

export const RELIC_BY_ID = new Map(RELICS.map((r) => [r.id, r]))

// ── Les Merveilles : une grande œuvre par époque ─────────────────────────────

export interface WonderDef {
  age: number
  id: string
  name: string
  /** Coût TOTAL du chantier, drainé peu à peu sur les surplus. */
  cost: Partial<Record<ResourceId, number>>
  fact: string
}

export const WONDERS: WonderDef[] = [
  { age: 0, id: 'menhirs', name: "L'alignement de menhirs", cost: { stone: 900, wood: 300 }, fact: "À Carnac, près de 3 000 menhirs s'alignent sur quatre kilomètres. Dressés entre −4500 et −3300, certains pèsent plus de vingt tonnes — déplacés sans roue ni métal." },
  { age: 1, id: 'dolmen', name: 'Le grand dolmen', cost: { stone: 2200, wood: 900 }, fact: 'La dalle de couverture du dolmen de Browne’s Hill, en Irlande, pèse environ 100 tonnes : la plus lourde d’Europe, levée il y a plus de 5 000 ans.' },
  { age: 2, id: 'ziggurat', name: 'La ziggourat', cost: { stone: 4500, clay: 2500, wood: 1500 }, fact: "La ziggourat d'Ur (~−2100) alignait des millions de briques crues gainées de briques cuites au bitume. Son cœur d'origine porte encore les restaurations de Nabonide, quinze siècles plus tard." },
  { age: 3, id: 'trophee', name: 'La colonne trophée', cost: { stone: 8000, iron: 2000, copper: 1500 }, fact: 'La colonne Trajane (113) déroule 200 mètres de bas-reliefs en spirale — 2 500 personnages racontant deux guerres, lisibles comme une bande dessinée de marbre.' },
  { age: 4, id: 'phare', name: 'Le grand phare', cost: { stone: 15000, wood: 4000, iron: 3000 }, fact: "Le phare d'Alexandrie (~−280) montait à plus de 100 mètres ; son feu, réfléchi par un miroir de bronze, se voyait à 50 kilomètres. Il tint dix-sept siècles avant les séismes." },
  { age: 5, id: 'cathedrale', name: 'La cathédrale', cost: { stone: 30000, wood: 9000, iron: 5000 }, fact: 'Une cathédrale gothique était le chantier de plusieurs générations : à Strasbourg, 424 ans séparent la première pierre de la flèche — un maçon pouvait y naître, y travailler et mourir sans la voir finie.' },
  { age: 6, id: 'dome', name: 'Le grand dôme', cost: { stone: 55000, clay: 20000, iron: 9000 }, fact: 'Le dôme de Brunelleschi à Florence (1436) fut bâti SANS cintrage : quatre millions de briques posées en spirale autoportante — personne ne savait si ça tiendrait. Ça tient depuis six siècles.' },
  { age: 7, id: 'tour', name: 'La tour de fer', cost: { iron: 60000, stone: 25000, wood: 10000 }, fact: "La tour Eiffel (1889) assemble 18 038 pièces de fer puddlé par 2,5 millions de rivets, posés à quatre ouvriers par rivet. Montée en deux ans, deux mois et cinq jours." },
  { age: 8, id: 'gratteciel', name: 'Le gratte-ciel', cost: { iron: 120000, stone: 50000, copper: 25000 }, fact: "L'Empire State Building (1931) monta de 102 étages en 410 jours — jusqu'à quatre étages et demi par semaine, en pleine Grande Dépression." },
  { age: 9, id: 'fusee', name: 'La fusée', cost: { iron: 250000, copper: 100000, fiber: 60000 }, fact: 'Saturn V (1967) reste la machine la plus puissante jamais construite : 3 000 tonnes au décollage, dont 91 % de carburant — pour envoyer 45 tonnes vers la Lune.' },
]

export const WONDER_BY_AGE = new Map(WONDERS.map((w) => [w.age, w]))
