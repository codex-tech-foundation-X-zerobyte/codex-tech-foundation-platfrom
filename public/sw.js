// Bump this on every meaningful deploy. The activate handler below deletes
// any cache whose name doesn't match — without that step (which this file
// never had before), a returning visitor's browser could keep serving an
// old cached app shell indefinitely, which looks exactly like "the site is
// broken/blank" even after a real fix has been deployed.
const CACHE = 'codex-shell-v2'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['/', '/manifest.webmanifest'])))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  // Only the app shell is ever cached (install step above) — Supabase API
  // calls, auth tokens, chat messages, and any other private/dynamic data
  // are never written to this cache, so there's nothing here to evict for
  // privacy reasons; there just isn't anything private in it to begin with.
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)))
})
