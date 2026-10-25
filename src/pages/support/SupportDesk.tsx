import { useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { ArrowUpRight, Headset, KeyRound, Lock, Plus, Send } from 'lucide-react'
import { Badge, Button, CopyButton, EmptyState, ErrorState, FieldWrap, Input, Modal, PageHeader, SearchInput, Select, SkeletonRows, Table, Tabs, Textarea, useToast } from '../../components/ui'
import {
  assignTicket, connectSupportProject, createSupportTicket, escalateTicket, getMyDepartments, listSupportAgents, listSupportSources, listTicketMessages, listTickets, replyToTicket,
  setSupportProjectActive, setTicketStatus, type TicketRow,
} from '../../lib/services'
import { CATEGORY_LABEL, PRIORITY_LABEL, STATUS_LABEL, TECH_DEPARTMENTS, agentStats, dueLabel, isLive, isOverdue, type TicketPriority, type TicketStatus } from '../../lib/supportRules'
import { timeAgo } from '../../lib/format'
import { useAuth } from '../../lib/auth'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import './SupportDesk.css'

type Filter = 'live' | 'unassigned' | 'mine' | 'overdue' | 'escalated' | 'resolved' | 'all'
const FILTERS: [Filter, string][] = [['live', 'Open'], ['unassigned', 'Unassigned'], ['mine', 'Mine'], ['overdue', 'Overdue'], ['escalated', 'Escalated'], ['resolved', 'Resolved'], ['all', 'All']]
const PRIORITY_TONE = { low: 'neutral', normal: 'neutral', high: 'warning', urgent: 'danger' } as const

export function SupportDesk() {
  useDocumentTitle('Support desk')
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'inbox'
  const tickets = useAsyncData('support-tickets', listTickets)
  const mine = useAsyncData(`support-mine:${profile?.id}`, async () => (profile && profile.role !== 'superadmin' ? getMyDepartments(profile.id) : { data: [], error: null }))
  const isMainAdmin = profile?.role === 'superadmin'
  const inCs = (mine.data ?? []).find((m) => m.department.slug === 'customer-service')
  const isAgent = isMainAdmin || !!inCs
  const isLead = isMainAdmin || inCs?.role === 'admin'
  const [filter, setFilter] = useState<Filter>('live')
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const rows = tickets.data ?? []
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((t) => {
      if (q && !`${t.ref} ${t.subject} ${t.customer_name} ${t.customer_ref}`.toLowerCase().includes(q)) return false
      switch (filter) {
        case 'live': return isLive(t.status)
        case 'unassigned': return isLive(t.status) && !t.assignee_id
        case 'mine': return t.assignee_id === profile?.id && isLive(t.status)
        case 'overdue': return isOverdue(t)
        case 'escalated': return t.status === 'escalated'
        case 'resolved': return !isLive(t.status)
        default: return true
      }
    })
  }, [rows, filter, query, profile?.id])
  const open = rows.find((t) => t.id === openId) ?? null
  const tabs = [{ id: 'inbox', label: 'Inbox', count: rows.filter((t) => isLive(t.status)).length }, ...(isLead ? [{ id: 'projects', label: 'Connected projects' }, { id: 'performance', label: 'Performance' }] : [])]

  return (
    <div className="ctf-support">
      <PageHeader title="Support desk" description="Every customer report from every connected project, in one inbox. Replies reach the customer; internal notes never do."
        actions={isAgent ? <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)}>Log a ticket</Button> : undefined} />
      {!tickets.loading && !isAgent && rows.length === 0 && !tickets.error
        ? <EmptyState icon={Headset} title="Nothing here for you" description="The support desk is for the Customer Service team. Technical departments see a ticket here once it is escalated to them." />
        : <>
          <Tabs tabs={tabs} active={tabs.some((t) => t.id === tab) ? tab : 'inbox'} onChange={(id) => setParams({ tab: id })} label="Support views" />
          {tab === 'projects' && isLead ? <Projects canManage={isMainAdmin} /> : tab === 'performance' && isLead ? <Performance tickets={rows} /> : (
            <>
              <div className="ctf-support__bar">
                <div className="ctf-support__filters" role="group" aria-label="Filter tickets">
                  {FILTERS.map(([id, label]) => <button key={id} type="button" className={filter === id ? 'is-on' : ''} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
                </div>
                <SearchInput value={query} onChange={setQuery} placeholder="Search tickets" />
              </div>
              {tickets.error ? <ErrorState title="Tickets couldn't load" description={tickets.errorDetail?.message ?? 'Try again.'} onRetry={tickets.reload} /> : (
                <Table loading={tickets.loading} rows={shown} rowKey={(t) => t.id} onRowClick={(t) => setOpenId(t.id)}
                  emptyState={<EmptyState icon={Headset} title={filter === 'live' ? 'No open tickets' : 'No tickets match'} description="When a customer reports something from a connected project, it lands here." />}
                  columns={[
                    { key: 'subject', header: 'Ticket', render: (t: TicketRow) => <><strong>{t.subject}</strong><div className="ctf-support__sub">{t.ref} · {t.source_name ?? 'Logged by staff'}{t.customer_name ? ` · ${t.customer_name}` : ''}</div></> },
                    { key: 'priority', header: 'Priority', render: (t: TicketRow) => <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge> },
                    { key: 'status', header: 'Status', render: (t: TicketRow) => <Badge tone={t.status === 'escalated' ? 'warning' : isLive(t.status) ? 'accent' : 'success'}>{STATUS_LABEL[t.status]}</Badge> },
                    { key: 'due', header: 'First reply', render: (t: TicketRow) => { const d = dueLabel(t); return <Badge tone={d.tone}>{d.text}</Badge> } },
                    { key: 'who', header: 'Assigned to', render: (t: TicketRow) => t.assignee_name ?? <span className="ctf-support__sub">Unassigned</span> },
                    { key: 'when', header: 'Opened', render: (t: TicketRow) => timeAgo(t.created_at) },
                  ]} />
              )}
            </>
          )}
        </>}
      <Modal open={creating} onClose={() => setCreating(false)} title="Log a ticket" description="For a customer who contacted you directly. Reports from connected projects arrive on their own.">
        {creating && <NewTicketForm onCancel={() => setCreating(false)} onDone={() => { setCreating(false); tickets.reload() }} />}
      </Modal>
      <Modal open={!!open} onClose={() => setOpenId(null)} title={open ? `${open.ref} · ${open.subject}` : ''} size="lg">
        {open && <TicketDetail key={open.id} ticket={open} isAgent={isAgent} isLead={isLead} meId={profile?.id} onChanged={() => tickets.reload()} />}
      </Modal>
    </div>
  )
}

function NewTicketForm({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const { push } = useToast()
  const [f, setF] = useState({ customer_name: '', customer_ref: '', subject: '', description: '', category: 'other', priority: 'normal' })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true)
    const { error } = await createSupportTicket(f)
    setBusy(false)
    if (error) push(error.message, 'error'); else { push('Ticket logged.'); onDone() }
  }
  return (
    <form className="ctf-sform" onSubmit={(e) => void submit(e)}>
      <FieldWrap label="Subject" htmlFor="tk-sub" required><Input id="tk-sub" value={f.subject} onChange={set('subject')} maxLength={200} autoFocus /></FieldWrap>
      <div className="ctf-sform__row">
        <FieldWrap label="Customer name" htmlFor="tk-name"><Input id="tk-name" value={f.customer_name} onChange={set('customer_name')} maxLength={120} /></FieldWrap>
        <FieldWrap label="Customer reference" htmlFor="tk-ref" hint="Their account or user id, not a password."><Input id="tk-ref" value={f.customer_ref} onChange={set('customer_ref')} maxLength={200} /></FieldWrap>
      </div>
      <div className="ctf-sform__row">
        <FieldWrap label="Category" htmlFor="tk-cat"><Select id="tk-cat" value={f.category} onChange={set('category')}>{Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></FieldWrap>
        <FieldWrap label="Priority" htmlFor="tk-pri" hint="Sets the first-reply target."><Select id="tk-pri" value={f.priority} onChange={set('priority')}>{(Object.keys(PRIORITY_LABEL) as TicketPriority[]).map((k) => <option key={k} value={k}>{PRIORITY_LABEL[k]}</option>)}</Select></FieldWrap>
      </div>
      <FieldWrap label="What happened?" htmlFor="tk-desc"><Textarea id="tk-desc" rows={4} value={f.description} onChange={set('description')} maxLength={8000} /></FieldWrap>
      <div className="ctf-sform__actions"><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button type="submit" variant="primary" loading={busy} disabled={f.subject.trim().length < 3}>Log ticket</Button></div>
    </form>
  )
}

function TicketDetail({ ticket: t, isAgent, isLead, meId, onChanged }: { ticket: TicketRow; isAgent: boolean; isLead: boolean; meId: string | undefined; onChanged: () => void }) {
  const { push } = useToast()
  const msgs = useAsyncData(`ticket-msgs:${t.id}`, () => listTicketMessages(t.id))
  const agents = useAsyncData('support-agents', listSupportAgents)
  const [body, setBody] = useState('')
  const [mode, setMode] = useState<'public' | 'internal'>('public')
  const [busy, setBusy] = useState(false)
  const [escalating, setEscalating] = useState(false)
  const [esc, setEsc] = useState({ dept: 'backend-development', note: '' })
  const canAct = isAgent && (isLead || !t.assignee_id || t.assignee_id === meId)

  const act = async (fn: () => Promise<{ error: Error | null }>, ok: string, after?: () => void) => {
    setBusy(true); const { error } = await fn(); setBusy(false)
    if (error) { push(error.message, 'error'); return }
    push(ok); after?.(); onChanged(); msgs.reload()
  }
  const send = (e: FormEvent) => { e.preventDefault(); if (body.trim()) void act(() => replyToTicket(t.id, body, isAgent ? mode : 'internal'), mode === 'public' && isAgent ? 'Reply sent to the customer.' : 'Note added.', () => setBody('')) }

  return (
    <div className="ctf-tdetail">
      <div className="ctf-tdetail__meta">
        <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge><Badge tone="neutral">{CATEGORY_LABEL[t.category] ?? t.category}</Badge>
        {t.rating && <Badge tone="success">Customer rated {t.rating}/5</Badge>}
        <span className="ctf-support__sub">{t.source_name ?? 'Logged by staff'}{t.customer_name ? ` · ${t.customer_name}` : ''}{t.customer_ref ? ` (${t.customer_ref})` : ''} · opened {timeAgo(t.created_at)}</span>
      </div>
      {t.description && <p className="ctf-tdetail__desc">{t.description}</p>}
      {isAgent && (
        <div className="ctf-tdetail__controls">
          <label>Status<Select value={t.status} disabled={!canAct || busy} onChange={(e) => void act(() => setTicketStatus(t.id, e.target.value as TicketStatus), 'Status updated.')}>
            {(Object.keys(STATUS_LABEL) as TicketStatus[]).map((s) => <option key={s} value={s} disabled={s === 'escalated' && t.status !== 'escalated'}>{STATUS_LABEL[s]}</option>)}</Select></label>
          <label>Assigned to<Select value={t.assignee_id ?? ''} disabled={busy || (!isLead && !!t.assignee_id)} onChange={(e) => void act(() => assignTicket(t.id, e.target.value || null), 'Assignment updated.')}>
            <option value="">Unassigned</option>{(agents.data ?? []).filter((a) => isLead || a.id === meId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></label>
          {canAct && isLive(t.status) && t.status !== 'escalated' && <Button variant="secondary" icon={<ArrowUpRight size={14} />} onClick={() => setEscalating(true)}>Escalate to a technical team</Button>}
        </div>
      )}
      {escalating && (
        <form className="ctf-tdetail__escalate" onSubmit={(e) => { e.preventDefault(); void act(() => escalateTicket(t.id, esc.dept, esc.note), 'Escalated. It is on that team\u2019s bug board.', () => setEscalating(false)) }}>
          <Select aria-label="Technical department" value={esc.dept} onChange={(e) => setEsc({ ...esc, dept: e.target.value })}>{TECH_DEPARTMENTS.map(([s, n]) => <option key={s} value={s}>{n}</option>)}</Select>
          <Textarea aria-label="What do you need from them?" rows={3} value={esc.note} onChange={(e) => setEsc({ ...esc, note: e.target.value })} placeholder="What do you need from them? Include what the customer sees." />
          <div className="ctf-sform__actions"><Button variant="ghost" onClick={() => setEscalating(false)}>Cancel</Button><Button type="submit" variant="primary" loading={busy} disabled={esc.note.trim().length < 5}>Escalate</Button></div>
        </form>
      )}
      <h4>Conversation</h4>
      {msgs.loading ? <SkeletonRows rows={3} height="44px" /> : (
        <ol className="ctf-thread">
          {(msgs.data ?? []).map((m) => (
            <li key={m.id} className={`ctf-thread__msg ctf-thread__msg--${m.author_kind} ${m.visibility === 'internal' ? 'is-internal' : ''}`}>
              <header><strong>{m.author_name}</strong>
                {m.visibility === 'internal' ? <Badge tone="warning"><Lock size={10} style={{ verticalAlign: '-1px' }} /> Internal</Badge> : m.author_kind !== 'system' ? <Badge tone="accent">Customer can see</Badge> : null}
                <span>{timeAgo(m.created_at)}</span></header>
              <p>{m.body}</p>
            </li>
          ))}
        </ol>
      )}
      {(isAgent || t.escalated_department_id) && t.status !== 'closed' && (
        <form className="ctf-reply" onSubmit={send}>
          {isAgent && <div className="ctf-reply__mode" role="group" aria-label="Who sees this">
            <button type="button" className={mode === 'public' ? 'is-on' : ''} aria-pressed={mode === 'public'} onClick={() => setMode('public')}><Send size={13} /> Reply to customer</button>
            <button type="button" className={mode === 'internal' ? 'is-on is-internal' : ''} aria-pressed={mode === 'internal'} onClick={() => setMode('internal')}><Lock size={13} /> Internal note</button>
          </div>}
          <Textarea aria-label={mode === 'public' && isAgent ? 'Reply to the customer' : 'Internal note'} rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={8000}
            placeholder={isAgent && mode === 'public' ? 'The customer will read this.' : 'Only the team can read this.'} />
          <div className="ctf-sform__actions"><Button type="submit" variant={mode === 'public' && isAgent ? 'primary' : 'secondary'} loading={busy} disabled={!body.trim()}>{mode === 'public' && isAgent ? 'Send to customer' : 'Add note'}</Button></div>
        </form>
      )}
    </div>
  )
}

function Projects({ canManage }: { canManage: boolean }) {
  const sources = useAsyncData('support-sources', listSupportSources)
  const { push } = useToast()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [shown, setShown] = useState<string | null>(null)
  const endpoint = `${import.meta.env?.VITE_SUPABASE_URL ?? 'https://YOUR-PROJECT.supabase.co'}/functions/v1/support-intake`
  const connect = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true)
    const { key, error } = await connectSupportProject(name)
    setBusy(false)
    if (error || !key) { push(error?.message ?? 'Could not connect.', 'error'); return }
    setShown(key); setName(''); sources.reload()
  }
  return (
    <div className="ctf-sprojects">
      <p className="ctf-support__note">Each connected project gets its own key. The project&apos;s <strong>backend</strong> (never its browser code) sends customer reports to the endpoint below with the key. Only a fingerprint of the key is stored, so a lost key cannot be recovered: make a new one and revoke the old.</p>
      <div className="ctf-sprojects__endpoint"><code>{endpoint}</code><CopyButton value={endpoint} label="Copy endpoint" /></div>
      {canManage && <form className="ctf-sprojects__add" onSubmit={(e) => void connect(e)}><Input aria-label="Project name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name, e.g. Portfolio site" maxLength={80} /><Button type="submit" variant="primary" icon={<KeyRound size={14} />} loading={busy} disabled={name.trim().length < 2}>Connect project</Button></form>}
      {!canManage && <p className="ctf-support__note">Only a Main Admin can connect or revoke projects.</p>}
      <Modal open={!!shown} onClose={() => setShown(null)} title="Copy this key now" description="This is the only time it is shown.">
        <div className="ctf-sprojects__key"><code>{shown}</code><CopyButton value={shown ?? ''} label="Copy key" /></div>
        <p className="ctf-support__note">Keep it in the project&apos;s server environment variables. Never put it in front-end code, a repository or a chat.</p>
        <div className="ctf-sform__actions"><Button variant="primary" onClick={() => setShown(null)}>I have saved it</Button></div>
      </Modal>
      {sources.loading ? <SkeletonRows rows={2} /> : (
        <Table rows={sources.data ?? []} rowKey={(s) => s.id} emptyState={<EmptyState icon={KeyRound} title="No projects connected" description="Connect a project to start receiving its customers' reports." />}
          columns={[
            { key: 'n', header: 'Project', render: (s) => <><strong>{s.name}</strong><div className="ctf-support__sub">Key {s.key_prefix}…</div></> },
            { key: 's', header: 'Status', render: (s) => <Badge tone={s.active ? 'success' : 'neutral'}>{s.active ? 'Active' : 'Revoked'}</Badge> },
            { key: 'u', header: 'Last report', render: (s) => (s.last_used_at ? timeAgo(s.last_used_at) : 'Never') },
            { key: 'a', header: '', render: (s) => canManage ? <Button size="sm" variant="ghost" onClick={() => void setSupportProjectActive(s.id, !s.active).then((r) => { if (r.error) push(r.error.message, 'error'); else sources.reload() })}>{s.active ? 'Revoke' : 'Restore'}</Button> : null },
          ]} />
      )}
    </div>
  )
}

function Performance({ tickets }: { tickets: TicketRow[] }) {
  const names = useMemo(() => new Map(tickets.filter((t) => t.assignee_id && t.assignee_name).map((t) => [t.assignee_id!, t.assignee_name!])), [tickets])
  const stats = useMemo(() => agentStats(tickets, names), [tickets, names])
  const h = (v: number | null) => (v === null ? '—' : v < 1 ? `${Math.round(v * 60)} min` : `${v.toFixed(1)} h`)
  return (
    <div className="ctf-sprojects">
      <p className="ctf-support__note">Counts alone reward fast, easy tickets, so every figure here sits beside response time, resolution time and the customer&apos;s own rating. Treat it as a conversation starter, not a ranking. Ratings only exist for tickets from connected projects whose customers chose to rate.</p>
      <Table rows={stats} rowKey={(s) => s.agent} emptyState={<EmptyState icon={Headset} title="Nothing to measure yet" description="Figures appear once tickets have been assigned." />}
        columns={[
          { key: 'a', header: 'Agent', render: (s) => <strong>{s.agent}</strong> }, { key: 'h', header: 'Handled', render: (s) => s.handled }, { key: 'r', header: 'Resolved', render: (s) => s.resolved },
          { key: 'f', header: 'Avg first reply', render: (s) => h(s.avgFirstResponseH) }, { key: 'x', header: 'Avg resolution', render: (s) => h(s.avgResolutionH) },
          { key: 's', header: 'Customer rating', render: (s) => (s.avgRating === null ? '—' : `${s.avgRating.toFixed(1)} / 5 (${s.rated})`) },
        ]} />
    </div>
  )
}
