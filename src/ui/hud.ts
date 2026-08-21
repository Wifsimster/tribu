import { AGES, DAY_SECONDS, DAY_START, DESTINATIONS, RESOURCES, TECHS, TECH_BY_ID, type RelicDef, type ResourceId, type TechDef } from '../game/content'
import type { Game } from '../game/sim'

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`missing #${id}`)
  return node as T
}

// Les emojis se rendent différemment sur chaque plateforme (et rarement bien) :
// on dessine nos propres glyphes, dans les teintes de la scène.
const GLYPHS: Record<ResourceId, string> = {
  food:
    '<path d="M13.6 4.2c1.9-.6 3.6-.3 4.6.8-2.1 1.5-3.9 1.9-5.4 1.3z" fill="#7ba24f"/>' +
    '<path d="M12.2 6.6c-.5-2 .2-3.7 1.6-4.4.9 1.9 1 3.6.3 4.9z" fill="#8fb75c"/>' +
    '<circle cx="9" cy="15" r="5.2" fill="#c2523c"/>' +
    '<circle cx="16.2" cy="16.4" r="4" fill="#d9705a"/>' +
    '<circle cx="7.3" cy="12.9" r="1.5" fill="#dd7a63"/>',
  wood:
    '<path d="M8.2 7.2h9.4a4.8 4.8 0 0 1 0 9.6H8.2z" fill="#835e3b"/>' +
    '<circle cx="8.2" cy="12" r="4.8" fill="#c8a175"/>' +
    '<circle cx="8.2" cy="12" r="2.7" fill="#b0885c"/>' +
    '<circle cx="8.2" cy="12" r="1" fill="#96714a"/>',
  stone:
    '<path d="M4.4 13.9 8.7 6.1l7.1-1.6 4.6 6.4-2.3 6.9-9.4 1.5z" fill="#7e848d"/>' +
    '<path d="m8.7 6.1 7.1-1.6 4.6 6.4-10.2 1.2z" fill="#a5abb3"/>',
  fiber:
    '<path d="M12 21.8a1.3 1.3 0 0 1-1.3-1.3V10.2a1.3 1.3 0 0 1 2.6 0v10.3c0 .7-.6 1.3-1.3 1.3z" fill="#a8873c"/>' +
    '<path d="M11.2 15.4C6.4 14.8 3.7 11.5 3.1 5.3c5.7 1.1 8.3 4.5 8.1 10.1z" fill="#cbac51"/>' +
    '<path d="M12.8 12.6c-.2-5.6 2.4-9 8.1-10.1-.6 6.2-3.3 9.5-8.1 10.1z" fill="#e3c96f"/>',
  clay:
    '<path d="M12 6.6c4.2 0 7.2 3.2 7.2 7.4 0 4-3.2 7-7.2 7s-7.2-3-7.2-7c0-4.2 3-7.4 7.2-7.4z" fill="#b06d47"/>' +
    '<path d="M10.4 5.2h3.2v2.6h-3.2z" fill="#a5643e"/>' +
    '<rect x="7.4" y="2.6" width="9.2" height="2.6" rx="1.3" fill="#8a5133"/>' +
    '<path d="M9.2 11c-1.9 1.7-2.7 3.7-2.3 5.9-1.7-2.8-1.1-5.1 1.6-7z" fill="#cb8b63"/>',
  copper:
    '<path d="M3.6 17.2 6.5 11h11l2.9 6.2z" fill="#b3702f"/>' +
    '<path d="M6.5 11 8.3 7.8h7.4L17.5 11z" fill="#dd9d55"/>',
  iron:
    '<rect x="3.6" y="4.6" width="16.8" height="5.6" rx="1.7" fill="#6d737c"/>' +
    '<path d="M15 4.6h3.7a1.7 1.7 0 0 1 1.7 1.7v2.2a1.7 1.7 0 0 1-1.7 1.7H15z" fill="#8d939c"/>' +
    '<rect x="10.6" y="9.4" width="2.8" height="10.6" rx="1.4" fill="#8a6440"/>',
  insight:
    '<path d="M12 2.2c.9 5 3.7 7.8 8.8 8.7-5.1.9-7.9 3.7-8.8 8.7-.9-5-3.7-7.8-8.8-8.7 5.1-.9 7.9-3.7 8.8-8.7z" fill="#d9a441"/>' +
    '<path d="M18.6 15.4c.4 2 1.5 3.1 3.4 3.5-1.9.4-3 1.5-3.4 3.4-.4-1.9-1.4-3-3.4-3.4 2-.4 3-1.5 3.4-3.5z" fill="#eac272"/>',
}

function icon(id: ResourceId, size = 15): string {
  return `<svg class="glyph" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">${GLYPHS[id]}</svg>`
}

/** Les messages venant du jeu portent encore les emojis de content.ts. */
const EMOJI: Array<[string, ResourceId]> = (Object.keys(RESOURCES) as ResourceId[]).map((id) => [
  RESOURCES[id].icon,
  id,
])
const EMOJI_RE = new RegExp(EMOJI.map(([char]) => char).join('|'), 'g')

/** Texte d'ailleurs (pseudo d'un voisin, par exemple) : jamais injecté brut. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  )
}

function withGlyphs(s: string): string {
  return escapeHtml(s).replace(EMOJI_RE, (char) => {
    const hit = EMOJI.find(([c]) => c === char)
    return hit ? icon(hit[1], 14) : char
  })
}

const comma = (s: string): string => s.replace('.', ',')

/** Idle games live or die on legible big numbers. */
export function fmt(n: number): string {
  if (n < 10) return Number.isInteger(n) ? n.toString() : comma(n.toFixed(1))
  if (n < 1000) return Math.floor(n).toString()
  if (n < 1e6) return `${comma((n / 1000).toFixed(n < 1e4 ? 2 : 1))} k`
  return `${comma((n / 1e6).toFixed(2))} M`
}

function fmtRate(n: number): string {
  return `${comma(n < 10 ? n.toFixed(2) : Math.round(n).toString())}/s`
}

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return m > 0 ? `${m} min ${s.toString().padStart(2, '0')}` : `${s} s`
}

export class Hud {
  private resNodes = new Map<ResourceId, { root: HTMLElement; val: HTMLElement; rate: HTMLElement }>()
  private lastValues = new Map<ResourceId, number>()
  private sheetOpen = false
  private factOpen = false

  constructor(private game: Game) {
    this.buildResources()
    this.wire()
    this.refreshTechList()
  }

  /** Un tap sur une ressource du bandeau explique ce qu'elle est, d'où elle
   *  vient et à quoi elle sert. */
  private static readonly RES_HELP: Record<ResourceId, string> = {
    food: 'Nourriture — buissons, chasse, champs. Paie les expéditions et quelques découvertes.',
    wood: 'Bois — tape un arbre pour y envoyer le colon. Sert aux découvertes et aux bâtiments.',
    stone: 'Pierre — tape un rocher. La base des outils et des grandes constructions.',
    fiber: 'Fibres — récoltées depuis le cordage. Cordes, tissage, voiles.',
    clay: "Argile — récoltée depuis la poterie. Jarres, tablettes, fours.",
    copper: 'Cuivre — récolté depuis la métallurgie du cuivre. Bronze, instruments, câbles.',
    iron: 'Fer — récolté depuis la forge. Outils, rails, machines.',
    insight: "Savoir — l'étincelle : il coule du travail de la tribu et paie chaque découverte.",
  }

  private buildResources(): void {
    const host = el('resources')
    host.textContent = ''
    for (const id of Object.keys(RESOURCES) as ResourceId[]) {
      const def = RESOURCES[id]
      const root = document.createElement('div')
      root.className = 'res'
      root.hidden = def.hidden
      root.innerHTML = `${icon(id, 14)}<span class="sr">${def.name}</span><span class="val">0</span><span class="rate"></span>`
      root.addEventListener('click', () => this.toast(Hud.RES_HELP[id]))
      host.appendChild(root)
      this.resNodes.set(id, {
        root,
        val: root.querySelector('.val') as HTMLElement,
        rate: root.querySelector('.rate') as HTMLElement,
      })
    }
    // La pastille qui replie le bandeau : l'essentiel de l'époque d'abord,
    // tout le grenier au tap.
    const more = document.createElement('div')
    more.className = 'res more'
    more.id = 'res-more'
    more.hidden = true
    more.innerHTML = '<span class="val" id="res-more-label">+0</span>'
    more.addEventListener('click', () => {
      this.allRes = !this.allRes
      this.update()
    })
    host.appendChild(more)
  }

  private wire(): void {
    el('btn-research').addEventListener('click', () => this.toggleSheet(!this.sheetOpen))
    el('daydial').addEventListener('click', () => this.toast(this.dayDialHint()))
    el('sheet-close').addEventListener('click', () => this.toggleSheet(false))
    el('fact-close').addEventListener('click', () => this.closeFact())
    el('scrim').addEventListener('click', () => {
      this.closeFact()
      this.toggleSheet(false)
    })
    el('btn-expedition').addEventListener('click', () => {
      if (this.game.save.expedition) return
      if (!this.game.seaOpen) {
        this.toast("La mer est noire : sans phare, aucune barque ne quitte l'île avant l'aube")
        return
      }
      if (!this.game.canExpedition()) {
        this.toast('Pas assez de nourriture pour partir')
        return
      }
      this.toggleDest(!this.destOpen)
    })
    // Le choix se referme si l'on touche ailleurs : c'est un menu, pas un modal.
    document.addEventListener('pointerdown', (e) => {
      if (!this.destOpen) return
      const t = e.target as HTMLElement
      if (t.closest('#dest-chooser') || t.closest('#btn-expedition')) return
      this.toggleDest(false)
    })
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeFact()
        this.toggleSheet(false)
      }
    })
  }

  toggleSheet(open: boolean): void {
    this.sheetOpen = open
    el('sheet').classList.toggle('open', open)
    this.syncScrim()
    if (open) {
      this.refreshTechList()
      // Ouvrir sur le prochain savoir à débloquer, pas sur le Paléolithique.
      requestAnimationFrame(() => {
        const body = el('sheet-body')
        const next = body.querySelector<HTMLElement>('.tech.next')
        body.scrollTop = next ? Math.max(0, next.offsetTop - body.offsetTop - 84) : 0
      })
    }
  }

  /** Un seul voile pour la feuille et la carte : la scène reste le sujet. */
  private syncScrim(): void {
    el('scrim').classList.toggle('on', this.sheetOpen || this.factOpen)
  }

  /** L'arbre complet, âge par âge : l'acquis, l'atteignable, et la route qui
   *  reste. Un idle vit de montrer au joueur où il va. */
  private nextMarked = false

  /** La carte de la Merveille, en tête de la feuille de savoir. */
  private wonderCard(body: HTMLElement): void {
    const ws = this.game.wonderState()
    if (!ws) return
    const card = document.createElement('div')
    card.className = 'wonder-card'
    if (ws.status === 'done') {
      card.innerHTML = `<b>${ws.def.name}</b><span class="wonder-note">Achevée — elle inspire la tribu (+4 % de récolte).</span>`
    } else if (ws.status === 'building') {
      card.innerHTML = `<b>${ws.def.name}</b><span class="wonder-note">Chantier en cours — les surplus y sont versés.</span><div class="wonder-bar"><i style="width:${Math.round(ws.progress * 100)}%"></i></div><span class="wonder-note">${Math.round(ws.progress * 100)} %</span>`
    } else {
      const costs = Object.entries(ws.def.cost)
        .map(([id, n]) => `${icon(id as ResourceId, 12)} ${fmt(n as number)}`)
        .join('  ')
      card.innerHTML = `<b>${ws.def.name}</b><span class="wonder-note">La grande œuvre de l'époque. Le chantier boira lentement tes surplus : ${costs}</span>`
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'btn primary wide'
      btn.innerHTML = '<span class="label">Lancer le chantier</span>'
      btn.addEventListener('click', () => {
        if (this.game.startWonder()) this.refreshTechList()
      })
      card.appendChild(btn)
    }
    body.appendChild(card)
  }

  refreshTechList(): void {
    const g = this.game
    const body = el('sheet-body')
    this.nextMarked = false
    body.textContent = ''
    this.wonderCard(body)

    for (const age of AGES) {
      const ageTechs = TECHS.filter((t) => t.age === age.id)
      const done = ageTechs.filter((t) => g.knows(t.id)).length
      const future = age.id > g.save.age

      const head = document.createElement('div')
      head.className = `age-h${future ? ' future' : ''}`
      head.innerHTML =
        `<span class="age-h-name">${age.name}</span>` +
        `<span class="age-h-meta">${future ? '🔒' : `${done}/${ageTechs.length}`}</span>`
      body.appendChild(head)

      for (const t of ageTechs) {
        const known = g.knows(t.id)
        const missing = t.requires.filter((r) => !g.knows(r))
        const reachable = !future && missing.length === 0
        const affordable = reachable && !known && g.canResearch(t)

        const btn = document.createElement('button')
        btn.type = 'button'
        // Le premier savoir atteignable est LE prochain objectif : marqué, et
        // la feuille s'ouvre dessus.
        const isNext = !known && reachable && !this.nextMarked
        if (isNext) this.nextMarked = true
        btn.className = `tech${known ? ' done' : ''}${!known && !reachable ? ' locked' : ''}${isNext ? ' next' : ''}`
        // Une techno acquise reste tapable : elle rejoue son fait historique.
        btn.disabled = !known && !affordable

        let right: string
        if (known) right = `<span class="cost done-mark">✓</span>`
        else if (future) right = `<span class="cost">🔒</span>`
        else {
          // Chaque composant du prix est marqué séparément : le joueur voit d'un
          // coup d'œil CE QUI manque, pas seulement qu'il manque quelque chose.
          const parts = [
            `<span class="${g.amount('insight') >= t.cost ? 'have' : 'lack'}">${icon('insight', 13)}${fmt(t.cost)}</span>`,
          ]
          if (t.materials) {
            for (const [res, n] of Object.entries(t.materials) as [ResourceId, number][]) {
              parts.push(
                `<span class="${g.amount(res) >= n ? 'have' : 'lack'}">${icon(res, 13)}${fmt(n)}</span>`,
              )
            }
          }
          right = `<span class="cost ${affordable ? 'ok' : ''}">${parts.join('')}</span>`
        }

        const needs =
          !known && !future && missing.length > 0
            ? `<span class="needs">requiert ${missing
                .map((r) => TECH_BY_ID.get(r)?.name ?? r)
                .join(', ')}</span>`
            : ''

        btn.innerHTML = `<span class="tech-main"><span class="name">${t.name}</span>${needs}</span>${right}`
        btn.addEventListener('click', () => {
          if (known) this.showFact(t)
          else if (this.game.research(t.id)) this.refreshTechList()
        })
        body.appendChild(btn)
      }
    }
  }

  /** Le choix de la destination : trois tempéraments, pas des tableaux de
   *  chiffres — durée estimée et niveau de risque en toutes lettres. */
  private destOpen = false

  private toggleDest(open: boolean): void {
    this.destOpen = open
    const host = el('dest-chooser')
    host.hidden = !open
    if (!open) {
      // Ceinture et bretelles : vidé, le panneau ne peut rien montrer même si
      // une règle CSS lui rendait un jour son display.
      host.textContent = ''
      return
    }
    host.textContent = ''
    for (const d of DESTINATIONS) {
      const sec = this.game.expeditionDuration(d.id)
      const dur = sec < 100 ? `${Math.round(sec / 10) * 10} s` : `${Math.round(sec / 60)} min`
      const risk = d.risk === 0 ? 'sans risque' : d.risk < 0.2 ? 'risque modéré' : 'risque élevé'
      const reachable = this.game.canReach(d.id)
      const row = document.createElement('button')
      row.type = 'button'
      row.className = reachable ? 'dest' : 'dest locked'
      row.innerHTML = `<span class="dest-name">${d.name}</span><span class="dest-blurb">${
        reachable ? d.blurb : `Nécessite ${d.needs} — le radeau n'ira pas si loin.`
      }</span><span class="dest-meta">${reachable ? `~${dur} · ${risk}` : 'hors de portée'}</span>`
      row.addEventListener('click', () => {
        if (!reachable) {
          this.toast(`Il faut ${d.needs} pour atteindre ${d.name.toLowerCase()}`)
          return
        }
        this.toggleDest(false)
        if (!this.game.startExpedition(d.id)) this.toast('Pas assez de nourriture pour partir')
      })
      host.appendChild(row)
    }
    // Les îles du voisinage : de vraies tribus, à visiter comme on visite une
    // côte — mais elles, elles le sauront.
    for (const v of this.game.visitable.slice(0, 4)) {
      const reachable = this.game.canReach('visite')
      const sec = this.game.expeditionDuration('visite')
      const dur = sec < 100 ? `${Math.round(sec / 10) * 10} s` : `${Math.round(sec / 60)} min`
      const row = document.createElement('button')
      row.type = 'button'
      row.className = reachable ? 'dest visit' : 'dest visit locked'
      row.innerHTML =
        `<span class="dest-name">Chez ${escapeHtml(v.name)}</span>` +
        `<span class="dest-blurb">${
          reachable
            ? 'Une autre tribu, en chair et en feux — ils sauront que nous sommes venus.'
            : "Nécessite la barque à voile — leur île est au-delà de la côte."
        }</span>` +
        `<span class="dest-meta">${reachable ? `~${dur} · risque modéré` : 'hors de portée'}</span>`
      row.addEventListener('click', () => {
        if (!reachable) {
          this.toast('Il faut la barque à voile pour aller chez eux')
          return
        }
        this.toggleDest(false)
        if (!this.game.startVisit(v.id, v.name)) this.toast('Pas assez de nourriture pour partir')
      })
      host.appendChild(row)
    }

    // L'ambassade : fonder le comptoir de l'îlot, une seule fois, avec la voile.
    if (this.game.knows('sail') && !this.game.save.outpost) {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'dest embassy'
      row.innerHTML = `<span class="dest-name">L'ambassade</span><span class="dest-blurb">Répondre aux feux de l'îlot — fonder un comptoir (provisions doublées).</span><span class="dest-meta">une seule fois</span>`
      row.addEventListener('click', () => {
        this.toggleDest(false)
        if (!this.game.startExpedition('ilot', true)) this.toast('Pas assez de nourriture pour une ambassade')
      })
      host.appendChild(row)
    }
  }

  /** Les vitrines du musée : chaque relique et son histoire vraie. */
  showMuseum(relics: RelicDef[]): void {
    el('fact-kicker').textContent = 'Le musée de la tribu'
    el('fact-title').textContent =
      relics.length === 0
        ? 'Les vitrines attendent'
        : relics.length === 1
          ? 'Une relique exposée'
          : `${relics.length} reliques exposées`
    el('fact-text').textContent =
      relics.length === 0
        ? "Les expéditions rapportent parfois une relique — c'est ici qu'elle sera exposée."
        : relics.map((r) => `${r.name} — ${r.fact}`).join('\n\n')
    el('fact').classList.add('open')
    this.factOpen = true
    this.syncScrim()
    el<HTMLButtonElement>('fact-close').focus({ preventScroll: true })
  }

  /** Une histoire hors savoir : épave, événement — même écrin que les faits. */
  showStory(kicker: string, title: string, text: string): void {
    el('fact-kicker').textContent = kicker
    el('fact-title').textContent = title
    el('fact-text').textContent = text
    el('fact').classList.add('open')
    this.factOpen = true
    this.syncScrim()
    el<HTMLButtonElement>('fact-close').focus({ preventScroll: true })
  }

  showFact(tech: TechDef): void {
    el('fact-kicker').textContent = `Découverte · ${this.game.age.name}`
    el('fact-title').textContent = tech.name
    el('fact-text').textContent = tech.fact
    el('fact').classList.add('open')
    this.factOpen = true
    this.syncScrim()
    el<HTMLButtonElement>('fact-close').focus({ preventScroll: true })
  }

  private closeFact(): void {
    el('fact').classList.remove('open')
    this.factOpen = false
    this.syncScrim()
  }

  showBanner(small: string, big: string): void {
    const banner = el('banner')
    el('banner-small').textContent = small
    el('banner-big').textContent = big
    banner.classList.remove('show')
    void banner.offsetWidth // restart the animation
    banner.classList.add('show')
  }

  toast(message: string): void {
    const host = el('toasts')
    const node = document.createElement('div')
    node.className = 'toast'
    node.innerHTML = withGlyphs(message)
    // Une anecdote de deux lignes mérite plus que 3,4 s ; un « De retour » non.
    const seconds = Math.min(9, 2.6 + message.length * 0.045)
    node.style.animationDuration = `${seconds}s`
    host.appendChild(node)
    setTimeout(() => node.remove(), seconds * 1000 + 200)
    while (host.childElementCount > 3) host.firstElementChild?.remove()
  }

  /** L'heure du monde, en tour de cadran (0 = lever, 0,5 = coucher). */
  private dayU(): number {
    return (DAY_START + this.game.save.totalPlaySeconds / DAY_SECONDS) % 1
  }

  /** La nuit commence quand la part de jour touche zéro (sin = −0,06). */
  private static readonly DUSK = 0.515
  private static readonly DAWN = 0.985

  private dayDialHint(): string {
    const u = this.dayU()
    const dur = (s: number): string => (s < 75 ? `${Math.max(5, Math.round(s / 5) * 5)} s` : `${Math.round(s / 60)} min`)
    if (u < Hud.DUSK) {
      const s = (Hud.DUSK - u) * DAY_SECONDS
      return u < 0.06
        ? `Le soleil se lève — la nuit tombera dans ${dur(s)}`
        : `Le soleil suit sa course — la nuit tombe dans ${dur(s)}`
    }
    const s = ((Hud.DAWN - u + 1) % 1) * DAY_SECONDS
    // Tant que la veillée dure, on le dit ; ensuite la tribu dort, à toutes les
    // époques — aucun savoir n'abolit le cœur de la nuit.
    const veille = !this.game.sleepTime
      ? this.game.knows('electricity')
        ? 'Sous le lampadaire, la tribu veille encore'
        : 'À la lueur des lampes, la tribu veille encore'
      : this.game.knows('electricity')
        ? 'Le lampadaire veille sur le village endormi'
        : this.game.age.id >= 4
          ? 'Le brasero veille sur le village endormi'
          : 'La tribu dort autour du feu'
    const mer = this.game.canSailAtNight ? ' — le phare tient la passe' : ''
    return `${veille}${mer} — le jour se lève dans ${dur(s)}`
  }

  private lastDialKey = ''
  private updateDayDial(): void {
    const u = this.dayU()
    const key = u.toFixed(3)
    if (key === this.lastDialKey) return
    this.lastDialKey = key
    const day = u < Hud.DUSK
    const sun = el('daydial-sun')
    const moon = el('daydial-moon')
    const place = (node: HTMLElement, p: number): void => {
      const x = 24 - 18 * Math.cos(p * Math.PI)
      const y = 21 - 16 * Math.sin(p * Math.PI)
      node.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`)
    }
    sun.setAttribute('visibility', day ? 'visible' : 'hidden')
    moon.setAttribute('visibility', day ? 'hidden' : 'visible')
    if (day) {
      const p = Math.min(1, u / 0.5)
      place(sun, p)
      // Deux teintes, façon toon : doré en journée, cuivré aux heures basses.
      const low = Math.sin(p * Math.PI) < 0.35
      sun.querySelector('circle')?.setAttribute('fill', low ? '#ff9a4e' : '#ffd76a')
    } else {
      place(moon, Math.min(1, Math.max(0, (u - 0.5) / 0.5)))
    }
  }

  /** Bandeau replié : montrer toutes les ressources, ou l'essentiel du moment. */
  private allRes = false
  private lastEssKey = ''
  private essCache = new Set<ResourceId>()

  /** Les ressources qui comptent MAINTENANT : le savoir (paie tout), le focus
   *  du colon, et les matériaux des découvertes à portée dans l'époque. */
  private essential(): Set<ResourceId> {
    const g = this.game
    const key = `${g.age.id}|${g.save.focus}|${g.save.techs.length}`
    if (key === this.lastEssKey) return this.essCache
    this.lastEssKey = key
    const set = new Set<ResourceId>(['insight', g.save.focus])
    for (const t of TECHS) {
      if (t.age !== g.age.id || g.knows(t.id)) continue
      if (t.requires.some((r) => !g.knows(r))) continue
      for (const id of Object.keys(t.materials ?? {}) as ResourceId[]) set.add(id)
    }
    this.essCache = set
    return set
  }

  update(): void {
    this.updateDayDial()
    const g = this.game

    const ess = this.essential()
    let folded = 0
    for (const [id, node] of this.resNodes) {
      const amount = g.amount(id)
      const owned = amount > 0 || !RESOURCES[id].hidden
      const visible = owned && (this.allRes || ess.has(id))
      if (owned && !visible) folded++
      node.root.hidden = !visible
      if (!visible) continue
      const shown = fmt(amount)
      if (node.val.textContent !== shown) node.val.textContent = shown
      // Un débit par ressource, c'est huit chiffres qui bougent : on ne montre
      // que celui sur lequel le colon travaille, plus le savoir qui coule seul.
      const lead = id === g.save.focus
      node.root.classList.toggle('lead', lead || id === 'insight')
      const rate = g.rates[id]
      const shownRate = (lead || id === 'insight') && rate > 0 ? fmtRate(rate) : ''
      if (node.rate.textContent !== shownRate) node.rate.textContent = shownRate
      const prev = this.lastValues.get(id) ?? 0
      if (amount - prev > Math.max(5, prev * 0.05)) {
        node.root.classList.remove('bump')
        void node.root.offsetWidth
        node.root.classList.add('bump')
        this.lastValues.set(id, amount)
      } else if (amount < prev) {
        this.lastValues.set(id, amount)
      } else if (prev === 0) {
        this.lastValues.set(id, amount)
      }
    }

    const more = el('res-more')
    more.hidden = folded === 0 && !this.allRes
    el('res-more-label').textContent = this.allRes ? '\u2212' : `+${folded}`
    more.title = this.allRes ? "Replier les ressources" : 'Tout afficher'

    if (this.lastAge !== g.age.id) {
      el('age-name').textContent = g.age.name
      el('age-period').textContent = g.age.period
      this.lastAge = g.age.id
    }
    const { done, needed } = g.ageProgress()
    const step = `${Math.min(done, needed)}/${needed}`
    if (this.lastStep !== step) {
      el('age-step').textContent = step
      el('age-fill').style.width = `${Math.min(100, (done / needed) * 100)}%`
      this.lastStep = step
    }

    const exp = g.save.expedition
    const expBtn = el<HTMLButtonElement>('btn-expedition')
    const label = el('expedition-label')
    if (exp) {
      expBtn.disabled = true
      // Voyage terminé mais la passe est noire : la barque attend l'aube au
      // large. Le compte est bloqué à zéro par la sim, il ne dirait rien.
      const text =
        exp.remaining <= 0 && !g.seaOpen ? "Au large… attend l'aube" : `En route… ${fmtDuration(exp.remaining)}`
      if (this.lastExpLabel !== text) {
        label.textContent = text
        this.lastExpLabel = text
      }
      el('expedition-fill').style.transform = `scaleX(${1 - exp.remaining / exp.total})`
    } else {
      expBtn.disabled = !g.canExpedition()
      // Le SVG coûte un reparse : on ne le réécrit qu'au changement d'état
      // (le coût varie avec l'âge, il fait donc partie de la clé).
      const key = g.seaOpen ? `idle-${g.expeditionCost()}` : 'idle-dark'
      if (this.lastExpLabel !== key) {
        label.innerHTML = g.seaOpen
          ? `Expédition <span class="cost">${icon('food', 14)}${fmt(g.expeditionCost())}</span>`
          : 'La mer est noire — aucune barque avant l’aube'
        this.lastExpLabel = key
      }
      el('expedition-fill').style.transform = 'scaleX(0)'
    }

    const ready = g.available().filter((t) => g.canResearch(t)).length
    const badge = el('research-badge')
    badge.hidden = ready === 0
    if (badge.textContent !== String(ready)) badge.textContent = String(ready)
    if (this.sheetOpen && ready !== this.lastReady) this.refreshTechList()
    this.lastReady = ready
  }

  private lastReady = -1
  private lastAge = -1
  private lastStep = ''
  private lastExpLabel = ''
}
