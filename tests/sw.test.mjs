import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/** Runs public/sw.js in a sandbox that looks like a service worker and returns the handlers it registered. */
function loadWorker({ hostname = 'app.example.com', cached = new Map(), fetchImpl = async () => new Response('live') } = {}) {
  const handlers = {}
  const shown = []
  const windows = { list: [] }
  const self = {
    location: { hostname, origin: `https://${hostname}` },
    addEventListener: (type, fn) => { handlers[type] = fn },
    skipWaiting: () => {},
    clients: { claim: async () => {}, matchAll: async () => windows.list, openWindow: async () => {} },
    registration: { showNotification: async (title, options) => { shown.push({ title, options }) } },
  }
  const caches = { match: async (req) => cached.get(typeof req === 'string' ? req : req.url), open: async () => ({ addAll: async () => {} }), keys: async () => [], delete: async () => true }
  vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), { self, caches, fetch: fetchImpl, Response, URL, console })
  return { handlers, shown, windows }
}

const navigate = (url = 'https://app.example.com/admin') => ({ url, method: 'GET', mode: 'navigate' })
async function respond(handlers, request) {
  let answer
  handlers.fetch({ request, respondWith: (p) => { answer = p } })
  return answer === undefined ? undefined : await answer
}

test('a failed request with nothing cached still produces a real response (the bug that broke the page)', async () => {
  const { handlers } = loadWorker({ fetchImpl: async () => { throw new TypeError('network down') } })
  const res = await respond(handlers, { url: 'https://app.example.com/assets/x.js', method: 'GET', mode: 'cors' })
  assert.ok(res instanceof Response, 'must be a Response, never undefined')
  assert.equal(res.status, 504)
})

test('offline navigation falls back to the cached app shell; a cached asset is served from cache', async () => {
  const shell = new Response('shell'); const asset = new Response('asset')
  const cached = new Map([['/', shell], ['https://app.example.com/assets/x.js', asset]])
  const { handlers } = loadWorker({ cached, fetchImpl: async () => { throw new TypeError('offline') } })
  assert.equal(await respond(handlers, navigate()), shell)
  assert.equal(await respond(handlers, { url: 'https://app.example.com/assets/x.js', method: 'GET', mode: 'cors' }), asset)
})

test('when online, the live response always wins', async () => {
  const { handlers } = loadWorker({ cached: new Map([['/', new Response('stale')]]), fetchImpl: async () => new Response('live') })
  assert.equal(await (await respond(handlers, navigate())).text(), 'live')
})

test('it never touches non-GET requests', async () => {
  const { handlers } = loadWorker()
  assert.equal(await respond(handlers, { url: 'https://app.example.com/x', method: 'POST', mode: 'cors' }), undefined)
})

test('on localhost it steps aside completely, so the dev server is never intercepted', async () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    const { handlers } = loadWorker({ hostname, fetchImpl: async () => { throw new TypeError('dev server restarting') } })
    assert.equal(await respond(handlers, navigate(`http://${hostname}:5173/admin`)), undefined, hostname)
  }
})

test('push: shows a notification when nobody is looking, stays quiet when the app is focused — except calls and tests', async () => {
  const send = async (data, focused) => {
    const { handlers, shown, windows } = loadWorker()
    windows.list = focused ? [{ visibilityState: 'visible', focused: true }] : []
    let work; handlers.push({ data: { json: () => data, text: () => '' }, waitUntil: (p) => { work = p } })
    await work
    return shown
  }
  assert.equal((await send({ title: 'Ada', body: 'hi', kind: 'chat' }, false)).length, 1)
  assert.equal((await send({ title: 'Ada', body: 'hi', kind: 'chat' }, true)).length, 0)
  assert.equal((await send({ title: 'Incoming call', kind: 'call' }, true)).length, 1)
  assert.equal((await send({ title: 'Notifications are working', kind: 'test' }, true)).length, 1)
})

test('push: a tapped notification only ever opens a same-site path', async () => {
  const shown = (await (async () => {
    const { handlers, shown: s } = loadWorker()
    let work; handlers.push({ data: { json: () => ({ title: 'x', url: 'https://evil.example/phish' }) }, waitUntil: (p) => { work = p } })
    await work
    return s
  })())
  assert.equal(shown[0].options.data.url, '/')
})
