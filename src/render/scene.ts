import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BackSide,
  Color,
  CylinderGeometry,
  BoxGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  MeshToonMaterial,
  Object3D,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MultiplyBlending,
  PCFSoftShadowMap,
  RepeatWrapping,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import type { DataTexture } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { AGES } from '../game/content'
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

/** Trajet du soleil : un arc de haute latitude. Il se lève au col d'horizon
 *  arrière-gauche — pile dans le cadrage par défaut, même en portrait —, monte
 *  jusqu'à SUN_DIR à midi (la direction cuite dans les ombres de contact, et
 *  tous les dosages des rounds), puis redescend au même col. Un cercle complet
 *  faisait se coucher le soleil derrière la caméra : personne ne le voyait. */
const NOON_AZ = Math.atan2(SUN_DIR.x, SUN_DIR.z)
const ARC = 1.45
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

  /** Rayon de l'île courante — mis à jour quand elle grandit avec les âges. */
  islandRadius = ISLAND_RADIUS

  // Orbit state, driven by the custom touch controller in controls.ts.
  azimuth = Math.PI * 0.25
  polar = Math.PI * 0.38
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

    // Le soleil visible : un halo chaud et un disque posés sur l'horizon dans
    // la direction réelle de l'azimut. C'est lui qui fait EXISTER le lever et
    // le coucher — sans lui, l'aube n'était qu'un fondu global de lumière.
    const glowMat = new MeshBasicMaterial({
      map: rampTexture(64, 64, (u, v, out) => {
        const d = Math.hypot(u - 0.5, v - 0.5) * 2
        out.set('#ff9a4a')
        return Math.pow(Math.max(0, 1 - d), 2.2)
      }),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      opacity: 0,
    })
    this.sunGlow = new Mesh(new PlaneGeometry(72, 72), glowMat)
    const discMat = new MeshBasicMaterial({
      map: rampTexture(48, 48, (u, v, out) => {
        const d = Math.hypot(u - 0.5, v - 0.5) * 2
        out.set('#fff3d2')
        return Math.pow(Math.max(0, 1 - d), 0.55)
      }),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      opacity: 0,
    })
    this.sunDisc = new Mesh(new PlaneGeometry(13, 13), discMat)
    this.sunDisc.position.z = 1
    this.sunGlow.add(this.sunDisc)
    // Enfant de la caméra, comme le vignettage : le vrai horizon est HORS
    // CADRE avec cette caméra plongeante (NDC y ≈ 1,3) — celui que le joueur
    // voit est le dégradé de fond. Le soleil se place donc en espace écran,
    // sur l'horizon perçu, à l'azimut réel près.
    glowMat.depthTest = false
    discMat.depthTest = false
    this.sunGlow.renderOrder = 990
    this.camera.add(this.sunGlow)

    // La lune : même système que le soleil — espace écran, horizon perçu —
    // en froid et en discret. Elle culmine la nuit là où le soleil culmine à
    // midi, décalée d'un quart de radian pour ne pas se superposer aux
    // transitions de l'aube et du crépuscule.
    const moonGlowMat = new MeshBasicMaterial({
      map: rampTexture(64, 64, (u, v, out) => {
        const d = Math.hypot(u - 0.5, v - 0.5) * 2
        out.set('#9fc2e8')
        return Math.pow(Math.max(0, 1 - d), 2.4)
      }),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
      opacity: 0,
    })
    this.moonGlow = new Mesh(new PlaneGeometry(52, 52), moonGlowMat)
    const moonDiscMat = new MeshBasicMaterial({
      map: rampTexture(48, 48, (u, v, out) => {
        const d = Math.hypot(u - 0.5, v - 0.5) * 2
        // Légères mers lunaires : deux creux plus sombres cuits dans le disque.
        const m1 = Math.hypot(u - 0.38, v - 0.42) * 3.2
        const m2 = Math.hypot(u - 0.6, v - 0.62) * 4.2
        const shade = 1 - 0.16 * Math.max(0, 1 - m1) - 0.12 * Math.max(0, 1 - m2)
        out.set('#eef4ff').multiplyScalar(shade)
        return Math.pow(Math.max(0, 1 - d), 0.5)
      }),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
      opacity: 0,
    })
    this.moonDisc = new Mesh(new PlaneGeometry(9, 9), moonDiscMat)
    this.moonDisc.position.z = 1
    this.moonGlow.add(this.moonDisc)
    this.moonGlow.renderOrder = 989
    // Astre-monde : il se lève, traverse et se couche à son propre azimut —
    // orbiter le déplace dans le cadre au lieu de l'y épingler.
    this.moonGlow.scale.setScalar(2.1)
    this.scene.add(this.moonGlow)

    // La traînée de lumière sur l'eau : le chemin scintillant vers l'astre —
    // soleil le jour (embrasé aux heures basses), lune la nuit. Un quad posé
    // sur la mer, strie longitudinale + scintillements cuits, additif.
    const glintHash = (n: number): number => {
      const s = Math.sin(n) * 43758.5453
      return s - Math.floor(s)
    }
    const glintMat = new MeshBasicMaterial({
      map: rampTexture(96, 256, (u, v, out) => {
        const across = Math.pow(Math.max(0, 1 - Math.abs(u - 0.5) * 2), 2.6)
        const along = smoothstep(0, 0.18, v) * (1 - smoothstep(0.6, 1, v))
        const cell = Math.floor(u * 24) * 57.3 + Math.floor(v * 90) * 131.7
        const sparkle = 0.45 + 0.55 * glintHash(cell)
        out.set('#ffffff')
        return across * along * sparkle
      }),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      opacity: 0,
    })
    this.glint = new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), glintMat)
    this.glint.position.y = 0.06
    this.glint.renderOrder = 2
    this.scene.add(this.glint)

    // Houle : des vaguelettes qui naissent, dérivent sous le vent des nuages
    // et se dissolvent. Un seul draw call, la respiration de la mer.
    const waveMat = new MeshBasicMaterial({
      map: rampTexture(64, 16, (u, v, out) => {
        const across = Math.pow(Math.max(0, 1 - Math.abs(v - 0.5) * 2), 1.8)
        const along = Math.sin(Math.min(1, Math.max(0, u)) * Math.PI)
        out.set('#dff2f6')
        return across * along
      }),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      opacity: 0.11,
    })
    this.waves = new InstancedMesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), waveMat, 14)
    this.waves.frustumCulled = false
    for (let i = 0; i < 14; i++) {
      const h = (n: number) => {
        const s = Math.sin(i * 43.7 + n * 91.1) * 43758.5453
        return s - Math.floor(s)
      }
      const r = 27 + h(1) * 65
      const a = h(2) * Math.PI * 2
      this.waveState.push({
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        len: 3 + h(3) * 4,
        rot: h(4) * 0.6 - 0.3,
        t: h(5) * 1,
        life: 5 + h(6) * 5,
      })
    }
    this.scene.add(this.waves)

    // Étoiles : un semis déterministe cuit dans une texture, sur un quad qui
    // ne couvre que la bande de ciel au-dessus de l'île. Légères — elles
    // habillent la nuit, elles ne la signent pas.
    const starHash = (n: number): number => {
      const s = Math.sin(n) * 43758.5453
      return s - Math.floor(s)
    }
    const starMat = new MeshBasicMaterial({
      map: rampTexture(256, 256, (u, v, out) => {
        const cells = 22
        const cx = Math.floor(u * cells)
        const cy = Math.floor(v * cells)
        const h = starHash(cx * 57.31 + cy * 131.7)
        out.set('#dfe8ff')
        if (h > 0.16) return 0
        const sx = (cx + 0.2 + 0.6 * starHash(cx * 91.7 + cy * 17.3)) / cells
        const sy = (cy + 0.2 + 0.6 * starHash(cx * 41.9 + cy * 73.1)) / cells
        const d = Math.hypot(u - sx, v - sy) * 256
        const bright = 0.25 + 0.75 * starHash(cx * 13.7 + cy * 219.4)
        // Fondu vers le bas de la voûte : sans depth test (voulu — la voûte
        // peint le ciel PAR-DESSUS la mer lointaine, indiscernable de nuit),
        // les étoiles basses tapissaient l'eau proche et la silhouette de
        // l'île dès qu'on inclinait la caméra. Elles meurent avant.
        return bright * Math.pow(Math.max(0, 1 - d / 1.25), 1.6) * smoothstep(0.16, 0.44, v)
      }),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
      opacity: 0,
    })
    // Voûte ancrée au MONDE : un cylindre autour de la scène, vu de
    // l'intérieur. Orbiter fait défiler les étoiles comme un vrai ciel — le
    // quad écran d'avant les collait à la caméra. Répétition horizontale pour
    // des cellules carrées, et une lente dérive sidérale.
    ;(starMat.map as DataTexture).wrapS = RepeatWrapping
    ;(starMat.map as DataTexture).repeat.set(7, 1)
    starMat.side = BackSide
    starMat.depthWrite = false
    this.stars = new Mesh(new CylinderGeometry(320, 320, 130, 48, 1, true), starMat)
    this.stars.position.y = -14
    this.scene.add(this.stars)

    // Nuages : des blobs facettés dans le style du jeu, une seule géométrie
    // instanciée (un draw call), éclairés par la scène — blancs le jour,
    // cuivrés au couchant, éteints la nuit — et qui PORTENT OMBRE : leur
    // passage devant le soleil glisse sur l'île.
    const puff = (r: number, sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
      const g = new IcosahedronGeometry(r, 0)
      g.scale(sx, sy, sz)
      g.translate(x, y, z)
      return g
    }
    const cloudGeo = mergeGeometries([
      puff(1.6, 1.4, 0.55, 1.0, 0, 0, 0),
      puff(1.1, 1.2, 0.5, 0.9, 1.6, 0.15, 0.3),
      puff(0.9, 1.1, 0.45, 0.9, -1.5, 0.1, -0.2),
      puff(0.7, 1.0, 0.4, 0.8, 0.4, 0.45, -0.6),
    ])!
    const cloudMat = new MeshToonMaterial({ color: '#f6fbff', transparent: true, opacity: 0.62 })
    this.clouds = new InstancedMesh(cloudGeo, cloudMat, 12)
    this.clouds.castShadow = true
    this.clouds.frustumCulled = false
    for (let i = 0; i < 12; i++) {
      // Semis déterministe : anneau large au-dessus de l'île, tailles variées.
      const h = (n: number) => {
        const s = Math.sin(i * 37.7 + n * 91.3) * 43758.5453
        return s - Math.floor(s)
      }
      // Bas et proches : au-dessus de l'île ils restent dans le cadre de la
      // caméra plongeante ET dans le frustum d'ombre — leurs ombres glissent.
      // Chaque nuage vit : il naît quelque part au vent, grandit, traverse,
      // se dissout et laisse la place — la population varie sans cesse.
      this.cloudState.push({
        x: (h(1) - 0.5) * 72,
        y: 16 + h(2) * 6,
        z: (h(3) - 0.5) * 72,
        s: 0.9 + h(4) * 1.0,
        v: 0.55 + h(5) * 0.7,
        rot: h(6) * Math.PI * 2,
        phase: h(7) < 0.6 ? 'live' : 'wait',
        t: 0,
        life: 20 + h(8) * 40,
        wait: 4 + h(9) * 30,
      })
    }
    this.scene.add(this.clouds)

    // Oiseaux : cinq silhouettes qui traversent par vols aléatoires, de jour
    // seulement. Les ailes sont des instances SÉPARÉES du corps, pivotées en
    // opposition autour de l'axe de vol : elles battent, elles ne balotent pas.
    const birdMat = new MeshToonMaterial({ color: '#39404a' })
    this.birdBody = new InstancedMesh(new BoxGeometry(0.24, 0.05, 0.09), birdMat, 5)
    const wingGeo = new BoxGeometry(0.1, 0.02, 0.36)
    wingGeo.translate(0, 0, 0.2) // pivot au flanc du corps
    this.birdWingL = new InstancedMesh(wingGeo, birdMat, 5)
    this.birdWingR = new InstancedMesh(wingGeo.clone().scale(1, 1, -1), birdMat, 5)
    for (const m of [this.birdBody, this.birdWingL, this.birdWingR]) {
      m.frustumCulled = false
      m.visible = false
      this.scene.add(m)
    }

    // Pluie : un rideau de gouttes instanciées au-dessus de l'île, un draw
    // call, visible seulement quand la météo l'appelle.
    this.rain = new InstancedMesh(
      new BoxGeometry(0.025, 0.55, 0.025),
      new MeshBasicMaterial({ color: '#a8bfd2', transparent: true, opacity: 0, fog: false }),
      240,
    )
    this.rain.frustumCulled = false
    this.rain.visible = false
    this.scene.add(this.rain)

    this.resize()
    window.addEventListener('resize', () => this.resize())
    window.addEventListener('orientationchange', () => this.resize())
  }

  private readonly sunGlow: Mesh
  private readonly sunDisc: Mesh
  private readonly moonGlow: Mesh
  private readonly moonDisc: Mesh
  private readonly glint: Mesh
  private readonly waves: InstancedMesh
  private readonly waveState: { x: number; z: number; len: number; rot: number; t: number; life: number }[] = []
  private readonly stars: Mesh
  private readonly clouds: InstancedMesh
  private readonly cloudState: { x: number; y: number; z: number; s: number; v: number; rot: number; phase: 'in' | 'live' | 'out' | 'wait'; t: number; life: number; wait: number }[] = []
  private readonly cloudDummy = new Object3D()

  private readonly birdBody: InstancedMesh
  private readonly birdWingL: InstancedMesh
  private readonly birdWingR: InstancedMesh
  private readonly rain: InstancedMesh
  private skyTime = 0
  /** La météo : des humeurs qui se succèdent, jamais un réglage figé. */
  private weather = { state: 'voile', next: 45 }
  private wTarget = { clouds: 5, grey: 0.2, sun: 0.92, rain: 0 }
  private wCur = { clouds: 5, grey: 0.2, sun: 0.92, rain: 0 }
  private flock = { active: false, t: 0, cooldown: 6, dir: 0.9, y: 18, side: 1 }

  /** Vie du ciel : dérive des nuages, vols d'oiseaux. Appelé chaque frame. */
  driftSky(dt: number): void {
    this.skyTime += dt
    this.tickWeather(dt)
    this.updateWaves(dt)
    this.driftClouds(dt)
    this.updateBirds(dt)
    this.updateRain(dt)
  }

  private updateWaves(dt: number): void {
    const wx = 0.82
    const wz = 0.44
    // Plus marquées par vent couvert, presque lisses la nuit calme.
    const mat = this.waves.material as MeshBasicMaterial
    mat.opacity = (0.07 + 0.1 * this.wCur.grey) * (0.45 + 0.55 * this.lastDaylight)
    this.waves.visible = mat.opacity > 0.015
    if (!this.waves.visible) return
    for (let i = 0; i < this.waveState.length; i++) {
      const w = this.waveState[i]!
      w.t += dt / w.life
      w.x += wx * 0.5 * dt
      w.z += wz * 0.5 * dt
      if (w.t >= 1) {
        w.t = 0
        const a = Math.random() * Math.PI * 2
        const r = 27 + Math.random() * 65
        w.x = Math.cos(a) * r
        w.z = Math.sin(a) * r
        w.len = 3 + Math.random() * 4
        w.life = 5 + Math.random() * 5
      }
      const grow = Math.sin(w.t * Math.PI)
      this.cloudDummy.position.set(w.x, 0.05, w.z)
      this.cloudDummy.rotation.set(0, Math.atan2(wx, wz) + w.rot, 0)
      this.cloudDummy.scale.set(w.len * (0.6 + grow * 0.4), 1, 0.5 + grow * 0.3)
      this.cloudDummy.updateMatrix()
      this.waves.setMatrixAt(i, this.cloudDummy.matrix)
    }
    this.waves.instanceMatrix.needsUpdate = true
  }

  private tickWeather(dt: number): void {
    this.weather.next -= dt
    if (this.weather.next <= 0) {
      const roll = Math.random()
      if (roll < 0.32) {
        this.weather.state = 'clair'
        this.wTarget = { clouds: 2, grey: 0.05, sun: 1, rain: 0 }
      } else if (roll < 0.62) {
        this.weather.state = 'voile'
        this.wTarget = { clouds: 5, grey: 0.2, sun: 0.92, rain: 0 }
      } else if (roll < 0.85) {
        this.weather.state = 'couvert'
        this.wTarget = { clouds: 10, grey: 0.65, sun: 0.6, rain: 0 }
      } else {
        this.weather.state = 'pluie'
        this.wTarget = { clouds: 12, grey: 0.85, sun: 0.45, rain: 1 }
      }
      this.weather.next = 70 + Math.random() * 90
    }
    // Transitions douces : la météo glisse, elle ne claque pas.
    const k = Math.min(1, dt / 9)
    this.wCur.clouds += (this.wTarget.clouds - this.wCur.clouds) * k
    this.wCur.grey += (this.wTarget.grey - this.wCur.grey) * k
    this.wCur.sun += (this.wTarget.sun - this.wCur.sun) * k
    this.wCur.rain += (this.wTarget.rain - this.wCur.rain) * k
  }

  private readonly rainDummy = new Object3D()

  private updateRain(dt: number): void {
    void dt
    const strength = this.wCur.rain * (0.25 + 0.75 * this.lastDaylight)
    ;(this.rain.material as MeshBasicMaterial).opacity = 0.34 * strength
    this.rain.visible = strength > 0.04
    if (!this.rain.visible) return
    const h = (n: number, m: number) => {
      const s = Math.sin(n * 127.1 + m * 311.7) * 43758.5453
      return s - Math.floor(s)
    }
    for (let i = 0; i < 240; i++) {
      const r = Math.sqrt(h(i, 1)) * 26
      const a = h(i, 2) * Math.PI * 2
      const speed = 16 + h(i, 3) * 6
      const y = 24 - ((this.skyTime * speed + h(i, 4) * 40) % 26)
      this.rainDummy.position.set(Math.cos(a) * r, y, Math.sin(a) * r)
      this.rainDummy.rotation.set(0, 0, 0.08)
      this.rainDummy.updateMatrix()
      this.rain.setMatrixAt(i, this.rainDummy.matrix)
    }
    this.rain.instanceMatrix.needsUpdate = true
  }

  private updateBirds(dt: number): void {
    const f = this.flock
    if (!f.active) {
      f.cooldown -= dt
      this.birdBody.visible = this.birdWingL.visible = this.birdWingR.visible = false
      // Ils ne décollent qu'en plein jour.
      if (f.cooldown <= 0 && this.lastDaylight > 0.6) {
        f.active = true
        f.t = 0
        f.dir = Math.random() * Math.PI * 2
        f.y = 9 + Math.random() * 5
        f.side = Math.random() < 0.5 ? 1 : -1
      }
      return
    }
    f.t += dt / 26
    const birdMeshes = [this.birdBody, this.birdWingL, this.birdWingR]
    if (f.t >= 1 || this.lastDaylight < 0.35) {
      f.active = false
      f.cooldown = 18 + Math.random() * 45
      for (const m of birdMeshes) m.visible = false
      return
    }
    for (const m of birdMeshes) m.visible = true
    const cx = Math.cos(f.dir)
    const sx = Math.sin(f.dir)
    const along = -46 + f.t * 92
    const yaw = -f.dir + Math.PI / 2
    this.cloudDummy.rotation.order = 'YXZ'
    for (let i = 0; i < 5; i++) {
      // Formation en V lâche : décalés derrière et de part et d'autre du guide.
      const rank = Math.ceil(i / 2)
      const lateral = (i % 2 === 0 ? 1 : -1) * rank * 2.1 * f.side
      const back = rank * 2.6
      const px = cx * (along - back) - sx * lateral
      const pz = sx * (along - back) + cx * lateral
      // Coup d'aile net vers le bas, remontée souple — et le corps ne fait que
      // suivre d'un léger ressaut, sans tanguer.
      const beat = Math.sin(this.skyTime * 8 + i * 1.7)
      const flap = beat * 0.85
      const py = f.y + Math.sin(this.skyTime * 2.2 + i) * 0.3 + Math.max(0, beat) * 0.06
      this.cloudDummy.position.set(px, py, pz)
      this.cloudDummy.scale.setScalar(1)
      this.cloudDummy.rotation.set(0, yaw, 0)
      this.cloudDummy.updateMatrix()
      this.birdBody.setMatrixAt(i, this.cloudDummy.matrix)
      this.cloudDummy.rotation.set(flap, yaw, 0)
      this.cloudDummy.updateMatrix()
      this.birdWingL.setMatrixAt(i, this.cloudDummy.matrix)
      this.cloudDummy.rotation.set(-flap, yaw, 0)
      this.cloudDummy.updateMatrix()
      this.birdWingR.setMatrixAt(i, this.cloudDummy.matrix)
    }
    this.cloudDummy.rotation.order = 'XYZ'
    for (const m of birdMeshes) m.instanceMatrix.needsUpdate = true
  }

  private activeClouds(): number {
    let n = 0
    for (const c of this.cloudState) if (c.phase !== 'wait') n++
    return n
  }

  /** Cycle de vie sous un vent diagonal constant : attente → naissance →
   *  traversée → dissolution. La nuit, le ciel se vide (les nuages n'ont rien
   *  à montrer sans soleil) et se repeuple à l'aube. */
  private driftClouds(dt: number): void {
    const wx = 0.82
    const wz = 0.44
    // Opacité globale calée sur le jour : voiles pleins en journée, ciel
    // dégagé la nuit pour la lune et les étoiles.
    // La nuit vide le ciel clair, mais un temps couvert garde ses masses
    // sombres — on voit qu'il fait mauvais même sans soleil.
    const dayFade = smoothstep(0.12, 0.55, this.lastDaylight)
    const vis = Math.max(dayFade, this.wCur.grey * 0.4)
    const mat = this.clouds.material as MeshToonMaterial
    mat.opacity = 0.62 * vis
    mat.color.set('#f6fbff').lerp(new Color('#8d99a6'), this.wCur.grey)
    this.clouds.visible = vis > 0.03
    for (let i = 0; i < this.cloudState.length; i++) {
      const c = this.cloudState[i]!
      let grow = 0
      switch (c.phase) {
        case 'wait':
          c.wait -= dt
          if (c.wait <= 0 && this.activeClouds() < Math.round(this.wCur.clouds)) {
            c.phase = 'in'
            c.t = 0
            // Naissance au vent, position et gabarit renouvelés.
            const r = (n: number) => {
              const s = Math.sin(i * 51.7 + this.skyTime * 0.13 + n * 97.3) * 43758.5453
              return s - Math.floor(s)
            }
            c.x = -44 + r(1) * 18
            c.z = (r(2) - 0.5) * 68
            c.y = 16 + r(3) * 6
            c.s = 0.9 + r(4) * 1.0
            c.v = 0.55 + r(5) * 0.7
            c.life = 26 + r(6) * 44
          }
          break
        case 'in':
          c.t += dt / 7
          grow = smoothstep(0, 1, Math.min(1, c.t))
          if (c.t >= 1) c.phase = 'live'
          break
        case 'live':
          grow = 1
          c.life -= dt
          // Le beau temps qui revient dissout les nuages en trop.
          if (this.activeClouds() > Math.round(this.wCur.clouds) + 1) c.life -= dt * 3
          if (c.life <= 0 || c.x > 40) {
            c.phase = 'out'
            c.t = 0
          }
          break
        case 'out':
          c.t += dt / 6
          grow = 1 - smoothstep(0, 1, Math.min(1, c.t))
          if (c.t >= 1) {
            c.phase = 'wait'
            c.wait = 5 + ((Math.sin(i * 77.7) * 43758.5453) % 1 + 1) % 1 * 30
          }
          break
      }
      if (c.phase !== 'wait') {
        c.x += wx * c.v * dt
        c.z += wz * c.v * dt
        if (c.z > 44) c.z = -44
      }
      this.cloudDummy.position.set(c.x, c.y, c.z)
      // Rotation ENTIÈREMENT réinitialisée : le dummy est partagé avec les
      // oiseaux, et sans ça les nuages héritaient de leur battement d'ailes.
      this.cloudDummy.rotation.set(0, c.rot, 0)
      // Aplatis : des voiles, pas des cumulus. La naissance et la dissolution
      // passent par l'échelle — l'alpha par instance n'existe pas.
      const s = Math.max(0.001, c.s * grow * (1 + this.wCur.grey * 0.7))
      this.cloudDummy.scale.set(s, s * 0.62, s)
      this.cloudDummy.updateMatrix()
      this.clouds.setMatrixAt(i, this.cloudDummy.matrix)
    }
    this.clouds.instanceMatrix.needsUpdate = true
  }
  private sunAz = 0
  private sunElev = 1
  private dayU = 0.32
  private glowBase = 0
  private discBase = 0
  private moonGlowBase = 0
  private moonDiscBase = 0
  private starsBase = 0

  /** Le ciel n'apparaît qu'en vue rasante : un dégradé vertical suffit, et sa
   *  base est exactement la couleur de brume pour que l'horizon disparaisse. */
  private paintSky(sky: number): DataTexture {
    const top = PALETTE.sky.clone().lerp(new Color(sky), 0.35)
    const bottom = this.hazeFor(sky)
    return rampTexture(2, 64, (_u, v, out) => {
      // v=0 est rendu EN HAUT de l'écran (convention DataTexture en fond de
      // scène) : bleu profond au sommet, brume vers l'horizon, transition
      // large pour ne jamais lire comme une barre.
      out.copy(top).lerp(bottom, smoothstep(0.12, 1, v))
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
    // cos² : période d'une demi-journée — le soleil se lève ET se couche au
    // même col d'horizon arrière (cos simple l'envoyait se coucher dans le dos
    // de la caméra), en passant par NOON_AZ au zénith.
    const az = NOON_AZ - ARC * Math.cos(u * Math.PI * 2) ** 2

    // k : part de jour (0 la nuit, 1 en plein jour) ; w : chaleur d'horizon.
    const k = smoothstep(-0.06, 0.2, elev)
    const w = (1 - smoothstep(0.05, 0.42, elev)) * k

    const r = 52
    const cosE = Math.max(0.25, Math.cos(elev * 0.9))
    // Plancher abaissé : aux heures basses le soleil rase vraiment, et les
    // ombres s'allongent — c'est la moitié du spectacle du soir.
    this.sun.position.set(
      Math.sin(az) * r * cosE,
      6 + Math.max(0.03, elev) * 54,
      Math.cos(az) * r * cosE,
    )

    // Halo et disque : visibles à l'aube et au crépuscule, fondus en plein
    // jour, éteints la nuit noire. La POSITION se règle dans updateCamera —
    // l'horizon à l'écran dépend de la caméra, pas du monde.
    this.sunAz = az
    this.sunElev = elev
    this.dayU = u
    const glowA = smoothstep(-0.14, 0.02, elev) * (1 - smoothstep(0.16, 0.42, elev))
    const discA = smoothstep(-0.03, 0.05, elev) * (1 - smoothstep(0.28, 0.5, elev))
    this.glowBase = glowA * 0.5 * (1 - this.wCur.grey * 0.8)
    this.discBase = discA
    // Blanc au zénith, cuivré à l'horizon — c'est la couleur qui dit l'heure.
    ;(this.sunDisc.material as MeshBasicMaterial).color
      .set('#fff3d2')
      .lerp(SUN_LOW, 1 - smoothstep(0.02, 0.35, elev))

    // La lune monte quand le soleil descend : élévation opposée. Elle reste
    // visible toute la nuit, s'efface à l'approche de l'aube.
    const moonElev = -elev
    this.moonDiscBase = smoothstep(-0.03, 0.1, moonElev) * 0.95
    this.moonGlowBase = smoothstep(0.0, 0.2, moonElev) * 0.3
    // Les étoiles s'allument au crépuscule, pleines en nuit noire.
    this.starsBase = (1 - k) * 0.7
    this.sun.color.copy(SUN_DAY).lerp(SUN_LOW, w)
    this.sun.intensity = 2.35 * k * this.wCur.sun
    // Ombres coupées la nuit : une shadow map pour un soleil éteint est un
    // rendu de profondeur payé pour rien.
    this.sun.castShadow = k > 0.02
    this.hemi.intensity = (0.16 + 0.6 * k) * (0.82 + 0.18 * this.wCur.sun)

    const haze = this.hazeFor(age.fog).lerp(NIGHT_HAZE, 1 - k)
    this.fog.color.copy(haze)

    // Le ciel n'est repeint que quand l'ambiance change vraiment : une aube
    // entière n'écrit la texture qu'une cinquantaine de fois.
    if (Math.abs(k - this.lastDaylight) > 0.02 || Math.abs(w - this.lastWarmth) > 0.02) {
      this.lastDaylight = k
      this.lastWarmth = w
      this.sky.dispose()
      const top = PALETTE.sky.clone().lerp(new Color(age.sky), 0.35).lerp(NIGHT_SKY, 1 - k)
      // L'horizon s'embrase davantage aux heures basses : le halo directionnel
      // fait le point chaud, le dégradé fait la nappe.
      const bottom = haze.clone().lerp(SUN_LOW, w * 0.62)
      this.sky = rampTexture(2, 64, (_u, v, out) => {
        // v=0 est rendu EN HAUT de l'écran (convention DataTexture en fond de
      // scène) : bleu profond au sommet, brume vers l'horizon, transition
      // large pour ne jamais lire comme une barre.
      out.copy(top).lerp(bottom, smoothstep(0.12, 1, v))
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
    const halfV = this.islandRadius * rise + 2.2
    return Math.max(halfV / (FILL_HEIGHT * vTan), this.islandRadius / (FILL_WIDTH * hTan))
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

    // Décalage horizontal = écart entre l'azimut du soleil et le centre de
    // l'horizon arrière visible ; vertical = horizon perçu + montée avec
    // l'élévation. Il glisse hors du cadre (et s'y fond) quand on orbite.
    const D = 30
    let dAz = this.sunAz - (this.azimuth + Math.PI)
    while (dAz > Math.PI) dAz -= Math.PI * 2
    while (dAz < -Math.PI) dAz += Math.PI * 2
    const halfH = Math.tan((this.camera.fov * Math.PI) / 360) * D
    const halfW = halfH * this.camera.aspect
    const gx = D * Math.tan(Math.max(-1.2, Math.min(1.2, dAz)))
    const gy = halfH * (0.52 + Math.max(0, this.sunElev) * 0.75)
    this.sunGlow.position.set(gx, gy, -D)
    // Taille relative au cadre, pas au monde : ~120 % de la demi-hauteur pour
    // le halo, le disque suit (enfant). Sans ça, le quad de 72 unités à 30
    // unités de la caméra avalait la scène entière.
    this.sunGlow.scale.setScalar((halfH * 1.7) / 72)
    // Fondu quand le soleil sort du cadre en orbite.
    const edge = 1 - smoothstep(halfW * 1.1, halfW * 2.2, Math.abs(gx))
    ;(this.sunGlow.material as MeshBasicMaterial).opacity = this.glowBase * edge
    ;(this.sunDisc.material as MeshBasicMaterial).opacity = this.discBase * edge
    this.sunGlow.visible = this.glowBase * edge > 0.01

    // La lune traverse lentement le col d'horizon arrière pendant la nuit —
    // l'azimut de midi du soleil est latéral, hors de la fenêtre visible, et
    // son zénith (élévation 1) sortait du cadre par le haut : trajectoire
    // écran propre, hauteur plafonnée.
    const nightPhase = this.dayU >= 0.5 ? (this.dayU - 0.5) * 2 : 0
    const moonAzWorld = NOON_AZ - ARC - 0.3 + nightPhase * 0.6
    const moonElev = Math.max(0, -this.sunElev)
    // La lune vit dans le monde : elle se lève bas au col d'horizon, culmine,
    // et l'orbite du joueur la déplace naturellement dans le cadre.
    this.moonGlow.position.set(
      Math.sin(moonAzWorld) * 300,
      // Course basse : vue plongeante oblige, le ciel visible est sous
      // l'horizontale — culmination à −27 pour rester dans le cadre.
      -60 + Math.min(moonElev, 0.55) * 60,
      Math.cos(moonAzWorld) * 300,
    )
    this.moonGlow.lookAt(this.camera.position)
    ;(this.moonGlow.material as MeshBasicMaterial).opacity = this.moonGlowBase
    ;(this.moonDisc.material as MeshBasicMaterial).opacity = this.moonDiscBase
    this.moonGlow.visible = this.moonDiscBase > 0.01

    // Traînée sur l'eau : vers le soleil tant qu'il fait jour, vers la lune
    // la nuit. Large et ardente aux heures basses, fine et froide sous la lune.
    const night = this.moonDiscBase > 0.05
    const gAz = night ? moonAzWorld : this.sunAz
    const gMat = this.glint.material as MeshBasicMaterial
    if (night) {
      gMat.color.set('#9fc0e6')
      gMat.opacity = this.moonDiscBase * 0.34
    } else {
      const w = 1 - smoothstep(0.05, 0.42, this.sunElev)
      gMat.color.set('#ffe9b8').lerp(SUN_LOW, w)
      gMat.opacity = this.lastDaylight * (0.14 + 0.4 * w)
    }
    const gLen = 92
    const gWidth = night ? 6 : 7 + 8 * (1 - smoothstep(0.05, 0.42, this.sunElev))
    this.glint.scale.set(gWidth, 1, gLen)
    this.glint.rotation.y = gAz
    this.glint.position.set(Math.sin(gAz) * (26 + gLen / 2), 0.06, Math.cos(gAz) * (26 + gLen / 2))
    // Il scintille : une respiration lente, plus un glissement latéral des
    // cellules cuites — le glitter dérive comme sur une vraie mer au lieu de
    // battre sur place (l'idée du sun-glitter de poseidon, au prix d'un offset).
    gMat.opacity *= 0.86 + 0.14 * Math.sin(this.skyTime * 2.6)
    if (gMat.map) {
      gMat.map.offset.x = Math.sin(this.skyTime * 1.7) * 0.012
      gMat.map.offset.y = Math.sin(this.skyTime * 0.9 + 1.3) * 0.008
    }
    this.glint.visible = gMat.opacity > 0.015

    // La voûte tourne imperceptiblement : le ciel vit même sans orbiter.
    this.stars.rotation.y = this.skyTime * 0.006
    ;(this.stars.material as MeshBasicMaterial).opacity = this.starsBase
    this.stars.visible = this.starsBase > 0.02
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
