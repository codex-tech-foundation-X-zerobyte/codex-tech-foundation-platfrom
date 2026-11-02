import { useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { Badge, Button, FieldWrap, Input, Modal, Select, Textarea, useToast } from './ui'
import { distributeProject, listClients, listDepartmentSummaries, type DepartmentSummary } from '../lib/services'
import { useAsyncData } from '../hooks/useAsyncData'
import { DEPARTMENTS } from '../workspaces/definitions'
import './ProjectWizard.css'

type Priority = 'low' | 'normal' | 'high' | 'urgent'
interface Brief { objective: string; deliverables: string; deadline: string }
const STEPS = ['Project', 'Departments', 'Review'] as const

export function CreateProjectWizardButton({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="primary" icon={<Plus size={15} />} onClick={() => setOpen(true)}>Create project</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Create project" description="One project, handed to the departments that will build it." size="lg">
        {/* Its own component so every step's state resets when the dialog reopens. */}
        {open && <Wizard onClose={() => setOpen(false)} onCreated={onCreated} />}
      </Modal>
    </>
  )
}

interface Outcome { name: string; lines: { dept: string; note: string; ok: boolean }[] }

function Wizard({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { push } = useToast()
  const clients = useAsyncData('wizard-clients', listClients)
  const summaries = useAsyncData('wizard-departments', listDepartmentSummaries)
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Priority>('normal')
  const [start, setStart] = useState('')
  const [due, setDue] = useState('')
  const [clientId, setClientId] = useState('')
  const [picked, setPicked] = useState<Record<string, Brief>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const bySlug = new Map((summaries.data?.departments ?? []).filter((d) => d.slug).map((d) => [d.slug as string, d]))
  const chosen = DEPARTMENTS.filter((d) => picked[d.slug])

  const toggle = (slug: string) => setPicked((p) => {
    const next = { ...p }
    if (next[slug]) delete next[slug]; else next[slug] = { objective: '', deliverables: '', deadline: '' }
    return next
  })
  const edit = (slug: string, patch: Partial<Brief>) => setPicked((p) => ({ ...p, [slug]: { ...p[slug], ...patch } }))

  const problem = (): string => {
    if (step === 0) {
      if (!name.trim()) return 'Give the project a name.'
      if (start && due && due < start) return 'The deadline can\u2019t be before the start date.'
    }
    if (step === 1) {
      if (chosen.length === 0) return 'Choose at least one department.'
      if (chosen.some((d) => !bySlug.get(d.slug))) return 'A chosen department isn\u2019t provisioned yet. Apply the latest migration.'
      const noObjective = chosen.find((d) => !picked[d.slug].objective.trim())
      if (noObjective) return `Say what ${noObjective.name} should deliver.`
    }
    return ''
  }
  const next = () => { const p = problem(); setError(p); if (!p) setStep((s) => s + 1) }

  const distribute = async () => {
    if (submitting) return
    setSubmitting(true); setError('')
    const { project, error: err, assigned } = await distributeProject(
      { name: name.trim(), description: description.trim(), status: 'planning', client_account_id: clientId || null, due_date: due || null, start_date: start || null, priority },
      chosen.map((d) => ({ departmentId: (bySlug.get(d.slug) as DepartmentSummary).id, objective: picked[d.slug].objective, deliverables: picked[d.slug].deliverables.split('\n'), deadline: picked[d.slug].deadline || null })),
    )
    setSubmitting(false)
    if (err || !project) { setError(err?.message ?? 'Could not create the project.'); return }
    onCreated()
    setOutcome({
      name: project.name,
      lines: chosen.filter((d) => assigned.includes((bySlug.get(d.slug) as DepartmentSummary).id)).map((d) => {
        const admins = (bySlug.get(d.slug) as DepartmentSummary).admins
        return admins.length > 0
          ? { dept: d.name, ok: true, note: `${admins.join(', ')} notified` }
          : { dept: d.name, ok: false, note: 'No Department Admin yet. Assign one so the work can be picked up.' }
      }),
    })
    push('Project created and distributed.')
  }

  if (outcome) {
    return (
      <div className="ctf-wiz">
        <h3 className="ctf-wiz__h">{outcome.name} is live</h3>
        <ul className="ctf-wiz__result" aria-label="Distribution">
          {outcome.lines.map((l) => (
            <li key={l.dept} className={l.ok ? '' : 'is-warn'}>
              <span className="ctf-wiz__tick" aria-hidden="true">{l.ok ? <Check size={14} /> : '!'}</span>
              <strong>{l.dept}</strong><span>{l.note}</span>
            </li>
          ))}
        </ul>
        <div className="ctf-form__actions"><Button variant="primary" onClick={onClose}>Done</Button></div>
      </div>
    )
  }

  return (
    <div className="ctf-wiz">
      <ol className="ctf-wiz__steps" aria-label="Progress">
        {STEPS.map((s, i) => <li key={s} aria-current={i === step ? 'step' : undefined} className={i === step ? 'is-active' : i < step ? 'is-done' : ''}><span>{i + 1}</span>{s}</li>)}
      </ol>

      {step === 0 && (
        <div className="ctf-form">
          <FieldWrap label="Project name" htmlFor="pw-name" required><Input id="pw-name" autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></FieldWrap>
          <FieldWrap label="Description" htmlFor="pw-desc"><Textarea id="pw-desc" rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></FieldWrap>
          <div className="ctf-form-row">
            <FieldWrap label="Priority" htmlFor="pw-priority">
              <Select id="pw-priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
              </Select>
            </FieldWrap>
            <FieldWrap label="Client" htmlFor="pw-client" hint="Optional">
              <Select id="pw-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">No client yet</option>
                {clients.data?.map((c) => <option key={c.id} value={c.id}>{c.organization}</option>)}
              </Select>
            </FieldWrap>
          </div>
          <div className="ctf-form-row">
            <FieldWrap label="Start date" htmlFor="pw-start" hint="Optional"><Input id="pw-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></FieldWrap>
            <FieldWrap label="Deadline" htmlFor="pw-due" hint="Optional"><Input id="pw-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></FieldWrap>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="ctf-wiz__depts">
          <p className="ctf-wiz__hint">Pick every department involved and say what each should deliver. There is one project; each department gets its own assignment.</p>
          {DEPARTMENTS.map((d) => {
            const Icon = d.icon
            const on = !!picked[d.slug]
            const sum = bySlug.get(d.slug)
            return (
              <fieldset key={d.slug} className={`ctf-wiz__dept ${on ? 'is-on' : ''}`} style={{ ['--dept-accent' as string]: d.accent }}>
                <label className="ctf-wiz__dept-head">
                  <input type="checkbox" checked={on} onChange={() => toggle(d.slug)} />
                  <span className="ctf-wiz__dept-icon" aria-hidden="true"><Icon size={16} /></span>
                  <strong>{d.name}</strong>
                  {sum && sum.admins.length === 0 && <Badge tone="warning">No Department Admin</Badge>}
                  {!summaries.loading && !sum && <Badge tone="warning">Not provisioned</Badge>}
                </label>
                {on && (
                  <div className="ctf-form ctf-wiz__dept-body">
                    <FieldWrap label="Objective" htmlFor={`pw-obj-${d.slug}`} required><Textarea id={`pw-obj-${d.slug}`} rows={2} maxLength={500} value={picked[d.slug].objective} onChange={(e) => edit(d.slug, { objective: e.target.value })} /></FieldWrap>
                    <div className="ctf-form-row">
                      <FieldWrap label="Deliverables" htmlFor={`pw-del-${d.slug}`} hint="One per line"><Textarea id={`pw-del-${d.slug}`} rows={3} value={picked[d.slug].deliverables} onChange={(e) => edit(d.slug, { deliverables: e.target.value })} /></FieldWrap>
                      <FieldWrap label="Department deadline" htmlFor={`pw-dl-${d.slug}`} hint="Optional"><Input id={`pw-dl-${d.slug}`} type="date" value={picked[d.slug].deadline} onChange={(e) => edit(d.slug, { deadline: e.target.value })} /></FieldWrap>
                    </div>
                  </div>
                )}
              </fieldset>
            )
          })}
        </div>
      )}

      {step === 2 && (
        <div className="ctf-wiz__review">
          <dl>
            <div><dt>Project</dt><dd>{name}</dd></div>
            <div><dt>Priority</dt><dd>{priority}</dd></div>
            {(start || due) && <div><dt>Dates</dt><dd>{start || 'Not set'} → {due || 'No deadline'}</dd></div>}
          </dl>
          <h3 className="ctf-wiz__h">Will be assigned to</h3>
          <ul>
            {chosen.map((d) => {
              const admins = bySlug.get(d.slug)?.admins ?? []
              const lines = picked[d.slug].deliverables.split('\n').map((x) => x.trim()).filter(Boolean)
              return (
                <li key={d.slug}>
                  <strong>{d.name}</strong>
                  <span>{picked[d.slug].objective}</span>
                  {lines.length > 0 && <span className="ctf-wiz__muted">Deliverables: {lines.join(', ')}</span>}
                  <span className="ctf-wiz__muted">{admins.length ? `${admins.join(', ')} will be notified.` : 'No Department Admin yet. You will be alerted.'}</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {error && <p className="ctf-form-error" role="alert">{error}</p>}
      <div className="ctf-form__actions">
        {step === 0 ? <Button variant="ghost" onClick={onClose}>Cancel</Button> : <Button variant="ghost" onClick={() => { setError(''); setStep((s) => s - 1) }}>Back</Button>}
        {step < 2 ? <Button variant="primary" onClick={next}>Continue</Button> : <Button variant="primary" loading={submitting} onClick={() => void distribute()}>Create and distribute</Button>}
      </div>
    </div>
  )
}

