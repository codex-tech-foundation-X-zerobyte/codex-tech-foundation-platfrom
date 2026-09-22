import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import type { Profile } from './types'

interface AuthState {
  profile: Profile | null
  loading: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

<<<<<<< HEAD
  const refresh = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
=======
  // Loads the profile row for a known-valid user id. A failed PROFILE
  // query and a lost SESSION are different failure modes — this function
  // never clears `profile` on its own error, so a transient query hiccup
  // never looks like a logout. Only an actual session loss (handled in
  // refresh()/onAuthStateChange below) does that.
  const loadProfile = async (userId: string) => {
    const { data, error } = await supabase.from('profiles').select('id, display_name, role, organization, avatar_path').eq('id', userId).single()
    if (error) {
      console.error('Failed to load profile:', error.message)
      setLoading(false)
      return
    }
    setProfile(data as Profile)
    setLoading(false)
  }

  const refresh = async () => {
    // getSession() reads the client's already-validated local session
    // state instead of making a network round-trip to Supabase Auth's
    // /user endpoint. This used to call getUser() here, which DOES hit
    // the network on every call and silently discarded its `error` — so
    // any transient network hiccup, rate limit, or timing overlap with a
    // background token refresh made a perfectly valid session look
    // logged-out and booted the user. This was the real cause of
    // worker/client sessions "eventually" failing: onAuthStateChange fires
    // this on every TOKEN_REFRESHED event (roughly hourly), and any one
    // bad network moment during that check was enough to sign someone out
    // who never actually lost their session. getUser() from inside an
    // onAuthStateChange-triggered path is also a documented Supabase
    // footgun (risk of deadlocking with the auth state machine) —
    // getSession() is the resilient, recommended choice here.
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) {
>>>>>>> ac4f45b (Codex Tech Foundation platform — through Pass 8)
      setProfile(null)
      setLoading(false)
      return
    }
<<<<<<< HEAD
    const { data, error } = await supabase.from('profiles').select('id, display_name, role, organization, avatar_path').eq('id', user.id).single()
    if (error) {
      // Previously silent — a failed profile load looked identical to "not
      // authorized" in ProtectedRoute, with nothing in the console to tell
      // the two apart. This is exactly the class of bug that made the
      // missing `profiles.status` column (present in the query, never in
      // the schema) invisible until someone actually hit it.
      console.error('Failed to load profile:', error.message)
    }
    setProfile((data as Profile | null))
    setLoading(false)
=======
    await loadProfile(session.user.id)
>>>>>>> ac4f45b (Codex Tech Foundation platform — through Pass 8)
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setProfile(null)
  }

  useEffect(() => {
    void refresh()
<<<<<<< HEAD
    const { data: listener } = supabase.auth.onAuthStateChange(() => void refresh())
=======
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      // SIGNED_OUT is the only event that should ever clear the profile.
      // Every other event (TOKEN_REFRESHED, USER_UPDATED, an
      // INITIAL_SESSION that still has a valid session, etc.) just re-syncs
      // the profile — it must never be treated as a logout.
      if (event === 'SIGNED_OUT' || !session) {
        setProfile(null)
        setLoading(false)
        return
      }
      void loadProfile(session.user.id)
    })
>>>>>>> ac4f45b (Codex Tech Foundation platform — through Pass 8)
    return () => listener.subscription.unsubscribe()
  }, [])

  return <AuthContext.Provider value={{ profile, loading, refresh, signOut }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
