/** L'ambiance sonore de l'île, entièrement synthétisée : pas un échantillon,
 *  pas un téléchargement. Ressac filtré, crépitement du feu (puis bourdon du
 *  lampadaire), oiseaux le jour, grillons la nuit, rideau de pluie, cloche du
 *  campanile. Tout est doux par construction — c'est une ambiance, pas une
 *  bande-son. Coupée par défaut ; l'activation (un geste utilisateur) crée le
 *  contexte, la préférence persiste. */

const PREF_KEY = 'tribu.sound.v1'

export type FireMode = 'open' | 'brazier' | 'lamp'

interface Layers {
  surf: GainNode
  fire: GainNode
  hum: GainNode
  rain: GainNode
}

export class Ambience {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private layers: Layers | null = null
  private enabled: boolean
  private birdTimer = 4
  private cricketTimer = 2
  private crackleTimer = 0.3

  constructor() {
    let pref: string | null = null
    try {
      pref = localStorage.getItem(PREF_KEY)
    } catch {
      /* stockage indisponible : préférence en mémoire seulement */
    }
    this.enabled = pref === 'on'
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  /** Au premier geste d'une session : reprendre si la préférence est « on ». */
  resumeIfOn(): void {
    if (this.enabled) this.start()
  }

  /** Bascule depuis le menu — le clic est le geste qui autorise l'audio. */
  toggle(): boolean {
    this.enabled = !this.enabled
    try {
      localStorage.setItem(PREF_KEY, this.enabled ? 'on' : 'off')
    } catch {
      /* tant pis, la préférence vivra le temps de la session */
    }
    if (this.enabled) this.start()
    else this.stop()
    return this.enabled
  }

  private start(): void {
    if (this.ctx) {
      void this.ctx.resume()
      return
    }
    const ctx = new AudioContext()
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = 0.55
    this.master.connect(ctx.destination)

    // Un buffer de bruit partagé : la matière première de la mer, du feu et
    // de la pluie — seuls les filtres diffèrent.
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const data = noiseBuf.getChannelData(0)
    let last = 0
    for (let i = 0; i < data.length; i++) {
      // Bruit rosé approximatif : le blanc pur siffle, la mer ne siffle pas.
      const white = Math.random() * 2 - 1
      last = last * 0.94 + white * 0.06
      data[i] = last * 3.2
    }
    const noiseSrc = (): AudioBufferSourceNode => {
      const src = ctx.createBufferSource()
      src.buffer = noiseBuf
      src.loop = true
      src.start()
      return src
    }

    // Ressac : bruit très grave, gonflé par deux respirations désaccordées —
    // leur battement fait qu'aucune vague ne ressemble à la précédente.
    const surf = ctx.createGain()
    surf.gain.value = 0
    const surfLp = ctx.createBiquadFilter()
    surfLp.type = 'lowpass'
    surfLp.frequency.value = 420
    noiseSrc().connect(surfLp).connect(surf).connect(this.master)
    const swell = ctx.createGain()
    swell.gain.value = 0.5
    surfLp.frequency.value = 380
    for (const [freq, depth] of [
      [0.07, 90],
      [0.11, 60],
    ] as const) {
      const lfo = ctx.createOscillator()
      lfo.frequency.value = freq
      const lfoGain = ctx.createGain()
      lfoGain.gain.value = depth
      lfo.connect(lfoGain).connect(surfLp.frequency)
      lfo.start()
    }

    // Feu : un souffle grave continu ; les claquements sont ajoutés par tick.
    const fire = ctx.createGain()
    fire.gain.value = 0
    const fireLp = ctx.createBiquadFilter()
    fireLp.type = 'lowpass'
    fireLp.frequency.value = 240
    noiseSrc().connect(fireLp).connect(fire).connect(this.master)

    // Lampadaire : un bourdon de secteur, à peine audible.
    const hum = ctx.createGain()
    hum.gain.value = 0
    const humOsc = ctx.createOscillator()
    humOsc.frequency.value = 100
    const humOsc2 = ctx.createOscillator()
    humOsc2.frequency.value = 200
    const humMix = ctx.createGain()
    humMix.gain.value = 0.35
    humOsc.connect(hum)
    humOsc2.connect(humMix).connect(hum)
    hum.connect(this.master)
    humOsc.start()
    humOsc2.start()

    // Pluie : bruit clair, dosé par la météo.
    const rain = ctx.createGain()
    rain.gain.value = 0
    const rainHp = ctx.createBiquadFilter()
    rainHp.type = 'highpass'
    rainHp.frequency.value = 900
    noiseSrc().connect(rainHp).connect(rain).connect(this.master)

    this.layers = { surf, fire, hum, rain }
    void swell
  }

  private stop(): void {
    if (!this.ctx) return
    void this.ctx.suspend()
  }

  /** Un claquement de braise : une bouffée de bruit très courte. */
  private crackle(loud: number): void {
    if (!this.ctx || !this.master) return
    const ctx = this.ctx
    const dur = 0.02 + Math.random() * 0.04
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
    const src = ctx.createBufferSource()
    src.buffer = buf
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 900 + Math.random() * 2600
    const g = ctx.createGain()
    g.gain.value = loud * (0.12 + Math.random() * 0.25)
    src.connect(bp).connect(g).connect(this.master)
    src.start()
  }

  /** Un pépiement : deux glissandos sinus très brefs. */
  private chirp(): void {
    if (!this.ctx || !this.master) return
    const ctx = this.ctx
    const t0 = ctx.currentTime
    for (let n = 0; n < 2 + Math.floor(Math.random() * 3); n++) {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      const start = t0 + n * (0.09 + Math.random() * 0.07)
      const f0 = 2400 + Math.random() * 1800
      osc.frequency.setValueAtTime(f0, start)
      osc.frequency.exponentialRampToValueAtTime(f0 * (0.7 + Math.random() * 0.7), start + 0.07)
      g.gain.setValueAtTime(0, start)
      g.gain.linearRampToValueAtTime(0.05 + Math.random() * 0.04, start + 0.015)
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.09)
      osc.connect(g).connect(this.master)
      osc.start(start)
      osc.stop(start + 0.12)
    }
  }

  /** Une strideur de grillon : un train de pulsations aiguës. */
  private cricket(): void {
    if (!this.ctx || !this.master) return
    const ctx = this.ctx
    const t0 = ctx.currentTime
    const f = 3800 + Math.random() * 900
    for (let n = 0; n < 6 + Math.floor(Math.random() * 6); n++) {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      const start = t0 + n * 0.055
      osc.frequency.value = f
      g.gain.setValueAtTime(0, start)
      g.gain.linearRampToValueAtTime(0.016, start + 0.008)
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.045)
      osc.connect(g).connect(this.master)
      osc.start(start)
      osc.stop(start + 0.05)
    }
  }

  /** Toc de bois : le retour du doigt quand on désigne un arbre, un rocher. */
  knock(): void {
    if (!this.enabled || !this.ctx || !this.master) return
    const ctx = this.ctx
    const t0 = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(220 + Math.random() * 60, t0)
    osc.frequency.exponentialRampToValueAtTime(90, t0 + 0.07)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.14, t0)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09)
    osc.connect(g).connect(this.master)
    osc.start(t0)
    osc.stop(t0 + 0.1)
  }

  /** Carillon de découverte : deux notes claires, une tierce au-dessus. */
  chime(): void {
    if (!this.enabled || !this.ctx || !this.master) return
    const ctx = this.ctx
    const t0 = ctx.currentTime
    for (const [f, at] of [
      [660, 0],
      [830, 0.11],
    ] as const) {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.frequency.value = f
      g.gain.setValueAtTime(0, t0 + at)
      g.gain.linearRampToValueAtTime(0.07, t0 + at + 0.012)
      g.gain.exponentialRampToValueAtTime(0.001, t0 + at + 0.5)
      osc.connect(g).connect(this.master)
      osc.start(t0 + at)
      osc.stop(t0 + at + 0.55)
    }
  }

  /** Tintement de pièces : le marchand est passé par là. */
  coin(): void {
    if (!this.enabled || !this.ctx || !this.master) return
    const ctx = this.ctx
    const t0 = ctx.currentTime
    for (let n = 0; n < 3; n++) {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      const at = n * (0.05 + Math.random() * 0.04)
      osc.frequency.value = 2300 + Math.random() * 1600
      g.gain.setValueAtTime(0, t0 + at)
      g.gain.linearRampToValueAtTime(0.05, t0 + at + 0.006)
      g.gain.exponentialRampToValueAtTime(0.001, t0 + at + 0.16)
      osc.connect(g).connect(this.master)
      osc.start(t0 + at)
      osc.stop(t0 + at + 0.2)
    }
  }

  /** La cloche du campanile : une fondamentale et deux partiels inharmoniques. */
  bell(): void {
    if (!this.enabled || !this.ctx || !this.master) return
    const ctx = this.ctx
    const t0 = ctx.currentTime
    for (const [ratio, amp, decay] of [
      [1, 0.16, 2.6],
      [2.76, 0.08, 1.6],
      [5.4, 0.03, 0.9],
    ] as const) {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.frequency.value = 392 * ratio
      g.gain.setValueAtTime(amp, t0)
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + decay)
      osc.connect(g).connect(this.master)
      osc.start(t0)
      osc.stop(t0 + decay + 0.1)
    }
  }

  /** Mixage continu, appelé chaque frame par la boucle de rendu. */
  update(dt: number, daylight: number, rainLevel: number, fireMode: FireMode, settlerAway: boolean): void {
    if (!this.enabled || !this.ctx || !this.layers) return
    const L = this.layers
    const ease = Math.min(1, dt * 1.5)
    const to = (g: GainNode, v: number): void => {
      g.gain.value += (v - g.gain.value) * ease
    }

    to(L.surf, 0.1 + 0.03 * (1 - daylight))
    const fireOn = fireMode !== 'lamp'
    to(L.fire, fireOn ? 0.05 + 0.05 * (1 - daylight) : 0)
    to(L.hum, fireMode === 'lamp' ? 0.008 + 0.012 * (1 - daylight) : 0)
    to(L.rain, rainLevel * 0.16)

    if (fireOn) {
      this.crackleTimer -= dt
      if (this.crackleTimer <= 0) {
        this.crackleTimer = 0.12 + Math.random() * 0.7
        this.crackle(fireMode === 'brazier' ? 0.7 : 1)
      }
    }
    if (daylight > 0.5 && !settlerAway) {
      this.birdTimer -= dt
      if (this.birdTimer <= 0) {
        this.birdTimer = 5 + Math.random() * 11
        this.chirp()
      }
    }
    if (daylight < 0.2) {
      this.cricketTimer -= dt
      if (this.cricketTimer <= 0) {
        this.cricketTimer = 2.5 + Math.random() * 5
        this.cricket()
      }
    }
  }
}
