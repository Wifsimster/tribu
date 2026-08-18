import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MultiplyBlending,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import type { DataTexture } from 'three'
import { AGES } from '../game/content'
import { ISLAND_RADIUS } from './island'
import { PALETTE, rampTexture, smoothstep } from './palette'

/** Phones get one pixel of DPR headroom, not three. This single clamp is the
 *  difference between 60 fps and 25 fps on a mid-range Android. */
function targetPixelRatio(): number {
  const dpr = window.devicePixelRatio || 1
  const coarse = window.matchMedia('(pointer: coarse)').matches
  return Math.min(dpr, coarse ? 1.75 : 2)
}

/** Champ étroit et caméra très reculée : la perspective s'aplatit, l'île se lit
 *  comme une maquette. Un grand angle proche donnait un point de vue de joueur
 *  posé dans l'herbe. */
const FOV = 27
/** Valeur historique de `distance` : le zoom du doigt reste un multiplicateur
 *  autour du cadrage nominal, sans jamais sortir des bornes de controls.ts. */
const BASE_ZOOM = 34
/** Part de l'écran que l'île a le droit d'occuper. Le reste, c'est de l'eau. */
const FILL_WIDTH = 0.76
const FILL_HEIGHT = 0.5

export class Stage {
  readonly renderer: WebGLRenderer
  readonly scene: Scene
  readonly camera: PerspectiveCamera
  readonly sun: DirectionalLight
  private readonly fog: Fog
  private readonly hemi: HemisphereLight
  private readonly vignette: Mesh
  private sky: DataTexture

  // Orbit state, driven by the custom touch controller in controls.ts.
  azimuth = Math.PI * 0.25
  polar = Math.PI * 0.32
  distance = BASE_ZOOM
  readonly target = new Vector3(0, 1, 0)

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: !window.matchMedia('(pointer: coarse)').matches,
      powerPreference: 'high-performance',
      stencil: false,
    })
    this.renderer.setPixelRatio(targetPixelRatio())
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFSoftShadowMap
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05

    this.scene = new Scene()
    const age = AGES[0]!
    this.sky = this.paintSky(age.sky)
    this.scene.background = this.sky
    this.fog = new Fog(this.hazeFor(age.fog), 100, 260)
    this.scene.fog = this.fog

    this.camera = new PerspectiveCamera(FOV, 1, 8, 2600)

    this.hemi = new HemisphereLight(0xdfeef2, 0x51757c, 0.82)
    this.scene.add(this.hemi)

    // Le soleil vient de la gauche et de derrière l'épaule gauche : sur le
    // cadrage par défaut, une face est éclairée, l'autre tombe dans l'ombre.
    this.sun = new DirectionalLight(0xfff1d8, 2.0)
    this.sun.position.set(-34, 46, 24)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(1024, 1024)
    this.sun.shadow.camera.left = -26
    this.sun.shadow.camera.right = 26
    this.sun.shadow.camera.top = 26
    this.sun.shadow.camera.bottom = -26
    this.sun.shadow.camera.near = 14
    this.sun.shadow.camera.far = 130
    this.sun.shadow.bias = -0.0009
    this.sun.shadow.normalBias = 0.045
    this.scene.add(this.sun)
    this.scene.add(this.sun.target)

    // Vignettage en une passe : un quad multiplicatif accroché à la caméra
    // coûte un draw call, là où un post-process coûterait une cible de rendu.
    this.vignette = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({
        map: rampTexture(96, 96, (u, v, out) => {
          // Un peu plus lourd en bas : c'est là que se posent les boutons.
          const k =
            smoothstep(0.42, 1.3, Math.hypot(u - 0.5, v - 0.5) * 2) + smoothstep(0.45, 0, v) * 0.35
          out.setRGB(1 - k * 0.2, 1 - k * 0.15, 1 - k * 0.12)
          return 1
        }),
        transparent: true,
        blending: MultiplyBlending,
        premultipliedAlpha: true,
        depthTest: false,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
    )
    this.vignette.position.z = -20
    this.vignette.renderOrder = 999
    this.camera.add(this.vignette)
    this.scene.add(this.camera)

    this.resize()
    window.addEventListener('resize', () => this.resize())
    window.addEventListener('orientationchange', () => this.resize())
  }

  /** Le ciel n'apparaît qu'en vue rasante : un dégradé vertical suffit, et sa
   *  base est exactement la couleur de brume pour que l'horizon disparaisse. */
  private paintSky(sky: number): DataTexture {
    const top = PALETTE.sky.clone().lerp(new Color(sky), 0.35)
    const bottom = this.hazeFor(sky)
    return rampTexture(2, 64, (_u, v, out) => {
      out.copy(bottom).lerp(top, smoothstep(0, 0.85, v))
      return 1
    })
  }

  private hazeFor(fog: number): Color {
    return PALETTE.haze.clone().lerp(new Color(fog), 0.18)
  }

  /** Sky, fog and light temperature drift with the age so progress is visible
   *  in the world itself, not only in the HUD. */
  applyAge(ageId: number): void {
    const age = AGES[Math.min(ageId, AGES.length - 1)]!
    this.sky.dispose()
    this.sky = this.paintSky(age.sky)
    this.scene.background = this.sky
    this.fog.color.copy(this.hazeFor(age.fog))
  }

  resize(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    this.renderer.setPixelRatio(targetPixelRatio())
    // `#scene` est un canvas positionné : sans taille CSS explicite il s'affiche
    // à la taille de son buffer, donc DPR fois trop grand — on ne voyait que le
    // coin haut-gauche du rendu, ce qui donnait cette impression de caméra
    // collée au sol sur mobile.
    this.renderer.setSize(w, h, true)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()

    const z = -this.vignette.position.z
    const vh = 2 * z * Math.tan((this.camera.fov * Math.PI) / 360)
    this.vignette.scale.set(vh * this.camera.aspect, vh, 1)
  }

  /** Le cadrage est calculé, pas réglé à la main : quel que soit l'écran, l'île
   *  garde la même taille apparente et la même marge d'eau autour d'elle. */
  private frameDistance(): number {
    const vTan = Math.tan((this.camera.fov * Math.PI) / 360)
    const hTan = vTan * this.camera.aspect
    // Vue de biais, un disque se projette en ellipse : sa hauteur écran suit
    // l'élévation de l'oeil.
    const rise = Math.max(0.5, Math.sin(Math.PI / 2 - this.polar))
    const halfV = ISLAND_RADIUS * rise + 2.2
    return Math.max(halfV / (FILL_HEIGHT * vTan), ISLAND_RADIUS / (FILL_WIDTH * hTan))
  }

  updateCamera(): void {
    const d = this.frameDistance() * (this.distance / BASE_ZOOM)
    const sinP = Math.sin(this.polar)
    this.camera.position.set(
      this.target.x + d * sinP * Math.sin(this.azimuth),
      this.target.y + d * Math.cos(this.polar),
      this.target.z + d * sinP * Math.cos(this.azimuth),
    )
    this.camera.lookAt(this.target)
    // La brume commence derrière l'île et sature avant le bord du plan d'eau :
    // l'île reste franche, l'horizon se dissout, aucune ligne de coupe.
    this.fog.near = d * 0.95
    this.fog.far = d * 1.7
  }

  render(): void {
    this.renderer.render(this.scene, this.camera)
  }
}
