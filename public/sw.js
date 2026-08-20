/* Service worker de Tribu : jouable hors-ligne.
 * - navigations : réseau d'abord (pour attraper chaque nouvelle version),
 *   repli sur le cache quand la mer est coupée ;
 * - /assets/ hachés par Vite : cache d'abord, ils sont immuables ;
 * - le nom de cache tourne à l'activation, l'ancien est balayé. */
const CACHE = 'tribu-v1'

self.addEventListener('install', (e) => {
  self.skipWaiting()
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/'])))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return

  if (e.request.mode === 'navigate') {
    e.respondWith(
      (async () => {
        try {
          const fresh = await fetch(e.request)
          const cache = await caches.open(CACHE)
          cache.put('/', fresh.clone())
          return fresh
        } catch {
          return (await caches.match('/')) ?? Response.error()
        }
      })(),
    )
    return
  }

  if (url.pathname.startsWith('/assets/') || /\.(png|webmanifest)$/.test(url.pathname)) {
    e.respondWith(
      (async () => {
        const hit = await caches.match(e.request)
        if (hit) return hit
        const fresh = await fetch(e.request)
        if (fresh.ok) {
          const cache = await caches.open(CACHE)
          cache.put(e.request, fresh.clone())
        }
        return fresh
      })(),
    )
  }
})
