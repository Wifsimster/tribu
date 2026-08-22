import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshToonMaterial,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import './style.css'
import { Game } from './game/sim'
import { SAVE_KEY } from './game/state'
import { decodeSave, encodeSave, transferFilename } from './game/transfer'
import {
  acceptOffer,
  announceVisit,
  cacheNeighbors,
  cachedNeighbors,
  drainInbox,
  fetchNeighbors,
  makeIdentity,
  suggestName,
  leave,
  publish,
  fetchOffers,
  postOffer,
  publishBeacon,
  sendGift,
  withdrawOffer,
  type Offer,
  type Neighbor,
  type Snapshot,
} from './net/neighbors'
import { CHANGELOG } from './game/changelog'
import { FEATS, WONDER_BY_AGE } from './game/content'
import { Ambience } from './audio/ambience'
import { Villagers } from './render/villagers'
import type { ResourceId } from './game/content'
import { DAY_SECONDS, DAY_START } from './game/content'
import { Stage } from './render/scene'
import { Island, growthForAge } from './render/island'
import { Village } from './render/village'
import { Settler } from './render/settler'
import { Fauna } from './render/fauna'
import { Caravan } from './render/caravan'
import { ExpeditionBoat } from './render/expedition-boat'
import { attachControls } from './render/controls'
import { Hud, escapeHtml, fmt } from './ui/hud'
import { AGES, RELIC_BY_ID, RESOURCES, TECHS, YULE_STORY, yuleState } from './game/content'

/** Le seul endroit du jeu où le calendrier RÉEL entre : la semaine de Noël.
 *  Lu une fois au chargement — une partie ne dure pas d'un jour à l'autre. */
const yule = yuleState()

const canvas = document.getElementById('scene') as HTMLCanvasElement
const stage = new Stage(canvas)

// Le jeu d'abord : l'île de chaque joueur pousse sur le seed de sa sauvegarde,
// et GRANDIT avec les âges — la tribu gagne du terrain sur la mer.
const game = new Game(Date.now())
const caravan = new Caravan()
const boat = new ExpeditionBoat()
/** Séquence d'embarquement : marche → embarque → large → (voyage) → accoste → marche. */
let expPhase: 'none' | 'walking' | 'sailed' = 'none'

let island!: Island
let village!: Village
let settler!: Settler
let fauna!: Fauna
let villagers!: Villagers
const nodeSpots = new Map<string, Vector3[]>()

function disposeWorld(): void {
  if (villagers) {
    stage.scene.remove(villagers.group)
    villagers.group.traverse((o) => {
      const m = o as { geometry?: { dispose(): void }; material?: { dispose(): void } }
      m.geometry?.dispose()
      m.material?.dispose()
    })
  }
  for (const g of [island?.group, village?.group, settler?.group, fauna?.group]) {
    if (!g) continue
    stage.scene.remove(g)
    g.traverse((o) => {
      const mesh = o as { geometry?: { dispose(): void }; material?: { dispose(): void } }
      mesh.geometry?.dispose()
      mesh.material?.dispose()
    })
  }
}

// Le voisinage, connu dès le lancement grâce au cache local : l'horizon est
// peuplé avant même la première réponse du serveur — et le reste hors ligne.
// Déclaré AVANT buildWorld, qui le repose sur chaque île reconstruite.
let neighbors: Neighbor[] = cachedNeighbors()
// Déclaré ICI, et pas près de la boucle de synchro : le bloc du menu s'exécute
// AVANT elle et s'y abonne — un `let` plus bas serait dans sa zone morte.
let onNeighborsChange: (() => void) | null = null
// Le choix de destination doit connaître les voisins DÈS le premier menu,
// même hors ligne : le cache d'hier fait l'affaire.
game.visitable = neighbors.map((n) => ({ id: n.id, name: n.name, age: n.age, relics: n.relics }))

// La pêche : un état de surface — le colon récolte SA nourriture, mais au
// rivage, avec la baie qui vit autour de lui. Déclarée AVANT buildWorld qui
// la remet à zéro à chaque reconstruction du monde.
let fishing = false
let catchTimer = 12
let firstCatch = true

/** (Re)construit l'île à la taille de l'âge courant. Appelé au chargement et à
 *  chaque passage d'âge : le monde s'agrandit sous la bannière. */
function buildWorld(): void {
  disposeWorld()
  island = new Island(game.save.seed, growthForAge(game.save.age), game.save.age)
  // Le centre du village suit l'époque : tipis puis maison, feu ouvert puis
  // brasero, lampadaire dès que l'électricité est sue.
  village = new Village(island, game.save.age, game.knows('electricity'), yule !== 'none')
  // Le plan sauvegardé d'abord : ce qui est bâti ne se redéplace pas.
  // Plan d'une version antérieure : il est retracé selon les règles du jour.
  village.adoptLayout(game.save.layoutV === 2 ? game.save.layout : [])
  game.save.layoutV = 2
  settler = new Settler(island)
  // La faune se reconstruit avec l'île : ses habitats dépendent des arbres et
  // du rivage de CETTE île-là.
  fauna = new Fauna(island, village.obstaclePoints)
  fauna.onFishJump = () => ambience.plop()
  // Le son du travail suit le GESTE : un coup porté, un son. À la pêche,
  // c'est la ligne qui tombe ; la chasse remplace la cueillette tant que la
  // tribu n'a pas l'agriculture.
  settler.onStrike = () => {
    if (fishing) return ambience.plop()
    const res = game.save.focus
    if (res === 'wood') return ambience.work('bois')
    if (res === 'food') return ambience.work(game.knows('farming') ? 'cueillette' : 'chasse')
    return ambience.work('pierre')
  }
  fishing = false
  villagers = new Villagers(island, village.obstaclePoints)
  // La tribu s'étoffe avec les âges : une cueilleuse au Néolithique, un
  // enfant à l'Antiquité. Le colon n'est plus seul.
  villagers.setPopulation(game.save.age >= 4 ? 2 : game.save.age >= 1 ? 1 : 0)
  stage.scene.add(island.group, village.group, settler.group, fauna.group, villagers.group)
  stage.islandRadius = island.radius
  island.setSeason(game.season.id, game.seasonU)
  stage.winter = game.season.id === 3
  {
    // La Merveille d'abord : elle réserve sa place au cœur de la clairière
    // AVANT que les ateliers ne prennent les meilleurs emplacements.
    const stageOf = (v: number): number => (v >= 0.75 ? 3 : v >= 0.5 ? 2 : v >= 0.25 ? 1 : 0)
    const cur = game.save.wonder
    if (cur) {
      const ws = game.wonderState()
      village.setWonder(cur.age, ws ? stageOf(ws.progress) : 0)
    } else if (game.save.wonders.length > 0) {
      village.setWonder(game.save.wonders[game.save.wonders.length - 1]!, 4)
    }
  }
  village.sync(game.buildings)
  // …et le plan repart dans la sauvegarde, complété des nouveaux venus.
  game.save.layout = village.layout
  village.setRelics(game.save.relics.length)
  island.setOutpost(game.save.outpost)
  island.setNeighbors(neighbors)
  // La barque mouille au bout du ponton : la flotte se voit sans partir.
  boat.setTier(game.boatTier)
  boat.moorAt(village.jettyEnd)
  if (game.save.expedition) settler.departExpedition(game.knows('cordage'))

  nodeSpots.clear()
  for (const mesh of island.pickables) {
    const kind = island.kindFor(mesh)
    if (!kind) continue
    const spots: Vector3[] = []
    // Les arbres abattus par la voie romaine ne sont plus des nœuds de bois :
    // le colon irait bûcheronner une souche invisible.
    for (let i = 0; i < mesh.count; i++) {
      if (island.isFelled(mesh, i)) continue
      spots.push(island.instancePosition(mesh, i))
    }
    nodeSpots.set(kind, spots)
  }
}

buildWorld()
stage.scene.add(caravan.group, boat.group)
stage.sun.target.position.set(0, 0, 0)
stage.applyAge(game.save.age)
// Barque déjà à quai dans la sauvegarde : elle reprend sa place sans naviguer.
if (game.save.caravan.visiting) caravan.arrive()

function spotFor(resource: ResourceId): Vector3 {
  const key = resource === 'food' ? 'food' : resource === 'wood' ? 'wood' : 'stone'
  const spots = nodeSpots.get(key)
  if (!spots || spots.length === 0) return new Vector3(4, 0, 4)
  // Prefer somewhere close to the fire so the walk cycle stays readable.
  return spots.reduce((best, s) =>
    s.lengthSq() < best.lengthSq() * 1.6 && Math.random() < 0.4 ? s : best,
  )
}

const hud = new Hud(game)

// L'ambiance sonore : coupée par défaut, activée au menu, reprise au premier
// geste si la préférence est déjà « on » (l'audio exige un geste utilisateur).
const ambience = new Ambience()

// PWA : le service worker rend le jeu installable et jouable hors-ligne.
if (import.meta.env.PROD && 'serviceWorker' in navigator)
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'))

// Notifications locales, strictement opt-in : prévenir du retour d'expédition
// quand l'application est en arrière-plan. Pas de serveur, pas de push.
const NOTIF_KEY = 'tribu.notif.v1'
let notifOn = false
try {
  notifOn = localStorage.getItem(NOTIF_KEY) === 'on' && Notification.permission === 'granted'
} catch {
  /* stockage ou API absents : les notifications resteront coupées */
}
function notify(body: string): void {
  if (!notifOn || !document.hidden || Notification.permission !== 'granted') return
  try {
    new Notification('Tribu', { body, icon: '/icon-192.png' })
  } catch {
    /* certains navigateurs exigent un service worker : tant pis, le toast suffira */
  }
}
document.addEventListener('pointerdown', () => ambience.resumeIfOn(), { once: true })

// Chaque objet posé remonte à sa découverte : taper un bâtiment rouvre son
// fait historique.
const techOfBuilding = new Map<string, (typeof TECHS)[number]>()
for (const t of TECHS)
  for (const e of t.effects) if (e.kind === 'building') techOfBuilding.set(e.building, t)

game.on((e) => {
  switch (e.type) {
    case 'tech':
      ambience.chime()
      hud.showFact(e.tech)
      if (game.treeComplete)
        hud.toast("Les 51 savoirs sont réunis — l'Exode attend dans le menu")
      // L'électricité transforme le cœur du village (lampadaire à la place du
      // feu) : on reconstruit le monde comme à un passage d'âge.
      if (e.tech.id === 'electricity') buildWorld()
      else {
        village.sync(game.buildings)
        // Le nouvel atelier prend sa place DÉFINITIVE : elle part dans la
        // sauvegarde tout de suite, sinon elle serait retirée au sort au
        // prochain chargement.
        game.save.layout = village.layout
      }
      hud.refreshTechList()
      settler.celebrate()
      break
    case 'age':
      stage.applyAge(e.age.id)
      hud.showBanner('Nouvel âge', e.age.name)
      hud.refreshTechList()
      // La tribu gagne du terrain : l'île est reconstruite plus grande, les
      // bâtiments repoussent avec leur animation de pose.
      buildWorld()
      break
    case 'expeditionStart':
      fishing = false
      fauna.setFishing(null)
      settler.departExpedition(game.knows('cordage'))
      boat.setTier(game.boatTier)
      expPhase = 'walking'
      hud.toast(
        game.knows('automobile')
          ? 'Le colon démarre le hors-bord — le camp attendra son retour'
          : game.knows('steamengine')
            ? 'Le vapeur souffle et quitte le quai — le camp attendra son retour'
            : game.knows('caravel')
              ? 'La caravelle prend le vent — le camp attendra son retour'
              : game.knows('sail')
          ? 'Le colon hisse la voile — le camp attendra son retour'
          : game.knows('polished_axe')
            ? 'Le colon pousse sa pirogue à l\'eau — le camp attendra son retour'
            : 'Le colon pousse son radeau à l\'eau — le camp attendra son retour',
      )
      break
    case 'expeditionEnd': {
      const parts = Object.entries(e.loot)
        .filter(([, n]) => (n as number) > 0)
        .map(([id, n]) => `${RESOURCES[id as ResourceId].icon}\u202F${fmt(n as number)}`)
        .join('  ')
      boat.sailIn(settler.shorePoint)
      notify('Le colon est rentré d’expédition — le butin est au camp')
      hud.toast(`De retour · ${parts}`)
      hud.toast(`Journal de bord · ${e.journal}`)
      if (e.relic) {
        // La relique passe du sac du colon aux vitrines : le musée pousse (ou
        // s'agrandit) sous les yeux du joueur.
        village.setRelics(game.save.relics.length)
  {
    // La Merveille : le chantier en cours, sinon la dernière achevée.
    const stageOf = (v: number): number => (v >= 0.75 ? 3 : v >= 0.5 ? 2 : v >= 0.25 ? 1 : 0)
    const cur = game.save.wonder
    if (cur) {
      const ws = game.wonderState()
      village.setWonder(cur.age, ws ? stageOf(ws.progress) : 0)
    } else if (game.save.wonders.length > 0) {
      village.setWonder(game.save.wonders[game.save.wonders.length - 1]!, 4)
    }
  }
        const name = e.relic.name.charAt(0).toLowerCase() + e.relic.name.slice(1)
        hud.toast(`Il rapporte ${name} — exposée au musée du village`)
      } else if (e.find) hud.toast(`Il rapporte ${e.find}`)
      break
    }
    case 'encourage':
      hud.toast('Le colon redouble d’ardeur')
      break
    case 'offline': {
      const mins = Math.round(e.seconds / 60)
      hud.toast(`Pendant ton absence (${mins} min), la tribu a continué`)
      break
    }
    case 'caravanArrive':
      caravan.arrive()
      hud.toast(`Une barque marchande ${e.merchant} accoste`)
      break
    case 'caravanTrade': {
      hud.toast(
        `Troc : ${RESOURCES[e.gave.res].icon}\u202F${fmt(e.gave.amount)} contre ` +
          `${RESOURCES[e.got.res].icon}\u202F${fmt(e.got.amount)} + ✨\u202F${e.insight}`,
      )
      if (e.tale) hud.toast(`Le marchand raconte : ${e.tale}`)
      break
    }
    case 'caravanLeave':
      caravan.depart()
      break
    case 'exodus':
      stage.applyAge(0)
      buildWorld()
      boat.setTier(0)
      caravan.depart()
      hud.refreshTechList()
      hud.showBanner("L'Exode", `${e.legacy} étoile${e.legacy > 1 ? 's' : ''} à la constellation`)
      hud.toast(
        `La tribu débarque sur une île inconnue. Sa constellation brille : récolte +${e.legacy * 8} % — pour toujours.`,
      )
      break
    case 'worldEvent':
      switch (e.kind) {
        case 'wreck':
          spawnWreck(e.fact)
          hud.toast(
            `Une épave s’est échouée sur la rive — la tribu récupère bois ${fmt(e.loot?.wood ?? 0)} et savoir ${fmt(e.loot?.insight ?? 0)}. Tape-la pour son histoire.`,
          )
          break
        case 'migration':
          fauna.stampede(Math.random() * Math.PI * 2)
          hud.toast('Un troupeau traverse l’île au galop — regarde-les passer')
          hud.toast(e.fact)
          break
        case 'eclipse':
          eclipseLeft = ECLIPSE_DUR
          hud.toast('Le ciel s’assombrit en plein jour — une éclipse')
          hud.toast(e.fact)
          break
        case 'aurora':
          stage.aurora(46)
          hud.toast('Une aurore ondule dans la nuit')
          hud.toast(e.fact)
          break
        case 'merchant':
          hud.toast('Un grand marchand approche — ses échanges sont légendaires')
          hud.toast(e.fact)
          break
      }
      break
    case 'feat':
      ambience.chime()
      hud.toast(`Haut fait accompli : ${e.name}`)
      break
    case 'outpostFounded':
      island.setOutpost(true)
      ambience.chime()
      break
    // Le colon a débarqué chez un voisin : on le leur fait savoir. Si le
    // réseau est absent, tant pis — la visite a quand même eu lieu chez nous.
    case 'visitDone': {
      const t = game.save.tribe
      if (t) void announceVisit(t.id, t.secret, e.neighborId)
      break
    }
    // Le courrier des autres tribus, relevé à la synchro.
    case 'mail': {
      hud.toast(e.text)
      notify(e.text)
      if (e.relic) village.setRelics(game.save.relics.length)
      break
    }
    case 'outpostTribute': {
      stage.outpostRun()
      const parts = Object.entries(e.loot)
        .filter(([, n]) => (n as number) > 0)
        .map(([id, n]) => `${RESOURCES[id as ResourceId].icon}\u202F${fmt(n as number)}`)
        .join('  ')
      hud.toast(`La barque du comptoir apporte son tribut · ${parts}`)
      break
    }
    case 'wonderStage': {
      village.setWonder(e.def.age, e.stage)
      hud.refreshTechList()
      hud.toast(
        e.stage === 0
          ? `Le chantier de ${e.def.name.toLowerCase()} commence — les surplus y seront versés`
          : e.stage === 1
            ? 'Les fondations de la Merveille sortent de terre'
            : e.stage === 2
              ? 'La Merveille atteint la moitié de sa hauteur'
              : 'La Merveille approche de son couronnement',
      )
      break
    }
    case 'wonderDone':
      village.setWonder(e.def.age, 4)
      ambience.chime()
      hud.refreshTechList()
      hud.showStory('La Merveille', e.def.name, e.def.fact)
      hud.toast('La tribu, inspirée, récolte 4 % plus vite — pour toujours sur cette île')
      break
    case 'season':
      island.setSeason(e.id, game.seasonU)
      stage.winter = e.id === 3
      hud.toast(`${e.name} s'installe${e.id === 3 && !game.knows('granary') ? ' — sans grenier, la récolte souffrira' : ''}`)
      hud.toast(e.fact)
      break
    case 'nightfall':
      if (game.knows('clock')) ambience.bell()
      // Le même crépuscule ne se raconte pas pareil selon les siècles.
      hud.toast(
        game.knows('electricity')
          ? 'La nuit tombe — le lampadaire s’allume, le village ne s’arrête plus'
          : game.knows('gaslight')
            ? 'La nuit tombe — les réverbères à gaz s’allument un à un'
            : game.save.age >= 4
              ? 'La nuit tombe — le brasero rougeoie, le travail ralentit à peine'
              : game.knows('lamp')
                ? 'La nuit tombe — les lampes à graisse veillent, la tribu continue'
                : game.knows('fire')
                  ? 'La nuit tombe — la tribu se serre autour du feu, le travail ralentit'
                  : 'La nuit tombe — sans lumière, la tribu ne fait presque plus rien',
      )
      break
    case 'daybreak':
      if (game.knows('clock')) ambience.bell()
      hud.toast(
        game.save.age >= 6
          ? 'Le jour se lève — la ville s’étire, le travail reprend'
          : game.save.age >= 2
            ? 'Le jour se lève — le village s’éveille, le travail reprend'
            : 'Le jour se lève, la tribu reprend le travail',
      )
      break
  }
})

// ── Événements du monde : épave et éclipse ─────────────────────────────────
const ECLIPSE_DUR = 38
// Le traîneau : il repasse toutes les deux minutes environ, mais seulement la
// nuit et seulement les 24 et 25 décembre. La carte d'explication, elle, ne
// s'ouvre qu'une fois par session — un événement s'explique, il ne se répète
// pas.
let sleighIn = 7
let sleighTold = false
let eclipseLeft = 0
let wreck: Group | null = null
let wreckFact = ''
let wreckTimer = 0

/** Une coque brisée échouée près du point d'accostage : trois membrures, des
 *  bordés éclatés, un bout de mât. Un seul mesh, retiré au bout de 4 minutes. */
function spawnWreck(fact: string): void {
  despawnWreck()
  wreckFact = fact
  const wood = new Color('#6b4f38')
  const dark = new Color('#4a3625')
  const parts: BufferGeometry[] = []
  const put = (g: BufferGeometry, c: Color, x: number, y: number, z: number): void => {
    g.translate(x, y, z)
    const n = g.attributes.position!.count
    const rgb = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      rgb[i * 3] = c.r
      rgb[i * 3 + 1] = c.g
      rgb[i * 3 + 2] = c.b
    }
    g.setAttribute('color', new BufferAttribute(rgb, 3))
    parts.push(g)
  }
  for (let i = 0; i < 3; i++)
    put(new CylinderGeometry(0.05, 0.07, 1.5 - i * 0.2, 5).rotateZ(0.9 + i * 0.25).rotateY(i * 0.5), dark, i * 0.5 - 0.4, 0.3, (i % 2) * 0.3 - 0.1)
  put(new BoxGeometry(1.9, 0.09, 0.34).rotateZ(0.16).rotateY(0.25), wood, 0.1, 0.16, 0.28)
  put(new BoxGeometry(1.5, 0.09, 0.3).rotateZ(-0.1).rotateY(-0.2), wood, -0.3, 0.12, -0.25)
  put(new CylinderGeometry(0.06, 0.08, 1.7, 6).rotateZ(1.35).rotateY(0.6), wood, 0.7, 0.24, -0.4)
  const geo = mergeGeometries(parts)
  if (!geo) return
  const mesh = new Mesh(geo, new MeshToonMaterial({ vertexColors: true }))
  mesh.castShadow = true
  wreck = new Group()
  wreck.add(mesh)
  const sp = settler.shorePoint
  const a = Math.atan2(sp.x, sp.z) + 0.55
  const r = Math.hypot(sp.x, sp.z) + 0.5
  wreck.position.set(Math.sin(a) * r, 0.03, Math.cos(a) * r)
  wreck.rotation.set(0.04, a + 1.1, 0.09)
  stage.scene.add(wreck)
  wreckTimer = 240
}

function despawnWreck(): void {
  if (!wreck) return
  stage.scene.remove(wreck)
  wreck.traverse((o) => {
    const m = o as { geometry?: { dispose(): void }; material?: { dispose(): void } }
    m.geometry?.dispose()
    m.material?.dispose()
  })
  wreck = null
}

// ── Tapping ────────────────────────────────────────────────────────────────
const raycaster = new Raycaster()
const pointer = new Vector2()

attachControls(stage, canvas, (x, y) => {
  pointer.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1)
  raycaster.setFromCamera(pointer, stage.camera)

  if (caravan.group.visible && raycaster.intersectObject(caravan.group, true).length > 0) {
    if (game.haggle()) {
      ambience.coin()
      hud.toast('Tu marchandes : le marchand cédera un meilleur prix')
    }
    else hud.toast('Le marchand te salue de la main')
    return
  }

  if (wreck && raycaster.intersectObject(wreck, true).length > 0) {
    ambience.chime()
    hud.showStory('Sur la rive', 'Les restes d’un navire', wreckFact)
    return
  }

  const onSettler = raycaster.intersectObject(settler.group, true)
  if (onSettler.length > 0) {
    if (settler.isSleeping) {
      hud.toast("Chut — le colon dort jusqu'à l'aube")
      return
    }
    if (game.encourage()) settler.celebrate()
    else hud.toast('Laisse-le souffler un instant')
    return
  }

  const onVillage = raycaster.intersectObject(village.group, true)
  if (onVillage.length > 0) {
    const hp = onVillage[0]!.point
    const id = village.identifyAt(hp.x, hp.z)
    if (id === 'wonder') {
      const ws = game.wonderState()
      const built = game.save.wonders
      const shown = game.save.wonder
        ? ws
        : built.length
          ? { def: WONDER_BY_AGE.get(built[built.length - 1]!)!, status: 'done' as const, progress: 1 }
          : null
      if (shown) {
        ambience.chime()
        if (shown.status === 'done') hud.showStory('La Merveille', shown.def.name, shown.def.fact)
        else
          hud.showStory(
            'Le chantier',
            shown.def.name,
            `L'œuvre est accomplie à ${Math.round(shown.progress * 100)} %. Les surplus de la tribu y sont versés, jour après jour.`,
          )
      }
      return
    }
    if (id === 'museum') {
      ambience.chime()
      hud.showMuseum(game.relics)
      return
    }
    if (id === 'campfire') {
      const fire = TECHS.find((t) => t.id === 'fire')
      if (fire && game.knows('fire')) hud.showFact(fire)
      else hud.toast('Le feu du camp — le cœur de la tribu')
      return
    }
    if (id) {
      const tech = techOfBuilding.get(id)
      if (tech && game.knows(tech.id)) {
        hud.showFact(tech)
        return
      }
    }
  }

  const hits = raycaster.intersectObjects(island.pickables, false)
  const hit = hits[0]
  if (!hit || hit.instanceId === undefined) {
    // Tap sur l'eau proche du rivage : le colon part pêcher. La nourriture
    // continue de couler (c'est sa récolte, en bord de mer) et la baie
    // s'anime — poissons qui sautent, prises bonus.
    const t = -raycaster.ray.origin.y / raycaster.ray.direction.y
    if (t > 0 && !game.save.expedition) {
      const px = raycaster.ray.origin.x + raycaster.ray.direction.x * t
      const pz = raycaster.ray.origin.z + raycaster.ray.direction.z * t
      const r = Math.hypot(px, pz)
      if (r > island.radius * 0.5 && r < island.radius + 10) {
        let bx = 0
        let bz = 0
        let by = 0
        let bestD = Infinity
        for (const c of island.cells) {
          if (!c.beach) continue
          const d = (c.x - px) ** 2 + (c.z - pz) ** 2
          if (d < bestD) {
            bestD = d
            bx = c.x
            bz = c.z
            by = c.height
          }
        }
        if (bestD < Infinity) {
          fishing = true
          ambience.knock()
          game.setFocus('food')
          settler.sendTo(new Vector3(bx, by, bz))
          fauna.setFishing(bx, bz)
          hud.toast('Le colon part pêcher au rivage')
          return
        }
      }
    }
    return
  }
  const kind = island.kindFor(hit.object as InstancedMesh)
  if (!kind) return
  const resource: ResourceId = kind
  if (!game.unlocked.has(resource)) return
  fishing = false
  fauna.setFishing(null)
  ambience.knock()
  game.setFocus(resource)
  settler.sendTo(island.instancePosition(hit.object as InstancedMesh, hit.instanceId))
  hud.toast(`Le colon s’occupe de : ${RESOURCES[resource].name.toLowerCase()}`)
})


// ── Loop ───────────────────────────────────────────────────────────────────
settler.sendTo(spotFor(game.save.focus))

// ?h=0.75 fige l'heure (0 = lever, 0,25 = zénith, 0,5 = coucher, 0,75 = nuit) —
// pour le debug et pour juger l'ambiance à heure fixe.
const hParam = new URLSearchParams(location.search).get('h')
const forcedHour = hParam !== null && !Number.isNaN(Number(hParam)) ? Number(hParam) % 1 : null
let hudNight = false

// ── Menu d'accueil et reset ────────────────────────────────────────────────
// Le monde tourne derrière le menu, mais la simulation est en pause : le temps
// de jeu n'avance pas tant que le joueur n'a pas choisi.
let paused = true

function menuEl<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

{
  const menu = menuEl('menu')
  const home = menuEl('menu-home')
  const confirm = menuEl('menu-confirm')
  const warn = menuEl('menu-warn')
  const eraseLabel = menuEl('menu-erase-label')
  const continueBtn = menuEl<HTMLButtonElement>('menu-continue')
  const newBtn = menuEl('menu-new')
  const exodeBtn = menuEl('menu-exode')
  let confirmStep = 0
  let confirmMode: 'erase' | 'exode' = 'erase'

  const hasProgress = game.save.techs.length > 0 || game.save.totalPlaySeconds > 30

  const tuto = menuEl('menu-tuto')

  // ── Le nom du village ────────────────────────────────────────────────────
  // Il vit dans `save.village`, PAS dans l'identité de voisinage : nommer son
  // village ne doit pas publier la tribu sur le serveur. Quand la tribu est
  // publiée, les deux noms sont tenus égaux.
  const villageBtn = menuEl('village-name')
  const villageEdit = menuEl('village-edit')
  const villageInput = menuEl<HTMLInputElement>('village-input')

  const renderVillageName = (): void => {
    const name = game.save.village || game.save.tribe?.name || ''
    menuEl('village-label').textContent = name || 'Nommer le village'
    villageBtn.classList.toggle('named', !!name)
  }

  const saveVillageName = (): void => {
    const name = villageInput.value.trim().slice(0, 24)
    villageEdit.hidden = true
    villageBtn.hidden = false
    if (!name) return
    game.save.village = name
    // Publié dans le voisinage : les autres voient le même nom.
    const t = game.save.tribe
    if (t) {
      t.name = name
      void syncNeighborhood()
    }
    game.flush(Date.now())
    renderVillageName()
    hud.toast(`Le village s'appelle désormais ${name}`)
  }

  villageBtn.addEventListener('click', () => {
    villageInput.value = game.save.village || game.save.tribe?.name || suggestName(game.save.seed)
    villageBtn.hidden = true
    villageEdit.hidden = false
    villageInput.focus()
    villageInput.select()
  })
  menuEl('village-save').addEventListener('click', saveVillageName)
  villageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveVillageName()
    if (e.key === 'Escape') {
      villageEdit.hidden = true
      villageBtn.hidden = false
    }
  })

  const showHome = () => {
    confirmStep = 0
    villageEdit.hidden = true
    villageBtn.hidden = false
    renderVillageName()
    confirm.hidden = true
    tuto.hidden = true
    menuEl('menu-news').hidden = true
    menuEl('menu-chronicle').hidden = true
    menuEl('menu-feats').hidden = true
    menuEl('menu-transfer').hidden = true
    menuEl('menu-neighbors').hidden = true
    menuEl('menu-market').hidden = true
    home.hidden = false
    continueBtn.hidden = !hasProgress
    ;(newBtn.querySelector('.label') as HTMLElement).textContent = hasProgress
      ? 'Nouvelle partie'
      : 'Commencer'
    // L'Exode n'apparaît que l'arbre complet ; la constellation, dès la première étoile.
    exodeBtn.hidden = !game.treeComplete
    const cons = menuEl('menu-constellation')
    cons.hidden = game.save.legacy === 0
    cons.textContent = `Constellation : ${'★'.repeat(Math.min(8, game.save.legacy))}${game.save.legacy > 8 ? `×${game.save.legacy}` : ''} — récolte +${game.save.legacy * 8} %`
  }

  const open = () => {
    showHome()
    menu.classList.add('open')
    paused = true
  }

  const close = () => {
    menu.classList.remove('open')
    paused = false
  }

  continueBtn.addEventListener('click', close)

  newBtn.addEventListener('click', () => {
    if (!hasProgress) {
      close()
      return
    }
    // Première confirmation.
    confirmMode = 'erase'
    confirmStep = 1
    home.hidden = true
    confirm.hidden = false
    warn.textContent = `Recommencer au Paléolithique ? Ta tribu — ${game.age.name}, ${game.save.techs.length} découvertes — et son île seront effacées.`
    eraseLabel.textContent = 'Effacer ma tribu'
  })

  exodeBtn.addEventListener('click', () => {
    confirmMode = 'exode'
    confirmStep = 1
    home.hidden = true
    confirm.hidden = false
    warn.textContent = `L'Exode : la tribu embarque vers une île inconnue — nouveau monde, savoirs remis à zéro. Elle emporte ses ${game.save.relics.length} reliques et gagne une étoile : récolte +8 % pour toujours.`
    eraseLabel.textContent = 'Embarquer'
  })

  menuEl('menu-cancel').addEventListener('click', showHome)

  menuEl('menu-tuto-open').addEventListener('click', () => {
    home.hidden = true
    tuto.hidden = false
  })
  menuEl('menu-tuto-close').addEventListener('click', showHome)

  const news = menuEl('menu-news')
  {
    const list = menuEl('news-list')
    for (const r of CHANGELOG) {
      const li = document.createElement('li')
      li.innerHTML =
        `<b>v${r.version} — ${r.title}.</b> ` + r.items.map((i) => i).join(' ')
      list.appendChild(li)
    }
  }
  // La Chronique : la saga de la tribu, du plus récent au plus ancien, avec
  // un bandeau par monde traversé.
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']
  menuEl('menu-chronicle-open').addEventListener('click', () => {
    const list = menuEl('chronicle-list')
    list.textContent = ''
    const entries = game.save.chronicle
    if (entries.length === 0) {
      const li = document.createElement('li')
      li.textContent =
        "La chronique s'écrira d'elle-même : chaque découverte, chaque expédition, chaque humeur du monde y laissera une ligne."
      list.appendChild(li)
    }
    let lastWorld = -1
    const manyWorlds = (entries[entries.length - 1]?.w ?? 1) > 1
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]!
      if (manyWorlds && e.w !== lastWorld) {
        lastWorld = e.w
        const head = document.createElement('li')
        head.className = 'chron-world'
        head.textContent = `Monde ${ROMAN[e.w - 1] ?? e.w}`
        list.appendChild(head)
      }
      const li = document.createElement('li')
      li.className = `chron chron-${e.k}`
      li.innerHTML = `<span class="chron-day">Jour ${e.d}</span> ${e.x}`
      list.appendChild(li)
    }
    home.hidden = true
    menuEl('menu-chronicle').hidden = false
  })
  menuEl('menu-chronicle-close').addEventListener('click', showHome)

  menuEl('menu-feats-open').addEventListener('click', () => {
    const list = menuEl('feats-list')
    list.textContent = ''
    for (const f of FEATS) {
      const done = game.save.feats.includes(f.id)
      const li = document.createElement('li')
      li.className = done ? 'feat done' : 'feat'
      li.innerHTML = `<b>${done ? '★' : '☆'} ${f.name}.</b> ${f.desc}`
      list.appendChild(li)
    }
    home.hidden = true
    menuEl('menu-feats').hidden = false
  })
  menuEl('menu-feats-close').addEventListener('click', showHome)

  menuEl('menu-news-open').addEventListener('click', () => {
    home.hidden = true
    news.hidden = false
  })
  menuEl('menu-news-close').addEventListener('click', showHome)

  // Le voisinage : qui d'autre allume un feu à l'horizon. On peut regarder
  // sans y paraître — publier reste un choix explicite.
  {
    const panel = menuEl('menu-neighbors')
    const list = menuEl('neighbors-list')
    const me = menuEl('neighbors-me')
    const nameRow = menuEl('neighbors-name-row')
    const nameInput = menuEl<HTMLInputElement>('neighbors-name')
    const giftRow = menuEl('gift-row')
    const giftWhat = menuEl<HTMLSelectElement>('gift-what')
    const giftWho = menuEl<HTMLSelectElement>('gift-who')
    const joinBtn = menuEl('neighbors-join')
    const leaveBtn = menuEl('neighbors-leave')

    const ago = (t: number): string => {
      const m = Math.max(0, Math.round((Date.now() - t) / 60_000))
      if (m < 2) return "à l'instant"
      if (m < 60) return `il y a ${m} min`
      const h = Math.round(m / 60)
      if (h < 24) return `il y a ${h} h`
      return `il y a ${Math.round(h / 24)} j`
    }

    const render = (): void => {
      list.textContent = ''
      if (neighbors.length === 0) {
        const li = document.createElement('li')
        li.textContent =
          "Personne à l'horizon pour l'instant. Les tribus qui paraissent au voisinage apparaissent ici — et leurs îles s'allument au loin, le soir venu."
        list.appendChild(li)
      }
      for (const n of neighbors) {
        const li = document.createElement('li')
        const stars = n.legacy > 0 ? ` ${'★'.repeat(Math.min(3, n.legacy))}` : ''
        const wonder = n.wonders > 0 ? ` — ${n.wonders} merveille${n.wonders > 1 ? 's' : ''}` : ''
        li.innerHTML =
          `<b>${escapeHtml(n.name)}${stars}</b> ` +
          `${escapeHtml(AGES[Math.min(n.age, AGES.length - 1)]!.name)}, jour ${n.day} — ` +
          `${n.techs} savoir${n.techs > 1 ? 's' : ''}${wonder}<br><span class="chron-day">vue ${ago(n.seen)}</span>`
        list.appendChild(li)
      }
      // Le coin des présents : il faut une identité, des voisins, et quelque
      // chose à donner.
      const canGift = !!game.save.tribe && neighbors.length > 0 && game.save.relics.length > 0
      giftRow.hidden = !canGift
      if (canGift) {
        giftWhat.textContent = ''
        for (const id of game.save.relics) {
          const def = RELIC_BY_ID.get(id)
          if (!def) continue
          const opt = document.createElement('option')
          opt.value = id
          opt.textContent = def.name
          giftWhat.appendChild(opt)
        }
        giftWho.textContent = ''
        for (const n of neighbors) {
          const opt = document.createElement('option')
          opt.value = n.id
          opt.textContent = n.name
          giftWho.appendChild(opt)
        }
      }
      const t = game.save.tribe
      if (t) {
        me.textContent = `Ta tribu paraît à l'horizon des autres sous le nom « ${t.name} ».`
        nameRow.hidden = false
        nameInput.value = t.name
        joinBtn.hidden = true
        leaveBtn.hidden = false
      } else {
        me.textContent =
          "Tu regardes l'horizon sans y paraître. Rejoindre publie un pseudo et quelques compteurs — époque, jour, nombre de savoirs. Jamais ta sauvegarde, jamais ta Chronique."
        nameRow.hidden = true
        joinBtn.hidden = false
        leaveBtn.hidden = true
      }
    }
    // Le rafraîchissement de fond redessine le panneau s'il est ouvert.
    onNeighborsChange = () => {
      if (!panel.hidden) render()
    }

    menuEl('menu-neighbors-open').addEventListener('click', () => {
      render()
      home.hidden = true
      panel.hidden = false
      void syncNeighborhood()
    })
    menuEl('menu-neighbors-close').addEventListener('click', showHome)

    joinBtn.addEventListener('click', () => {
      game.save.tribe = makeIdentity(game.save.seed)
      // Le village a déjà un nom : la tribu le porte, plutôt qu'un nom tiré au sort.
      if (game.save.village) game.save.tribe.name = game.save.village
      else game.save.village = game.save.tribe.name
      game.flush(Date.now())
      render()
      void syncNeighborhood()
    })

    menuEl('neighbors-rename').addEventListener('click', () => {
      const t = game.save.tribe
      if (!t) return
      const name = nameInput.value.trim().slice(0, 24)
      if (!name) return
      t.name = name
      game.save.village = name
      game.flush(Date.now())
      render()
      void syncNeighborhood()
    })

    menuEl('gift-send').addEventListener('click', () => {
      const t = game.save.tribe
      const to = neighbors.find((n) => n.id === giftWho.value)
      if (!t || !to) return
      const def = game.giveRelic(giftWhat.value, to.name)
      if (!def) return
      void sendGift(t.id, t.secret, to.id, def.id)
      village.setRelics(game.save.relics.length)
      hud.toast(`${def.name} part pour ${to.name}`)
      render()
    })

    leaveBtn.addEventListener('click', () => {
      const t = game.save.tribe
      if (!t) return
      // On efface d'abord côté serveur, tant qu'on a encore le secret.
      void leave(t.id, t.secret)
      game.save.tribe = null
      game.flush(Date.now())
      render()
    })
  }

  // Le comptoir : des offres déposées par d'autres tribus, et les nôtres. La
  // marchandise quitte le camp au dépôt et revient au retrait — rien ne se
  // crée ici, tout se déplace.
  {
    const panel = menuEl('menu-market')
    const list = menuEl('market-list')
    const note = menuEl('market-note')
    const form = menuEl('offer-form')
    const giveRes = menuEl<HTMLSelectElement>('offer-give-res')
    const wantRes = menuEl<HTMLSelectElement>('offer-want-res')
    const giveQty = menuEl<HTMLInputElement>('offer-give-qty')
    const wantQty = menuEl<HTMLInputElement>('offer-want-qty')
    let mine: Offer[] = []
    let others: Offer[] = []

    const label = (res: string, qty: number): string =>
      `${RESOURCES[res as ResourceId]?.icon ?? '?'}\u202F${fmt(qty)}`

    const fillSelects = (): void => {
      const goods = [...game.unlocked].filter((r) => r !== 'insight')
      for (const sel of [giveRes, wantRes]) {
        const before = sel.value
        sel.textContent = ''
        for (const r of goods) {
          const opt = document.createElement('option')
          opt.value = r
          opt.textContent = RESOURCES[r].name
          sel.appendChild(opt)
        }
        if ((goods as string[]).includes(before)) sel.value = before
      }
      if (wantRes.value === giveRes.value && goods.length > 1)
        wantRes.value = goods.find((r) => r !== giveRes.value)!
    }

    const render = (): void => {
      list.textContent = ''
      const t = game.save.tribe
      form.hidden = !t
      if (!t) {
        note.textContent =
          "Le comptoir n'ouvre qu'aux tribus du voisinage — rejoins-le d'abord."
        return
      }
      note.textContent =
        "On n'échange qu'avec des tribus d'une époque voisine : un surplus de fin de partie n'a rien à faire chez un débutant. Trois dépôts au maximum."
      if (mine.length === 0 && others.length === 0) {
        const li = document.createElement('li')
        li.textContent = 'Le comptoir est vide. Dépose la première offre.'
        list.appendChild(li)
      }
      for (const o of mine) {
        const li = document.createElement('li')
        const txt = document.createElement('span')
        txt.innerHTML = `<b>Ton dépôt.</b> ${label(o.give_res, o.give_qty)} contre ${label(o.want_res, o.want_qty)}`
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'btn'
        btn.innerHTML = '<span class="label">Retirer</span>'
        btn.addEventListener('click', () => {
          void withdrawOffer(t.id, t.secret, o.id).then(() => {
            hud.toast('Dépôt repris — la marchandise rentre au prochain réveil')
            void refresh()
          })
        })
        li.append(txt, btn)
        list.appendChild(li)
      }
      for (const o of others) {
        // On n'affiche que ce que la tribu sait manipuler : recevoir du fer
        // avant de savoir ce qu'est le fer n'aurait aucun sens.
        if (!game.unlocked.has(o.give_res as ResourceId) || !game.unlocked.has(o.want_res as ResourceId))
          continue
        const li = document.createElement('li')
        const txt = document.createElement('span')
        txt.innerHTML = `<b>${escapeHtml(o.name)}</b> donne ${label(o.give_res, o.give_qty)}<br>contre ${label(o.want_res, o.want_qty)}`
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'btn'
        const affordable = game.amount(o.want_res as ResourceId) >= o.want_qty
        btn.innerHTML = `<span class="label">${affordable ? 'Échanger' : 'Trop cher'}</span>`
        btn.disabled = !affordable
        btn.addEventListener('click', () => {
          if (!game.tradeSpend(o.want_res as ResourceId, o.want_qty)) return
          void acceptOffer(t.id, t.secret, o.id).then((r) => {
            if (!r?.ok || !r.giveRes) {
              // Offre déjà prise (ou serveur muet) : on rend son dû au joueur.
              game.tradeCredit(
                o.want_res as ResourceId,
                o.want_qty,
                'Un échange du comptoir a échoué — la marchandise revient au camp.',
              )
              hud.toast('Cette offre vient de partir — rien n’a été échangé')
            } else {
              game.tradeCredit(
                r.giveRes as ResourceId,
                r.giveQty ?? 0,
                `Échange au comptoir avec ${r.from ?? 'une autre tribu'} : ${label(r.giveRes, r.giveQty ?? 0)} entrent au camp.`,
              )
              hud.toast(`Échange conclu · ${label(r.giveRes, r.giveQty ?? 0)}`)
              ambience.coin()
            }
            void refresh()
          })
        })
        li.append(txt, btn)
        list.appendChild(li)
      }
    }

    const refresh = async (): Promise<void> => {
      const t = game.save.tribe
      if (!t) return render()
      const out = await fetchOffers(t.id)
      if (out) {
        mine = out.mine
        others = out.offers
      }
      render()
    }

    menuEl('menu-market-open').addEventListener('click', () => {
      fillSelects()
      render()
      home.hidden = true
      panel.hidden = false
      void refresh()
    })
    menuEl('menu-market-close').addEventListener('click', showHome)

    menuEl('offer-post').addEventListener('click', () => {
      const t = game.save.tribe
      if (!t) return
      const g = Math.floor(Number(giveQty.value))
      const w = Math.floor(Number(wantQty.value))
      if (!(g > 0) || !(w > 0)) return
      if (giveRes.value === wantRes.value) {
        hud.toast('Troquer une marchandise contre elle-même ne mène nulle part')
        return
      }
      if (!game.tradeSpend(giveRes.value as ResourceId, g)) {
        hud.toast('Les réserves ne suivent pas')
        return
      }
      void postOffer(t.id, t.secret, giveRes.value, g, wantRes.value, w).then((r) => {
        if (!r.ok) {
          game.tradeCredit(
            giveRes.value as ResourceId,
            g,
            'Dépôt refusé au comptoir — la marchandise reste au camp.',
          )
          hud.toast(r.error ?? 'Le comptoir n’a pas répondu')
        } else {
          hud.toast('Offre déposée au comptoir')
        }
        void refresh()
      })
    })
  }

  // Transfert de tribu : la partie s'emporte en fichier ou en code, et se
  // rouvre ailleurs. Sans ça, vider les données du navigateur efface tout.
  {
    const panel = menuEl('menu-transfer')
    const status = menuEl('transfer-status')
    const codeBox = menuEl<HTMLTextAreaElement>('transfer-code')
    const fileInput = menuEl<HTMLInputElement>('transfer-input')
    let restoreStep = 0

    const say = (text: string, kind: 'ok' | 'bad' | '' = '') => {
      status.textContent = text
      status.className = `transfer-status${kind ? ` ${kind}` : ''}`
      status.hidden = false
    }

    /** Le code décrit l'état À CET INSTANT : on écrit la sauvegarde d'abord. */
    const currentCode = async () => {
      game.flush(Date.now())
      return encodeSave(game.save)
    }

    menuEl('menu-transfer-open').addEventListener('click', () => {
      restoreStep = 0
      status.hidden = true
      codeBox.value = ''
      home.hidden = true
      panel.hidden = false
    })
    menuEl('menu-transfer-close').addEventListener('click', showHome)

    menuEl('transfer-download').addEventListener('click', () => {
      void currentCode().then((code) => {
        const day = Math.floor(game.save.totalPlaySeconds / DAY_SECONDS) + 1
        const blob = new Blob([code], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = transferFilename(game.age.name, day)
        a.click()
        URL.revokeObjectURL(url)
        say('Tribu enregistrée. Garde ce fichier : il la fera renaître partout.', 'ok')
      })
    })

    menuEl('transfer-copy').addEventListener('click', () => {
      void currentCode().then(async (code) => {
        try {
          await navigator.clipboard.writeText(code)
          say('Code copié — colle-le où tu veux le garder.', 'ok')
        } catch {
          // Presse-papiers refusé (http, permission) : on montre le code, le
          // joueur le sélectionne lui-même.
          codeBox.value = code
          codeBox.select()
          say('Copie impossible depuis la page : le code est ci-dessous, sélectionne-le.', 'bad')
        }
      })
    })

    menuEl('transfer-file').addEventListener('click', () => fileInput.click())
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0]
      if (!file) return
      void file.text().then((text) => {
        codeBox.value = text.trim()
        restoreStep = 0
        say('Fichier chargé. Tape « Restaurer cette tribu » pour l’ouvrir.')
      })
      fileInput.value = ''
    })

    menuEl('transfer-restore').addEventListener('click', () => {
      const raw = codeBox.value.trim()
      if (!raw) {
        say('Colle d’abord un code, ou ouvre un fichier de tribu.', 'bad')
        return
      }
      void decodeSave(raw).then((res) => {
        if (!res.ok) {
          say(
            res.reason === 'tronque'
              ? 'Ce code est incomplet — il a dû être coupé à la copie. Reprends-le en entier.'
              : 'Ce texte n’est pas une tribu lisible.',
            'bad',
          )
          restoreStep = 0
          return
        }
        if (restoreStep === 0 && hasProgress) {
          restoreStep = 1
          say(
            `Cette tribu compte ${res.save.techs.length} découvertes. La restaurer remplacera ta partie en cours. Tape encore pour confirmer.`,
            'bad',
          )
          return
        }
        try {
          // Filet de sécurité : la partie remplacée reste récupérable une fois.
          const previous = localStorage.getItem(SAVE_KEY)
          if (previous) localStorage.setItem(`${SAVE_KEY}.bak`, previous)
          // Horodatée à maintenant : un transfert ne doit pas créditer
          // l'absence entre l'export et l'import.
          localStorage.setItem(SAVE_KEY, JSON.stringify({ ...res.save, t: Date.now() }))
        } catch {
          say('Le stockage du navigateur refuse d’écrire — restauration impossible.', 'bad')
          return
        }
        say('Tribu restaurée. On rouvre le monde…', 'ok')
        setTimeout(() => location.reload(), 600)
      })
    })
  }

  menuEl('menu-erase').addEventListener('click', () => {
    if (confirmMode === 'exode') {
      if (confirmStep === 1) {
        confirmStep = 2
        warn.textContent =
          "Dernière confirmation : l'île actuelle et ses 51 savoirs restent derrière. Le musée et la constellation voyagent avec la tribu."
        eraseLabel.textContent = 'Larguer les amarres'
        return
      }
      if (game.exodus()) close()
      return
    }
    if (confirmStep === 1) {
      // Seconde confirmation : le libellé change, il faut re-taper en conscience.
      confirmStep = 2
      warn.textContent = 'Dernière confirmation. Il ne restera rien : ni savoir, ni bâtiments, ni île.'
      eraseLabel.textContent = 'Tout effacer définitivement'
      return
    }
    try {
      localStorage.removeItem(SAVE_KEY)
    } catch {
      /* stockage indisponible : la partie était déjà en mémoire seulement */
    }
    location.reload()
  })

  menuEl('menu-open').addEventListener('click', open)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.classList.contains('open') && hasProgress) close()
  })

  const notifBtn = menuEl('menu-notif')
  const notifLabel = menuEl('menu-notif-label')
  if ('Notification' in window) {
    notifBtn.hidden = false
    notifLabel.textContent = notifOn ? 'Notifications : activées' : 'Notifications : coupées'
    notifBtn.addEventListener('click', () => {
      if (notifOn) {
        notifOn = false
        try {
          localStorage.setItem(NOTIF_KEY, 'off')
        } catch { /* préférence en mémoire */ }
        notifLabel.textContent = 'Notifications : coupées'
        return
      }
      void Notification.requestPermission().then((perm) => {
        notifOn = perm === 'granted'
        try {
          localStorage.setItem(NOTIF_KEY, notifOn ? 'on' : 'off')
        } catch { /* préférence en mémoire */ }
        notifLabel.textContent = notifOn ? 'Notifications : activées' : 'Notifications : refusées'
      })
    })
  }

  const soundLabel = menuEl('menu-sound-label')
  soundLabel.textContent = ambience.isEnabled ? 'Son : activé' : 'Son : coupé'
  menuEl('menu-sound').addEventListener('click', () => {
    soundLabel.textContent = ambience.toggle() ? 'Son : activé' : 'Son : coupé'
  })

  menuEl('menu-version').textContent = `v${__APP_VERSION__}`

  // ?nomenu=1 : le harnais de capture juge le jeu, pas l'écran d'accueil.
  if (new URLSearchParams(location.search).has('nomenu')) {
    paused = false
  } else {
    showHome()
    menu.classList.add('open')
  }
}

let last = performance.now()
let lastWall = Date.now()
let elapsed = 0

/** Compteur d'images, sur demande : `?fps=1`.
 *
 *  Il existe parce que le harnais de capture ne PEUT PAS mesurer la fluidité —
 *  Chromium sans écran rend en logiciel (SwiftShader / llvmpipe) et plafonne à
 *  deux ou trois images par seconde quoi qu'on fasse. La seule mesure qui vaut
 *  est celle prise sur un vrai appareil, donc elle doit être à portée de main.
 *
 *  Il montre la MÉDIANE et les 5 % de pires images : une moyenne cache
 *  précisément les à-coups qu'on cherche. `js` est le temps passé dans notre
 *  propre boucle, hors rendu — c'est celui-là qu'on maîtrise. */
const fpsPanel = new URLSearchParams(location.search).get('fps') ? document.createElement('div') : null
if (fpsPanel) {
  fpsPanel.style.cssText =
    'position:fixed;left:8px;bottom:8px;z-index:99;padding:6px 9px;border-radius:9px;' +
    'background:rgba(20,26,32,.82);color:#eaf2f7;font:12px/1.45 ui-monospace,monospace;' +
    'white-space:pre;pointer-events:none'
  document.body.appendChild(fpsPanel)
}
const fpsDts: number[] = []
let fpsJs = 0
let fpsLast = 0

function frame(now: number): void {
  requestAnimationFrame(frame)
  const t0 = fpsPanel ? performance.now() : 0
  // A backgrounded tab can hand back a huge delta; the sim would jump, the
  // animation would teleport. Clamp here and let the save handle real absence.
  const dt = Math.min((now - last) / 1000, 0.1)
  last = now
  // Détection de suspension à l'horloge murale : verrouillage d'écran, gel
  // d'onglet, throttling — tout écart réel est crédité au premier frame du
  // retour, sans dépendre d'un événement de visibilité.
  const wall = Date.now()
  const gap = (wall - lastWall) / 1000
  lastWall = wall
  if (gap > 5 && !paused) game.creditAbsence(gap)
  elapsed += dt

  if (!paused) game.tick(dt, Date.now())
  // La nuit, TOUT LE MONDE dort. La lumière découverte ne fait qu'allonger la
  // veillée sur le crépuscule et l'aube (game.sleepTime) : même électrifiée,
  // l'île doit être vue endormie une partie de la nuit.
  settler.setNight(game.sleepTime)
  const boost = game.encourageLeft > 0 ? 1.7 : 1
  // L'outil suit la ressource travaillée et la matière suit les savoirs.
  const metal = game.knows('bessemer') ? 3 : game.knows('ironworking') ? 2 : game.knows('bronze') ? 1 : 0
  if (game.save.focus === 'food') {
    settler.setTool(
      fishing
        ? game.knows('cordage')
          ? 'rod'
          : 'spear'
        : game.knows('agriculture')
          ? 'sickle'
          : game.knows('spear')
            ? 'spear'
            : 'hand',
      metal,
    )
  } else if (game.save.focus === 'wood') {
    settler.setTool(game.knows('flint') ? 'axe' : 'hand', metal)
  } else {
    // Galet percuteur, puis pic de cuivre, puis pic de fer.
    settler.setTool('pick', game.knows('bessemer') ? 3 : game.knows('ironworking') ? 2 : game.knows('copper') ? 1 : 0)
  }
  settler.update(dt, boost)
  caravan.update(dt, elapsed, game.knows('sail'))
  boat.update(dt, elapsed)
  if (expPhase === 'walking' && settler.isAway) {
    boat.launchOut(settler.shorePoint)
    expPhase = 'sailed'
  }
  if (boat.consumeDocked()) {
    settler.returnFromExpedition()
    expPhase = 'none'
  }
  village.update(dt, elapsed)
  fauna.setKnown(game.knows('agriculture'), game.knows('granary'), game.knows('horsecollar'), game.knows('sail'))
  fauna.update(dt, elapsed, settler.group.position, game.isNight)
  // Les adultes veillent tant que la lumière le permet ; l'enfant est couché
  // dès la tombée de la nuit.
  villagers.update(dt, elapsed, game.sleepTime, game.isNight)
  // Le jour avance avec le temps de jeu cumulé : la partie reprend à l'heure
  // où elle s'était arrêtée, pas toujours au même matin.
  stage.tickSleigh(dt)
  // Nuit de Noël : les grelots, puis la silhouette qui traverse le ciel.
  if (yule === 'flight' && !paused) {
    if (game.isNight) {
      sleighIn -= dt
      if (sleighIn <= 0 && !stage.sleighFlying) {
        sleighIn = 95 + Math.random() * 80
        stage.sleigh(17)
        ambience.sleighBells()
        hud.toast('Des grelots, très haut dans la nuit — un traîneau traverse le ciel')
        if (!sleighTold) {
          sleighTold = true
          hud.showStory('La nuit du 25 décembre', 'Le traîneau dans le ciel', YULE_STORY)
        }
      }
    } else {
      // Au jour, on réarme court : la première nuit venue, il passe.
      sleighIn = Math.min(sleighIn, 10)
    }
  }

  if (wreckTimer > 0) {
    wreckTimer -= dt
    if (wreckTimer <= 0) despawnWreck()
  }
  if (eclipseLeft > 0) {
    eclipseLeft -= dt
    const p = 1 - Math.max(0, eclipseLeft) / ECLIPSE_DUR
    // Une cloche d'ombre : la lumière fond, s'éteint aux trois quarts, revient.
    stage.eclipseK = 1 - 0.78 * Math.sin(Math.PI * Math.min(1, p))
    if (eclipseLeft <= 0) stage.eclipseK = 1
  }
  const daylight = stage.setDaylight(
    forcedHour ?? (DAY_START + game.save.totalPlaySeconds / DAY_SECONDS) % 1,
  )
  island.setDaylight(daylight)
  // L'enneigement progresse DANS la saison : l'appel est gardé côté île (il ne
  // repeint qu'aux 2 % de saison écoulée).
  island.setSeason(game.season.id, game.seasonU)
  // Les ailes du moulin tournent, et le cadran du campanile donne l'heure
  // qu'il est sur l'île — la même fraction de journée que celle du soleil.
  village.tickMovers(dt, forcedHour ?? (DAY_START + game.save.totalPlaySeconds / DAY_SECONDS) % 1)
  stage.driftSky(dt)
  // Hystérésis : l'encre du HUD ne doit pas clignoter pendant tout un crépuscule.
  if (hudNight ? daylight > 0.55 : daylight < 0.4) {
    hudNight = !hudNight
    document.body.classList.toggle('night', hudNight)
  }
  if (fishing && !game.save.expedition && !settler.isAway && !settler.isSleeping) {
    catchTimer -= dt
    if (catchTimer <= 0) {
      catchTimer = 13 + Math.random() * 13
      const n = game.landCatch()
      ambience.plop()
      if (firstCatch) {
        firstCatch = false
        hud.toast(`Ça mord — +${fmt(n)} nourriture. Le colon pêchera tant que tu ne l'envoies pas ailleurs`)
      }
    }
  }
  ambience.update(
    dt,
    daylight,
    stage.rainLevel,
    game.knows('electricity') ? 'lamp' : game.save.age >= 4 ? 'brazier' : 'open',
    settler.isAway,
  )
  stage.updateCamera()
  hud.update()
  if (fpsPanel) fpsJs = performance.now() - t0
  stage.render()
  if (fpsPanel) {
    if (fpsLast) fpsDts.push(now - fpsLast)
    fpsLast = now
    if (fpsDts.length >= 60) {
      const sorted = [...fpsDts].sort((a, b) => a - b)
      const med = sorted[sorted.length >> 1]!
      const worst = sorted[Math.floor(sorted.length * 0.95)]!
      const info = stage.renderer.info.render
      fpsPanel.textContent =
        `${(1000 / med).toFixed(0)} fps  (5 % pires : ${(1000 / worst).toFixed(0)})\n` +
        `js ${fpsJs.toFixed(1)} ms · ${info.calls} appels · ${(info.triangles / 1000).toFixed(0)} k tris`
      fpsDts.length = 0
    }
  }
}

requestAnimationFrame((t) => {
  last = t
  requestAnimationFrame(frame)
})

// Measurement hook for the screenshot/perf harness in tools/. Costs one object;
// exposing draw calls and triangles is what makes the perf half of the bar
// objective instead of a vibe.
;(window as unknown as Record<string, unknown>).__tribu = {
  info: () => ({
    calls: stage.renderer.info.render.calls,
    triangles: stage.renderer.info.render.triangles,
    programs: stage.renderer.info.programs?.length ?? 0,
    geometries: stage.renderer.info.memory.geometries,
    textures: stage.renderer.info.memory.textures,
  }),
  ready: true,
  stage,
  game,
  // Recréés à chaque buildWorld : le harnais passe par des getters.
  fauna: () => fauna,
  settler: () => settler,
  villagers: () => villagers,
  village: () => village,
  island: () => island,
}

// Credit real elapsed time when the tab comes back, and never lose a session.
// Sur mobile la page vit en arrière-plan sans repasser par le constructeur :
// le temps caché doit être crédité ici, par le même chemin que le hors-ligne.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    game.flush(Date.now())
    // Le son ne doit pas survivre à l'onglet : navigateur réduit, l'ambiance
    // continuait de jouer dans le vide.
    ambience.pauseForBackground()
  } else {
    // Le crédit passe par la détection d'écart de la boucle : ici on ne fait
    // que réarmer le chrono d'animation.
    last = performance.now()
    ambience.resumeFromBackground()
  }
})
window.addEventListener('pagehide', () => {
  game.flush(Date.now())
  ambience.pauseForBackground()
  const snap = snapshot()
  if (snap) publishBeacon(snap)
})

// ── Le voisinage ───────────────────────────────────────────────────────────
// Les silhouettes de l'horizon sont d'autres tribus. Tout ici est facultatif :
// serveur éteint ou avion activé, le jeu ne s'en aperçoit pas.

/** L'instantané public — un pseudo et des compteurs, rien d'autre. `null`
 *  tant que le joueur n'a pas rejoint le voisinage. */
function snapshot(): Snapshot | null {
  const t = game.save.tribe
  if (!t) return null
  return {
    id: t.id,
    secret: t.secret,
    name: t.name,
    age: game.save.age,
    day: Math.floor(game.save.totalPlaySeconds / DAY_SECONDS) + 1,
    techs: game.save.techs.length,
    wonders: game.save.wonders.length,
    feats: game.save.feats.length,
    relics: game.save.relics.length,
    legacy: game.save.legacy,
    seed: game.save.seed,
  }
}

/** Ce qui, dans le voisinage, change ce qu'on DESSINE : identité, époque,
 *  merveilles. Un simple jour de plus chez le voisin ne reconstruit rien. */
const horizonKey = (list: Neighbor[]): string =>
  list
    .slice(0, 8)
    .map((n) => `${n.id}:${n.age}:${n.wonders}`)
    .join('|')

async function syncNeighborhood(): Promise<void> {
  const snap = snapshot()
  if (snap) await publish(snap)
  // Le courrier d'abord : ce que les autres ont fait pendant l'absence.
  const t = game.save.tribe
  if (t) {
    const mail = await drainInbox(t.id, t.secret)
    if (mail.length > 0) game.receiveMail(mail)
  }
  const list = await fetchNeighbors(game.save.tribe?.id ?? '', 8)
  if (!list) return
  // Les îles joignables par le colon : le choix de destination s'en sert.
  game.visitable = list.map((n) => ({ id: n.id, name: n.name, age: n.age, relics: n.relics }))
  const before = horizonKey(neighbors)
  neighbors = list
  cacheNeighbors(list)
  if (horizonKey(list) !== before) island.setNeighbors(list)
  onNeighborsChange?.()
}

// Premier appel décalé : la première image du jeu passe avant le réseau.
setTimeout(() => void syncNeighborhood(), 4000)
setInterval(() => void syncNeighborhood(), 5 * 60_000)
