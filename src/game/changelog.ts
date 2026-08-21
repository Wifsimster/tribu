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
    version: '3.16.2',
    title: 'Les buissons aussi',
    items: [
      "Dernier étage du ménage : les buissons sont moins nombreux, un peu plus bas, et laissent le cœur de la clairière au village. Ils la bordent de plus près que les rochers — ce sont aussi tes nœuds de nourriture, les éloigner allongerait les trajets du colon.",
    ],
  },
  {
    version: '3.16.1',
    title: 'Les rochers reculent aussi',
    items: [
      "Même traitement que la forêt pour les blocs de pierre : un tiers de moins, plus petits, et tenus à distance de la clairière du village. Les plus gros atteignaient la taille d'une hutte.",
    ],
  },
  {
    version: '3.16.0',
    title: 'Le cheval, la mouette, et de l’air',
    items: [
      "Les cinq animaux sont détaillés : le cheval bai gagne son encolure, sa crinière en épis, sa liste blanche, sa balzane et ses sabots noirs ; la mouette, une aile en trois segments, une queue en éventail et les rémiges écartées du bout.",
      "La forêt recule à mesure que le village s'étale : la clairière s'élargit avec l'île, et les plus hauts sapins ne dépassent plus les toits.",
      "Sur grand écran, les messages se rangent en bas à droite au lieu de barrer le milieu de la scène, et le cadran d'horizon s'aligne sur la ligne du bouton de menu.",
    ],
  },
  {
    version: '3.15.0',
    title: 'La poule, et deux choses qui s’enfonçaient',
    items: [
      "Troisième animal détaillé : la poule gagne sa crête dentelée, son barbillon, des ailes plaquées, une queue à rectrices, un dos plus chaud, des yeux et trois doigts au sol.",
      "Les bêtes ne s'enfoncent plus dans le sol la nuit : elles se tassaient toutes de la même hauteur, ce qui est un rien sous un cheval et le quart d'un mouton — le troupeau disparaissait sous l'herbe.",
      "Les bâtiments ne débordent plus du bord de l'île : le terrain sait enfin répondre « ici, c'est de l'eau ».",
    ],
  },
  {
    version: '3.14.0',
    title: 'Le mouton de plus près',
    items: [
      "Deuxième animal détaillé : la toison du mouton déborde en flocons au lieu d'être un galet lisse, avec un dessous plus gris, une tête et des pattes noires, des oreilles tombantes, un toupet de laine et une petite queue.",
    ],
  },
  {
    version: '3.13.0',
    title: 'Le chevreuil de plus près',
    items: [
      "Premier animal détaillé : le chevreuil gagne sa selle dorsale sombre, son ventre crème, le miroir blanc de sa croupe, un masque de museau, de grandes oreilles doublées de clair, des yeux et des sabots.",
    ],
  },
  {
    version: '3.12.1',
    title: 'Le ponton touche la plage',
    items: [
      "Le ponton flottait à quelques pas du rivage depuis le passage aux tuiles hexagonales. Son tablier part désormais du sable, avec une petite rampe qui descend au niveau de l'eau.",
    ],
  },
  {
    version: '3.12.0',
    title: 'Le bruit du travail',
    items: [
      "Le colon s'entend travailler : la hache mord le tronc, le pic éclate la pierre, les mains froissent le buisson, l'épieu frappe — et la ligne plouffe quand il pêche.",
      "Un son par COUP, calé sur son geste : rien pendant qu'il marche, rien pendant qu'il dort. Et la hauteur change à chaque impact, pour qu'une série de coups sonne comme un bras et non comme une machine.",
      "Avant l'agriculture, c'est la chasse qu'on entend ; après, la cueillette.",
    ],
  },
  {
    version: '3.11.0',
    title: 'La famille se ressemble',
    items: [
      "La cueilleuse et l'enfant sont redessinés dans la langue du colon : même tunique en cylindre tronqué, même col de fourrure crème, même peau, mêmes membres. Ils appartenaient visiblement à un autre jeu.",
      "L'enfant n'est plus la cueilleuse rétrécie et teintée en bleu — peau comprise. Il a ses propres proportions d'enfant : tête au quart de la hauteur, tunique courte, membres ramassés, et deux couettes.",
    ],
  },
  {
    version: '3.10.0',
    title: 'L’île sonne pour de vrai',
    items: [
      "Onze sons remplacent le synthétiseur : le ressac, le feu, la pluie, les grillons, le chœur de l'aube, le bourdon du réverbère — et les quatre gestes du jeu, le toc du bois, le carillon d'une découverte, le tintement des pièces, le plouf de la ligne.",
      "Le pilotage, lui, ne change pas : le ressac enfle avec la nuit, le feu se tait quand le lampadaire s'allume. C'est ce mouvement qui fait vivre l'île, pas les fichiers.",
      "Rien n'est téléchargé tant que le son est coupé, et si un fichier manque, la synthèse d'origine reprend la main sans un hoquet.",
    ],
  },
  {
    version: '3.9.0',
    title: 'De vrais sons',
    items: [
      "Quatre prises de son réelles rejoignent l'ambiance : le chœur de l'aube, les grillons de la nuit, la pluie sur les feuilles, et une vraie cloche — celle de Notre-Dame de Paris, enregistrée en 2011.",
      "Le reste demeure synthétisé, et c'est voulu : le ressac enfle avec la nuit, le feu suit le foyer, la lampe bourdonne. Un échantillon ne sait pas faire ça.",
      "Rien n'est téléchargé tant que tu n'as pas activé le son : l'application reste aussi légère à installer qu'avant.",
    ],
  },
  {
    version: '3.8.0',
    title: 'L’île passe aux hexagones',
    items: [
      "Le sol change de forme : les terrasses carrées deviennent des tuiles hexagonales. La côte se découpe en dents plus franches, les paliers se lisent mieux, et l'île ressemble enfin à la maquette qu'elle voulait être.",
      "Le son se tait quand tu quittes l'application : l'ambiance continuait de jouer navigateur réduit. Elle reprend exactement où elle en était au retour.",
    ],
  },
  {
    version: '3.7.0',
    title: 'Le pré et la basse-cour',
    items: [
      "Les quartiers de la faune se voient : une clôture de piquets ceint le pré des moutons — ouverte côté village, c'est une barrière, pas une cage — et une cabane à poules avec sa planche d'envol se dresse près du foyer.",
      'Les lieux apparaissent avec leurs bêtes : pas de clôture avant le troupeau.',
    ],
  },
  {
    version: '3.6.0',
    title: 'Chacun chez soi',
    items: [
      "La faune tient enfin ses quartiers : les chevreuils en lisière de forêt, les moutons en pleine plaine dégagée, les poules à quelques pas du foyer, les chevaux dans les grands prés du bout de l'île.",
      "Les habitats existaient, mais dès que l'île était petite le jeu ne trouvait pas de terrain idéal et lâchait les bêtes n'importe où. Chaque parcelle est maintenant notée et chaque espèce prend les meilleures : il y a toujours une zone cohérente, même au premier jour.",
    ],
  },
  {
    version: '3.5.0',
    title: 'Le lagon',
    items: [
      "Une vraie ceinture de haut-fond turquoise épouse la côte : l'île n'est plus posée sur du bleu uni, elle a sa plage sous l'eau.",
      'La pinède respire — un tiers de sapins en moins et des bosquets plus lâches. On voit enfin le sol, les clairières et le village qui disparaissait derrière sa propre forêt.',
      'Un ponton de planches pousse sur l’eau depuis la plage, pieux et caisse oubliée compris.',
    ],
  },
  {
    version: '3.4.0',
    title: 'Un monde plus franc',
    items: [
      "Nouvelle palette : herbe vive, mer cobalt, hauts-fonds turquoise — et l'ardoise bleue sur les toits des époques tardives. Le monde est peint plus franchement, sans perdre la lecture de sa silhouette.",
      "Les îles du voisinage se rapprochent et grossissent : elles s'accrochaient au bord haut de l'écran, larges de cinquante pixels. Deux voisins tiennent maintenant dans le cadre d'un téléphone, cinq sur un écran large.",
      "« Comment jouer » racontait le jeu de la version 2.3 : saisons, pêche, Merveilles, hauts faits, Chronique, voisinage, comptoir, transfert et Exode y sont enfin.",
    ],
  },
  {
    version: '3.3.0',
    title: 'Le comptoir des tribus',
    items: [
      "Un vrai troc entre joueurs : dépose une offre — tant de bois contre tant de pierre — et la marchandise attend preneur au comptoir. Une autre tribu l'accepte, chacun repart avec ce qui lui manquait.",
      "Rien ne se crée : ce que tu déposes quitte le camp sur-le-champ, et te revient si tu retires ton dépôt. Trois offres ouvertes au maximum.",
      "On n'échange qu'entre époques voisines. Un surplus de fin de partie n'a rien à faire dans le camp d'un débutant — sa courbe lui appartient.",
    ],
  },
  {
    version: '3.2.0',
    title: 'Le présent',
    items: [
      "Une relique de ton musée peut partir chez une autre tribu : choisis la pièce, choisis l'île, elle traverse la mer. Chez eux, elle entre au musée avec le nom de qui l'a offerte.",
      "Un présent qui ne coûte rien n'en est pas un : la pièce quitte vraiment tes vitrines. Elle redevient trouvable en expédition — et le geste, lui, reste écrit dans la Chronique des deux tribus.",
    ],
  },
  {
    version: '3.1.0',
    title: 'En visite chez le voisin',
    items: [
      "Les îles du voisinage deviennent des destinations : avec la barque à voile, le colon peut mettre le cap sur l'île d'une autre tribu. Il en revient chargé, et souvent avec une pièce de LEUR musée.",
      "Et eux le sauront : à leur retour, leur Chronique dira qu'une barque étrangère a accosté. La visite se raconte des deux côtés.",
      "Le courrier des autres tribus se relève tout seul, et attend patiemment que tu reviennes.",
    ],
  },
  {
    version: '3.0.1',
    title: 'Le menu tient dans l’écran',
    items: [
      "Le menu s'était allongé au fil des versions et débordait sous les barres du navigateur sur téléphone : le pied de la carte devenait inatteignable. Les entrées secondaires passent en deux colonnes, la carte respecte les zones sûres et défile si jamais elle grandit encore.",
    ],
  },
  {
    version: '3.0.0',
    title: 'Le voisinage',
    items: [
      "Les silhouettes de l'horizon ne sont plus des décors : ce sont d'autres tribus. Leur île montre leur époque — tipis, hameau de torchis, ville à clocher — et la flèche de leur Merveille quand elles en ont bâti une. Le soir, leurs feux s'allument au loin.",
      "Tu peux regarder sans y paraître. « Le voisinage » dans le menu publie, si tu le choisis, un pseudo et quelques compteurs — époque, jour, savoirs. Jamais ta sauvegarde, jamais ta Chronique, et quitter efface vraiment.",
      "Serveur injoignable, avion activé, hors-ligne : le jeu est exactement le même, avec le dernier horizon connu.",
    ],
  },
  {
    version: '2.12.0',
    title: 'Transférer sa tribu',
    items: [
      "Ta partie ne dépend plus d'un seul navigateur : « Transférer ma tribu » dans le menu télécharge toute la sauvegarde — île, savoirs, reliques, Chronique, constellation — dans un fichier, ou la copie en un code.",
      "Sur un autre appareil, ouvre le fichier ou colle le code : la tribu reprend exactement où elle en était. Tout reste local, aucun serveur ne voit la partie.",
      'La partie remplacée est mise de côté en secours, et un code tronqué à la copie est refusé plutôt que chargé à moitié.',
    ],
  },
  {
    version: '2.11.0',
    title: 'Les hauts faits',
    items: [
      "Douze jalons à accomplir — de l'étincelle de la première découverte aux trois étoiles de la constellation. Panneau dans le menu, étoile dorée à chaque accomplissement, et chaque haut fait s'écrit dans la Chronique.",
    ],
  },
  {
    version: '2.10.0',
    title: 'Le comptoir de l’îlot',
    items: [
      "Réponds enfin aux feux d'en face : avec la voile, une ambassade (provisions doublées, une seule fois) fonde un comptoir sur l'îlot voisin — cabane, ponton et mât apparaissent sur la silhouette lointaine.",
      'Leur barque fait ensuite la navette et apporte un tribut périodique — regarde-la venir.',
    ],
  },
  {
    version: '2.9.0',
    title: 'La Merveille de l’âge',
    items: [
      "Chaque époque propose sa grande œuvre — menhirs, ziggourat, phare, cathédrale, tour de fer, fusée… Lance le chantier depuis la feuille de savoir : il boit lentement tes surplus, et l'ouvrage monte sous tes yeux, étape par étape, échafaudages compris.",
      'Chaque Merveille achevée raconte son histoire vraie et inspire la tribu : +4 % de récolte, cumulés, sur cette île.',
      "C'est enfin un emploi pour les millions qui dormaient dans le grenier.",
    ],
  },
  {
    version: '2.8.0',
    title: 'La tribu s’agrandit',
    items: [
      'Le colon n’est plus seul : une cueilleuse flâne de bâtiment en bâtiment dès le Néolithique, un enfant court dans le village dès l’Antiquité.',
      'Ils vivent leur vie — et rentrent dormir au camp à la nuit tombée.',
    ],
  },
  {
    version: '2.7.0',
    title: 'Les saisons',
    items: [
      "L'île vit une année entière en 48 minutes : printemps tendre, été doré, automne roux, hiver givré — le feuillage, les buissons et la lumière suivent.",
      "En hiver la pluie devient neige, et la récolte de nourriture souffre (le grenier l'amortit). L'été, elle abonde.",
      'Chaque saison arrive avec son histoire vraie : l’année de la confusion de César, Stonehenge, vendémiaire, le Grand Hyver de 1709.',
    ],
  },
  {
    version: '2.6.0',
    title: 'Nous ne sommes pas seuls',
    items: [
      "Le monde est habité : des voiles inconnues passent parfois à l'horizon, des feux s'allument la nuit sur la côte lointaine, une fumée monte de l'îlot voisin.",
      'Trois signes de vie minuscules — le journal de bord le disait déjà.',
    ],
  },
  {
    version: '2.5.0',
    title: 'Ça mord',
    items: [
      "Tape l'eau près du rivage : le colon part pêcher — au harpon d'abord, à la canne dès le cordage. Sa récolte de nourriture continue, avec des prises bonus quand ça mord.",
      'La baie vit : des poissons sautent près des côtes, et se pressent autour du pêcheur.',
      'Un plop discret à chaque saut, si le son est activé.',
    ],
  },
  {
    version: '2.4.0',
    title: 'La Chronique',
    items: [
      "La tribu tient registre : chaque découverte, chaque passage d'âge, chaque expédition, chaque relique, chaque humeur du monde s'écrit dans la Chronique — datée en jours de jeu, dans le menu.",
      "La Chronique survit aux Exodes : monde après monde, c'est la même saga qui continue, sectionnée par bandeaux Monde I, II, III…",
      'Les parties déjà avancées ouvrent leur registre en cours de route.',
    ],
  },
  {
    version: '2.3.1',
    title: 'Petit correctif de cap',
    items: [
      "Le choix de destination se referme bien une fois l'expédition lancée — il restait affiché à l'écran pendant tout le voyage.",
    ],
  },
  {
    version: '2.3.0',
    title: 'La mer se mérite',
    items: [
      "La flotte ouvre la mer : la côte lointaine exige la pirogue, le grand large la barque à voile — le radeau n'ira pas si loin. Les destinations hors de portée restent visibles, éteintes.",
      'Un bateau au-dessus du minimum requis affronte mieux la mer : le risque de revers diminue avec chaque palier de flotte.',
      "Le tap a une voix : toc de bois sur les ressources, carillon des découvertes, du musée et de l'épave, tintement de pièces au marchandage (si le son est activé).",
    ],
  },
  {
    version: '2.2.0',
    title: 'Tribu dans la poche',
    items: [
      "Tribu est une vraie app : installe-la depuis le navigateur (« Ajouter à l'écran d'accueil ») — elle a son icône, se lance plein écran et fonctionne hors-ligne.",
      "Notifications optionnelles dans le menu : sois prévenu du retour d'expédition quand le jeu est en arrière-plan. Rien n'est envoyé nulle part — tout reste sur ton appareil.",
    ],
  },
  {
    version: '2.1.0',
    title: "L'île a une voix",
    items: [
      "Une ambiance sonore, entièrement synthétisée : le ressac respire, le feu crépite (le brasero aussi, le lampadaire bourdonne), les oiseaux pépient le jour, les grillons stridulent la nuit, la pluie chuinte quand elle tombe.",
      "Dès l'horloge mécanique, la cloche du campanile sonne l'aube et le crépuscule.",
      'Le son est coupé par défaut — active-le dans le menu, la préférence est retenue.',
    ],
  },
  {
    version: '2.0.0',
    title: "L'Exode",
    items: [
      "Le jeu a désormais une fin — et une suite. Les 51 savoirs réunis, l'Exode s'ouvre dans le menu : la tribu embarque vers une île inconnue, nouveau monde, savoirs remis à zéro.",
      "Elle emporte son musée, et gagne une étoile à sa constellation : récolte +8 % par Exode, pour toujours.",
      'La constellation brille dans le menu — chaque étoile est un monde traversé.',
    ],
  },
  {
    version: '1.11.0',
    title: 'Le monde a ses humeurs',
    items: [
      "Des événements rares (toutes les 6 à 13 minutes, en jouant) : une épave s'échoue sur la rive — tape-la pour son histoire —, un troupeau traverse l'île au galop, une éclipse assombrit le plein jour, une aurore ondule certaines nuits, un grand marchand passe avec des échanges légendaires.",
      'Chaque événement raconte un fait vrai : le droit de bris, Pincevent, Thalès et l’éclipse de −585, l’événement de Carrington, les routes de la soie.',
      'Les messages du soir suivent l’époque : feu de camp, brasero, réverbères à gaz, lampadaire électrique.',
    ],
  },
  {
    version: '1.10.0',
    title: 'Cap au large',
    items: [
      "L'expédition a désormais un cap : l'îlot voisin (court et sûr), la côte lointaine (équilibrée) ou le grand large (long, risqué, généreux) — et les destinations se voient à l'horizon.",
      "Au retour, le colon tient un journal de bord : ce qu'il a vu, ce qui a mal tourné.",
      "Il rapporte parfois une relique — figurine d'ivoire, disque de Nebra, mécanisme d'Anticythère… Chacune est un vrai objet de l'archéologie, exposé au musée du village. Tape le musée pour lire leurs histoires.",
    ],
  },
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
