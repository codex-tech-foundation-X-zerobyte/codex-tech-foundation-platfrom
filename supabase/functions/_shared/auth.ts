import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface CallerCheck {
  userId: string
  role: string
}

/**
 * Verifies the caller's JWT (from the Authorization header) and loads their
 * profile role. Edge functions that use the service-role key bypass RLS
 * entirely, so any function performing a privileged action MUST call this
 * and check the result itself — the database will not stop it.
 *
 * Returns null if the token is missing/invalid or the profile can't be
 * loaded; the caller should treat that as unauthorized.
 */
export async function authorizeCaller(admin: SupabaseClient, request: Request): Promise<CallerCheck | null> {
  const authHeader = request.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return null

  const { data: userResult, error: userError } = await admin.auth.getUser(token)
  if (userError || !userResult.user) return null

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', userResult.user.id)
    .maybeSingle()
  if (profileError || !profile) return null

  return { userId: userResult.user.id, role: profile.role }
}

export function forbiddenResponse(cors: Record<string, string>) {
  return new Response(JSON.stringify({ error: 'You are not authorized to perform this action.' }), {
    status: 403,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

/**
 * Cryptographically random temporary password — never logged, never stored in plaintext.
 * Uses rejection sampling: `byte % alphabet.length` slightly favours the first few characters whenever 256 isn't a
 * multiple of the alphabet size, and a credential generator shouldn't have a measurable skew. 16 characters from a
 * 60-symbol alphabet is roughly 94 bits.
 */
export function generateTempPassword(length = 16): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%'
  const limit = 256 - (256 % alphabet.length) // largest multiple of the alphabet size that fits in a byte
  const out: string[] = []
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2))
    for (const b of bytes) {
      if (b < limit) out.push(alphabet[b % alphabet.length])
      if (out.length === length) break
    }
  }
  return out.join('')
}
