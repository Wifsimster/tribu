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
