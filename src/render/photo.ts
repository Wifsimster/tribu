import { HalfFloatType, Vector2, WebGLRenderTarget } from 'three'
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'

/** Le mode photo maquette : la chaîne de post-traitement n'existe QUE là.
 *  Ce module est chargé à la demande (import dynamique depuis scene.ts) — le
 *  premier chargement du jeu n'en paie pas un octet, et la boucle normale ne
 *  passe jamais par un composer.
 *
 *  Le tilt-shift des exemples de three floute en proportion LINÉAIRE de
 *  l'écart à la ligne de netteté : il n'y a pas de bande nette, tout est un
 *  peu flou sauf une ligne. Une maquette photographiée se lit au contraire
 *  à sa bande nette franche, puis à un flou qui monte vite vers les bords —
 *  d'où ce flou séparable maison, masqué par un smoothstep. */
const TiltShiftShader = {
  name: 'TribuTiltShift',
  uniforms: {
    tDiffuse: { value: null },
    /** Pas d'échantillonnage, en fraction d'écran : (1/w, 0) puis (0, 1/h). */
    dir: { value: new Vector2(1 / 512, 0) },
    /** Écart maximal entre deux échantillons, en pixels du tampon. */
    spread: { value: 2.4 },
    /** Hauteur (0..1) de la ligne de netteté. */
    focus: { value: 0.5 },
    /** Demi-hauteur de la bande nette, puis largeur du fondu vers le flou. */
    band: { value: 0.12 },
    feather: { value: 0.3 },
    /** Vignettage, appliqué seulement par la seconde passe. */
    vignette: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 dir;
    uniform float spread;
    uniform float focus;
    uniform float band;
    uniform float feather;
    uniform float vignette;
    varying vec2 vUv;
    void main() {
      float k = smoothstep(band, band + feather, abs(vUv.y - focus));
      vec2 s = dir * spread * k;
      vec4 sum = texture2D(tDiffuse, vUv) * 0.1633;
      sum += (texture2D(tDiffuse, vUv - s) + texture2D(tDiffuse, vUv + s)) * 0.1531;
      sum += (texture2D(tDiffuse, vUv - 2.0 * s) + texture2D(tDiffuse, vUv + 2.0 * s)) * 0.12245;
      sum += (texture2D(tDiffuse, vUv - 3.0 * s) + texture2D(tDiffuse, vUv + 3.0 * s)) * 0.0918;
      sum += (texture2D(tDiffuse, vUv - 4.0 * s) + texture2D(tDiffuse, vUv + 4.0 * s)) * 0.051;
      // Vignettage doux, en ellipse calée sur le cadre : il assombrit les
      // coins sans jamais toucher la bande nette.
      vec2 c = vUv - 0.5;
      sum.rgb *= 1.0 - vignette * smoothstep(0.18, 0.62, dot(c, c) * 1.6);
      gl_FragColor = sum;
    }`,
}

export class PhotoFx {
  private readonly composer: EffectComposer
  private readonly blurX: ShaderPass
  private readonly blurY: ShaderPass

  constructor(
    private readonly renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
  ) {
    const size = renderer.getDrawingBufferSize(new Vector2())
    // L'antialiasing du canvas ne s'applique pas à une cible de rendu : sans
    // MSAA sur la cible, la bande nette — la seule qu'on regarde — crénelait.
    // Mêmes règles que le canvas : rien sur pointeur grossier.
    const coarse = window.matchMedia('(pointer: coarse)').matches
    const target = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: coarse ? 0 : 4 })
    this.composer = new EffectComposer(renderer, target)
    this.composer.addPass(new RenderPass(scene, camera))
    this.blurX = new ShaderPass(TiltShiftShader)
    this.blurY = new ShaderPass(TiltShiftShader)
    this.blurY.uniforms.vignette!.value = 0.32
    this.composer.addPass(this.blurX)
    this.composer.addPass(this.blurY)
    // Tonemapping et sRGB en fin de chaîne : sans elle, l'image sortait
    // délavée — la scène se rend en linéaire dans les cibles du composer.
    this.composer.addPass(new OutputPass())
    this.resize()
  }

  /** Suit la taille ET le DPR bridé du renderer (posés par Stage.resize). */
  resize(): void {
    const css = this.renderer.getSize(new Vector2())
    const pr = this.renderer.getPixelRatio()
    this.composer.setPixelRatio(pr)
    this.composer.setSize(css.x, css.y)
    const w = Math.max(1, css.x * pr)
    const h = Math.max(1, css.y * pr)
    ;(this.blurX.uniforms.dir!.value as Vector2).set(1 / w, 0)
    ;(this.blurY.uniforms.dir!.value as Vector2).set(0, 1 / h)
    // Le flou se dose en pixels CSS : même rendu à DPR 1 et à DPR 2.
    this.blurX.uniforms.spread!.value = 2.6 * pr
    this.blurY.uniforms.spread!.value = 2.6 * pr
  }

  render(): void {
    this.composer.render()
  }

  dispose(): void {
    for (const pass of this.composer.passes) pass.dispose()
    this.composer.dispose()
  }
}
