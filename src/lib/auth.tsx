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

  const refresh = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setProfile(null)
      setLoading(false)
      return
    }
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
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setProfile(null)
  }

  useEffect(() => {
    void refresh()
    const { data: listener } = supabase.auth.onAuthStateChange(() => void refresh())
    return () => listener.subscription.unsubscribe()
  }, [])

  return <AuthContext.Provider value={{ profile, loading, refresh, signOut }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
