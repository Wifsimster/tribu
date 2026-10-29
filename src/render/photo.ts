import { HalfFloatType, Vector2, WebGLRenderTarget } from 'three'
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'

const TiltShiftShader = {
  name: 'TribuTiltShift',
  uniforms: {
    tDiffuse: { value: null },
    dir: { value: new Vector2(1 / 512, 0) },
    spread: { value: 2.4 },
    focus: { value: 0.5 },
    band: { value: 0.12 },
    feather: { value: 0.3 },
    vignette: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
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
    const coarse = window.matchMedia('(pointer: coarse)').matches
    const target = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: coarse ? 0 : 4 })
    this.composer = new EffectComposer(renderer, target)
    this.composer.addPass(new RenderPass(scene, camera))
    this.blurX = new ShaderPass(TiltShiftShader)
    this.blurY = new ShaderPass(TiltShiftShader)
    this.blurY.uniforms.vignette!.value = 0.32
    this.composer.addPass(this.blurX)
    this.composer.addPass(this.blurY)
    this.composer.addPass(new OutputPass())
    this.resize()
  }

  resize(): void {
    const css = this.renderer.getSize(new Vector2())
    const pr = this.renderer.getPixelRatio()
    this.composer.setPixelRatio(pr)
    this.composer.setSize(css.x, css.y)
    const w = Math.max(1, css.x * pr)
    const h = Math.max(1, css.y * pr)
    ;(this.blurX.uniforms.dir!.value as Vector2).set(1 / w, 0)
    ;(this.blurY.uniforms.dir!.value as Vector2).set(0, 1 / h)
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
