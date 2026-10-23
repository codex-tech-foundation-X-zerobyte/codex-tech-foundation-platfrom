/**
 * Everything prefixed VITE_ is compiled into the JavaScript every visitor downloads. A Supabase SERVICE-ROLE (secret) key
 * bypasses Row Level Security entirely, so if one ends up in a VITE_ variable the whole database is effectively public.
 * This is the single check used by BOTH the build (vite.config.ts) and the running app (lib/supabase.ts).
 */
function jwtRole(token: string): string | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='))
    const role = (JSON.parse(json) as { role?: unknown }).role
    return typeof role === 'string' ? role : null
  } catch {
    return null
  }
}

/** Returns a human-readable reason if `value` is a secret key that must never be shipped to a browser, else null. */
export function secretKeyProblem(value: string | undefined): string | null {
  if (!value) return null
  const v = value.trim()
  if (v.startsWith('sb_secret_')) return 'it is a Supabase secret key (sb_secret_…)'
  if (jwtRole(v) === 'service_role') return 'it is a Supabase service_role key'
  return null
}

/** Names that should never be exposed to the browser, whatever they contain. */
const FORBIDDEN_NAME = /(SERVICE_ROLE|SECRET|PRIVATE_KEY|PASSWORD)/i

/** Checks a set of VITE_* variables. Returns one message per problem (empty = fine). */
export function findExposedSecrets(env: Record<string, string | undefined>): string[] {
  const problems: string[] = []
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('VITE_')) continue
    if (FORBIDDEN_NAME.test(name)) {
      // VITE_TURN_CREDENTIAL is deliberately allowed below: a TURN credential must reach the browser to work.
      problems.push(`${name} is exposed to the browser because of its VITE_ prefix, and its name suggests it is a secret.`)
      continue
    }
    const why = secretKeyProblem(value)
    if (why) problems.push(`${name} is exposed to the browser, and ${why}.`)
  }
  return problems
}
