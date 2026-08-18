import { RESOURCES, type ResourceId, type TechDef } from '../game/content'
import type { Game } from '../game/sim'

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`missing #${id}`)
  return node as T
}

/** Idle games live or die on legible big numbers. */
export function fmt(n: number): string {
  if (n < 10) return n.toFixed(1)
  if (n < 1000) return Math.floor(n).toString()
  if (n < 1e6) return `${(n / 1000).toFixed(n < 1e4 ? 2 : 1)} k`
  return `${(n / 1e6).toFixed(2)} M`
}

function fmtRate(n: number): string {
  return `${n < 10 ? n.toFixed(2) : Math.round(n)}/s`
}

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return m > 0 ? `${m} min ${s.toString().padStart(2, '0')}` : `${s} s`
}

export class Hud {
  private resNodes = new Map<ResourceId, { root: HTMLElement; val: HTMLElement; rate: HTMLElement }>()
  private focusButtons = new Map<ResourceId, HTMLButtonElement>()
  private lastValues = new Map<ResourceId, number>()
  private sheetOpen = false

  constructor(
    private game: Game,
    private onFocus: (id: ResourceId) => void,
  ) {
    this.buildResources()
    this.buildFocus()
    this.wire()
    this.refreshTechList()
  }

  private buildResources(): void {
    const host = el('resources')
    host.textContent = ''
    for (const id of Object.keys(RESOURCES) as ResourceId[]) {
      const def = RESOURCES[id]
      const root = document.createElement('div')
      root.className = 'res'
      root.hidden = def.hidden
      root.innerHTML = `<span class="icon">${def.icon}</span><span class="val">0</span><span class="rate"></span>`
      host.appendChild(root)
      this.resNodes.set(id, {
        root,
        val: root.querySelector('.val') as HTMLElement,
        rate: root.querySelector('.rate') as HTMLElement,
      })
    }
  }

  private buildFocus(): void {
    const host = el('focus-row')
    host.textContent = ''
    for (const id of Object.keys(RESOURCES) as ResourceId[]) {
      if (id === 'insight') continue
      const def = RESOURCES[id]
      const btn = document.createElement('button')
      btn.className = 'chip'
      btn.type = 'button'
      btn.hidden = true
      btn.setAttribute('aria-pressed', 'false')
      btn.innerHTML = `${def.icon} ${def.name}`
      btn.addEventListener('click', () => this.onFocus(id))
      host.appendChild(btn)
      this.focusButtons.set(id, btn)
    }
  }

  private wire(): void {
    el('btn-research').addEventListener('click', () => this.toggleSheet(!this.sheetOpen))
    el('sheet-close').addEventListener('click', () => this.toggleSheet(false))
    el('fact-close').addEventListener('click', () => this.closeFact())
    el('btn-expedition').addEventListener('click', () => {
      if (!this.game.startExpedition()) this.toast("Pas assez de nourriture pour partir")
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
    if (open) this.refreshTechList()
  }

  refreshTechList(): void {
    const body = el('sheet-body')
    const techs = this.game.available()
    body.textContent = ''
    if (techs.length === 0) {
      const empty = document.createElement('p')
      empty.style.cssText = 'color:var(--ink-soft);text-align:center;padding:18px 6px;margin:0'
      empty.textContent =
        'Rien de neuf à découvrir pour l’instant. Fais progresser ton âge pour en ouvrir d’autres.'
      body.appendChild(empty)
      return
    }
    for (const t of techs) {
      const affordable = this.game.canResearch(t)
      const btn = document.createElement('button')
      btn.className = 'tech'
      btn.type = 'button'
      btn.disabled = !affordable
      btn.innerHTML = `<span><span class="name">${t.name}</span></span><span class="cost ${
        affordable ? 'ok' : ''
      }">✨ ${fmt(t.cost)}</span>`
      btn.addEventListener('click', () => {
        if (this.game.research(t.id)) this.refreshTechList()
      })
      body.appendChild(btn)
    }
  }

  showFact(tech: TechDef): void {
    el('fact-kicker').textContent = `Découverte · ${this.game.age.name}`
    el('fact-title').textContent = tech.name
    el('fact-text').textContent = tech.fact
    el('fact').classList.add('open')
  }

  private closeFact(): void {
    el('fact').classList.remove('open')
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
    node.textContent = message
    host.appendChild(node)
    setTimeout(() => node.remove(), 3600)
    while (host.childElementCount > 3) host.firstElementChild?.remove()
  }

  update(): void {
    const g = this.game

    for (const [id, node] of this.resNodes) {
      const amount = g.amount(id)
      const visible = amount > 0 || !RESOURCES[id].hidden
      node.root.hidden = !visible
      if (!visible) continue
      const shown = fmt(amount)
      if (node.val.textContent !== shown) node.val.textContent = shown
      const rate = g.rates[id]
      node.rate.textContent = rate > 0 ? fmtRate(rate) : ''
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

    for (const [id, btn] of this.focusButtons) {
      const unlocked = g.unlocked.has(id)
      btn.hidden = !unlocked
      btn.setAttribute('aria-pressed', String(g.save.focus === id))
    }

    el('age-name').textContent = g.age.name
    el('age-period').textContent = g.age.period
    const { done, needed } = g.ageProgress()
    el('age-fill').style.width = `${Math.min(100, (done / needed) * 100)}%`

    const exp = g.save.expedition
    const expBtn = el<HTMLButtonElement>('btn-expedition')
    if (exp) {
      expBtn.disabled = true
      el('expedition-label').textContent = `En route… ${fmtDuration(exp.remaining)}`
      el('expedition-fill').style.transform = `scaleX(${1 - exp.remaining / exp.total})`
    } else {
      expBtn.disabled = !g.canExpedition()
      el('expedition-label').textContent = `Expédition · 🍖 10`
      el('expedition-fill').style.transform = 'scaleX(0)'
    }

    const ready = g.available().filter((t) => g.canResearch(t)).length
    const badge = el('research-badge')
    badge.hidden = ready === 0
    badge.textContent = String(ready)
    if (this.sheetOpen && ready !== this.lastReady) this.refreshTechList()
    this.lastReady = ready
  }

  private lastReady = -1
}
