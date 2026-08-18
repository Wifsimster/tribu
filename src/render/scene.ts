import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import { AGES } from '../game/content'

/** Phones get one pixel of DPR headroom, not three. This single clamp is the
 *  difference between 60 fps and 25 fps on a mid-range Android. */
function targetPixelRatio(): number {
  const dpr = window.devicePixelRatio || 1
  const coarse = window.matchMedia('(pointer: coarse)').matches
  return Math.min(dpr, coarse ? 1.75 : 2)
}

export class Stage {
  readonly renderer: WebGLRenderer
  readonly scene: Scene
  readonly camera: PerspectiveCamera
  readonly sun: DirectionalLight
  private readonly fog: Fog
  private readonly hemi: HemisphereLight

  // Orbit state, driven by the custom touch controller in controls.ts.
  azimuth = Math.PI * 0.25
  polar = Math.PI * 0.32
  distance = 34
  readonly target = new Vector3(0, 0.5, 0)

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: !window.matchMedia('(pointer: coarse)').matches,
      powerPreference: 'high-performance',
      stencil: false,
    })
    this.renderer.setPixelRatio(targetPixelRatio())
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = 2 // PCFShadowMap — soft enough, cheap enough
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15

    this.scene = new Scene()
    const age = AGES[0]!
    this.scene.background = new Color(age.sky)
    this.fog = new Fog(age.fog, 42, 96)
    this.scene.fog = this.fog

    this.camera = new PerspectiveCamera(30, 1, 1, 160)

    this.hemi = new HemisphereLight(0xdff0ff, 0x6b7f4a, 1.15)
    this.scene.add(this.hemi)

    this.sun = new DirectionalLight(0xfff2d6, 2.1)
    this.sun.position.set(18, 26, 12)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(1024, 1024)
    this.sun.shadow.camera.left = -22
    this.sun.shadow.camera.right = 22
    this.sun.shadow.camera.top = 22
    this.sun.shadow.camera.bottom = -22
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 70
    this.sun.shadow.bias = -0.0012
    this.sun.shadow.normalBias = 0.03
    this.scene.add(this.sun)
    this.scene.add(this.sun.target)

    this.resize()
    window.addEventListener('resize', () => this.resize())
    window.addEventListener('orientationchange', () => this.resize())
  }

  /** Sky, fog and light temperature drift with the age so progress is visible
   *  in the world itself, not only in the HUD. */
  applyAge(ageId: number): void {
    const age = AGES[Math.min(ageId, AGES.length - 1)]!
    ;(this.scene.background as Color).set(age.sky)
    this.fog.color.set(age.fog)
  }

  resize(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    this.renderer.setPixelRatio(targetPixelRatio())
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    // Narrow phone screens need to pull back or the village falls off the sides.
    this.camera.fov = w / h < 0.75 ? 38 : 30
    this.camera.updateProjectionMatrix()
  }

  updateCamera(): void {
    const sinP = Math.sin(this.polar)
    this.camera.position.set(
      this.target.x + this.distance * sinP * Math.sin(this.azimuth),
      this.target.y + this.distance * Math.cos(this.polar),
      this.target.z + this.distance * sinP * Math.cos(this.azimuth),
    )
    this.camera.lookAt(this.target)
  }

  render(): void {
    this.renderer.render(this.scene, this.camera)
  }
}
