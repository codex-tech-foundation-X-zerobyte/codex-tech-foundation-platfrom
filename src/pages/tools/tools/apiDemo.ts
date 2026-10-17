export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'

/**
 * The API tool opens on a working example request. httpbin.org has one endpoint per method (/get only answers GET,
 * /patch only answers PATCH, ...), so a single hard-coded demo URL guaranteed a 405 the moment anyone picked another
 * method. These helpers keep the demo URL in step with the method — but only while the URL is still an untouched demo
 * URL. Anything the user typed is theirs and is never rewritten, and the chosen method is never changed for them.
 */
export const DEMO_ORIGIN = 'https://httpbin.org'

const DEMO_PATH: Record<HttpMethod, string> = {
  GET: '/get',
  HEAD: '/get', // /get answers HEAD too
  POST: '/post',
  PUT: '/put',
  PATCH: '/patch',
  DELETE: '/delete',
}

/** Which methods each httpbin endpoint accepts (besides OPTIONS). */
const ALLOWED: Record<string, HttpMethod[]> = {
  '/get': ['GET', 'HEAD'],
  '/post': ['POST'],
  '/put': ['PUT'],
  '/patch': ['PATCH'],
  '/delete': ['DELETE'],
}

export const demoUrlFor = (method: HttpMethod) => DEMO_ORIGIN + DEMO_PATH[method]

const demoPathOf = (url: string): string | null => {
  const trimmed = url.trim().replace(/\/+$/, '')
  if (!trimmed.startsWith(DEMO_ORIGIN + '/')) return null
  const path = trimmed.slice(DEMO_ORIGIN.length)
  return path in ALLOWED ? path : null
}

/** True only for the exact demo endpoints this tool offers — not for any other URL, even on httpbin.org. */
export const isDemoUrl = (url: string) => demoPathOf(url) !== null

/** The URL to show after the user changes the method: the matching demo endpoint if untouched, otherwise unchanged. */
export function urlAfterMethodChange(currentUrl: string, nextMethod: HttpMethod): string {
  return isDemoUrl(currentUrl) ? demoUrlFor(nextMethod) : currentUrl
}

/**
 * If the URL is one of httpbin's single-method endpoints and the chosen method isn't one it serves, say so BEFORE the
 * request is sent. This is advice, never a block: the request still goes out exactly as configured.
 */
export function demoMismatch(url: string, method: HttpMethod): { message: string; suggestedUrl: string } | null {
  const path = demoPathOf(url)
  if (!path || ALLOWED[path].includes(method)) return null
  return {
    message: `httpbin.org${path} only accepts ${ALLOWED[path].join(' / ')}, so ${method} will get 405 Method Not Allowed. Use ${DEMO_PATH[method]} for ${method}.`,
    suggestedUrl: demoUrlFor(method),
  }
}
