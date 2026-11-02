import { createClient } from '@supabase/supabase-js'
import { createDiagnosticFetch } from './diagnostics'
import { secretKeyProblem } from './keyGuard'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// No silent fallback to a fake project. A deployed app that falls back to
// https://example.supabase.co when env vars are missing builds and deploys
// successfully, then has EVERY Supabase call fail against a nonexistent
// project — which looks like "nothing works" with no indication why. Fail
// loudly and specifically instead; main.tsx catches this and renders a
// visible, actionable message rather than a blank page.
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL and/or VITE_SUPABASE_ANON_KEY. ' +
    'Set these in your .env file locally, or in your deployment platform\u2019s ' +
    'environment variable settings (e.g. Vercel project settings) for production.',
  )
}

// Refuse to run with a secret key in the browser build: it would bypass every Row Level Security policy for all visitors.
const keyProblem = secretKeyProblem(supabaseAnonKey)
if (keyProblem) {
  throw new Error(`VITE_SUPABASE_ANON_KEY must be the public anon/publishable key, but ${keyProblem}. Replace it in your environment settings and rotate that key — it has been published to anyone who loaded this build.`)
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  // Reports status / code / message / hint for every failed request (never tokens, bodies or query values).
  global: { fetch: createDiagnosticFetch() },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
