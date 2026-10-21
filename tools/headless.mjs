// Ce que partagent les vérifications headless (console-check, perf-budget,
// shoot, screenshot-readme) : lancer Chromium, servir le build, et juger la
// console.
//
// PW_CHROME choisit un Chromium déjà installé (celui d'une autre version de
// Playwright) au lieu de celui que `playwright install` télécharge.

import { chromium } from 'playwright'

export async function launch() {
  return chromium.launch({
    executablePath: process.env.PW_CHROME || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
}

/** Sert `dist/` avec `vite preview` sur un port libre. Rend { url, close }. */
export async function serveDist() {
  const { preview } = await import('vite')
  const server = await preview({ preview: { port: 0, host: '127.0.0.1', strictPort: false }, logLevel: 'silent' })
  const url = server.resolvedUrls.local[0]
  return { url, close: () => new Promise((r) => server.httpServer.close(r)) }
}

/** La mesure d'audience (Umami) est servie vide : une vérification ne compte
 *  jamais comme une visite, et une requête avortée écrirait une erreur dans la
 *  console. */
export async function blockAudience(context) {
  await context.route(/umami/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }))
}

// ── La console ─────────────────────────────────────────────────────────────
// Tout avertissement et toute erreur font échouer la vérification, sauf ceux
// listés ici. Chaque entrée dit pourquoi elle est tolérée. La liste reste
// courte : un avertissement de dépréciation se corrige dans la PR qui le fait
// apparaître, il ne s'ajoute pas ici.
export const CONSOLE_ALLOW = [
  {
    // Le voisinage (`/api/neighbors`) est servi par le conteneur API en
    // production. Un serveur statique (`python3 -m http.server`, souvent pris
    // par la QA) répond 404 ; le jeu le sait et joue seul. `vite preview`
    // répond la page d'accueil : rien à tolérer.
    match: /Failed to load resource: the server responded with a status of 404/,
    url: /\/api\/neighbors/,
    why: 'voisinage absent hors production (serveur statique)',
  },
]

/** Écoute la console de `page` : `report()` rend tout ce qui a été vu et ce
 *  qui n'est pas dans `CONSOLE_ALLOW`. */
export function watchConsole(page) {
  const seen = []
  page.on('console', (m) => {
    const type = m.type()
    if (type !== 'error' && type !== 'warning') return
    seen.push({ type, text: m.text(), url: m.location()?.url ?? '' })
  })
  page.on('pageerror', (e) => seen.push({ type: 'pageerror', text: String(e), url: '' }))
  return {
    report() {
      const unexpected = seen.filter((s) => !CONSOLE_ALLOW.some((a) => a.match.test(s.text) && (!a.url || a.url.test(s.url))))
      return { seen: [...seen], unexpected }
    },
  }
}
