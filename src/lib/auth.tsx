import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Profile } from './types'

interface AuthState {
  profile: Profile | null
  loading: boolean
  refresh: () => Promise<Profile | null>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

const PROFILE_COLUMNS = 'id, display_name, role, organization, avatar_path'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Same person + same fields => keep the SAME object, so effects keyed on `profile` don't re-run on every token refresh. */
const sameProfile = (a: Profile | null, b: Profile | null) =>
  a === b || (!!a && !!b && a.id === b.id && a.role === b.role && a.display_name === b.display_name && a.organization === b.organization && a.avatar_path === b.avatar_path)

/**
 * Reads the signed-in user's profile, retrying transient failures (cold edge, flaky mobile network) with a short
 * backoff. A row that genuinely doesn't exist (PGRST116) is answered immediately — retrying can't create it.
 * Returns `undefined` when every attempt failed, which callers treat as "unknown", NOT as "signed out".
 */
async function fetchProfile(userId: string, attempts = 3): Promise<Profile | null | undefined> {
  for (let i = 0; i < attempts; i++) {
    try {
      const { data, error } = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).single()
      if (!error) return data as Profile
      if (error.code === 'PGRST116') return null
    } catch {
      /* network error — fall through to retry */
    }
    if (i < attempts - 1) await sleep(400 * 2 ** i)
  }
  return undefined
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfileState] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const setProfile = useCallback((next: Profile | null) => setProfileState((prev) => (sameProfile(prev, next) ? prev : next)), [])

  /**
   * Explicit, user-triggered refresh (e.g. right after sign-in, where Login needs a definitive answer to route on).
   * Unlike the background sync below, it is allowed to clear the profile: the caller is actively waiting.
   */
  const refresh = useCallback(async (): Promise<Profile | null> => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setProfile(null)
      setLoading(false)
      return null
    }
    const loaded = (await fetchProfile(user.id)) ?? null
    setProfile(loaded)
    setLoading(false)
    return loaded
  }, [setProfile])

  const signOut = useCallback(async () => {
    try { await supabase.auth.signOut() } catch { /* the local session is cleared below regardless */ }
    setProfile(null)
  }, [setProfile])

  useEffect(() => {
    let cancelled = false

    /**
     * Background sync driven by onAuthStateChange. It uses the session the event already carries rather than calling
     * getUser() again: onAuthStateChange fires on every TOKEN_REFRESHED (about hourly), and a transient failure on an
     * extra network call used to wipe a perfectly valid profile, making the user look logged out. A failed re-fetch
     * therefore leaves the existing profile alone — the session itself is the source of truth for "logged in".
     */
    const syncFromSession = async (session: Session | null) => {
      if (!session?.user) {
        if (!cancelled) { setProfile(null); setLoading(false) }
        return
      }
      const loaded = await fetchProfile(session.user.id)
      if (cancelled) return
      if (loaded !== undefined) setProfile(loaded)
      setLoading(false)
    }

    void supabase.auth.getSession().then(({ data }) => syncFromSession(data.session)).catch(() => { if (!cancelled) setLoading(false) })

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setProfile(null)
        setLoading(false)
        return
      }
      // Never call back into supabase synchronously inside this callback (it can deadlock the auth lock);
      // defer to the next tick.
      setTimeout(() => void syncFromSession(session), 0)
    })

    return () => {
      cancelled = true
      listener.subscription.unsubscribe()
    }
  }, [setProfile])

  const value = useMemo(() => ({ profile, loading, refresh, signOut }), [profile, loading, refresh, signOut])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
