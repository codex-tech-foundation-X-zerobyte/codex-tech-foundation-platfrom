import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { getPrefs } from '../lib/prefs'
import { playChime } from '../lib/ringtone'
import { getDisplayNames, listMyChannels, type ChatChannel, type ChatMessage } from '../lib/services'
import { useToast } from './ui'

interface ChatActivity {
  unread: Readonly<Record<string, number>>
  totalUnread: number
  /** TeamChat tells us which channel is on screen, so messages you're already looking at don't count as unread. */
  setActiveChannel: (channelId: string | null) => void
}

const ChatActivityContext = createContext<ChatActivity>({ unread: {}, totalUnread: 0, setActiveChannel: () => {} })
const TEAM_ROLES = ['worker', 'manager', 'superadmin']

const preview = (m: ChatMessage) => {
  const text = m.body.trim().replace(/\s+/g, ' ')
  if (text) return text.length > 90 ? `${text.slice(0, 90)}…` : text
  return m.attachments?.length ? `sent ${m.attachments.length === 1 ? 'an attachment' : `${m.attachments.length} attachments`}` : ''
}

/**
 * New-message awareness on every page: an unread count per channel (shown on the sidebar's Chat item), and for private
 * messages a toast + chime — plus a desktop notification when the tab is in the background and the person opted in.
 * Group channels only add to the unread count; pinging everyone for every message in General would just train people to ignore it.
 */
export function ChatActivityProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const { push } = useToast()
  const userId = profile?.id
  const isTeam = !!profile && TEAM_ROLES.includes(profile.role)
  const [unread, setUnread] = useState<Record<string, number>>({})
  const activeRef = useRef<string | null>(null)
  const channelsRef = useRef<Map<string, ChatChannel>>(new Map())
  const namesRef = useRef<Record<string, string>>({})
  const pushRef = useRef(push)
  useEffect(() => { pushRef.current = push })

  const setActiveChannel = useCallback((id: string | null) => {
    activeRef.current = id
    if (id) setUnread((prev) => (prev[id] ? { ...prev, [id]: 0 } : prev))
  }, [])

  useEffect(() => {
    if (!userId || !isTeam) return
    let cancelled = false

    const loadChannels = () => void listMyChannels().then(({ data }) => { if (!cancelled) channelsRef.current = new Map(data.map((c) => [c.id, c])) })
    loadChannels()

    const onMessage = async (m: ChatMessage) => {
      if (m.sender_id === userId) return
      const looking = activeRef.current === m.channel_id && document.visibilityState === 'visible'
      if (looking) return
      setUnread((prev) => ({ ...prev, [m.channel_id]: (prev[m.channel_id] ?? 0) + 1 }))

      let channel = channelsRef.current.get(m.channel_id)
      if (!channel) { // a brand-new DM we haven't listed yet
        const { data } = await listMyChannels()
        channelsRef.current = new Map(data.map((c) => [c.id, c]))
        channel = channelsRef.current.get(m.channel_id)
      }
      if (channel?.type !== 'dm') return // group channels: badge only

      if (!namesRef.current[m.sender_id]) namesRef.current = { ...namesRef.current, ...(await getDisplayNames([m.sender_id])) }
      const who = namesRef.current[m.sender_id] ?? 'A teammate'
      const text = preview(m)
      pushRef.current(`${who}: ${text}`, 'info')
      playChime()
      if (getPrefs().desktopAlerts && document.visibilityState === 'hidden' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(who, { body: text, tag: `dm-${m.channel_id}` })
      }
    }

    const sub = supabase
      .channel(`chat-activity:${crypto.randomUUID()}`)
      // RLS (is_channel_member) decides which messages Realtime delivers to this user.
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (p) => void onMessage(p.new as ChatMessage))
      // Someone opened a DM with me: refresh the list so the new chat is known immediately.
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_channel_members', filter: `user_id=eq.${userId}` }, loadChannels)
      .subscribe()

    return () => { cancelled = true; void supabase.removeChannel(sub) }
  }, [userId, isTeam])

  const value = useMemo<ChatActivity>(() => {
    const live = isTeam ? unread : {}
    return { unread: live, totalUnread: Object.values(live).reduce((a, b) => a + b, 0), setActiveChannel }
  }, [unread, isTeam, setActiveChannel])

  return <ChatActivityContext.Provider value={value}>{children}</ChatActivityContext.Provider>
}

export function useChatActivity() {
  return useContext(ChatActivityContext)
}
