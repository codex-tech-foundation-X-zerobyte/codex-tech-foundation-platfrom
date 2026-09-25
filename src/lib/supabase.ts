import { createClient } from '@supabase/supabase-js'

<<<<<<< HEAD
const rawUrl = import.meta.env.VITE_SUPABASE_URL
const rawAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// A silent fallback to a fake project used to live here. That's exactly
// the kind of thing that produces confusing, seemingly-unrelated cascading
// errors — every request timing out or 403ing with no obvious cause,
// because the app quietly booted against a project that was never real.
// hasValidConfig is checked explicitly in main.tsx before the app renders,
// which shows one clear "not configured" message instead of a wall of
// per-request network errors that all trace back to the same root cause.
export const hasValidConfig = Boolean(rawUrl && rawAnonKey)

const supabaseUrl = rawUrl || 'https://example.supabase.co'
const supabaseAnonKey = rawAnonKey || 'demo-anon-key-for-local-development'

if (!hasValidConfig) {
  console.error(
    'VITE_SUPABASE_URL and/or VITE_SUPABASE_ANON_KEY are not set. ' +
    'The app is not connecting to a real Supabase project — every request will fail. ' +
    'See .env.example and docs/DEPLOYMENT.md.',
  )
}
=======
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? 'https://example.supabase.co'
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'demo-anon-key-for-local-development'
>>>>>>> 061b8d9550595bf4603704f9a719614dc376af1a

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
