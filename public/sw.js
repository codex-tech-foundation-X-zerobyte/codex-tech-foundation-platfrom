// Cache name includes a version marker — bump CACHE_VERSION on any release
// where you need to force-invalidate old clients' caches. Combined with
// skipWaiting()/clients.claim() below, this closes the "deployed app keeps
// serving an old bundle until every tab is closed" class of bug — a new
// service worker now activates and takes over immediately instead of
// waiting indefinitely for existing tabs to close.
const CACHE_VERSION = 'v6'
const CACHE = `codex-shell-${CACHE_VERSION}`

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['/', '/manifest.webmanifest'])))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // Purge any cache from a previous version — prevents an old cached
      // shell from ever being served after this activates.
      caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
      self.clients.claim(),
    ]),
  )
})

// Local development (npm run dev): never sit between the browser and the dev server. Vite serves a live module graph and
// hot-reloads it; if this worker answered any of those requests — or failed to — the app would break in confusing ways.
// The worker is still registered on localhost so push notifications can be tested there; it just doesn't touch fetches.
const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname)

/**
 * Network-first, and ALWAYS answers with a real Response. The old version fell back to `caches.match(request)`, which
 * resolves to `undefined` when nothing is cached — and respondWith(undefined) is a hard error ("Failed to convert value to
 * 'Response'") that turns one failed request into a broken page.
 */
async function networkFirst(request) {
  try {
    return await fetch(request)
  } catch {
    const cached = await caches.match(request)
    if (cached) return cached
    // Offline on any app route: serve the cached shell so the app can show its own state instead of the browser's error page.
    if (request.mode === 'navigate') {
      const shell = await caches.match('/')
      if (shell) return shell
    }
    return new Response('', { status: 504, statusText: 'Offline' })
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || LOCAL) return
  // Never caches API responses (Supabase requests are cross-origin and untouched); only the static app shell.
  event.respondWith(networkFirst(event.request))
})

// ─── Web Push ───────────────────────────────────────────────────────────────────────────────────────────────────
// Payload comes from the push-dispatch edge function: { title, body, url, tag, kind, requireInteraction }.
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { title: 'Codex Tech Foundation', body: event.data ? event.data.text() : '' } }

  event.waitUntil((async () => {
    // If the person is looking at the app right now, the app already shows it (toast, badge, ringing screen):
    // a second system notification on top would just be noise. Calls are the exception — always ring.
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const watching = windows.some((w) => w.visibilityState === 'visible' && w.focused)
    // (A test notification is the other exception: someone pressing "Send test" must see it, even with the app in front.)
    if (watching && data.kind !== 'call' && data.kind !== 'test') return

    await self.registration.showNotification(data.title || 'Codex Tech Foundation', {
      body: data.body || '',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: data.tag || 'codex',
      renotify: true, // a new message in the same chat should still alert, while replacing the old one
      requireInteraction: Boolean(data.requireInteraction),
      data: { url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/' },
    })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // Reuse an open tab of the app rather than piling up new ones.
    for (const w of windows) {
      if (new URL(w.url).origin === self.location.origin) {
        await w.focus()
        if ('navigate' in w) { try { await w.navigate(target) } catch { /* fall through: focus is enough */ } }
        return
      }
    }
    await self.clients.openWindow(target)
  })())
})

// The browser rotated this device's push credentials: tell any open page so it can register the new ones.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => windows.forEach((w) => w.postMessage({ type: 'push-subscription-changed' }))))
})
