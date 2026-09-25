import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Hash, MessageSquarePlus, PanelLeftClose, PanelLeftOpen, Paperclip, Pencil, Phone, Send, Trash2, Users, Video, X } from 'lucide-react'
import { Avatar, Button, EmptyState, Input, Modal, SkeletonRows, useToast } from '../components/ui'
import { CallView } from '../components/CallView'
import {
  deleteMessage, editMessage, ensureProjectChannel, ensureTeamChannel, getActiveCall, getAttachmentUrl,
  getProfilesByIds, listMessages, listMyChannels, listMyProjects, listWorkers,
  openDirectMessage, sendMessage, startCall, type WorkerRow,
} from '../lib/services'
import { subscribeToChannelCalls, subscribeToChannelMessages, unsubscribe } from '../lib/realtime'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Call, Channel, Message, Project } from '../lib/types'
import './ChatPage.css'

function channelLabel(channel: Channel, names: Map<string, string>, dmOtherUser: (c: Channel) => string | null) {
  if (channel.kind === 'dm') {
    const otherId = dmOtherUser(channel)
    return (otherId && names.get(otherId)) || 'Direct message'
  }
  return channel.name || 'Channel'
}

export function ChatPage() {
  const { profile } = useAuth()
  const { push } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [dmMembers, setDmMembers] = useState<Map<string, string[]>>(new Map()) // channelId -> [userIds]
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [draft, setDraft] = useState('')
  const [attachment, setAttachment] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [pickerOpen, setPickerOpen] = useState<'dm' | 'project' | null>(null)
  const [activeCall, setActiveCall] = useState<Call | null>(null)
  const [inCall, setInCall] = useState<Call | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('ctf-chat-sidebar-collapsed') === 'true')
  const fileRef = useRef<HTMLInputElement>(null)
  const listEndRef = useRef<HTMLDivElement>(null)

  const active = channels?.find((c) => c.id === activeId) ?? null

  const loadChannels = async () => {
    await ensureTeamChannel()
    const { data } = await listMyChannels()
    setChannels(data)
    if (!activeId && data.length) setActiveId(data.find((c) => c.kind === 'team')?.id ?? data[0].id)

    // Resolve DM participant pairs + everyone's display name in one pass.
    const dmIds = data.filter((c) => c.kind === 'dm').map((c) => c.id)
    if (dmIds.length) {
      const { data: members } = await supabase.from('channel_members').select('channel_id, user_id').in('channel_id', dmIds)
      const map = new Map<string, string[]>()
      for (const row of members ?? []) {
        const arr = map.get(row.channel_id) ?? []
        arr.push(row.user_id)
        map.set(row.channel_id, arr)
      }
      setDmMembers(map)
      const allIds = Array.from(map.values()).flat()
      const { data: nameMap } = await getProfilesByIds(allIds)
      setNames(nameMap)
    }
  }

  useEffect(() => { void loadChannels() }, [])

  // Deep link from IncomingCallListener's "Accept" button
  // (?join=<callId>&channel=<channelId>) — select the channel and join the
  // already-active call directly, rather than calling startCall() again
  // (which would be wrong: the call already exists, we're joining it, not
  // starting a second one).
  useEffect(() => {
    const joinCallId = searchParams.get('join')
    const joinChannelId = searchParams.get('channel')
    if (!joinCallId || !joinChannelId || channels === null) return
    setActiveId(joinChannelId)
    void getActiveCall(joinChannelId).then(({ data }) => {
      if (data && data.id === joinCallId) setInCall(data)
    })
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('join')
      next.delete('channel')
      return next
    }, { replace: true })
  }, [searchParams, channels])

  useEffect(() => {
    if (!activeId) return
    setMessages(null)
    void listMessages(activeId).then(async ({ data }) => {
      setMessages(data)
      const { data: nameMap } = await getProfilesByIds(data.map((m) => m.author_id).filter((x): x is string => !!x))
      setNames((prev) => new Map([...prev, ...nameMap]))
    })
    const channel = subscribeToChannelMessages(activeId, {
      onInsert: (message) => setMessages((prev) => (prev ? [...prev, message] : [message])),
      onUpdate: (message) => setMessages((prev) => prev?.map((m) => (m.id === message.id ? message : m)) ?? prev),
    })
    return () => unsubscribe(channel)
  }, [activeId])

  useEffect(() => { listEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // Live "is a call happening in this channel" feed, independent of
  // whether I've joined it — drives the "Call in progress · Join" banner.
  useEffect(() => {
    if (!activeId) { setActiveCall(null); return }
    void getActiveCall(activeId).then(({ data }) => setActiveCall(data))
    const channel = subscribeToChannelCalls(activeId, () => void getActiveCall(activeId).then(({ data }) => setActiveCall(data)))
    return () => unsubscribe(channel)
  }, [activeId])

  const startOrJoinCall = async (kind: Call['kind']) => {
    if (!activeId) return
    if (activeCall) { setInCall(activeCall); return }
    const { data, error } = await startCall(activeId, kind)
    if (error || !data) { push('Could not start the call.', 'error'); return }
    setInCall(data)
  }

  const dmOtherUser = (channel: Channel) => {
    const members = dmMembers.get(channel.id) ?? []
    return members.find((id) => id !== profile?.id) ?? null
  }

  const send = async () => {
    if (!activeId || (!draft.trim() && !attachment)) return
    setSending(true)
    const { error } = await sendMessage(activeId, draft, attachment ?? undefined)
    setSending(false)
    if (error) { push(error.message, 'error'); return }
    setDraft('')
    setAttachment(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const startEdit = (message: Message) => { setEditingId(message.id); setEditDraft(message.body) }
  const saveEdit = async () => {
    if (!editingId) return
    const { error } = await editMessage(editingId, editDraft)
    if (error) push('Could not save that edit.', 'error')
    setEditingId(null)
  }
  const remove = async (message: Message) => {
    if (!window.confirm('Delete this message?')) return
    const { error } = await deleteMessage(message)
    if (error) push('Could not delete that message.', 'error')
  }
  const download = async (message: Message) => {
    const { url, error } = await getAttachmentUrl(message)
    if (error || !url) { push('Could not open that attachment.', 'error'); return }
    window.open(url, '_blank', 'noopener')
  }

  const grouped = useMemo(() => {
    const team = channels?.filter((c) => c.kind === 'team') ?? []
    const project = channels?.filter((c) => c.kind === 'project') ?? []
    const dm = channels?.filter((c) => c.kind === 'dm') ?? []
    return { team, project, dm }
  }, [channels])

  return (
    <div className={`ctf-chat ${sidebarCollapsed ? 'ctf-chat--sidebar-collapsed' : ''}`}>
      <aside className={`ctf-chat__sidebar ${sidebarCollapsed ? 'is-collapsed' : ''}`}>
        <div className="ctf-chat__sidebar-head">
          {!sidebarCollapsed && <span>Channels</span>}
          {!sidebarCollapsed && (
            <>
              <button className="ctf-chat__add" onClick={() => setPickerOpen('project')} title="Open a project channel"><Hash size={14} /></button>
              <button className="ctf-chat__add" onClick={() => setPickerOpen('dm')} title="New direct message"><MessageSquarePlus size={14} /></button>
            </>
          )}
          <button
            className="ctf-chat__add"
            onClick={() => { const next = !sidebarCollapsed; setSidebarCollapsed(next); localStorage.setItem('ctf-chat-sidebar-collapsed', String(next)) }}
            title={sidebarCollapsed ? 'Expand channel list' : 'Collapse channel list'}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </button>
        </div>
        {!sidebarCollapsed && channels === null && <SkeletonRows rows={3} />}
        {!sidebarCollapsed && channels && (
          <div className="ctf-chat__list">
            {grouped.team.map((c) => (
              <button key={c.id} className={`ctf-chat__item ${activeId === c.id ? 'is-active' : ''}`} onClick={() => setActiveId(c.id)}>
                <Users size={14} /> {c.name}
              </button>
            ))}
            {grouped.project.length > 0 && <div className="ctf-chat__group-label">Projects</div>}
            {grouped.project.map((c) => (
              <button key={c.id} className={`ctf-chat__item ${activeId === c.id ? 'is-active' : ''}`} onClick={() => setActiveId(c.id)}>
                <Hash size={14} /> {c.name}
              </button>
            ))}
            {grouped.dm.length > 0 && <div className="ctf-chat__group-label">Direct messages</div>}
            {grouped.dm.map((c) => (
              <button key={c.id} className={`ctf-chat__item ${activeId === c.id ? 'is-active' : ''}`} onClick={() => setActiveId(c.id)}>
                <Avatar name={channelLabel(c, names, dmOtherUser)} size={20} /> {channelLabel(c, names, dmOtherUser)}
              </button>
            ))}
          </div>
        )}
      </aside>

      <section className="ctf-chat__thread">
        {!active && <EmptyState icon={Hash} title="Select a channel" description="Pick a channel on the left to start chatting." />}
        {active && (
          <>
            <div className="ctf-chat__thread-head">
              <span>{channelLabel(active, names, dmOtherUser)}</span>
              <div className="ctf-chat__thread-head-actions">
                <Button variant="ghost" size="sm" icon={<Phone size={14} />} onClick={() => void startOrJoinCall('voice')}>
                  {activeCall?.kind === 'voice' ? 'Join call' : 'Voice call'}
                </Button>
                <Button variant="ghost" size="sm" icon={<Video size={14} />} onClick={() => void startOrJoinCall('video')}>
                  {activeCall?.kind === 'video' ? 'Join call' : 'Video call'}
                </Button>
              </div>
            </div>
            {activeCall && !inCall && (
              <div className="ctf-chat__call-banner">
                <span>{activeCall.kind === 'video' ? 'Video' : 'Voice'} call in progress</span>
                <Button variant="primary" size="sm" onClick={() => setInCall(activeCall)}>Join</Button>
              </div>
            )}
            <div className="ctf-chat__messages">
              {messages === null && <SkeletonRows rows={3} />}
              {messages && messages.length === 0 && <EmptyState icon={Hash} title="No messages yet" description="Say hello — this channel is empty so far." />}
              {messages?.map((m, i) => {
                const isMine = m.author_id === profile?.id
                const prev = messages[i - 1]
                // Sender name/avatar shown once per consecutive run from the
                // same person — not repeated on every bubble (matches the
                // convention in Slack/Telegram/WhatsApp group chats). Never
                // shown for your own messages (no "You" label needed) or in
                // a DM (only two participants — who sent what is implicit
                // from which side of the thread it's on, same as WhatsApp).
                const showHeader = !isMine && active?.kind !== 'dm' && (!prev || prev.author_id !== m.author_id || prev.deleted_at)
                return (
                  <div key={m.id} className={`ctf-chat__message ${isMine ? 'is-mine' : 'is-theirs'}`}>
                    {!isMine && (
                      <div className="ctf-chat__message-avatar">
                        {showHeader ? <Avatar name={names.get(m.author_id ?? '') ?? '?'} size={28} /> : <span className="ctf-chat__avatar-spacer" />}
                      </div>
                    )}
                    <div className="ctf-chat__bubble-col">
                      {showHeader && <span className="ctf-chat__sender-name">{names.get(m.author_id ?? '') ?? 'Unknown'}</span>}
                      <div className="ctf-chat__bubble">
                        {m.deleted_at ? (
                          <em className="ctf-chat__deleted">Message deleted</em>
                        ) : editingId === m.id ? (
                          <div className="ctf-chat__edit-row">
                            <Input value={editDraft} onChange={(e) => setEditDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void saveEdit(); if (e.key === 'Escape') setEditingId(null) }} autoFocus />
                            <Button size="sm" variant="primary" onClick={() => void saveEdit()}>Save</Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <>
                            {m.body && <p>{m.body}</p>}
                            {m.attachment_name && (
                              <button className="ctf-chat__attachment" onClick={() => void download(m)}>
                                <Paperclip size={13} /> {m.attachment_name}
                              </button>
                            )}
                          </>
                        )}
                        <span className="ctf-chat__bubble-time">
                          {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{m.edited_at ? ' · edited' : ''}
                        </span>
                      </div>
                      {!m.deleted_at && isMine && editingId !== m.id && (
                        <div className="ctf-chat__message-actions">
                          <button onClick={() => startEdit(m)} title="Edit"><Pencil size={13} /></button>
                          <button onClick={() => void remove(m)} title="Delete"><Trash2 size={13} /></button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
              <div ref={listEndRef} />
            </div>

            <div className="ctf-chat__composer">
              {attachment && (
                <div className="ctf-chat__composer-attachment">
                  <Paperclip size={12} /> {attachment.name}
                  <button onClick={() => { setAttachment(null); if (fileRef.current) fileRef.current.value = '' }}><X size={12} /></button>
                </div>
              )}
              <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={(e) => setAttachment(e.target.files?.[0] ?? null)} />
              <button className="ctf-chat__attach-btn" onClick={() => fileRef.current?.click()} title="Attach a file"><Paperclip size={16} /></button>
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
                placeholder={`Message ${channelLabel(active, names, dmOtherUser)}`}
              />
              <Button variant="primary" icon={<Send size={15} />} loading={sending} onClick={() => void send()} disabled={!draft.trim() && !attachment}>Send</Button>
            </div>
          </>
        )}
      </section>

      <DmPicker
        open={pickerOpen === 'dm'}
        onClose={() => setPickerOpen(null)}
        onPicked={async (userId) => {
          const { data } = await openDirectMessage(userId)
          setPickerOpen(null)
          if (data) { await loadChannels(); setActiveId(data.id) }
        }}
      />
      <ProjectChannelPicker
        open={pickerOpen === 'project'}
        onClose={() => setPickerOpen(null)}
        onPicked={async (project) => {
          const { data } = await ensureProjectChannel(project)
          setPickerOpen(null)
          if (data) { await loadChannels(); setActiveId(data.id) }
        }}
      />

      {inCall && <CallView call={inCall} names={names} onLeave={() => setInCall(null)} />}
    </div>
  )
}

function DmPicker({ open, onClose, onPicked }: { open: boolean; onClose: () => void; onPicked: (userId: string) => void }) {
  const { profile } = useAuth()
  const [workers, setWorkers] = useState<WorkerRow[] | null>(null)
  useEffect(() => { if (open) void listWorkers().then((r) => setWorkers(r.data)) }, [open])

  return (
    <Modal open={open} onClose={onClose} title="New direct message">
      {workers === null && <SkeletonRows rows={3} />}
      {workers && (
        <div style={{ display: 'grid', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
          {workers.filter((w) => w.user_id !== profile?.id).map((w) => (
            <button key={w.user_id} className="ctf-chat__picker-row" onClick={() => onPicked(w.user_id)}>
              <Avatar name={w.display_name} size={24} /> {w.display_name}
            </button>
          ))}
          {workers.length === 0 && <p>No other team members yet.</p>}
        </div>
      )}
    </Modal>
  )
}

function ProjectChannelPicker({ open, onClose, onPicked }: { open: boolean; onClose: () => void; onPicked: (project: Project) => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null)
  useEffect(() => { if (open) void listMyProjects().then((r) => setProjects(r.data)) }, [open])

  return (
    <Modal open={open} onClose={onClose} title="Open a project channel">
      {projects === null && <SkeletonRows rows={3} />}
      {projects && (
        <div style={{ display: 'grid', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
          {projects.map((p) => (
            <button key={p.id} className="ctf-chat__picker-row" onClick={() => onPicked(p)}>
              <Hash size={14} /> {p.name}
            </button>
          ))}
          {projects.length === 0 && <p>No projects yet.</p>}
        </div>
      )}
    </Modal>
  )
}
