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
import { AGES, DAY_START } from '../game/content'
import { ISLAND_RADIUS } from './island'
import { PALETTE, SUN_DIR, rampTexture, smoothstep } from './palette'

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

/** Le jeu démarre en milieu de matinée : l'azimut du soleil y coïncide avec
 *  SUN_DIR, la direction cuite dans l'ombre de contact de la texture d'eau. */
const SUN_AZ0 = Math.atan2(SUN_DIR.x, SUN_DIR.z) - DAY_START * Math.PI * 2
const NIGHT_SKY = new Color('#16283f')
const NIGHT_HAZE = new Color('#1c3247')
const SUN_DAY = new Color('#fff1d8')
const SUN_LOW = new Color('#ffb36b')

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

    // Moins de ciel diffus, plus de soleil : c'est le rapport entre les deux qui
    // creuse les contre-marches. À 0,82 l'ambiante remplissait tous les creux et
    // les paliers se lisaient comme un aplat.
    this.hemi = new HemisphereLight(0xdfeef2, 0x53757f, 0.66)
    this.scene.add(this.hemi)

    // Le soleil vient de la gauche et de derrière l'épaule gauche : sur le
    // cadrage par défaut, une face est éclairée, l'autre tombe dans l'ombre.
    this.sun = new DirectionalLight(0xfff1d8, 2.35)
    this.sun.position.set(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z)
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
    this.ageId = Math.min(ageId, AGES.length - 1)
    this.lastDaylight = -1 // force la repeinture du ciel au prochain frame
  }

  private ageId = 0
  private lastDaylight = -1
  private lastWarmth = -1

  /** La course du soleil : u ∈ [0,1), lever à 0, zénith à 0,25, coucher à 0,5.
   *  Tout le reste — couleur, intensité, ciel, brume — découle de l'élévation.
   *  Retourne la part de jour, que l'île applique à ses matériaux non éclairés. */
  setDaylight(u: number): number {
    const age = AGES[this.ageId]!
    const elev = Math.sin(u * Math.PI * 2)
    const az = SUN_AZ0 + u * Math.PI * 2

    // k : part de jour (0 la nuit, 1 en plein jour) ; w : chaleur d'horizon.
    const k = smoothstep(-0.06, 0.2, elev)
    const w = (1 - smoothstep(0.05, 0.42, elev)) * k

    const r = 52
    const cosE = Math.max(0.25, Math.cos(elev * 0.9))
    this.sun.position.set(
      Math.sin(az) * r * cosE,
      10 + Math.max(0.03, elev) * 50,
      Math.cos(az) * r * cosE,
    )
    this.sun.color.copy(SUN_DAY).lerp(SUN_LOW, w)
    this.sun.intensity = 2.35 * k
    // Ombres coupées la nuit : une shadow map pour un soleil éteint est un
    // rendu de profondeur payé pour rien.
    this.sun.castShadow = k > 0.02
    this.hemi.intensity = 0.16 + 0.6 * k

    const haze = this.hazeFor(age.fog).lerp(NIGHT_HAZE, 1 - k)
    this.fog.color.copy(haze)

    // Le ciel n'est repeint que quand l'ambiance change vraiment : une aube
    // entière n'écrit la texture qu'une cinquantaine de fois.
    if (Math.abs(k - this.lastDaylight) > 0.02 || Math.abs(w - this.lastWarmth) > 0.02) {
      this.lastDaylight = k
      this.lastWarmth = w
      this.sky.dispose()
      const top = PALETTE.sky.clone().lerp(new Color(age.sky), 0.35).lerp(NIGHT_SKY, 1 - k)
      const bottom = haze.clone().lerp(SUN_LOW, w * 0.4)
      this.sky = rampTexture(2, 64, (_u, v, out) => {
        out.copy(bottom).lerp(top, smoothstep(0, 0.85, v))
        return 1
      })
      this.scene.background = this.sky
    }
    return k
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
    // La brume ne commence qu'au-delà de l'île entière. À 0,95·d elle mordait
    // sur le bord éloigné : les faces basses se dissolvaient exactement là où
    // la ligne d'eau doit trancher.
    this.fog.near = d * 1.16
    this.fog.far = d * 2.05
  }

  render(): void {
    this.renderer.render(this.scene, this.camera)
  }
}
