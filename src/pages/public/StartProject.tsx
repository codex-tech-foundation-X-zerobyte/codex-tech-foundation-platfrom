import { useState, type FormEvent } from 'react'
import { PublicLayout } from '../../layouts/PublicLayout'
import { Button, FieldWrap, Input, SectionHeading, Select, Textarea } from '../../components/ui'
import { submitStartProjectRequest } from '../../lib/services'
import type { StartProjectRequest } from '../../lib/types'
import './StartProject.css'

const EMPTY: StartProjectRequest = {
  name: '', company: '', email: '', phone: '', project_type: 'digital-product',
  problem: '', desired_outcome: '', budget: '', timeline: '', existing_system: '', additional_info: '',
}

export function StartProject() {
  const [form, setForm] = useState(EMPTY)
  const [status, setStatus] = useState<'idle' | 'submitting' | 'sent' | 'error'>('idle')

  const set = <K extends keyof StartProjectRequest>(key: K, value: StartProjectRequest[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setStatus('submitting')
    const { error } = await submitStartProjectRequest(form)
    setStatus(error ? 'error' : 'sent')
  }

  if (status === 'sent') {
    return (
      <PublicLayout>
        <main className="container ctf-start-project ctf-start-project--sent">
          <span className="eyebrow">Received</span>
          <h1>Thanks — we've got it.</h1>
          <p className="lead">Someone from Codex will follow up within a couple of business days with next steps.</p>
        </main>
      </PublicLayout>
    )
  }

  return (
    <PublicLayout>
      <main className="container ctf-start-project">
        <SectionHeading eyebrow="Start a project" title="Tell us about the problem." description="The more specific you are, the faster we can tell you whether — and how — we can help." />

        <form onSubmit={submit} className="ctf-start-project__form">
          <fieldset>
            <legend>Who you are</legend>
            <div className="ctf-start-project__row">
              <FieldWrap label="Name" htmlFor="sp-name" required>
                <Input id="sp-name" required value={form.name} onChange={(e) => set('name', e.target.value)} />
              </FieldWrap>
              <FieldWrap label="Company" htmlFor="sp-company">
                <Input id="sp-company" value={form.company} onChange={(e) => set('company', e.target.value)} />
              </FieldWrap>
            </div>
            <div className="ctf-start-project__row">
              <FieldWrap label="Email" htmlFor="sp-email" required>
                <Input id="sp-email" type="email" required value={form.email} onChange={(e) => set('email', e.target.value)} />
              </FieldWrap>
              <FieldWrap label="Phone" htmlFor="sp-phone" hint="Optional">
                <Input id="sp-phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
              </FieldWrap>
            </div>
          </fieldset>

          <fieldset>
            <legend>The project</legend>
            <FieldWrap label="Project type" htmlFor="sp-type" required>
              <Select id="sp-type" value={form.project_type} onChange={(e) => set('project_type', e.target.value)}>
                <option value="digital-product">Digital product</option>
                <option value="business-system">Business system</option>
                <option value="developer-infrastructure">Developer infrastructure</option>
                <option value="intelligent-system">Intelligent / AI system</option>
                <option value="other">Something else</option>
              </Select>
            </FieldWrap>
            <FieldWrap label="What problem are you trying to solve?" htmlFor="sp-problem" required hint="Describe the operational or business problem, not the feature you think you need.">
              <Textarea id="sp-problem" required rows={4} value={form.problem} onChange={(e) => set('problem', e.target.value)} />
            </FieldWrap>
            <FieldWrap label="What does success look like?" htmlFor="sp-outcome" required>
              <Textarea id="sp-outcome" required rows={3} value={form.desired_outcome} onChange={(e) => set('desired_outcome', e.target.value)} />
            </FieldWrap>
          </fieldset>

          <fieldset>
            <legend>Scope &amp; context</legend>
            <div className="ctf-start-project__row">
              <FieldWrap label="Rough budget" htmlFor="sp-budget" hint="A range is fine">
                <Input id="sp-budget" value={form.budget} onChange={(e) => set('budget', e.target.value)} />
              </FieldWrap>
              <FieldWrap label="Timeline" htmlFor="sp-timeline">
                <Input id="sp-timeline" value={form.timeline} onChange={(e) => set('timeline', e.target.value)} />
              </FieldWrap>
            </div>
            <FieldWrap label="Existing system" htmlFor="sp-existing" hint="What are you using today, if anything?">
              <Textarea id="sp-existing" rows={3} value={form.existing_system} onChange={(e) => set('existing_system', e.target.value)} />
            </FieldWrap>
            <FieldWrap label="Anything else we should know?" htmlFor="sp-additional">
              <Textarea id="sp-additional" rows={3} value={form.additional_info} onChange={(e) => set('additional_info', e.target.value)} />
            </FieldWrap>
          </fieldset>

          {status === 'error' && <p className="ctf-form-error">Something went wrong submitting your request. Please try again.</p>}
          <Button type="submit" variant="primary" size="lg" loading={status === 'submitting'}>Submit</Button>
        </form>
      </main>
    </PublicLayout>
  )
}
