import { useState, type FormEvent } from 'react'
import { Webhook } from 'lucide-react'
import { Badge, Button, CopyButton, EmptyState, ErrorState, FieldWrap, Input, Modal, SkeletonRows, Table, useToast } from '../../components/ui'
import { clearCallback, getCallbacks, listCallbackEvents, retryCallback, setCallback, type CallbackEvent, type CallbackSummary } from '../../lib/services'
import { CALLBACK_EVENT_LABEL, CALLBACK_STATUS_LABEL, CALLBACK_STATUS_TONE, CALLBACK_VERIFY_SNIPPET } from '../../lib/supportRules'
import { useAsyncData } from '../../hooks/useAsyncData'
import { timeAgo } from '../../lib/format'

function Log({ source }: { source: CallbackSummary }) {
  const events = useAsyncData(`support-cb-events:${source.source_id}`, () => listCallbackEvents(source.source_id))
  const { push } = useToast()
  if (events.loading) return <SkeletonRows rows={3} />
  if (events.error) return <ErrorState title="The log couldn't load" description={events.errorDetail?.message ?? 'Try again.'} onRetry={events.reload} />
  return (
    <Table caption={`Deliveries to ${source.name}`} rows={events.data ?? []} rowKey={(e) => e.id} emptyState={<EmptyState icon={Webhook} title="Nothing sent yet" description="A message is queued when Customer Service replies publicly or a ticket's status changes in a way the customer would notice." />}
      columns={[
        { key: 'e', header: 'Message', render: (e: CallbackEvent) => <><strong>{CALLBACK_EVENT_LABEL[e.event] ?? e.event}</strong><div className="ctf-support__sub">{e.ticket_ref} · {timeAgo(e.created_at)}</div></> },
        { key: 's', header: 'State', render: (e: CallbackEvent) => <Badge tone={CALLBACK_STATUS_TONE[e.status]}>{CALLBACK_STATUS_LABEL[e.status]}</Badge> },
        { key: 'a', header: 'Tries', render: (e: CallbackEvent) => e.attempts },
        { key: 'x', header: 'Last problem', render: (e: CallbackEvent) => (e.last_error ? <span>{e.last_error}{e.last_http ? ` (HTTP ${e.last_http})` : ''}</span> : '') },
        { key: 'r', header: '', render: (e: CallbackEvent) => e.status === 'dead' ? <Button size="sm" variant="secondary" onClick={() => void retryCallback(e.id).then((r) => { if (r.error) push(r.error.message, 'error'); else { push('Queued to try again.', 'success'); events.reload() } })}>Retry</Button> : null },
      ]} />
  )
}

function Editor({ source, canManage, onSaved }: { source: CallbackSummary; canManage: boolean; onSaved: () => void }) {
  const { push } = useToast()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true)
    const r = await setCallback(source.source_id, url.trim())
    setBusy(false)
    if (r.error || !r.secret) { push(r.error?.message ?? 'The callback could not be saved.', 'error'); return }
    setSecret(r.secret); setUrl(''); onSaved()
  }
  if (secret) {
    return (
      <div className="ctf-cb">
        <p className="ctf-cb__warn"><strong>Copy the signing secret now.</strong> It is shown once. Setting the address again makes a new one.</p>
        <div className="ctf-cb__secret"><code>{secret}</code><CopyButton value={secret} label="Copy secret" /></div>
        <p className="ctf-support__sub">The project's backend uses it to check that a message really came from here:</p>
        <pre className="ctf-cb__code" tabIndex={0} aria-label="How to verify a callback">{CALLBACK_VERIFY_SNIPPET}</pre>
        <div className="ctf-cb__row"><CopyButton value={CALLBACK_VERIFY_SNIPPET} label="Copy example" /><Button variant="primary" onClick={() => setSecret(null)}>I have saved it</Button></div>
      </div>
    )
  }
  return (
    <div className="ctf-cb">
      <p className="ctf-support__sub">{source.configured ? <>Messages go to <strong>{source.host}</strong>.</> : 'No callback is set for this project.'} Each message is signed, sent over https only, and retried if it fails. It contains the ticket reference, your own reference and what the customer may be told: never internal notes.</p>
      {canManage ? (
        <form className="ctf-cb" onSubmit={(e) => void save(e)}>
          <FieldWrap label={source.configured ? 'New address (replaces the old one and the secret)' : 'Address'} htmlFor="cb-url" hint="https only, a real domain name, port 443 or 8443. The path may include a token."><Input id="cb-url" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.yourproject.com/support/callback" maxLength={300} autoComplete="off" /></FieldWrap>
          <div className="ctf-cb__row">
            <Button type="submit" variant="primary" loading={busy} disabled={!url.trim().startsWith('https://')}>{source.configured ? 'Replace address and secret' : 'Save and make a secret'}</Button>
            {source.configured && <Button type="button" variant="ghost" onClick={() => void clearCallback(source.source_id).then((r) => { if (r.error) push(r.error.message, 'error'); else { push('Callback removed. Anything still queued was dropped.', 'success'); onSaved() } })}>Remove callback</Button>}
          </div>
        </form>
      ) : <p className="ctf-support__sub">Only a Main Admin can change the address.</p>}
    </div>
  )
}

export function CallbacksPanel({ canManage }: { canManage: boolean }) {
  const data = useAsyncData('support-callbacks', getCallbacks)
  const [open, setOpen] = useState<{ kind: 'edit' | 'log'; source: CallbackSummary } | null>(null)
  return (
    <section className="ctf-cbp" aria-labelledby="cbp-h">
      <h2 id="cbp-h"><Webhook size={15} aria-hidden /> Callbacks to the project</h2>
      <p className="ctf-support__sub">Tell a project's own backend when Customer Service replies or a ticket's status changes, so it can show the customer. The project can always ask for the current state with the support-ticket endpoint too.</p>
      {data.loading ? <SkeletonRows rows={2} /> : data.error ? <ErrorState title="Callbacks couldn't load" description={data.errorDetail?.message ?? 'Try again.'} onRetry={data.reload} /> : (
        <Table caption="Callbacks by project" rows={data.data ?? []} rowKey={(s) => s.source_id} emptyState={<EmptyState icon={Webhook} title="No projects connected" description="Connect a project first." />}
          columns={[
            { key: 'n', header: 'Project', render: (s: CallbackSummary) => <strong>{s.name}</strong> },
            { key: 'h', header: 'Sends to', render: (s: CallbackSummary) => (s.configured ? s.host : <span className="ctf-support__sub">Not set</span>) },
            { key: 'st', header: 'Delivery', render: (s: CallbackSummary) => !s.configured ? '' : <>
              {s.dead > 0 && <Badge tone="danger">{s.dead} given up</Badge>} {s.pending > 0 && <Badge>{s.pending} waiting</Badge>} <span className="ctf-support__sub">{s.delivered_24h} delivered in 24 h{s.last_delivery_at ? ` · last ${timeAgo(s.last_delivery_at)}` : ''}</span></> },
            { key: 'a', header: '', render: (s: CallbackSummary) => <div className="ctf-cb__row"><Button size="sm" variant="ghost" onClick={() => setOpen({ kind: 'edit', source: s })}>{canManage ? (s.configured ? 'Change' : 'Set up') : 'Details'}</Button>{s.configured && <Button size="sm" variant="ghost" onClick={() => setOpen({ kind: 'log', source: s })}>Log</Button>}</div> },
          ]} />
      )}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `${open.kind === 'log' ? 'Deliveries' : 'Callback'}: ${open.source.name}` : ''} size="lg">
        {open?.kind === 'log' ? <Log source={open.source} /> : open ? <Editor source={open.source} canManage={canManage} onSaved={data.reload} /> : null}
      </Modal>
    </section>
  )
}
