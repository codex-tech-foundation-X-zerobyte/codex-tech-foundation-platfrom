/**
 * Failed-request diagnostics for Supabase (PostgREST, Edge Functions, Storage, Auth).
 *
 * The browser's network panel only says "400 Bad Request". The useful part — PostgREST's `code`, `message`, `hint` — is in
 * the response body, which supabase-js hands to callers that often discard it. This wraps `fetch` once so EVERY failed
 * request is reported with its HTTP status, error code, message and hint.
 *
 * What is deliberately never logged: request headers (the Authorization bearer token and apikey live there), request
 * bodies (passwords, personal data), the URL's query string (filter values), and — unless debugging is on — the `details`
 * field, because Postgres puts failing-row VALUES in it ("Failing row contains (...)").
 *
 * Turn on full detail in production with: localStorage.setItem('ctf:debug', '1')
 */
export interface FailureReport {
  method: string
  target: string
  status: number
  code?: string
  message?: string
  hint?: string
  details?: string
}

const isDebug = () => {
  try {
    return import.meta.env.DEV || globalThis.localStorage?.getItem('ctf:debug') === '1'
  } catch {
    return false
  }
}

/** "/rest/v1/worker_profiles?x=y" -> "rest worker_profiles" (query string dropped: it holds filter values). */
export function describeTarget(rawUrl: string): { target: string; skip: boolean } {
  let url: URL
  try { url = new URL(rawUrl, 'http://local') } catch { return { target: 'unknown', skip: false } }
  const parts = url.pathname.split('/').filter(Boolean) // e.g. ['rest', 'v1', 'worker_profiles']
  const svc = parts[0] ?? ''
  const name = parts.slice(2).join('/')
  // A wrong password is a normal 400 from /auth/v1/token — not a fault worth a console error.
  const skip = svc === 'auth' && url.pathname.includes('/token')
  return { target: `${svc}${name ? ' ' + name : ''}`.trim() || url.pathname, skip }
}

export function buildReport(method: string, rawUrl: string, status: number, body: unknown): { report: FailureReport; skip: boolean } {
  const { target, skip } = describeTarget(rawUrl)
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
  return {
    skip,
    report: {
      method,
      target,
      status,
      code: str(b.code) ?? str(b.error_code),
      message: str(b.message) ?? str(b.msg) ?? str(b.error_description) ?? str(b.error),
      hint: str(b.hint),
      details: str(b.details),
    },
  }
}

export function logFailure(report: FailureReport) {
  const { details, ...safe } = report
  console.error(
    `[supabase] ${report.method} ${report.target} → ${report.status}${report.code ? ` (${report.code})` : ''}`,
    isDebug() ? report : { ...safe, details: details ? '(hidden — localStorage.setItem("ctf:debug","1") to show)' : undefined },
  )
}

export function createDiagnosticFetch(base: typeof fetch = (...args) => fetch(...args)): typeof fetch {
  return async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    let response: Response
    try {
      response = await base(input, init)
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') {
        console.error(`[supabase] ${method} ${describeTarget(rawUrl).target} → network error (no response: offline, blocked, or CORS)`)
      }
      throw error
    }
    if (!response.ok) {
      // Clone so the caller still gets an unread body.
      void response.clone().json().then(
        (body) => { const { report, skip } = buildReport(method, rawUrl, response.status, body); if (!skip) logFailure(report) },
        () => { const { report, skip } = buildReport(method, rawUrl, response.status, null); if (!skip) logFailure(report) },
      )
    }
    return response
  }
}
