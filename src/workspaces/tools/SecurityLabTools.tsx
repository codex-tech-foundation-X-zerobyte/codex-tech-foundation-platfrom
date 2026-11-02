import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, FieldWrap, Input, Select, SkeletonRows, Surface, Textarea, useToast } from '../../components/ui'
import { createRecord, listRecords, type DepartmentRow } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import {
  CONFIG_CHECKLIST, DNS_TYPES, TRAINING_LINKS, analyzeLog, analyzeSecurityHeaders, emailAuthFindings, lookupDns, scoreChecklist,
  type CheckResult, type DnsRecord, type DnsResult, type DnsType, type Finding, type Severity,
} from '../../lib/securityLab'

const TONE: Record<Severity, 'success' | 'warning' | 'danger' | 'neutral'> = { pass: 'success', warn: 'warning', fail: 'danger', info: 'neutral' }
const LABEL: Record<Severity, string> = { pass: 'Pass', warn: 'Review', fail: 'Fix', info: 'Note' }

function Findings({ items }: { items: Finding[] }) {
  return (
    <ul className="ctf-lab__findings">
      {items.map((f) => (
        <li key={f.id}>
          <Badge tone={TONE[f.severity]}>{LABEL[f.severity]}</Badge>
          <div><strong>{f.title}</strong><span>{f.detail}</span></div>
        </li>
      ))}
    </ul>
  )
}

export function HeaderAnalyzer() {
  const [raw, setRaw] = useState('')
  const [shown, setShown] = useState<ReturnType<typeof analyzeSecurityHeaders> | null>(null)
  return (
    <div className="ctf-denv__stack">
      <FieldWrap label="Response headers" htmlFor="hdr-input" hint="Paste the output of curl -I https://your-site, or copy the response headers from your browser's network panel.">
        <Textarea id="hdr-input" rows={9} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={'HTTP/2 200\nstrict-transport-security: max-age=31536000\ncontent-security-policy: default-src \'self\''} spellCheck={false} />
      </FieldWrap>
      <div><Button variant="primary" onClick={() => setShown(analyzeSecurityHeaders(raw))} disabled={!raw.trim()}>Analyse headers</Button></div>
      {shown && (shown.headerCount === 0
        ? <EmptyState title="No headers found" description="Paste lines in the form Name: value." />
        : <Surface><div className="ctf-lab__score"><strong>{shown.score}%</strong><span>of checks passed · {shown.headerCount} headers read. Nothing was sent anywhere.</span></div><Findings items={shown.findings} /></Surface>)}
    </div>
  )
}

export function LogAnalyzer() {
  const [raw, setRaw] = useState('')
  const [report, setReport] = useState<ReturnType<typeof analyzeLog> | null>(null)
  const pairs = (rows: [string, number][]) => rows.map(([k, n]) => <li key={k}><span>{k}</span><strong>{n}</strong></li>)
  return (
    <div className="ctf-denv__stack">
      <FieldWrap label="Log text" htmlFor="log-input" hint="Web-server access logs, JSON lines or ordinary levelled logs. It stays in your browser.">
        <Textarea id="log-input" rows={10} value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={false} />
      </FieldWrap>
      <div><Button variant="primary" onClick={() => setReport(analyzeLog(raw))} disabled={!raw.trim()}>Analyse log</Button></div>
      {report && (report.lines === 0 ? <EmptyState title="Nothing to analyse" description="Paste some log lines." /> : (
        <Surface>
          <p className="ctf-denv__muted">{report.lines} lines, {report.recognised} recognised{report.first ? ` · ${report.first} → ${report.last}` : ''}</p>
          {report.flags.length > 0 && <ul className="ctf-lab__flags" aria-label="Things to look at">{report.flags.map((f) => <li key={f}>{f}</li>)}</ul>}
          <div className="ctf-lab__grid">
            <section><h4>Levels</h4><ul className="ctf-lab__pairs">{pairs(Object.entries(report.levels))}</ul></section>
            <section><h4>Status codes</h4><ul className="ctf-lab__pairs">{pairs(Object.entries(report.statuses).sort())}</ul></section>
            <section><h4>Top sources</h4><ul className="ctf-lab__pairs">{pairs(report.topIps)}</ul></section>
            <section><h4>Top errors</h4><ul className="ctf-lab__pairs">{pairs(report.topErrors)}</ul></section>
            <section><h4>Top paths</h4><ul className="ctf-lab__pairs">{pairs(report.topPaths)}</ul></section>
          </div>
        </Surface>
      ))}
    </div>
  )
}

export function DnsInspector() {
  const [domain, setDomain] = useState('')
  const [type, setType] = useState<DnsType>('A')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<DnsResult | null>(null)
  const [mail, setMail] = useState<Finding[] | null>(null)

  const run = async (checkMail = false) => {
    setBusy(true); setResult(null); setMail(null)
    if (checkMail) {
      const [txt, dmarc] = await Promise.all([lookupDns(domain, 'TXT'), lookupDns(`_dmarc.${domain.trim()}`, 'TXT')])
      setBusy(false)
      if (txt.status === 'error') { setResult(txt); return }
      setMail(emailAuthFindings(txt.records as DnsRecord[], dmarc.records))
      return
    }
    const r = await lookupDns(domain, type)
    setBusy(false); setResult(r)
  }
  return (
    <div className="ctf-denv__stack">
      <p className="ctf-denv__muted">Looks up public DNS records for a domain through a public resolver. Only the domain name is sent; nothing contacts the site itself. Use it on domains the company owns.</p>
      <div className="ctf-lab__row">
        <FieldWrap label="Domain" htmlFor="dns-domain"><Input id="dns-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" autoComplete="off" spellCheck={false} /></FieldWrap>
        <FieldWrap label="Record type" htmlFor="dns-type"><Select id="dns-type" value={type} onChange={(e) => setType(e.target.value as DnsType)}>{DNS_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></FieldWrap>
      </div>
      <div className="ctf-lab__actions">
        <Button variant="primary" loading={busy} disabled={!domain.trim()} onClick={() => void run()}>Look up</Button>
        <Button variant="secondary" disabled={busy || !domain.trim()} onClick={() => void run(true)}>Check email authentication (SPF, DMARC)</Button>
      </div>
      {result && (result.status === 'ok' ? (
        <Surface><table className="ctf-lab__table"><thead><tr><th>Name</th><th>Type</th><th>TTL</th><th>Value</th></tr></thead><tbody>{result.records.map((r, i) => <tr key={i}><td>{r.name}</td><td>{r.type}</td><td>{r.ttl}</td><td className="ctf-lab__mono">{r.data}</td></tr>)}</tbody></table></Surface>
      ) : result.status === 'error' ? <ErrorState title="Lookup failed" description={result.message} /> : <EmptyState title={result.status === 'not-found' ? 'No such domain' : 'No records'} description={result.message ?? ''} />)}
      {mail && <Surface><Findings items={mail} /></Surface>}
    </div>
  )
}

export function ConfigChecks({ row }: { row: DepartmentRow }) {
  const [results, setResults] = useState<Record<string, CheckResult | undefined>>({})
  const [scope, setScope] = useState('')
  const [saving, setSaving] = useState(false)
  const history = useAsyncData(`config-audits:${row.id}`, () => listRecords(row.id, 'config_audit'))
  const { push } = useToast()
  const summary = scoreChecklist(results)
  const groups = Array.from(new Set(CONFIG_CHECKLIST.map((c) => c.group)))

  const save = async () => {
    setSaving(true)
    const failed = CONFIG_CHECKLIST.filter((c) => results[c.id] === 'fail').map((c) => `- ${c.text}`).join('\n')
    const { error } = await createRecord({
      department_id: row.id, kind: 'config_audit', stage: 'Saved', title: `${scope.trim()} audit, ${new Date().toLocaleDateString()}`,
      fields: { scope: scope.trim(), ...(summary.score != null ? { score: summary.score } : {}), results: `${summary.passed} passed, ${summary.failed} to fix, ${summary.unanswered} unanswered.${failed ? `\n\nTo fix:\n${failed}` : ''}` },
    })
    setSaving(false)
    if (error) { push(error.message, 'error'); return }
    push('Audit saved.'); setResults({}); setScope(''); history.reload()
  }

  return (
    <div className="ctf-denv__stack">
      {groups.map((g) => (
        <Surface key={g}>
          <h3 className="ctf-denv__h3">{g}</h3>
          <ul className="ctf-lab__checks">
            {CONFIG_CHECKLIST.filter((c) => c.group === g).map((c) => (
              <li key={c.id}>
                <span id={`chk-${c.id}`}>{c.text}</span>
                <div role="radiogroup" aria-labelledby={`chk-${c.id}`} className="ctf-lab__seg">
                  {(['pass', 'fail', 'na'] as const).map((v) => (
                    <button key={v} type="button" role="radio" aria-checked={results[c.id] === v} className={results[c.id] === v ? `is-on is-${v}` : ''} onClick={() => setResults((r) => ({ ...r, [c.id]: r[c.id] === v ? undefined : v }))}>
                      {v === 'pass' ? 'Pass' : v === 'fail' ? 'Fix' : 'N/A'}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Surface>
      ))}
      <Surface>
        <div className="ctf-lab__score"><strong>{summary.score == null ? '—' : `${summary.score}%`}</strong><span>{summary.passed} pass · {summary.failed} to fix · {summary.unanswered} unanswered</span></div>
        <div className="ctf-lab__row">
          <FieldWrap label="What was audited" htmlFor="audit-scope" required><Input id="audit-scope" value={scope} onChange={(e) => setScope(e.target.value)} placeholder="e.g. Production app and database" /></FieldWrap>
          <div className="ctf-lab__save"><Button variant="primary" loading={saving} disabled={!scope.trim() || summary.score == null} onClick={() => void save()}>Save audit</Button></div>
        </div>
      </Surface>
      <h3 className="ctf-denv__h3">Saved audits</h3>
      {history.loading ? <SkeletonRows rows={2} /> : (history.data ?? []).length === 0 ? <EmptyState title="No saved audits" description="Complete the checklist and save it to keep a record." /> : (
        <ul className="ctf-rec__list">{(history.data ?? []).map((r) => <li key={r.id} className="ctf-rec__row"><div className="ctf-rec__main"><strong>{r.title}</strong><span className="ctf-denv__muted">{typeof r.fields.score === 'number' ? `Score ${r.fields.score}%` : 'No score'}</span></div></li>)}</ul>
      )}
    </div>
  )
}

export function TrainingLinks() {
  return (
    <div className="ctf-denv__stack">
      <p className="ctf-denv__muted">Practise on platforms built to be attacked. Never practise on company or third-party systems you are not authorised to test.</p>
      <ul className="ctf-lab__training">
        {TRAINING_LINKS.map((t) => (
          <li key={t.url}>
            <a href={t.url} target="_blank" rel="noopener noreferrer"><strong>{t.name}</strong><ExternalLink size={13} aria-hidden="true" /></a>
            <span>{t.about}</span>
            <Badge tone="neutral">{t.level}</Badge>
          </li>
        ))}
      </ul>
    </div>
  )
}
