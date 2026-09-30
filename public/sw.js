// Cache name includes a version marker — bump CACHE_VERSION on any release
// where you need to force-invalidate old clients' caches. Combined with
// skipWaiting()/clients.claim() below, this closes the "deployed app keeps
// serving an old bundle until every tab is closed" class of bug — a new
// service worker now activates and takes over immediately instead of
// waiting indefinitely for existing tabs to close.
const CACHE_VERSION = 'v3'
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

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  // Network-first: always prefer the live deployment when reachable: only
  // fall back to the cached shell when actually offline. Never cache API
  // responses (Supabase requests aren't same-origin here, so they're
  // untouched by this handler regardless) — this only ever affects the
  // static app shell.
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)))
})
