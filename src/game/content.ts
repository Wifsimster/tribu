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
  // La seule époque que l'Histoire n'a pas encore écrite. Elle n'est pas
  // inventée pour autant : chacun de ses savoirs existe déjà, à l'état de
  // prototype, de première usine ou de première autorisation. Ce qui reste
  // hypothétique, c'est le passage à l'échelle — et c'est le sujet même de
  // l'époque : plus « peut-on le faire ? », mais « à quelle échelle, à quel
  // coût, et à temps ? ».
  {
    id: 10,
    name: 'Ère des limites',
    period: "aujourd'hui à demain",
    techsToAdvance: 6,
    sky: 0xc6dbe6,
    fog: 0xdce8ea,
    ground: 0xb4c47c,
  },
]

/** LE TEMPS DES CADEAUX. Sur l'horloge du joueur, pas sur celle du jeu : du
 *  20 au 26 décembre, des paquets attendent autour du feu ; les nuits du 24 et
 *  du 25, un traîneau traverse le ciel. C'est le seul endroit du jeu où le
 *  calendrier réel entre — d'où le nom explicite. */
export type YuleState = 'none' | 'gifts' | 'flight'

export function yuleState(now = new Date()): YuleState {
  if (now.getMonth() !== 11) return 'none'
  const d = now.getDate()
  if (d === 24 || d === 25) return 'flight'
  return d >= 20 && d <= 26 ? 'gifts' : 'none'
}

/** Ce que raconte la carte du traîneau : la vraie histoire, et un mythe défait.
 *  Le jeu explique TOUT ce qu'il montre — un événement sans son fait ne serait
 *  qu'une décoration. */
export const YULE_STORY =
  "Le 25 décembre ne doit rien à une date de naissance : l'Église l'a fixé au IVe siècle sur le solstice romain du Sol Invictus, la fête du soleil qui renaît. Le personnage, lui, vient de saint Nicolas de Myre, évêque du IVe siècle réputé pour ses dons secrets, que les Néerlandais emportent en Amérique sous le nom de Sinterklaas. Le traîneau et ses huit rennes n'apparaissent qu'en 1823, dans un poème américain ; Rudolph, le neuvième, est inventé en 1939 par un grand magasin de Chicago pour son catalogue de Noël. Et non : ce n'est pas Coca-Cola qui l'a habillé de rouge — le dessinateur Thomas Nast le représentait déjà ainsi dans les années 1860, quarante ans avant la marque."

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
  /** Le « Le saviez-vous ? » : une seconde anecdote, plus inattendue que le
   *  fait principal. C'est elle qui fait qu'on relit une fiche déjà lue. */
  funFact?: string
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
    funFact:
      "Un éclat d'obsidienne — du verre volcanique — présente un tranchant de quelques nanomètres, plus fin qu'un rasoir d'acier. Des chirurgiens s'en sont servis au XXe siècle pour des incisions qui cicatrisent mieux.",
    effects: [
      { kind: 'gatherRate', resource: 'stone', mult: 1.6 }],
  },
  {
    id: 'fire',
    name: 'Maîtrise du feu',
    age: 0,
    cost: 18,
    materials: { wood: 15 },
    requires: ['flint'],
    fact: "À Gesher Benot Ya'aqov, en Israël, des foyers vieux de 780 000 ans montrent un feu entretenu volontairement, pas un incendie naturel.",
    funFact:
      "Cuire, c'est prédigérer : à quantité égale, un aliment cuit libère beaucoup plus d'énergie que cru. C'est le cœur de l'hypothèse du « singe cuisinier », qui lie la maîtrise du feu à la croissance de notre cerveau.",
    effects: [
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
    funFact:
      "À Mezhyrich, en Ukraine, on bâtissait il y a 15 000 ans des huttes en OS de mammouth : l'une d'elles empile 95 mandibules disposées en chevrons, comme un appareillage de maçon.",
    effects: [{ kind: 'building', building: 'hut' }, { kind: 'carry', add: 4 }],
  },
  {
    id: 'spear',
    name: 'Épieu de chasse',
    age: 0,
    cost: 45,
    materials: { wood: 20, stone: 15 },
    requires: ['fire'],
    fact: "Les épieux de Schöningen, en Allemagne, ont entre 200 000 et 300 000 ans selon les datations. Taillés dans l'épicéa, ils sont équilibrés comme des javelots de compétition.",
    funFact:
      "Le propulseur, apparu vers −18 000, ajoute un segment au bras : la pointe du javelot atteint une centaine de kilomètres à l'heure. C'est le premier levier connu au service d'un muscle humain.",
    effects: [
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
    funFact:
      "Une lampe à graisse éclaire à peu près comme une bougie. Pour peindre une paroi entière, il en fallait des dizaines allumées ensemble — la lumière était un budget avant d'être un confort.",
    effects: [
      { kind: 'nightFloor', value: 0.85 }],
  },
  {
    id: 'cordage',
    name: 'Cordage végétal',
    age: 0,
    cost: 70,
    materials: { wood: 30 },
    requires: ['spear'],
    fact: "Un fragment de corde à trois brins retrouvé à l'Abri du Maras, en Ardèche, a environ 45 000 à 50 000 ans : il a été fabriqué par des Néandertaliens.",
    funFact:
      "Une corde change tout ce qui devient possible : l'arc, le filet, le piège, le radeau, la hache emmanchée. C'est l'outil qui fabrique les autres — et le plus rare en fouille, parce que la fibre pourrit et ne laisse presque jamais de trace.",
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
    materials: { wood: 40, fiber: 25 },
    requires: ['cordage'],
    fact: "Le blé amidonnier et l'orge sont domestiqués dans le Croissant fertile vers −9500. Il a fallu près d'un millénaire pour que l'épi cesse de s'égrener tout seul.",
    funFact:
      "Les squelettes des premiers paysans sont plus petits, plus cariés et plus usés que ceux des chasseurs qui les précèdent. L'agriculture nourrit PLUS DE MONDE, pas mieux : elle échange la qualité du régime contre le nombre.",
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
    funFact:
      "Un pot change le régime alimentaire : on peut enfin bouillir. Les résidus carbonisés au fond des plus vieux pots japonais montrent qu'on y cuisait du poisson — la poterie naît autour du feu des pêcheurs, pas des moissonneurs.",
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
    materials: { fiber: 60 },
    requires: ['pottery'],
    fact: "Des empreintes de textiles tissés sur argile, à Dolní Věstonice en Moravie, datent de 27 000 ans — le tissu précède de loin le métier à tisser retrouvé.",
    funFact:
      "Un métier à tisser est une machine à programme : Jacquard n'a fait que remplacer les mains par des cartes perforées. Ces mêmes cartes ont servi de mémoire aux premiers ordinateurs.",
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
    funFact:
      "Polir une lame prend des dizaines d'heures pour un tranchant à peine plus vif — mais bien plus solide : elle ne s'éclate plus dans le bois. Les archéologues qui refont l'expérience abattent un chêne en moins d'une heure.",
    effects: [
      { kind: 'gatherRate', resource: 'wood', mult: 2.0 }],
  },
  {
    id: 'granary',
    name: 'Grenier',
    age: 1,
    cost: 340,
    materials: { wood: 80, fiber: 40 },
    requires: ['agriculture', 'weaving'],
    fact: "À Dhra', en Jordanie, des greniers surélevés vieux de 11 300 ans stockaient l'orge sauvage : on a stocké les céréales avant de savoir les cultiver.",
    funFact:
      "Un stock, ça se compte, ça se garde, ça se prête et ça se vole. Le grenier apparaît avant le champ : la propriété a probablement précédé la récolte.",
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
    funFact:
      "Ötzi, mort dans les Alpes vers −3300, portait une hache de cuivre presque pur. Ses cheveux contiennent de l'arsenic : il avait respiré les fumées d'une fonte.",
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
    materials: { copper: 60 },
    requires: ['copper'],
    fact: "Le bronze demande du cuivre et de l'étain, qu'on ne trouve presque jamais au même endroit. L'âge du bronze est donc d'abord un âge du commerce longue distance.",
    funFact:
      "L'étain est rare et ne gît jamais près du cuivre : le bronze impose des routes commerciales longues. Quand ces routes se rompent, vers −1200, plusieurs civilisations s'effondrent presque en même temps.",
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
    funFact:
      "L'invention n'est pas le disque — c'est l'assemblage roue-ESSIEU, qui exige un ajustement au millimètre. Et la roue arrive tard : après la voile, après la poterie, après la ville.",
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
    materials: { clay: 60 },
    requires: ['bronze'],
    fact: "Le cunéiforme naît vers −3400 à Uruk pour compter des sacs d'orge et des têtes de bétail. La comptabilité précède la littérature de plusieurs siècles.",
    funFact:
      "Le plus ancien nom propre connu de l'humanité n'est ni celui d'un roi ni celui d'un dieu : c'est « Kushim », signé au bas d'une tablette de comptes d'orge à Uruk. Le premier nom de l'Histoire est celui d'un comptable.",
    effects: [
      { kind: 'insightRate', add: 0.6 }],
  },
  {
    id: 'sail',
    name: 'Voile',
    age: 2,
    cost: 1200,
    materials: { fiber: 120, wood: 60 },
    requires: ['wheel', 'weaving'],
    fact: "Les premières voiles attestées sont peintes sur des vases égyptiens vers −3100 : un carré de lin tendu, qui ne sait remonter au vent qu'à peine.",
    funFact:
      "Une voile carrée ne remonte pas au vent : pendant des millénaires, on n'a navigué qu'avec le vent dans le dos, ou en attendant qu'il tourne. La voile latine, qui permet de louvoyer, n'arrive qu'à la fin de l'Antiquité.",
    // PAS de bâtiment : découvrir la voile doit se voir sur la BARQUE, pas
    // ajouter un atelier sur l'île. Le palier 2 de la flotte gréé sa voile.
    effects: [{ kind: 'expeditionSpeed', mult: 1.6 }],
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
    funFact:
      "Le fer n'est pas d'abord meilleur que le bronze : il est plus COMMUN. Son minerai est presque partout, alors que l'étain venait du bout du monde. C'est l'abondance, pas la qualité, qui démocratise l'outil de métal.",
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
    funFact:
      "La charrue à versoir retourne la terre et réclame un attelage puissant : elle a fait basculer le nord de l'Europe vers de longs champs en lanières, dont le parcellaire se lit encore sur les photos aériennes.",
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
    funFact:
      "La plupart des alphabets du monde — grec, latin, cyrillique, hébreu, arabe — descendent du même ancêtre proto-sinaïtique. Notre « A » est une tête de bœuf retournée : aleph.",
    effects: [
      { kind: 'insightRate', add: 1.5 }],
  },
  {
    id: 'coinage',
    name: 'Monnaie frappée',
    age: 3,
    cost: 3400,
    materials: { copper: 40, iron: 30 },
    requires: ['alphabet'],
    fact: "Les premières pièces sont frappées en Lydie vers −630, en électrum, un alliage naturel d'or et d'argent trouvé dans la rivière Pactole.",
    funFact:
      "Frapper une pièce, c'est garantir son poids. Le bénéfice du prince est l'écart entre la valeur du métal et celle qu'il décrète : dès le premier jour, une monnaie est en partie une confiance.",
    effects: [
      { kind: 'building', building: 'market' },
      { kind: 'expeditionSpeed', mult: 1.8 },
      { kind: 'gatherRate', resource: 'iron', mult: 1.5 },
    ],
  },
  {
    id: 'lighthouse',
    name: 'Tour à feu',
    age: 3,
    cost: 2400,
    materials: { stone: 140, wood: 70 },
    requires: ['sail'],
    fact: "Les Grecs tenaient des feux allumés au sommet des caps — les phryktories. Dans l'Agamemnon d'Eschyle, la nouvelle de la chute de Troie franchit la mer Égée en une seule nuit, de brasier en brasier.",
    funFact:
      "La tour d'Hercule, à La Corogne, allumée par les Romains au Ier siècle, éclaire toujours l'Atlantique : c'est le plus vieux phare du monde encore en service.",
    effects: [
      { kind: 'building', building: 'lighthouse' },
      { kind: 'insightRate', add: 1 },
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
    funFact:
      "L'eau des aqueducs romains coulait en permanence : on ne savait pas la fermer. Le trop-plein rinçait les égouts — le gaspillage faisait partie du système.",
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
    funFact:
      "Le dôme du Panthéon, coulé vers 126, reste le plus grand dôme de béton NON ARMÉ du monde. Les Romains allègent le mélange en montant : pierre lourde en bas, pierre ponce au sommet.",
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
    funFact:
      "Le Domesday Book recense 5 624 moulins à eau en Angleterre en 1086 — environ un pour trois cents habitants. L'Europe médiévale tourne à la force de l'eau.",
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
    funFact:
      "Le verre romain était massivement recyclé : on a retrouvé dans des épaves des cargaisons entières de tessons destinés à la refonte.",
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
    funFact:
      "Les voies romaines étaient si droites qu'elles servent encore de tracé : plusieurs routes départementales françaises suivent au mètre près une chaussée d'il y a deux mille ans.",
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
    funFact:
      "Le codex a rendu possible le palimpseste : gratter un texte pour en écrire un autre. C'est ainsi qu'on a failli perdre Archimède — et qu'on l'a retrouvé sous des prières du XIIIe siècle, révélé au début des années 2000 par imagerie multispectrale et rayons X.",
    effects: [
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
    funFact:
      "L'assolement triennal ajoute une sole de printemps : avoine, pois, fèves. Conséquence inattendue — plus d'avoine, donc plus de CHEVAUX, qui labourent deux fois plus vite que les bœufs.",
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
    funFact:
      "Les Pays-Bas ont asséché des lacs entiers au moulin. Le Beemster, drainé en 1612 par des dizaines de moulins en cascade, est aujourd'hui à trois mètres et demi SOUS le niveau de la mer.",
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
    funFact:
      "Avant l'horloge, l'heure était élastique : on divisait le jour en douze, donc une heure d'été durait plus qu'une heure d'hiver. L'échappement mécanique a imposé l'heure égale — et la ponctualité.",
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
    funFact:
      "Gutenberg n'a pas inventé les caractères mobiles : la Corée les fondait en métal dès le XIIIe siècle, deux cents ans avant lui. Ce qu'il invente, c'est le SYSTÈME complet — alliage, encre grasse, presse à vis — et le marché qui va avec.",
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
    funFact:
      "Pour rentrer d'Afrique, les Portugais ont dû apprendre à faire fausse route : s'éloigner de la côte vers le large pour retrouver des vents portants. Cette boucle contre-intuitive s'appelle la volta do mar — et c'est elle qui rend l'exploration réversible.",
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
    funFact:
      "Le point de fuite a une conséquence inattendue : il assigne au spectateur une place unique et immobile. Le tableau cesse d'être une surface à lire pour devenir une fenêtre — vue d'un seul œil.",
    effects: [
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
    funFact:
      "Galilée a vu les PHASES de Vénus — impossibles dans le système de Ptolémée. Une lunette de quelques centimètres a suffi à faire tomber le ciel des Anciens.",
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
    funFact:
      "La lettre de change contourne aussi l'interdit du prêt à intérêt : le gain se cache dans le taux de change entre deux villes. La finance moderne est née en partie d'un contournement moral.",
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
    funFact:
      "Vésale a commencé par voler des cadavres : les suppliciés décrochés de nuit au gibet de Louvain. L'anatomie moderne débute par une infraction.",
    effects: [
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
    funFact:
      "Watt n'a pas inventé la machine à vapeur, il l'a rendue économe. Et pour la vendre, il a inventé une unité de mesure : le cheval-vapeur, calibré sur ce qu'un cheval de brasserie soulevait réellement.",
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
    funFact:
      "L'écartement standard des rails, 1 435 mm, vient des tramways à chevaux anglais, eux-mêmes calés sur les ornières des chariots. La moitié des voies du monde a la largeur d'une charrette.",
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
    funFact:
      "Le réverbère au gaz a créé un métier : l'allumeur, qui passait deux fois par nuit. Il a surtout allongé la journée — le travail et le théâtre ont cessé de s'arrêter au coucher du soleil.",
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
    funFact:
      "Le convertisseur souffle de l'air dans la fonte en fusion et la transforme en acier en vingt minutes, contre plusieurs jours auparavant. Le prix de l'acier s'effondre : les rails, les ponts et les gratte-ciel deviennent possibles.",
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
    funFact:
      "Le premier câble transatlantique, en 1858, transmettait environ un mot toutes les deux minutes : le message de la reine Victoria au président Buchanan mit près de dix-sept heures. Le câble grilla trois semaines plus tard.",
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
    funFact:
      "La « guerre des courants » opposa le continu d'Edison à l'alternatif de Tesla et Westinghouse. L'alternatif l'emporta parce qu'il voyage loin : c'est le transformateur, plus que la dynamo, qui a électrifié le monde.",
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
    funFact:
      "Le premier long voyage en automobile est l'œuvre de Bertha Benz, en 1888 : 106 kilomètres sans prévenir son mari, en achetant l'essence en pharmacie et en réparant un câble avec sa jarretelle.",
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
    funFact:
      "La radio a aussi produit sa légende : en 1938, la fiction d'Orson Welles sur La Guerre des mondes a bien moins affolé le public que la presse écrite ne l'a raconté. Les journaux tenaient là de quoi discréditer un média rival.",
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
    fact: "Le 17 décembre 1903, le Flyer des frères Wright tient l'air douze secondes et trente-sept mètres — moins que l'envergure d'un 747.",
    funFact:
      "Les Wright n'étaient pas ingénieurs mais fabricants de bicyclettes — et c'est de là que vient leur idée décisive. Leurs concurrents cherchaient un appareil stable ; eux ont cherché des COMMANDES, parce qu'un vélo non plus ne tient pas tout seul.",
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
    funFact:
      "Fleming voit la moisissure en 1928, mais le premier patient n'est soigné qu'en 1941. La pénicilline était si rare qu'on la récupérait dans ses urines pour la lui réinjecter ; le stock s'épuisa avant sa guérison.",
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
    funFact:
      "Le mot « ordinateur » a été proposé en 1955 par un professeur de lettres consulté par IBM France, qui trouvait « calculateur » trop pauvre. Il l'a pris au vocabulaire théologique : celui qui met en ordre.",
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
    funFact:
      "Le signal GPS a longtemps été dégradé exprès pour les civils : une centaine de mètres d'erreur ajoutée par l'armée américaine. Elle a été coupée le 2 mai 2000, et la précision civile a été divisée par dix du jour au lendemain.",
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
    funFact:
      "Le réseau n'a pas été conçu pour survivre à une guerre nucléaire — la légende est tenace. Il a été conçu pour PARTAGER des ordinateurs rares et hors de prix entre laboratoires ; la robustesse est venue en prime.",
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
    funFact:
      "L'effet photovoltaïque est observé en 1839, mais la première cellule utile date de 1954. Son premier vrai marché fut l'espace — là où l'on ne peut pas livrer de carburant.",
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
    funFact:
      "Le téléphone dans ta poche dépasse, à lui seul, la puissance de calcul de l'ensemble des ordinateurs dont disposait la NASA pour poser des hommes sur la Lune.",
    effects: [
      { kind: 'building', building: 'phone' },
      { kind: 'insightRate', add: 100 },
    ],
  },

  // ── Ère des limites ──────────────────────────────────────────────────────
  // Aucun de ces savoirs n'est inventé : tous existent en 2026, à l'état de
  // prototype, de première usine ou de première autorisation. Ce qui reste
  // hypothétique, c'est leur passage à l'échelle — et c'est le sujet même de
  // l'époque : non plus « peut-on le faire ? », mais « à quelle échelle, et
  // à quel coût ? ».
  {
    id: 'ai',
    name: 'Intelligence artificielle',
    age: 10,
    cost: 2000000,
    materials: { copper: 3000, iron: 1500, fiber: 1000 },
    requires: ['smartphone'],
    fact: "L'architecture Transformer, publiée en 2017 dans un article de huit pages intitulé « Attention Is All You Need », est le socle commun de presque tous les grands modèles de langage d'aujourd'hui.",
    funFact:
      "Le coût dominant d'un grand modèle n'est plus le calcul : c'est l'électricité et le refroidissement. C'est pourquoi les nouveaux centres de données se construisent désormais à côté des barrages, des parcs éoliens et des centrales — l'informatique redevient une industrie lourde.",
    effects: [
      { kind: 'building', building: 'datacenter' },
      { kind: 'insightRate', add: 220 },
      { kind: 'gatherRate', resource: 'insight', mult: 1 },
    ],
  },
  {
    id: 'storage',
    name: 'Stockage du réseau',
    age: 10,
    cost: 2600000,
    materials: { copper: 4000, iron: 2500 },
    requires: ['ai'],
    fact: "Le prix d'un kilowattheure de batterie au lithium a chuté d'environ 90 % entre 2010 et 2023. C'est cette courbe, plus qu'aucune décision politique, qui rend le solaire et l'éolien pilotables.",
    funFact:
      "Une batterie de réseau ne sert pas qu'à stocker : elle répond en millisecondes là où une turbine met des minutes. La première grande installation australienne a fait chuter de plus de moitié le coût des services qui tiennent la fréquence du réseau.",
    effects: [
      { kind: 'building', building: 'battery' },
      { kind: 'gatherRate', resource: 'iron', mult: 2.2 },
      { kind: 'gatherRate', resource: 'copper', mult: 2.2 },
    ],
  },
  {
    id: 'desal',
    name: 'Dessalement',
    age: 10,
    cost: 3400000,
    materials: { iron: 3000, stone: 6000 },
    requires: ['storage'],
    fact: "Israël tire environ 85 % de son eau domestique de la mer. L'osmose inverse est passée d'une dizaine de kilowattheures par mètre cube à près de trois : ce n'est pas la technique qui la limitait, c'est l'énergie.",
    funFact:
      "Le vrai problème du dessalement n'est pas de produire l'eau : c'est la saumure, deux fois plus salée que la mer, qu'il faut rendre à l'océan sans asphyxier les fonds. Une usine se juge sur son rejet autant que sur son débit.",
    effects: [
      { kind: 'building', building: 'desal' },
      { kind: 'gatherRate', resource: 'food', mult: 2.4 },
    ],
  },
  {
    id: 'crispr',
    name: 'Édition du génome',
    age: 10,
    cost: 4200000,
    materials: { fiber: 3000, copper: 2000 },
    requires: ['storage'],
    fact: "CRISPR-Cas9, publié en 2012, vaut à Emmanuelle Charpentier et Jennifer Doudna le prix Nobel de chimie 2020. En 2023, la première thérapie qui l'emploie est autorisée : elle corrige la drépanocytose.",
    funFact:
      "CRISPR n'a pas été inventé, il a été TROUVÉ : c'est le système immunitaire des bactéries, qui conservent dans leur ADN des fragments des virus rencontrés. Nous avons emprunté une mémoire d'infection vieille de milliards d'années.",
    effects: [
      { kind: 'building', building: 'genlab' },
      { kind: 'gatherRate', resource: 'food', mult: 2.2 },
      { kind: 'insightRate', add: 300 },
    ],
  },
  {
    id: 'carbon',
    name: 'Captage du carbone',
    age: 10,
    cost: 5600000,
    materials: { iron: 6000, stone: 9000, copper: 3000 },
    requires: ['desal'],
    fact: "Les premières usines de captage direct dans l'air tournent en Islande, alimentées par la géothermie. Elles retirent quelques milliers de tonnes de CO₂ par an — quand l'humanité en émet près de quarante milliards.",
    funFact:
      "L'ordre de grandeur EST le sujet : compenser une seule année d'émissions demanderait des millions d'usines comme celles-là. Le captage ne remplace pas la baisse des émissions, il ne peut qu'en finir le dernier dixième.",
    effects: [
      { kind: 'building', building: 'capture' },
      { kind: 'gatherRate', resource: 'stone', mult: 2.4 },
      { kind: 'insightRate', add: 380 },
    ],
  },
  {
    id: 'quantum',
    name: 'Ordinateur quantique',
    age: 10,
    cost: 7400000,
    materials: { copper: 8000, iron: 5000, fiber: 4000 },
    requires: ['crispr', 'carbon'],
    fact: "Un qubit ne tient sa superposition que quelques centaines de microsecondes. L'essentiel de la recherche ne porte donc pas sur le calcul mais sur la CORRECTION d'erreurs : il faut aujourd'hui des milliers de qubits physiques pour un seul qubit logique fiable.",
    funFact:
      "La menace est déjà prise au sérieux : « récolter maintenant, déchiffrer plus tard ». Des messages chiffrés aujourd'hui sont archivés dans l'attente d'une machine capable de les ouvrir — d'où la migration en cours de tout l'Internet vers une cryptographie post-quantique.",
    effects: [
      { kind: 'building', building: 'quantum' },
      { kind: 'insightRate', add: 600 },
      { kind: 'carry', add: 400 },
    ],
  },
]
export const TECH_BY_ID = new Map(TECHS.map((t) => [t.id, t]))

// ── Expéditions : destinations et reliques ───────────────────────────────────

export interface DestinationDef {
  /** 'ilot' | 'cote' | 'large' — ou 'visite', la destination fabriquée à la
   *  volée quand on met le cap sur l'île d'un voisin. */
  id: string
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

/** Mettre le cap sur l'île d'un voisin : plus loin que la côte, moins que le
 *  grand large, et payant — on ne rentre pas les mains vides de chez les
 *  autres. Il faut une vraie barque : leurs îles sont au-delà de la côte. */
export const VISIT_DEST: DestinationDef = {
  id: 'visite',
  name: 'Chez le voisin',
  blurb: "Mettre le cap sur l'île d'une autre tribu.",
  durationK: 1.25,
  lootK: 1.4,
  risk: 0.16,
  relicChance: 0.5,
  azimuth: 3.66,
  minTier: 2,
  needs: 'la barque à voile',
}

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
  { age: 10, id: 'fusion', name: 'Le réacteur à fusion', cost: { iron: 900000, copper: 400000, stone: 300000 }, fact: "ITER, en construction à Cadarache, est la plus grande collaboration scientifique jamais montée : trente-cinq pays, un aimant capable de soulever un porte-avions, un plasma à 150 millions de degrés — dix fois le cœur du Soleil. En décembre 2022, une expérience américaine a pour la première fois libéré plus d'énergie que le laser n'en avait déposé sur la cible : un gain sur la cible, pas encore sur la prise de courant." },
]

export const WONDER_BY_AGE = new Map(WONDERS.map((w) => [w.age, w]))


/** Les hauts faits : des jalons, pas des corvées — chacun se lit d'un état. */
export interface FeatDef { id: string; name: string; desc: string }
export const FEATS: FeatDef[] = [
  { id: 'etincelle', name: "L'étincelle", desc: 'Faire une première découverte.' },
  { id: 'bronze', name: "L'âge des métaux", desc: "Atteindre l'âge du bronze." },
  { id: 'michemin', name: 'À mi-chemin', desc: 'Connaître 26 savoirs.' },
  { id: 'sage', name: 'La tribu sage', desc: 'Réunir tous les savoirs.' },
  { id: 'relique', name: 'Première vitrine', desc: 'Rapporter une relique.' },
  { id: 'musee', name: 'Le musée plein', desc: 'Exposer les 14 reliques.' },
  { id: 'merveille', name: 'Bâtisseurs', desc: 'Achever une Merveille.' },
  { id: 'comptoir', name: 'Les feux répondent', desc: "Fonder le comptoir de l'îlot." },
  { id: 'exode', name: 'Le grand départ', desc: 'Accomplir un Exode.' },
  { id: 'constellation', name: 'Trois étoiles', desc: 'Accomplir trois Exodes.' },
  { id: 'annee', name: 'Une année vécue', desc: "Vivre une année entière de l'île (4 saisons)." },
  { id: 'memoire', name: 'La mémoire longue', desc: 'Écrire 100 lignes de Chronique.' },
]
