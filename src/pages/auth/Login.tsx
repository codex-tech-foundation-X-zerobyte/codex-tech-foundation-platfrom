import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { Brand } from '../../components/Brand'
import { Button, FieldWrap, Input } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import type { Role } from '../../lib/types'
import './Login.css'

type Mode = 'worker' | 'client' | 'superadmin'

const MODE_COPY: Record<Mode, { label: string; fieldLabel: string; placeholder: string; genericError: string }> = {
  worker: { label: 'Worker / Manager', fieldLabel: 'Worker ID', placeholder: 'CTF-WKR-0001', genericError: 'Worker ID or password is incorrect.' },
  client: { label: 'Client', fieldLabel: 'Client ID', placeholder: 'CTF-CLT-0001', genericError: 'Client ID or password is incorrect.' },
  superadmin: { label: 'Super Admin', fieldLabel: 'Email', placeholder: 'you@codextech.com', genericError: 'Email or password is incorrect.' },
}

// Where each authenticated role lands — kept in one place so Login.tsx and
// App.tsx's route guards never disagree about it.
const ROLE_HOME: Record<Role, string> = { worker: '/worker', manager: '/admin', superadmin: '/admin', client: '/client' }

export function Login() {
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const [mode, setMode] = useState<Mode>('worker')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const copy = MODE_COPY[mode]

  const afterSignIn = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data: profile } = user
      ? await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
      : { data: null }
    await refresh()
    navigate((profile?.role && ROLE_HOME[profile.role as Role]) || '/')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    if (mode === 'superadmin') {
      // The only mode that talks to Supabase Auth directly — there's no
      // short ID to resolve server-side first, so there's nothing an Edge
      // Function step would add here.
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: identifier.trim(), password })
      if (signInError) {
        setError(copy.genericError)
        setSubmitting(false)
        return
      }
      setSubmitting(false)
      await afterSignIn()
      return
    }

    // Worker and Client both resolve through a server-side Edge Function
    // that checks the password itself and returns a session — the account's
    // real email is never sent to this browser, even on a failed attempt.
    // See /docs/AUTH-RULES.md.
    const fnName = mode === 'worker' ? 'resolve-worker-login' : 'resolve-client-login'
    const body = mode === 'worker' ? { worker_id: identifier.trim(), password } : { client_id: identifier.trim(), password }
    const { data, error: resolveError } = await supabase.functions.invoke(fnName, { body })
    if (resolveError || !data?.access_token || !data?.refresh_token) {
      setError(copy.genericError)
      setSubmitting(false)
      return
    }
    const { error: signInError } = await supabase.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    })
    setSubmitting(false)
    if (signInError) {
      setError(copy.genericError)
      return
    }
    await afterSignIn()
  }

  return (
    <div className="ctf-auth">
      <div className="ctf-auth__card">
        <Brand tagline={false} />
        <span className="eyebrow" style={{ marginTop: 28 }}><ShieldCheck size={12} /> Secure workspace</span>
        <h1>Sign in to Codex.</h1>
        <p>Choose your account type and sign in with the credentials you were given.</p>

        <div className="ctf-auth__modes" role="tablist" aria-label="Account type">
          {(Object.keys(MODE_COPY) as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={`ctf-auth__mode ${mode === m ? 'is-active' : ''}`}
              onClick={() => { setMode(m); setIdentifier(''); setError('') }}
            >
              {MODE_COPY[m].label}
            </button>
          ))}
        </div>

        <form onSubmit={submit}>
          <FieldWrap label={copy.fieldLabel} htmlFor="login-id" required>
            <Input
              id="login-id"
              required
              type={mode === 'superadmin' ? 'email' : 'text'}
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={copy.placeholder}
            />
          </FieldWrap>
          <FieldWrap label="Password" htmlFor="password" required>
            <Input id="password" required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </FieldWrap>
          {error && <p className="ctf-form-error">{error}</p>}
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
