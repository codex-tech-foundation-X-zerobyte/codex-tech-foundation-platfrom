import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { AlertCircle, ArrowDown, Hash, Loader2, MessageSquare, Paperclip, Phone, PhoneCall, Send, Video, X } from 'lucide-react'
import { Avatar, EmptyState, ErrorState, SearchInput, SkeletonRows, Tabs, useToast } from '../components/ui'
import {
  deleteChatMedia, getDisplayNames, getOrCreateDm, listChannelMemberIds, listDmPartners, listMessages, listMyChannels,
  listTeamMembers, sendMessage, subscribeToChannel, subscribeToMyChannelMembership, uploadChatMedia,
  type ChatAttachment, type ChatChannel, type ChatMessage, type TeamMember,
} from '../lib/services'
import { CHAT_MAX_FILES, formatBytes, validateChatFile } from '../lib/storagePath'
import { useAuth } from '../lib/auth'
import { useCall } from '../components/CallProvider'
import { useGroupCall } from '../components/GroupCallProvider'
import { usePresence, type PresenceStatus } from '../components/PresenceProvider'
import { useChatActivity } from '../components/ChatActivityProvider'
import { FileIcon, MessageAttachments } from './ChatAttachments'
import './TeamChat.css'

const MAX_LENGTH = 4000
const GROUP_GAP_MS = 5 * 60 * 1000
const ACCEPT = 'image/*,video/*,audio/*,application/pdf,text/plain,text/csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.json'
const STATUS_TEXT: Record<PresenceStatus, string> = { online: 'Online', away: 'Away', offline: 'Offline' }

/** Insert keeping chronological order, ignoring an id we already have (the realtime echo of our own send). */
function addUnique(list: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  if (list.some((m) => m.id === msg.id)) return list
  return [...list, msg].sort((a, b) => a.created_at.localeCompare(b.created_at))
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  if (d.toDateString() === new Date().toDateString()) return 'Today'
  if (d.toDateString() === new Date(Date.now() - 86_400_000).toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

function PresenceDot({ status }: { status: PresenceStatus }) {
  return <i className={`ctf-dot ctf-dot--${status}`} role="img" aria-label={STATUS_TEXT[status]} />
}

export function TeamChat() {
  const { profile } = useAuth()
  const { push } = useToast()
  const { statusOf, onlineIds } = usePresence()
  const { unread } = useChatActivity()
  const meId = profile?.id
  const [channels, setChannels] = useState<ChatChannel[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [team, setTeam] = useState<TeamMember[]>([])
  const [partners, setPartners] = useState<Record<string, string>>({})
  const [tab, setTab] = useState<'chats' | 'people'>('chats')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [opening, setOpening] = useState<string | null>(null)

  // Refreshes in place (no skeleton flash), so a new DM can appear without the whole chat blinking.
  const refreshChannels = useCallback(async () => {
    const r = await listMyChannels()
    if (r.error) { setFailed(true); return }
    setFailed(false)
    setChannels(r.data)
    if (meId) setPartners(await listDmPartners(r.data.filter((c) => c.type === 'dm').map((c) => c.id), meId))
  }, [meId])

  useEffect(() => {
    void refreshChannels()
    void listTeamMembers().then((r) => setTeam(r.data))
  }, [refreshChannels])
  useEffect(() => (meId ? subscribeToMyChannelMembership(meId, () => void refreshChannels()) : undefined), [meId, refreshChannels])

  const teamById = useMemo(() => new Map(team.map((m) => [m.id, m])), [team])
  const labelOf = useCallback((c: ChatChannel) => (c.type === 'dm' ? teamById.get(partners[c.id])?.display_name ?? 'Direct message' : c.name || c.type), [teamById, partners])

  const current = channels?.find((c) => c.id === activeId) ?? channels?.find((c) => c.name === 'General') ?? channels?.[0] ?? null
  const groupChannels = (channels ?? []).filter((c) => c.type !== 'dm')
  const dmChannels = (channels ?? []).filter((c) => c.type === 'dm').sort((a, b) => labelOf(a).localeCompare(labelOf(b)))

  const people = useMemo(() => {
    const q = query.trim().toLowerCase()
    return team
      .filter((m) => m.id !== meId && (!q || m.display_name.toLowerCase().includes(q)))
      .sort((a, b) => Number(statusOf(b.id) !== 'offline') - Number(statusOf(a.id) !== 'offline') || a.display_name.localeCompare(b.display_name))
  }, [team, meId, query, statusOf])
  const onlineCount = team.filter((m) => m.id !== meId && onlineIds.has(m.id)).length

  const openDm = async (userId: string) => {
    setOpening(userId)
    const { data, error } = await getOrCreateDm(userId)
    setOpening(null)
    if (error || !data) { push(error?.message ?? 'Could not open that conversation.', 'error'); return }
    await refreshChannels()
    setActiveId(data)
    setTab('chats')
  }

  if (failed && !channels) return <ErrorState title="Chat didn't load" description="We couldn't load your conversations." onRetry={() => void refreshChannels()} />
  if (!channels) return <SkeletonRows rows={4} height="50px" />
  if (channels.length === 0 && team.length === 0) {
    return <EmptyState icon={MessageSquare} title="No conversations yet" description="You'll be added to General automatically, and to a project's channel once you're assigned to it." />
  }

  const channelButton = (c: ChatChannel) => {
    const isDm = c.type === 'dm'
    const partner = isDm ? partners[c.id] : undefined
    const count = unread[c.id] ?? 0
    return (
      <li key={c.id}>
        <button className={`ctf-chat__channel ${current?.id === c.id ? 'is-active' : ''}`} aria-current={current?.id === c.id ? 'true' : undefined} onClick={() => setActiveId(c.id)}>
          {isDm ? <span className="ctf-chat__avatar-wrap"><Avatar name={labelOf(c)} size={22} />{partner && <PresenceDot status={statusOf(partner)} />}</span> : <Hash size={14} />}
          <span>{labelOf(c)}</span>
          {count > 0 && <b className="ctf-chat__unread" aria-label={`${count} unread`}>{count > 99 ? '99+' : count}</b>}
        </button>
      </li>
    )
  }

  return (
    <div className="ctf-chat">
      <aside className="ctf-chat__sidebar" aria-label="Conversations">
        <Tabs label="Chat view" active={tab} onChange={(id) => setTab(id as 'chats' | 'people')} tabs={[{ id: 'chats', label: 'Chats' }, { id: 'people', label: 'People', count: onlineCount }]} />
        {tab === 'chats' ? (
          <>
            <h2>Channels</h2>
            <ul>{groupChannels.map(channelButton)}</ul>
            <h2>Direct messages</h2>
            {dmChannels.length === 0 ? (
              <p className="ctf-chat__side-empty">No private chats yet. Open <button onClick={() => setTab('people')}>People</button> to message a teammate.</p>
            ) : (
              <ul>{dmChannels.map(channelButton)}</ul>
            )}
          </>
        ) : (
          <>
            <SearchInput value={query} onChange={setQuery} placeholder="Find a teammate…" />
            <ul className="ctf-chat__people">
              {people.map((m) => (
                <li key={m.id}>
                  <button className="ctf-chat__person" disabled={opening === m.id} onClick={() => void openDm(m.id)} aria-label={`Message ${m.display_name}, ${STATUS_TEXT[statusOf(m.id)]}`}>
                    <span className="ctf-chat__avatar-wrap"><Avatar name={m.display_name} size={30} /><PresenceDot status={statusOf(m.id)} /></span>
                    <span className="ctf-chat__person-text"><strong>{m.display_name}</strong><small>{m.role === 'superadmin' ? 'Admin' : m.role} · {STATUS_TEXT[statusOf(m.id)]}</small></span>
                    {opening === m.id && <Loader2 size={14} className="ctf-chat__spin" />}
                  </button>
                </li>
              ))}
              {people.length === 0 && <li className="ctf-chat__side-empty">{query ? `Nobody matches “${query}”.` : 'No other team members yet.'}</li>}
            </ul>
          </>
        )}
      </aside>
      {/* key = remount per channel, so the draft, attachments and scroll position never leak between conversations */}
      {current ? <ChannelThread key={current.id} channel={current} label={labelOf(current)} partnerId={partners[current.id] ?? null} teamById={teamById} /> : <div className="ctf-chat__thread"><EmptyState icon={MessageSquare} title="Pick a conversation" description="Choose a channel, or open People to message a teammate." /></div>}
    </div>
  )
}

interface Pending { id: string; file: File; preview: string | null; status: 'uploading' | 'ready' | 'error'; attachment?: ChatAttachment; error?: string }

function ChannelThread({ channel, label, partnerId, teamById }: { channel: ChatChannel; label: string; partnerId: string | null; teamById: Map<string, TeamMember> }) {
  const { profile } = useAuth()
  const { push } = useToast()
  const { statusOf, onlineIds } = usePresence()
  const { setActiveChannel } = useChatActivity()
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [body, setBody] = useState('')
  const [pending, setPending] = useState<Pending[]>([])
  const [sending, setSending] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [members, setMembers] = useState<string[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [unseen, setUnseen] = useState(0)

  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const atBottomRef = useRef(true)
  const sendingRef = useRef(false)
  const pendingRef = useRef<Pending[]>([])
  useEffect(() => { pendingRef.current = pending })
  const profileId = profile?.id
  const isDm = channel.type === 'dm'

  // Messages already on screen don't count as unread; tell the global tracker which conversation is open.
  useEffect(() => {
    setActiveChannel(channel.id)
    return () => setActiveChannel(null)
  }, [channel.id, setActiveChannel])

  useEffect(() => {
    let cancelled = false
    void listMessages(channel.id).then((r) => {
      if (cancelled) return
      if (r.error) { setLoadFailed(true); return }
      setMessages((prev) => (prev ? r.data.reduce(addUnique, prev) : r.data))
    })
    void listChannelMemberIds(channel.id).then((ids) => { if (!cancelled) setMembers(ids) })
    const unsub = subscribeToChannel(channel.id, (m) => {
      setMessages((prev) => addUnique(prev ?? [], m))
      if (!atBottomRef.current && m.sender_id !== profileId) setUnseen((n) => n + 1)
    })
    return () => { cancelled = true; unsub() }
  }, [channel.id, profileId])

  // Don't strand files in storage if the person leaves without sending them.
  useEffect(() => () => {
    const orphans = pendingRef.current.filter((p) => p.attachment).map((p) => p.attachment!.path)
    pendingRef.current.forEach((p) => p.preview && URL.revokeObjectURL(p.preview))
    void deleteChatMedia(orphans)
  }, [])

  const unknownIds = useMemo(() => [...new Set((messages ?? []).map((m) => m.sender_id))].filter((id) => id !== profileId && !teamById.has(id) && !names[id]), [messages, profileId, teamById, names])
  useEffect(() => {
    if (unknownIds.length === 0) return
    let cancelled = false
    void getDisplayNames(unknownIds).then((n) => { if (!cancelled) setNames((prev) => ({ ...prev, ...n })) })
    return () => { cancelled = true }
  }, [unknownIds])
  const nameOf = (id: string) => (id === profileId ? 'You' : teamById.get(id)?.display_name ?? names[id] ?? 'Team member')

  const scrollToBottom = useCallback((smooth = false) => {
    const el = listRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    atBottomRef.current = true
    setUnseen(0)
  }, [])
  const messageCount = messages?.length ?? 0
  const lastSender = messages?.[messageCount - 1]?.sender_id
  useEffect(() => { if (atBottomRef.current || lastSender === profileId) scrollToBottom() }, [messageCount, lastSender, profileId, scrollToBottom])
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

  // ── attachments ──
  const addFiles = (files: File[]) => {
    const accepted: File[] = []
    for (const f of files) {
      if (pendingRef.current.length + accepted.length >= CHAT_MAX_FILES) { push(`You can attach up to ${CHAT_MAX_FILES} files per message.`, 'error'); break }
      const problem = validateChatFile(f)
      if (problem) { push(problem, 'error'); continue }
      accepted.push(f)
    }
    for (const file of accepted) {
      const id = crypto.randomUUID()
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null
      setPending((prev) => [...prev, { id, file, preview, status: 'uploading' }])
      void uploadChatMedia(channel.id, file).then(({ data, error }) =>
        setPending((prev) => prev.map((p) => (p.id !== id ? p : error || !data ? { ...p, status: 'error', error: error?.message ?? 'Upload failed' } : { ...p, status: 'ready', attachment: data }))),
      )
    }
  }
  const removePending = (p: Pending) => {
    if (p.preview) URL.revokeObjectURL(p.preview)
    if (p.attachment) void deleteChatMedia([p.attachment.path])
    setPending((prev) => prev.filter((x) => x.id !== p.id))
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    addFiles(Array.from(e.dataTransfer.files))
  }
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files)
    if (files.length) { e.preventDefault(); addFiles(files) } // pasted screenshots become attachments
  }

  const uploading = pending.some((p) => p.status === 'uploading')
  const ready = pending.filter((p) => p.status === 'ready')
  const canSend = !sending && !uploading && (body.trim().length > 0 || ready.length > 0)

  const submit = async () => {
    const text = body.trim()
    if (sendingRef.current || uploading || (!text && ready.length === 0)) return
    sendingRef.current = true
    setSending(true)
    // Everything stays on screen until the server confirms, so a failure loses nothing and a retry just works.
    const { data, error } = await sendMessage(channel.id, text, ready.map((p) => p.attachment!))
    sendingRef.current = false
    setSending(false)
    if (error || !data) { push(`Your message was not sent: ${error?.message ?? 'unknown error'}`, 'error'); return }
    pending.forEach((p) => p.preview && URL.revokeObjectURL(p.preview))
    setPending((prev) => prev.filter((p) => p.status === 'error'))
    setBody('')
    requestAnimationFrame(resizeInput)
    setMessages((prev) => addUnique(prev ?? [], data))
    inputRef.current?.focus()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit() }
  }

  const onlineMembers = members.filter((id) => id !== profileId && onlineIds.has(id))
  const partnerStatus = partnerId ? statusOf(partnerId) : 'offline'

  return (
    <div
      className={`ctf-chat__thread ${dragging ? 'is-dragging' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true) } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }}
      onDrop={onDrop}
    >
      {dragging && <div className="ctf-chat__drop" aria-hidden="true"><Paperclip size={22} /> Drop files to attach</div>}
      <header className="ctf-chat__head">
        <div className="ctf-chat__title">
          <strong>{isDm ? <span className="ctf-chat__avatar-wrap"><Avatar name={label} size={26} />{partnerId && <PresenceDot status={partnerStatus} />}</span> : <Hash size={15} />} {label}</strong>
          <span className="ctf-chat__presence">
            {isDm ? <><i className={`ctf-dot ctf-dot--${partnerStatus}`} aria-hidden="true" /> {STATUS_TEXT[partnerStatus]}</> : <><i className="ctf-dot ctf-dot--online" aria-hidden="true" /> {onlineMembers.length + (profileId ? 1 : 0)} online{members.length ? ` · ${members.length} members` : ''}</>}
          </span>
        </div>
        <CallMenu channelId={channel.id} isDm={isDm} partnerId={partnerId} partnerOnline={partnerStatus !== 'offline'} onlineOthers={onlineMembers} nameOf={nameOf} />
      </header>

      <div className="ctf-chat__messages" ref={listRef} onScroll={onScroll} role="log" aria-live="polite" aria-label={`Messages in ${label}`}>
        {loadFailed && <ErrorState title="Messages didn't load" description="Refresh to try again." />}
        {messages === null && !loadFailed && <SkeletonRows rows={4} height="44px" />}
        {messages?.length === 0 && (
          <div className="ctf-chat__empty">
            <MessageSquare size={20} />
            <strong>{isDm ? `This is the start of your conversation with ${label}` : `This is the start of ${label}`}</strong>
            <span>{isDm ? 'Only the two of you can see what you send here.' : 'Send the first message.'}</span>
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
                  {m.body.trim() && <p className="ctf-chat__bubble">{m.body}</p>}
                  <MessageAttachments items={m.attachments} />
                </div>
              </div>
            </div>
          )
        })}
        {unseen > 0 && <button className="ctf-chat__jump" onClick={() => scrollToBottom(true)}><ArrowDown size={13} /> {unseen} new message{unseen === 1 ? '' : 's'}</button>}
      </div>

      {pending.length > 0 && (
        <ul className="ctf-chat__pending" aria-label="Attachments to send">
          {pending.map((p) => {
            return (
              <li key={p.id} className={`ctf-pending ctf-pending--${p.status}`}>
                {p.preview ? <img src={p.preview} alt="" /> : <span className="ctf-pending__icon"><FileIcon mime={p.file.type} /></span>}
                <span className="ctf-pending__text"><strong title={p.file.name}>{p.file.name}</strong><small>{p.status === 'error' ? p.error : p.status === 'uploading' ? 'Uploading…' : formatBytes(p.file.size)}</small></span>
                {p.status === 'uploading' && <Loader2 size={14} className="ctf-chat__spin" />}
                {p.status === 'error' && <AlertCircle size={14} />}
                <button type="button" aria-label={`Remove ${p.file.name}`} onClick={() => removePending(p)}><X size={13} /></button>
              </li>
            )
          })}
        </ul>
      )}

      <form className="ctf-chat__composer" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <input ref={fileRef} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; addFiles(files) }} />
        <button type="button" className="ctf-chat__attach" aria-label="Attach files" title="Attach photos, video, audio or documents" onClick={() => fileRef.current?.click()}><Paperclip size={17} /></button>
        <textarea
          ref={inputRef}
          rows={1}
          value={body}
          maxLength={MAX_LENGTH}
          placeholder={`Message ${label}`}
          aria-label={`Message ${label}`}
          onChange={(e) => { setBody(e.target.value); resizeInput() }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        <button type="submit" className="ctf-chat__send" disabled={!canSend} aria-label="Send message">{sending ? <Loader2 size={16} className="ctf-chat__spin" /> : <Send size={16} />}</button>
      </form>
      <p className="ctf-chat__hint"><span className="kbd">Enter</span> to send · <span className="kbd">Shift</span> + <span className="kbd">Enter</span> for a new line · drop or paste files to attach</p>
    </div>
  )
}

function CallMenu({ channelId, isDm, partnerId, partnerOnline, onlineOthers, nameOf }: { channelId: string; isDm: boolean; partnerId: string | null; partnerOnline: boolean; onlineOthers: string[]; nameOf: (id: string) => string }) {
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

  // A private chat: one person to call, so skip the menu and put the buttons right in the header.
  if (isDm && partnerId) {
    const why = busy ? 'You are already in a call' : !partnerOnline ? `${nameOf(partnerId)} is offline — they wouldn't hear it ring` : ''
    return (
      <div className="ctf-chat__dm-calls">
        <button className="ctf-chat__call-btn" disabled={busy || !partnerOnline} title={why || 'Voice call'} onClick={() => run(() => startCallWith(partnerId, 'voice'))}><Phone size={14} /> Voice</button>
        <button className="ctf-chat__call-btn" disabled={busy || !partnerOnline} title={why || 'Video call'} onClick={() => run(() => startCallWith(partnerId, 'video'))}><Video size={14} /> Video</button>
      </div>
    )
  }

  return (
    <div className="ctf-chat__calls" ref={rootRef}>
      <button className="ctf-chat__call-btn" disabled={busy} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <PhoneCall size={14} /> {busy ? 'In a call' : 'Call'}
      </button>
      {open && (
        <div className="ctf-chat__menu" role="menu">
          <div className="ctf-chat__menu-label">Whole channel — everyone gets an alert to join</div>
          <button role="menuitem" onClick={() => run(() => joinChannelCall(channelId, 'voice'))}><PhoneCall size={14} /> Start group voice call</button>
          <button role="menuitem" onClick={() => run(() => joinChannelCall(channelId, 'video'))}><Video size={14} /> Start group video call</button>
          <div className="ctf-chat__menu-label">Call someone who's online</div>
          {onlineOthers.length === 0 && <div className="ctf-chat__menu-empty">Nobody else from this channel is online right now.</div>}
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
