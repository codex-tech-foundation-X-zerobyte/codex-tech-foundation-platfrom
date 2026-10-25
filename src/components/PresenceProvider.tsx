import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

export type PresenceStatus = 'online' | 'away' | 'offline'

interface PresenceState {
  /** Everyone currently connected (online or away). */
  onlineIds: ReadonlySet<string>
  statusOf: (userId: string) => PresenceStatus
}

const EMPTY = new Set<string>()
const PresenceContext = createContext<PresenceState>({ onlineIds: EMPTY, statusOf: () => 'offline' })

const TEAM_ROLES = ['worker', 'manager', 'superadmin']

/**
 * Who is online, on EVERY page.
 *
 * Presence used to be tracked per chat channel, which meant you only registered as online while you had that exact
 * channel open — and could only see others who did too. This joins one workspace-wide channel as soon as a team member
 * signs in, wherever they are in the app, and marks them "away" when the tab is hidden.
 *
 * Only team members take part (clients are never tracked or listed), and the payload is a status only — no names, emails
 * or anything else. Realtime presence channels aren't access-controlled by Row Level Security, so keep it that minimal.
 */
export function PresenceProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const userId = profile?.id
  const isTeam = !!profile && TEAM_ROLES.includes(profile.role)
  const [statuses, setStatuses] = useState<ReadonlyMap<string, PresenceStatus>>(new Map())

  useEffect(() => {
    if (!userId || !isTeam) return
    const channel = supabase.channel('presence:team', { config: { presence: { key: userId } } })
    const current = (): PresenceStatus => (document.visibilityState === 'hidden' ? 'away' : 'online')

    channel
      .on('presence', { event: 'sync' }, () => {
        const next = new Map<string, PresenceStatus>()
        for (const [key, metas] of Object.entries(channel.presenceState<{ status?: PresenceStatus }>())) {
          // Several tabs/devices can share a key: online if ANY of them is in the foreground.
          next.set(key, metas.some((m) => m.status !== 'away') ? 'online' : 'away')
        }
        setStatuses(next)
      })
      .subscribe((status) => {
        // Runs again after every automatic reconnect, which is what re-announces us after a network drop.
        if (status === 'SUBSCRIBED') void channel.track({ status: current() })
      })

    const onVisibility = () => void channel.track({ status: current() })
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      void supabase.removeChannel(channel)
    }
  }, [userId, isTeam])

  const value = useMemo<PresenceState>(() => {
    const map = isTeam ? statuses : new Map<string, PresenceStatus>()
    return { onlineIds: map.size ? new Set(map.keys()) : EMPTY, statusOf: (id) => map.get(id) ?? 'offline' }
  }, [statuses, isTeam])

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>
}

export function usePresence() {
  return useContext(PresenceContext)
}
