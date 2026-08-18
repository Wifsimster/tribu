import { InstancedMesh, Raycaster, Vector2, Vector3 } from 'three'
import './style.css'
import { Game } from './game/sim'
import type { ResourceId } from './game/content'
import { Stage } from './render/scene'
import { Island } from './render/island'
import { Village } from './render/village'
import { Settler } from './render/settler'
import { Caravan } from './render/caravan'
import { attachControls } from './render/controls'
import { Hud, fmt } from './ui/hud'
import { RESOURCES } from './game/content'

const canvas = document.getElementById('scene') as HTMLCanvasElement
const stage = new Stage(canvas)

// Le jeu d'abord : l'île de chaque joueur pousse sur le seed de sa sauvegarde.
const game = new Game(Date.now())
const island = new Island(game.save.seed)
const village = new Village(island)
const settler = new Settler(island)
const caravan = new Caravan()

stage.scene.add(island.group, village.group, settler.group, caravan.group)
settler.setHome(new Vector3(0, island.heightAt(0, 0), 0))
stage.sun.target.position.set(0, 0, 0)

stage.applyAge(game.save.age)
village.sync(game.buildings)
// Barque déjà à quai dans la sauvegarde : elle reprend sa place sans naviguer.
if (game.save.caravan.visiting) caravan.arrive()

/** Where the settler goes for each resource: the nearest matching node. */
const nodeSpots = new Map<string, Vector3[]>()
for (const mesh of island.pickables) {
  const kind = island.kindFor(mesh)
  if (!kind) continue
  const spots: Vector3[] = []
  for (let i = 0; i < mesh.count; i++) spots.push(island.instancePosition(mesh, i))
  nodeSpots.set(kind, spots)
}

function spotFor(resource: ResourceId): Vector3 {
  const key = resource === 'food' ? 'food' : resource === 'wood' ? 'wood' : 'stone'
  const spots = nodeSpots.get(key)
  if (!spots || spots.length === 0) return new Vector3(4, 0, 4)
  // Prefer somewhere close to the fire so the walk cycle stays readable.
  return spots.reduce((best, s) =>
    s.lengthSq() < best.lengthSq() * 1.6 && Math.random() < 0.4 ? s : best,
  )
}

const hud = new Hud(game, (id) => {
  game.setFocus(id)
  settler.sendTo(spotFor(id))
})

game.on((e) => {
  switch (e.type) {
    case 'tech':
      hud.showFact(e.tech)
      village.sync(game.buildings)
      hud.refreshTechList()
      settler.celebrate()
      break
    case 'age':
      stage.applyAge(e.age.id)
      hud.showBanner('Nouvel âge', e.age.name)
      hud.refreshTechList()
      break
    case 'expeditionStart':
      hud.toast('Le colon part en expédition')
      break
    case 'expeditionEnd': {
      const parts = Object.entries(e.loot)
        .filter(([, n]) => (n as number) > 0)
        .map(([id, n]) => `${RESOURCES[id as ResourceId].icon} ${fmt(n as number)}`)
        .join('  ')
      hud.toast(`De retour · ${parts}`)
      if (e.find) hud.toast(`Il rapporte ${e.find}`)
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
        `Troc : ${RESOURCES[e.gave.res].icon} ${fmt(e.gave.amount)} contre ` +
          `${RESOURCES[e.got.res].icon} ${fmt(e.got.amount)} + ✨ ${e.insight}`,
      )
      if (e.tale) hud.toast(`Le marchand raconte : ${e.tale}`)
      break
    }
    case 'caravanLeave':
      caravan.depart()
      break
  }
})

// ── Tapping ────────────────────────────────────────────────────────────────
const raycaster = new Raycaster()
const pointer = new Vector2()

attachControls(stage, canvas, (x, y) => {
  pointer.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1)
  raycaster.setFromCamera(pointer, stage.camera)

  if (caravan.group.visible && raycaster.intersectObject(caravan.group, true).length > 0) {
    if (game.haggle()) hud.toast('Tu marchandes : le marchand cédera un meilleur prix')
    else hud.toast('Le marchand te salue de la main')
    return
  }

  const onSettler = raycaster.intersectObject(settler.group, true)
  if (onSettler.length > 0) {
    if (game.encourage()) settler.celebrate()
    else hud.toast('Laisse-le souffler un instant')
    return
  }

  const hits = raycaster.intersectObjects(island.pickables, false)
  const hit = hits[0]
  if (!hit || hit.instanceId === undefined) return
  const kind = island.kindFor(hit.object as InstancedMesh)
  if (!kind) return
  const resource: ResourceId = kind
  if (!game.unlocked.has(resource)) return
  game.setFocus(resource)
  settler.sendTo(island.instancePosition(hit.object as InstancedMesh, hit.instanceId))
  hud.toast(`Le colon s’occupe de : ${RESOURCES[resource].name.toLowerCase()}`)
})

// ── Loop ───────────────────────────────────────────────────────────────────
settler.sendTo(spotFor(game.save.focus))

let last = performance.now()
let elapsed = 0

function frame(now: number): void {
  requestAnimationFrame(frame)
  // A backgrounded tab can hand back a huge delta; the sim would jump, the
  // animation would teleport. Clamp here and let the save handle real absence.
  const dt = Math.min((now - last) / 1000, 0.1)
  last = now
  elapsed += dt

  game.tick(dt, Date.now())
  const boost = game.encourageLeft > 0 ? 1.7 : 1
  settler.update(dt, boost)
  caravan.update(dt, elapsed, game.knows('sail'))
  village.update(dt, elapsed)
  stage.updateCamera()
  hud.update()
  stage.render()
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
}

// Credit real elapsed time when the tab comes back, and never lose a session.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') game.flush(Date.now())
  else last = performance.now()
})
window.addEventListener('pagehide', () => game.flush(Date.now()))
