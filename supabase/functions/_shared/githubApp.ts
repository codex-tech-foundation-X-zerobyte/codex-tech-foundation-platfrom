/*
  GitHub App authentication, as pure code (no Deno or Supabase imports), so it is unit-tested under Node with the network injected
  (tests/githubApp.test.mjs).

  How it works: the App's private key (a server secret, never stored in a table) signs a short-lived RS256 JWT. That JWT is exchanged
  for an INSTALLATION token, which is scoped to the repositories the organisation chose when installing the App and expires after an
  hour. Only the installation token is ever sent to the REST API, and it is never persisted: it is minted when needed and cached in
  memory for the life of the function instance.

  Nothing here talks to a real GitHub in tests. Whether the live exchange works is UNVERIFIED until the owner creates the App.
*/
import { GITHUB_API, GithubError, type Fetcher } from './github.ts'

const enc = new TextEncoder()

export const b64url = (input: ArrayBuffer | Uint8Array | string): string => {
  const bytes = typeof input === 'string' ? enc.encode(input) : input instanceof Uint8Array ? input : new Uint8Array(input)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** GitHub hands out PKCS#1 keys ("BEGIN RSA PRIVATE KEY"); WebCrypto only imports PKCS#8. Accepts either, and `\n` escaped into one line. */
export function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const text = pem.replace(/\\n/g, '\n').trim()
  const m = text.match(/-----BEGIN ((?:RSA )?PRIVATE KEY)-----([\s\S]+?)-----END \1-----/)
  if (!m) throw new GithubError('error', 500, 'The GitHub App private key is not a PEM private key.')
  const der = Uint8Array.from(atob(m[2].replace(/\s+/g, '')), (c) => c.charCodeAt(0))
  if (m[1] === 'PRIVATE KEY') return der
  // Wrap PKCS#1 in a PKCS#8 envelope: SEQUENCE { INTEGER 0, SEQUENCE { rsaEncryption, NULL }, OCTET STRING { pkcs1 } }
  const len = (n: number) => (n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff])
  const algo = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]
  const octet = [0x04, ...len(der.length)]
  const inner = [0x02, 0x01, 0x00, ...algo, ...octet]
  const total = inner.length + der.length
  return Uint8Array.from([0x30, ...len(total), ...inner, ...der])
}

export const isAppId = (s: unknown): s is string => typeof s === 'string' && /^\d{1,12}$/.test(s)
export const isInstallationId = (s: unknown): s is number | string => /^\d{1,14}$/.test(String(s ?? ''))

/** JWT for authenticating AS the App. GitHub allows at most 10 minutes; `iat` is back-dated 60 s to tolerate clock drift. */
export async function signAppJwt(appId: string, privateKeyPem: string, nowSeconds: number): Promise<string> {
  if (!isAppId(appId)) throw new GithubError('error', 500, 'The GitHub App id is not valid.')
  const key = await crypto.subtle.importKey('pkcs8', pemToPkcs8(privateKeyPem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: appId }))
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${head}.${body}`))
  return `${head}.${body}.${b64url(sig)}`
}

export interface InstallationToken { token: string; expiresAt: number; permissions?: Record<string, string> }

type PostFetcher = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<Awaited<ReturnType<Fetcher>>>

/** Exchange the App JWT for an installation token. Optionally narrowed to named repositories (least privilege). */
export async function mintInstallationToken(
  jwt: string, installationId: number | string, opts: { repositories?: string[]; fetchImpl?: PostFetcher } = {},
): Promise<InstallationToken> {
  if (!isInstallationId(installationId)) throw new GithubError('error', 400, 'Bad installation id.')
  const fetchImpl = opts.fetchImpl ?? ((u, i) => fetch(u, i))
  const res = await fetchImpl(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'codex-workspace', 'Content-Type': 'application/json' },
    body: opts.repositories?.length ? JSON.stringify({ repositories: opts.repositories }) : undefined,
  })
  if (res.status === 401) throw new GithubError('unauthorized', 401, 'GitHub rejected the App credentials. Check the App id and private key.')
  if (res.status === 403) throw new GithubError('forbidden', 403, 'The GitHub App installation is suspended or lacks permission.')
  if (res.status === 404) throw new GithubError('not_found', 404, 'The GitHub App is not installed (or the installation was removed).')
  if (!res.ok) throw new GithubError('error', res.status, `GitHub answered ${res.status} while minting an installation token.`)
  const data = (await res.json()) as { token?: string; expires_at?: string; permissions?: unknown }
  const expiresAt = Date.parse(String(data.expires_at ?? ''))
  if (typeof data.token !== 'string' || data.token.length < 10 || !Number.isFinite(expiresAt)) throw new GithubError('error', 502, 'GitHub returned an unexpected token response.')
  // The permissions GitHub actually granted this installation (used by the connection check). Anything that is not a plain string map is dropped.
  const permissions: Record<string, string> = {}
  if (data.permissions && typeof data.permissions === 'object' && !Array.isArray(data.permissions)) {
    for (const [k, v] of Object.entries(data.permissions as Record<string, unknown>)) if (typeof v === 'string' && /^[a-z_]{1,60}$/.test(k)) permissions[k] = v
  }
  return { token: data.token, expiresAt, permissions }
}

/** In-memory cache with a safety margin, so a token about to expire is replaced rather than used. Keyed by installation. */
export function createTokenCache(marginMs = 120_000) {
  const store = new Map<string, InstallationToken>()
  return {
    get: (key: string, now: number) => { const t = store.get(key); return t && t.expiresAt - marginMs > now ? t.token : null },
    set: (key: string, t: InstallationToken) => { store.set(key, t) },
    clear: (key?: string) => { if (key === undefined) store.clear(); else store.delete(key) },
  }
}

export type CredentialSource = 'github_app' | 'personal_token'
export interface ResolvedCredential { token: string; source: CredentialSource }

/**
 * Which credential does a request use? The App wins whenever it is fully configured AND an installation is recorded; otherwise the
 * legacy shared personal token keeps working, so nothing breaks before the App exists. `null` means GitHub is not connected.
 */
export async function resolveCredential(deps: {
  appId?: string; privateKey?: string; installationId?: number | string | null; legacyToken?: string | null
  cache: ReturnType<typeof createTokenCache>; now: number; fetchImpl?: PostFetcher
}): Promise<ResolvedCredential | null> {
  const { appId, privateKey, installationId, legacyToken, cache, now } = deps
  if (appId && privateKey && installationId != null && isInstallationId(installationId)) {
    const key = `inst:${installationId}`
    const hit = cache.get(key, now)
    if (hit) return { token: hit, source: 'github_app' }
    const jwt = await signAppJwt(appId, privateKey, Math.floor(now / 1000))
    const minted = await mintInstallationToken(jwt, installationId, { fetchImpl: deps.fetchImpl })
    cache.set(key, minted)
    return { token: minted.token, source: 'github_app' }
  }
  return legacyToken ? { token: legacyToken, source: 'personal_token' } : null
}
