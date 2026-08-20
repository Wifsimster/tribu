/** Nouveautés, de la plus récente à la plus ancienne. Une entrée par version
 *  publiée — le panneau du menu les affiche telles quelles, et la version
 *  courante vient de package.json (define Vite). À tenir à jour à CHAQUE
 *  correctif ou fonctionnalité. */
export interface Release {
  version: string
  title: string
  items: string[]
}

export const CHANGELOG: Release[] = [
  {
    version: '1.9.0',
    title: "L'essentiel en haut",
    items: [
      "Le bandeau de ressources ne montre plus que ce qui compte maintenant : le savoir, la récolte en cours et les matériaux des découvertes à portée dans l'époque.",
      'Le reste se replie derrière une pastille « +N » — un tap déplie tout le grenier, un autre le referme.',
    ],
  },
  {
    version: '1.8.0',
    title: "L'horizon en poche",
    items: [
      "Un cadran d'horizon sous le menu : le soleil parcourt son arc, cuivré aux heures basses, et la lune prend le relais la nuit. Un tap dit quand la nuit tombe ou quand le jour se lève.",
      "Les étoiles ne descendent plus sur l'eau ni sur l'île quand on incline la caméra : la voûte s'éteint en fondu vers l'horizon.",
    ],
  },
  {
    version: '1.7.2',
    title: "L'eau calme retrouvée",
    items: [
      "Retour à la mer de la 1.6 : l'aplat profond et uniforme, sans taches sombres ni voile laiteux — la houle de maillage de la 1.7.0 créait des artefacts, elle est retirée.",
      'Le chemin de lumière garde son scintillement dérivant ; les vaguelettes et reflets restent.',
    ],
  },
  {
    version: '1.7.1',
    title: 'Des conifères dignes de ce nom',
    items: [
      "Les sapins gardent leur hauteur mais perdent leur volume : houppier en trois couronnes étagées au lieu d'un cône plein, emprise réduite d'un quart.",
      'Le ciel passe entre les étages, les troncs se voient, le village redevient lisible sous la canopée.',
      'Chaque couronne porte son ombre interne — plus sombre au pied, claire à la cime.',
    ],
  },
  {
    version: '1.7.0',
    title: 'Le village vit avec son temps',
    items: [
      "Le campement évolue enfin : dès l'âge du bronze, une maison remplace les tipis — torchis et chaume d'abord, enduit, tuiles et cheminée ensuite. Jarres, caisses et barrières remplacent séchoirs et paravents.",
      "Le feu suit le progrès : feu ouvert aux âges anciens, brasero sur trépied à l'antiquité, et lampadaire électrique dès que l'électricité est découverte — la veillée continue, sans fumée.",
      'Les animaux respectent le bâti : chaque bâtiment a son emprise réelle et les bêtes la contournent au lieu de la traverser.',
      "La mer inspirée de poseidon, en toon : la surface ondule vraiment, rend le ciel au regard rasant, et le chemin de lumière scintille en dérivant.",
    ],
  },
  {
    version: '1.6.0',
    title: 'Le monde à la bonne échelle',
    items: [
      'Audit métrique complet : chaque objet mesuré et recalé sur le colon (1,5 u ≈ 1,75 m).',
      'La forêt domine enfin le camp — sapins portés à ~10 m, le tipi passe sous la canopée.',
      "Les monuments gagnent leur stature : campanile ×4,5, moulin à vent ×5,5, moulin à eau ×2,5, villa et aqueduc agrandis.",
      "La flotte est recalée : pirogue, voilier, caravelle, vapeur, hors-bord et barque marchande à l'échelle.",
      "L'automobile redevient plus longue que le cheval, les moutons retrouvent la taille mouton.",
      'Le smartphone-monolithe cède la place à une antenne relais, vrai repère contemporain.',
    ],
  },
  {
    version: '1.5.1',
    title: 'La mer vivante et le village vrai',
    items: [
      "Le village pousse en hameaux organiques sur toute l'île — fini la couronne géométrique autour du feu.",
      "La lumière se reflète sur l'eau : chemin doré vers le soleil couchant, traînée bleutée sous la lune.",
      'Une houle légère anime la mer, plus marquée par temps couvert.',
      "Les étoiles ne transpercent plus l'île en vue rasante.",
    ],
  },
  {
    version: '1.5.0',
    title: "L'île s'anime",
    items: [
      "La faune suit les époques : cerfs en lisière dès le début (ils fuient le chasseur), moutons avec l'agriculture, poules avec le grenier, chevaux avec le collier d'épaule, mouettes avec la voile. La nuit, tout ce petit monde dort.",
      'Rendu optimisé : les bâtiments fondus dans un mesh unique — le village complet plus la faune tiennent sous le budget mobile.',
    ],
  },
  {
    version: '1.4.2',
    title: 'Grand audit et confort',
    items: [
      "Audit complet des 51 savoirs : dix faits historiques précisés (Barbegal, Galilée, codex, roue…), déblocage vérifié de bout en bout, ateliers retouchés pour la lisibilité.",
      "Les expéditions durent selon l'époque (~90 s au Paléolithique, ~4 min à l'ère contemporaine) et leur coût suit ta production.",
      'Zoom rapproché ×2, ciel de nuit ancré au monde (lune et étoiles défilent quand on orbite).',
      'La feuille de savoir s\'ouvre sur le prochain objectif ; un tap sur une ressource explique son rôle ; toasts lisibles sur mobile.',
    ],
  },
  {
    version: '1.4.1',
    title: 'Expéditions rééquilibrées',
    items: [
      "Le coût d'une expédition suit ta production réelle (~30 s de récolte de nourriture) au lieu d'un barème fixe devenu dérisoire.",
      'Le butin profite en partie du portage : partir reste un vrai choix, jamais une évidence ni un piège.',
    ],
  },
  {
    version: '1.4.0',
    title: "Jusqu'à nos jours",
    items: [
      "Quatre nouvelles époques : Renaissance, ère industrielle, ère moderne et ère contemporaine — vingt savoirs, de la caravelle au smartphone, chacun avec son fait réel et son atelier.",
      "L'expédition évolue encore : caravelle, vapeur à roues, hors-bord.",
      "L'éclairage progresse : réverbères à gaz puis électricité — la nuit finit par ne plus rien coûter.",
      'Outils en acier Bessemer, île encore plus vaste aux derniers âges.',
    ],
  },
  {
    version: '1.3.1',
    title: 'Passage d\'âge rattrapé',
    items: [
      "Les joueurs qui avaient fini l'âge du fer avant la 1.3.0 passent bien à l'Antiquité au chargement.",
    ],
  },
  {
    version: '1.3.0',
    title: 'Deux nouvelles époques',
    items: [
      "L'histoire continue : l'Antiquité (béton romain, moulin à eau, verre soufflé, voies romaines, codex) puis le Moyen Âge (collier d'épaule, assolement triennal, moulin à vent, horloge mécanique, imprimerie) — dix savoirs, dix faits réels, dix ateliers.",
      "L'île grandit encore à chaque époque.",
      'Le temps s\'écoule vraiment téléphone verrouillé : expéditions et récolte avancent pendant toute absence, même courte.',
      'Panneau Nouveautés dans le menu (tu y es).',
    ],
  },
  {
    version: '1.2.0',
    title: 'Le village vivant',
    items: [
      'Chaque savoir pose son atelier dans le village — 21 objets, du billot de taille à la stèle gravée.',
      'Tape un bâtiment : il raconte son histoire.',
      "Les outils du colon suivent la ressource et les âges : épieu, faucille, hache, pic — silex, bronze, fer.",
      "L'expédition part par la mer : radeau, pirogue creusée, puis barque à voile.",
    ],
  },
  {
    version: '1.1.0',
    title: 'Le ciel et la météo',
    items: [
      'Lever et coucher de soleil visibles, lune et étoiles la nuit.',
      'Météo vivante : ciel clair, voilé, couvert, pluie — nuages qui naissent, traversent et se dissolvent.',
      "Vols d'oiseaux qui battent des ailes.",
      "Le temps hors application est enfin crédité au retour, même sans recharger la page.",
    ],
  },
  {
    version: '1.0.0',
    title: 'Tribu',
    items: [
      'Un colon, un feu, et 300 000 ans à traverser : 21 découvertes sur 4 âges, chacune avec un fait historique réel.',
      "Jour et nuit, sommeil, expéditions, barque marchande dès l'âge du bronze, île unique par joueur qui grandit avec les âges.",
    ],
  },
]
