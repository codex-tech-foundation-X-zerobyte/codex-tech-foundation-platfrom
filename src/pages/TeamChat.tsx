import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowDown, Hash, MessageSquare, Phone, PhoneCall, Send, User, Video } from 'lucide-react'
import { Avatar, EmptyState, ErrorState, SkeletonRows, useToast } from '../components/ui'
import {
  getDisplayNames, listMessages, listMyChannels, sendMessage, subscribeToChannel, subscribeToPresence,
  type ChatChannel, type ChatMessage,
} from '../lib/services'
import { useAsyncData } from '../hooks/useAsyncData'
import { useAuth } from '../lib/auth'
import { useCall } from '../components/CallProvider'
import { useGroupCall } from '../components/GroupCallProvider'
import './TeamChat.css'

const MAX_LENGTH = 4000
const GROUP_GAP_MS = 5 * 60 * 1000

const channelLabel = (c: ChatChannel) => c.name || (c.type === 'dm' ? 'Direct message' : c.type)

/** Insert keeping chronological order, ignoring an id we already have (the realtime echo of our own send). */
function addUnique(list: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  if (list.some((m) => m.id === msg.id)) return list
  return [...list, msg].sort((a, b) => a.created_at.localeCompare(b.created_at))
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

export function TeamChat() {
  const { data: channels, error, loading, reload } = useAsyncData('once', listMyChannels)
  const [activeChannel, setActiveChannel] = useState<string | null>(null)

  const current = channels?.find((c) => c.id === activeChannel) ?? channels?.[0] ?? null

  if (error) return <ErrorState title="Chat didn't load" description="We couldn't load your channels." onRetry={reload} />
  if (loading) return <SkeletonRows rows={4} height="50px" />
  if (!channels || channels.length === 0) {
    return <EmptyState icon={MessageSquare} title="No channels yet" description="You'll be added to General automatically, and to a project's channel once you're assigned to it." />
  }

  return (
    <div className="ctf-chat">
      <aside className="ctf-chat__sidebar" aria-label="Channels">
        <h2>Channels</h2>
        <ul>
          {channels.map((c) => (
            <li key={c.id}>
              <button className={`ctf-chat__channel ${current?.id === c.id ? 'is-active' : ''}`} aria-current={current?.id === c.id ? 'true' : undefined} onClick={() => setActiveChannel(c.id)}>
                {c.type === 'dm' ? <User size={14} /> : <Hash size={14} />}
                <span>{channelLabel(c)}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      {/* key = remount per channel, so the draft, scroll position and message list never leak between channels */}
      {current && <ChannelThread key={current.id} channel={current} />}
    </div>
  )
}

function ChannelThread({ channel }: { channel: ChatChannel }) {
  const { profile } = useAuth()
  const { push } = useToast()
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [body, setBody] = useState('')
  const [online, setOnline] = useState<string[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [unseen, setUnseen] = useState(0)

  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const atBottomRef = useRef(true)
  const profileId = profile?.id

  // Depends on profile?.id, not the profile object: a token refresh re-creates the object and would
  // otherwise tear down and rebuild both subscriptions (and blank the message list) for nothing.
  useEffect(() => {
    let cancelled = false
    void listMessages(channel.id).then((r) => {
      if (cancelled) return
      if (r.error) { setLoadFailed(true); return }
      setMessages((prev) => (prev ? r.data.reduce(addUnique, prev) : r.data)) // keep anything realtime delivered while loading
    })
    const unsubMessages = subscribeToChannel(channel.id, (m) => {
      setMessages((prev) => addUnique(prev ?? [], m))
      if (!atBottomRef.current && m.sender_id !== profileId) setUnseen((n) => n + 1)
    })
    const unsubPresence = profileId ? subscribeToPresence(channel.id, profileId, setOnline) : () => {}
    return () => { cancelled = true; unsubMessages(); unsubPresence() }
  }, [channel.id, profileId])

  // Resolve display names for anyone we have seen but not yet named.
  const unknownIds = useMemo(() => {
    const ids = new Set<string>([...online, ...(messages ?? []).map((m) => m.sender_id)])
    return [...ids].filter((id) => id !== profileId && !names[id])
  }, [online, messages, names, profileId])
  useEffect(() => {
    if (unknownIds.length === 0) return
    let cancelled = false
    void getDisplayNames(unknownIds).then((n) => { if (!cancelled) setNames((prev) => ({ ...prev, ...n })) })
    return () => { cancelled = true }
  }, [unknownIds])

  const scrollToBottom = useCallback((smooth = false) => {
    const el = listRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    atBottomRef.current = true
    setUnseen(0)
  }, [])

  const messageCount = messages?.length ?? 0
  const lastSender = messages?.[messageCount - 1]?.sender_id
  useEffect(() => {
    // Follow new messages only if the reader is already at the bottom (or wrote the message themselves).
    if (atBottomRef.current || lastSender === profileId) scrollToBottom()
  }, [messageCount, lastSender, profileId, scrollToBottom])

  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (atBottomRef.current) setUnseen(0)
  }

  const resizeInput = () => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  const submit = async () => {
    const text = body.trim()
    if (!text) return
    setBody('')
    requestAnimationFrame(resizeInput)
    // Intentionally NOT disabling the input while sending. A disabled input drops focus, which meant
    // clicking back into the box after every single message.
    const { data, error } = await sendMessage(channel.id, text)
    if (error || !data) {
      push('Your message was not sent. Check your connection and try again.', 'error')
      setBody((current) => current || text) // give the draft back
      requestAnimationFrame(resizeInput)
      return
    }
    setMessages((prev) => addUnique(prev ?? [], data))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  const nameOf = (id: string) => (id === profileId ? 'You' : names[id] ?? 'Team member')
  const onlineOthers = online.filter((id) => id !== profileId)

  return (
    <div className="ctf-chat__thread">
      <header className="ctf-chat__head">
        <div className="ctf-chat__title">
          <strong>{channel.type === 'dm' ? <User size={15} /> : <Hash size={15} />} {channelLabel(channel)}</strong>
          <span className="ctf-chat__presence">
            <i aria-hidden="true" /> {online.length} online
          </span>
        </div>
        <CallMenu channelId={channel.id} onlineOthers={onlineOthers} nameOf={nameOf} />
      </header>

      <div className="ctf-chat__messages" ref={listRef} onScroll={onScroll} role="log" aria-live="polite" aria-label={`Messages in ${channelLabel(channel)}`}>
        {loadFailed && <ErrorState title="Messages didn't load" description="Refresh to try again." />}
        {messages === null && !loadFailed && <SkeletonRows rows={4} height="44px" />}
        {messages?.length === 0 && (
          <div className="ctf-chat__empty">
            <MessageSquare size={20} />
            <strong>This is the start of {channelLabel(channel)}</strong>
            <span>Send the first message.</span>
          </div>
        )}
        {messages?.map((m, i) => {
          const prev = messages[i - 1]
          const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString()
          const grouped = !newDay && prev.sender_id === m.sender_id && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < GROUP_GAP_MS
          const own = m.sender_id === profileId
          return (
            <div key={m.id}>
              {newDay && <div className="ctf-chat__day"><span>{dayLabel(m.created_at)}</span></div>}
              <div className={`ctf-chat__row ${own ? 'is-own' : ''} ${grouped ? 'is-grouped' : ''}`}>
                {!own && <div className="ctf-chat__avatar">{!grouped && <Avatar name={nameOf(m.sender_id)} size={30} />}</div>}
                <div className="ctf-chat__bubble-wrap">
                  {!grouped && (
                    <div className="ctf-chat__meta">
                      {!own && <strong>{nameOf(m.sender_id)}</strong>}
                      <time dateTime={m.created_at}>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                    </div>
                  )}
                  <p className="ctf-chat__bubble">{m.body}</p>
                </div>
              </div>
            </div>
          )
        })}
        {unseen > 0 && (
          <button className="ctf-chat__jump" onClick={() => scrollToBottom(true)}><ArrowDown size={13} /> {unseen} new message{unseen === 1 ? '' : 's'}</button>
        )}
      </div>

      <form className="ctf-chat__composer" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <textarea
          ref={inputRef}
          rows={1}
          value={body}
          maxLength={MAX_LENGTH}
          placeholder={`Message ${channelLabel(channel)}`}
          aria-label={`Message ${channelLabel(channel)}`}
          onChange={(e) => { setBody(e.target.value); resizeInput() }}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className="ctf-chat__send" disabled={!body.trim()} aria-label="Send message"><Send size={16} /></button>
      </form>
      <p className="ctf-chat__hint"><span className="kbd">Enter</span> to send · <span className="kbd">Shift</span> + <span className="kbd">Enter</span> for a new line</p>
    </div>
  )
}

function CallMenu({ channelId, onlineOthers, nameOf }: { channelId: string; onlineOthers: string[]; nameOf: (id: string) => string }) {
  const { startCallWith, phase } = useCall()
  const { call: groupCall, joining, joinChannelCall } = useGroupCall()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const busy = phase !== 'idle' || !!groupCall || joining
  const run = (fn: () => Promise<void>) => { setOpen(false); void fn() }

  return (
    <div className="ctf-chat__calls" ref={rootRef}>
      <button className="ctf-chat__call-btn" disabled={busy} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <PhoneCall size={14} /> {busy ? 'In a call' : 'Call'}
      </button>
      {open && (
        <div className="ctf-chat__menu" role="menu">
          <div className="ctf-chat__menu-label">Whole channel</div>
          <button role="menuitem" onClick={() => run(() => joinChannelCall(channelId, 'voice'))}><PhoneCall size={14} /> Start group voice call</button>
          <button role="menuitem" onClick={() => run(() => joinChannelCall(channelId, 'video'))}><Video size={14} /> Start group video call</button>
          <div className="ctf-chat__menu-label">Call someone who's online</div>
          {onlineOthers.length === 0 && <div className="ctf-chat__menu-empty">Nobody else is online in this channel right now.</div>}
          {onlineOthers.map((id) => (
            <div key={id} className="ctf-chat__menu-person">
              <Avatar name={nameOf(id)} size={22} />
              <span>{nameOf(id)}</span>
              <button aria-label={`Voice call ${nameOf(id)}`} onClick={() => run(() => startCallWith(id, 'voice'))}><Phone size={14} /></button>
              <button aria-label={`Video call ${nameOf(id)}`} onClick={() => run(() => startCallWith(id, 'video'))}><Video size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
