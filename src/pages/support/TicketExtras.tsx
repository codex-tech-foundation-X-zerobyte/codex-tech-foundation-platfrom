import { useRef, useState, type FormEvent } from 'react'
import { Paperclip, Link2 } from 'lucide-react'
import { Badge, Button, ErrorState, Input, SkeletonRows, useToast } from '../../components/ui'
import { addAttachment, attachmentLink, linkIncident, listAttachments, listIncidentLinks, unlinkIncident } from '../../lib/services'
import { formatBytes } from '../../lib/storagePath'
import { ATTACHMENT_TYPES } from '../../lib/supportRules'
import { useAsyncData } from '../../hooks/useAsyncData'
import { timeAgo } from '../../lib/format'
import './TicketExtras.css'

const INCIDENT_TONE: Record<string, 'danger' | 'warning' | 'success' | 'neutral'> = { critical: 'danger', high: 'danger', medium: 'warning', low: 'neutral' }

/** Files on a ticket. Everything is private; only Customer Service can mark a file as shared with the customer. */
function Attachments({ ticketId, isAgent, closed }: { ticketId: string; isAgent: boolean; closed: boolean }) {
  const list = useAsyncData(`support-attachments:${ticketId}`, () => listAttachments(ticketId))
  const { push } = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [share, setShare] = useState(false)
  const [busy, setBusy] = useState(false)

  const pick = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setBusy(true)
    const r = await addAttachment(ticketId, file, isAgent && share ? 'public' : 'internal')
    setBusy(false)
    if (input.current) input.current.value = ''
    if (r.error) { push(r.error.message, 'error'); return }
    push(share && isAgent ? 'Attached, and shared with the customer.' : 'Attached for the team.', 'success'); list.reload()
  }
  const open = async (path: string) => {
    const r = await attachmentLink(path)
    if (r.error || !r.url) { push(r.error?.message ?? 'The link could not be made.', 'error'); return }
    window.open(r.url, '_blank', 'noopener,noreferrer')
  }
  return (
    <section className="ctf-extras" aria-labelledby={`att-${ticketId}`}>
      <h3 id={`att-${ticketId}`}><Paperclip size={14} aria-hidden /> Files</h3>
      {list.loading ? <SkeletonRows rows={1} /> : list.error ? <ErrorState title="Files couldn't load" description={list.errorDetail?.message ?? 'Try again.'} onRetry={list.reload} /> : (list.data ?? []).length === 0 ? <p className="ctf-extras__none">No files yet.</p> : (
        <ul className="ctf-extras__list">
          {(list.data ?? []).map((a) => (
            <li key={a.id}>
              <button type="button" className="ctf-extras__file" onClick={() => void open(a.path)}>{a.file_name}</button>
              <span className="ctf-extras__meta">{ATTACHMENT_TYPES[a.mime_type] ?? a.mime_type} · {formatBytes(a.size_bytes)} · {timeAgo(a.created_at)}</span>
              {a.visibility === 'public' ? <Badge tone="accent">Shared with customer</Badge> : <Badge tone="warning">Internal</Badge>}
            </li>
          ))}
        </ul>
      )}
      {!closed && (
        <div className="ctf-extras__add">
          <input ref={input} type="file" className="visually-hidden" id={`att-in-${ticketId}`} accept={Object.keys(ATTACHMENT_TYPES).join(',')} onChange={(e) => void pick(e.target.files)} disabled={busy} />
          <Button size="sm" variant="secondary" loading={busy} onClick={() => input.current?.click()}>Add a file</Button>
          {isAgent && <label className="ctf-extras__share"><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /> Share the next file with the customer</label>}
          <span className="ctf-extras__hint">PDF, image, text or CSV, up to 10 MB. Files cannot be deleted.</span>
        </div>
      )}
    </section>
  )
}

/** Incidents behind this ticket: Customer Service sees reference, severity and status (not the incident itself); engineers link and unlink. */
function Incidents({ ticketId, canLink }: { ticketId: string; canLink: boolean }) {
  const links = useAsyncData(`support-incidents:${ticketId}`, () => listIncidentLinks(ticketId))
  const { push } = useToast()
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true)
    const r = await linkIncident(ticketId, ref.trim())
    setBusy(false)
    if (r.error) { push(r.error.message, 'error'); return }
    setRef(''); links.reload()
  }
  const items = links.data ?? []
  return (
    <section className="ctf-extras" aria-labelledby={`inc-${ticketId}`}>
      <h3 id={`inc-${ticketId}`}><Link2 size={14} aria-hidden /> Related incidents</h3>
      {links.loading ? <SkeletonRows rows={1} /> : links.error ? <ErrorState title="Incidents couldn't load" description={links.errorDetail?.message ?? 'Try again.'} onRetry={links.reload} /> : items.length === 0 ? <p className="ctf-extras__none">None linked.</p> : (
        <ul className="ctf-extras__list">
          {items.map((i) => (
            <li key={i.id}>
              <strong>{i.ref}</strong><span className="ctf-extras__meta">{i.project}</span>
              <Badge tone={INCIDENT_TONE[i.severity] ?? 'neutral'}>{i.severity}</Badge><Badge tone={i.status === 'resolved' ? 'success' : 'warning'}>{i.status.replace('_', ' ')}</Badge>
              {canLink && <Button size="sm" variant="ghost" onClick={() => void unlinkIncident(ticketId, i.id).then((r) => { if (r.error) push(r.error.message, 'error'); else links.reload() })}>Unlink</Button>}
            </li>
          ))}
        </ul>
      )}
      {canLink && (
        <form className="ctf-extras__add" onSubmit={(e) => void submit(e)}>
          <Input aria-label="Incident reference" placeholder="INC-000123" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={20} />
          <Button type="submit" size="sm" variant="secondary" loading={busy} disabled={!/^inc-\d{3,}$/i.test(ref.trim())}>Link incident</Button>
        </form>
      )}
    </section>
  )
}

export function TicketExtras({ ticketId, isAgent, canLink, closed }: { ticketId: string; isAgent: boolean; canLink: boolean; closed: boolean }) {
  return <div className="ctf-extras-wrap"><Attachments ticketId={ticketId} isAgent={isAgent} closed={closed} /><Incidents ticketId={ticketId} canLink={canLink} /></div>
}
