import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { Brand } from '../../components/Brand'
import { Button, FieldWrap, Input } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { roleHome } from '../../lib/roles'
import './Login.css'

const WORKER_ID_RE = /^CTF-WKR-/i
const CLIENT_ID_RE = /^CTF-CLI-/i
const GENERIC_ERROR = 'Your ID/email or password is incorrect.'
const RATE_LIMIT_ERROR = 'Too many attempts. Please wait a few minutes and try again.'
const FUNCTION_UNREACHABLE_ERROR = "Couldn't reach the sign-in service. Check your connection and try again."

/**
 * Resolves a Worker/Client ID to an email via the given edge function,
 * distinguishing *why* it failed instead of collapsing every failure into
 * the same generic message — that collapse was the actual reported bug
 * (rate-limiting, an undeployed function, and a wrong ID were all
 * indistinguishable). The 401/"not found" case still returns the generic
 * credentials message on purpose — that one specifically must not leak
 * whether an ID exists (see docs/AUTH-RULES.md's enumeration-protection
 * section) — but rate-limit and unreachable-function are not sensitive
 * information and are safe to report accurately.
 */
async function resolveLoginEmail(functionName: string, body: Record<string, string>): Promise<{ email?: string; error?: string }> {
  const { data, error } = await supabase.functions.invoke<{ email?: string; error?: string }>(functionName, { body })

  if (!error) return { email: data?.email }

  if (error instanceof FunctionsHttpError) {
    const status = error.context?.status
    if (status === 429) return { error: RATE_LIMIT_ERROR }
    // Any other non-2xx (400/401) is the generic credentials message —
    // deliberately not distinguished further here.
    return { error: GENERIC_ERROR }
  }
  // FunctionsFetchError (network failure) or FunctionsRelayError (the
  // function isn't deployed, or the project URL/anon key don't match where
  // it's actually deployed) — this is the "different Supabase project" /
  // "undeployed function" failure mode the report described. Surfacing it
  // distinctly, rather than folding it into "wrong password," is the fix.
  return { error: FUNCTION_UNREACHABLE_ERROR }
}

export function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { refresh, profile, loading, signOut } = useAuth()
  const from = (location.state as { from?: string } | null)?.from
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    const trimmed = identifier.trim()
    let email: string | undefined
    let resolveError: string | undefined

    if (WORKER_ID_RE.test(trimmed)) {
      const result = await resolveLoginEmail('resolve-worker-login', { worker_id: trimmed })
      email = result.email
      resolveError = result.error
    } else if (CLIENT_ID_RE.test(trimmed)) {
      const result = await resolveLoginEmail('resolve-client-login', { client_id: trimmed })
      email = result.email
      resolveError = result.error
    } else if (trimmed.includes('@')) {
      // Super Admin / Manager: direct email + password through Supabase Auth,
      // no ID-resolution step needed.
      email = trimmed
    }

    if (!email) {
      setError(resolveError ?? GENERIC_ERROR)
      setSubmitting(false)
      return
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) {
      setSubmitting(false)
      setError(GENERIC_ERROR)
      return
    }
    const loadedProfile = await refresh()
    setSubmitting(false)
    if (!loadedProfile) {
      // Credentials were right but the profile couldn't be read. Guessing a workspace here used to land people on
      // "Access restricted"; say what happened instead and drop the half-established session.
      await signOut()
      setError("You're signed in, but we couldn't load your account. Please try again in a moment.")
      return
    }
    // Route by the account's actual role, not by which ID format was typed —
    // a resolved Worker ID could belong to a 'worker' or a 'manager' profile.
    const home = roleHome(loadedProfile.role)
    // Go back to where they were headed, but only within the area their role can open.
    navigate(from && from.startsWith(home) ? from : home, { replace: true })
  }

  // Already signed in: don't show the form, just continue.
  if (!loading && profile) return <Navigate to={from && from.startsWith(roleHome(profile.role)) ? from : roleHome(profile.role)} replace />

  return (
    <div className="ctf-auth">
      <div className="ctf-auth__card">
        <Brand tagline={false} />
        <span className="eyebrow" style={{ marginTop: 28 }}><ShieldCheck size={12} /> Secure workspace</span>
        <h1>Sign in to Codex.</h1>
        <p>Enter your Worker ID, Client ID, or admin email.</p>

        <form onSubmit={submit}>
          <FieldWrap label="Worker ID / Client ID / Email" htmlFor="identifier" required>
            <Input
              id="identifier"
              required
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="CTF-WKR-0001, CTF-CLI-0001, or admin email"
            />
          </FieldWrap>
          <FieldWrap label="Password" htmlFor="password" required>
            <Input id="password" required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </FieldWrap>
          {error && <p className="ctf-form-error" role="alert">{error}</p>}
          <Button type="submit" variant="primary" size="lg" loading={submitting} icon={<ArrowRight size={16} />} className="ctf-auth__submit">
            Sign in
          </Button>
        </form>

        <Link to="/contact" className="text-link">Forgot password?</Link>
        <p className="ctf-auth__notice">This is a secured system. Access is logged and limited to authorised accounts.</p>
        <Link to="/" className="text-link ctf-auth__back">← Back to Codex</Link>
      </div>
    </div>
  )
}
