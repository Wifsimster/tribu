import { chromium } from 'playwright'

export async function launch() {
  return chromium.launch({
    executablePath: process.env.PW_CHROME || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
}

export async function serveDist() {
  const { preview } = await import('vite')
  const server = await preview({ preview: { port: 0, host: '127.0.0.1', strictPort: false }, logLevel: 'silent' })
  const url = server.resolvedUrls.local[0]
  return { url, close: () => new Promise((r) => server.httpServer.close(r)) }
}

export async function blockAudience(context) {
  await context.route(/umami/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }))
}

export const CONSOLE_ALLOW = [
  {
    match: /Failed to load resource: the server responded with a status of 404/,
    url: /\/api\/neighbors/,
    why: 'voisinage absent hors production (serveur statique)',
  },
]

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
