import { useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, Mail, Phone } from 'lucide-react'
import { Badge, Button, FieldWrap, Modal, Select, Textarea, copyToClipboard, useToast } from '../../components/ui'
import { DeleteButton } from '../../components/DeleteButton'
import { Linkify } from '../../components/Linkify'
import { deleteLead, updateLeadNotes, updateLeadStatus } from '../../lib/services'
import { parseLeadMessage, telHref } from '../../lib/leadMessage'
import { timeAgo } from '../../lib/format'
import type { Lead, LeadStatus } from '../../lib/types'
import './LeadDetail.css'

const STATUSES: LeadStatus[] = ['new', 'contacted', 'qualified', 'converted', 'closed']

interface LeadDetailProps {
  lead: Lead
  position: { index: number; total: number }
  onPrev: (() => void) | null
  onNext: (() => void) | null
  onClose: () => void
  /** The list needs to reload (status/notes changed, or the lead was deleted). */
  onChanged: () => void
}

/** Everything about one enquiry in one place: read it properly, reply, set its status, leave private notes. */
export function LeadDetail({ lead, position, onPrev, onNext, onClose, onChanged }: LeadDetailProps) {
  // The parent keys this component by lead id, so switching lead (Next/Prev) starts with that lead's own notes.
  const [notes, setNotes] = useState(lead.internal_notes ?? '')
  const [savedNotes, setSavedNotes] = useState(lead.internal_notes ?? '')
  const [savingNotes, setSavingNotes] = useState(false)
  const { push } = useToast()
  const parsed = parseLeadMessage(lead.message)
  const tel = telHref(parsed.phone)
  const dirty = notes !== savedNotes
  const id = lead.id as string

  const setStatus = async (status: LeadStatus) => {
    const { error } = await updateLeadStatus(id, status)
    push(error ? 'Could not update status.' : `Marked ${status}.`, error ? 'error' : 'success')
    onChanged()
  }
  const saveNotes = async () => {
    setSavingNotes(true)
    const { error } = await updateLeadNotes(id, notes)
    setSavingNotes(false)
    if (error) { push(error.message, 'error'); return }
    setSavedNotes(notes)
    push('Notes saved.')
    onChanged()
  }
  const copyEmail = async () => push((await copyToClipboard(lead.email)) ? 'Email copied.' : 'Could not copy.', 'info')

  return (
    <Modal
      open
      onClose={onClose}
      title={lead.name}
      description={[lead.company, lead.source].filter(Boolean).join(' · ') || undefined}
      size="lg"
      footer={(
        <div className="ctf-lead__footer">
          <div className="ctf-lead__nav" aria-label="Browse leads">
            <Button variant="ghost" size="sm" icon={<ChevronLeft size={14} />} onClick={onPrev ?? undefined} disabled={!onPrev} aria-label="Previous lead" />
            <span>{position.index + 1} of {position.total}</span>
            <Button variant="ghost" size="sm" icon={<ChevronRight size={14} />} onClick={onNext ?? undefined} disabled={!onNext} aria-label="Next lead" />
          </div>
          <div className="ctf-lead__footer-actions">
            <DeleteButton what="lead" name={lead.name} onDelete={() => deleteLead(id)} undo={{ table: 'leads', id }} onDeleted={() => { onChanged(); onClose() }} size="md" />
            <Button variant="primary" onClick={onClose}>Done</Button>
          </div>
        </div>
      )}
    >
      <div className="ctf-lead">
        <div className="ctf-lead__top">
          <div className="ctf-lead__contact">
            <a href={`mailto:${lead.email}`} className="ctf-lead__line"><Mail size={14} aria-hidden /> {lead.email}</a>
            {tel && <a href={tel} className="ctf-lead__line"><Phone size={14} aria-hidden /> {parsed.phone}</a>}
            <span className="ctf-lead__when">Received {lead.created_at ? `${timeAgo(lead.created_at)} · ${new Date(lead.created_at).toLocaleString()}` : '—'}</span>
          </div>
          <div className="ctf-lead__status">
            <Badge tone={lead.status === 'new' ? 'warning' : 'neutral'}>{lead.status ?? 'new'}</Badge>
            <Select value={lead.status ?? 'new'} onChange={(e) => void setStatus(e.target.value as LeadStatus)} aria-label="Lead status">
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
        </div>

        <div className="ctf-lead__actions">
          <a className="ctf-btn ctf-btn--primary ctf-btn--md" href={`mailto:${lead.email}?subject=${encodeURIComponent('Re: your enquiry')}`}><Mail size={14} aria-hidden /> Reply by email</a>
          <Button variant="secondary" icon={<Copy size={14} />} onClick={() => void copyEmail()}>Copy email</Button>
          {lead.status === 'new' && <Button variant="secondary" onClick={() => void setStatus('contacted')}>Mark contacted</Button>}
        </div>

        <section aria-label="Their message" className="ctf-lead__message">
          <h3>Their message</h3>
          {parsed.fields.length > 0 ? (
            <dl>
              {parsed.fields.map((f) => <div key={f.label}><dt>{f.label}</dt><dd><Linkify text={f.value} /></dd></div>)}
            </dl>
          ) : null}
          {parsed.rest && <p><Linkify text={parsed.rest} /></p>}
          {!parsed.fields.length && !parsed.rest && <p className="ctf-lead__empty">No message.</p>}
        </section>

        <section aria-label="Internal notes">
          <FieldWrap label="Internal notes" htmlFor="lead-notes" hint="Only your team sees this. The lead never does.">
            <Textarea id="lead-notes" rows={4} value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} placeholder="Call summary, next step, who owns this…" />
          </FieldWrap>
          <div className="ctf-lead__notes-actions">
            <Button variant="secondary" size="sm" onClick={() => void saveNotes()} loading={savingNotes} disabled={!dirty}>Save notes</Button>
            {dirty ? <span>Unsaved changes</span> : savedNotes ? <span>Saved</span> : null}
          </div>
        </section>
      </div>
    </Modal>
  )
}
