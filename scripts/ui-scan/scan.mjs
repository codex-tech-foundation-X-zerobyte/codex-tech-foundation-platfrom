// UI scan harness (headless Chromium against a MOCKED Supabase). Not part of the app or the test suites.
// Usage (see docs/workspace/UPDATE_SECURITY_AND_UI_REPAIR.md):
//   1. npm i --no-save playwright-core @sparticuz/chromium   (a Chromium that installs from npm)
//   2. build with a fake env: VITE_SUPABASE_URL=https://mock.supabase.co VITE_SUPABASE_ANON_KEY=<jwt with {"role":"anon"}> npx vite build --outDir /tmp/mockdist
//   3. serve /tmp/mockdist on 127.0.0.1:4173 with a single-page-app fallback to index.html
//   4. node scripts/ui-scan/scan.mjs [public|worker|admin|client|all] [360,768,1280]   (SHOTS=1 saves screenshots to /tmp/shots; results go to /tmp/scan.json)
// The mock returns empty lists, so it checks layout, overflow, errors, redirects and touch targets, not data-heavy screens.
// Optional: ONLY_RE='finance|funds' limits the routes; CLICK='Generate report' clicks that button on routes containing CLICK_ON (default 'reports'); FULL=1 takes full-page screenshots.
// Optional: AXE=1 runs an accessibility audit (axe-core) per page: `npm i --no-save axe-core` and point the path in this file at node_modules/axe-core/axe.min.js. Run one group at a time (public|worker|admin|client) and keep the static server alive between runs; if the page navigates while axe runs it reports 'axe-failed' for that page.
import chromium from '@sparticuz/chromium'
import { chromium as pw } from 'playwright-core'
import { writeFileSync, mkdirSync } from 'node:fs'
const BASE = 'http://127.0.0.1:4173'
const DEPTS = ['frontend-development','backend-development','devops','cybersecurity','ui-ux-design','graphics-creative','content','marketing','finance','customer-service']
const did = (s) => '00000000-0000-4000-8000-' + String(DEPTS.indexOf(s) + 1).padStart(12, '0')
const UID = '11111111-1111-4111-8111-111111111111'
const depts = DEPTS.map((s) => ({ id: did(s), slug: s, name: s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), description: 'Department for ' + s, is_active: true, created_at: '2026-01-01T00:00:00Z' }))
const people = ['Ada Okafor','Tunde Bello','Ngozi Eze','Ibrahim Musa'].map((n, i) => ({ id: `2222222${i}-2222-4222-8222-222222222222`, display_name: n, role: 'worker', organization: null, avatar_path: null }))
const wp = (u, i) => ({ user_id: u.id, worker_id: 'CTF-WKR-A000000' + i, department_id: did(DEPTS[i % 8]), department_role: i === 0 ? 'admin' : 'member', position: 'Engineer', status: 'active', join_date: '2026-02-0' + (i + 1), email: 'x@example.com', phone: null })
function profileFor(role) { return { id: UID, display_name: 'Test ' + role, role, organization: role === 'client' ? 'Acme Ltd' : null, avatar_path: null } }
function handler(role) {
  return (route) => {
    const req = route.request(); const url = new URL(req.url()); const p = url.pathname
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/*' }, body: JSON.stringify(b) })
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
    if (p.startsWith('/auth/v1/user')) return json({ id: UID, email: 'test@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' })
    if (p.startsWith('/auth/v1')) return json({})
    if (p.startsWith('/storage/')) return json([])
    if (p.startsWith('/functions/')) return json({})
    if (p.startsWith('/rest/v1/rpc/push_setup_summary')) return json({ configured: true, secret_set: true, function_host: 'abcdefgh.supabase.co', function_path_ok: true, devices: 1, pg_net_available: true })
    if (p.startsWith('/rest/v1/rpc/send_test_notification')) return json('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    if (p.startsWith('/rest/v1/rpc/push_dispatch_result')) return json({ handed_over: true, configured: true, pg_net_available: true, answered: true, status_code: 403, content: '{"error":"Forbidden"}' })
    if (p.startsWith('/rest/v1/rpc/finance_report_rows')) return json([{ ref: 'FR-2026-00009', title: 'Annual hosting for the portfolio website', department: 'Frontend Development', category: 'hosting', vendor: 'Vercel', project: null, requester: 'Ada Okafor', status: 'paid', amount: '250000', amount_paid: '250000', refunded: '40000', currency: 'NGN', submitted_on: '2026-10-01', paid_on: '2026-10-05', payment_reference: 'TRX-99812', has_receipt: false, discrepancy: false }])
    if (p.startsWith('/rest/v1/rpc/finance_report')) { const g = (l, o = {}) => ({ key: l, label: l, requested: '600000', approved: '500000', paid: '250000', refunded: '40000', net: '210000', ...o }); return json({
      meta: { from: '2026-10-01', to: '2026-10-25', currency: 'NGN', department_id: null, scope: 'company', generated_at: '2026-10-25T10:00:00Z', generated_by: 'Test superadmin', basis: ['Requests submitted in the period: requested and approved amounts, by the day each request was submitted. Drafts are not counted.', 'Income is only money Codex itself earned and recorded. Money handled for clients is never counted.'] },
      submitted: { requested: '1649999', approved: '550000' }, moved: { paid: '300000', refunded: '40000', net_spend: '260000', income: '650000', net_position: '390000' }, income_by_source: [{ source: 'client_work_fee', amount: '450000' }, { source: 'retainer', amount: '200000' }],
      pending_approvals: { count: 1, amount: '100000' }, approved_unpaid: { count: 2, amount: '200000' }, discrepancies: { count: 1, amount: '50000' }, missing_receipts: { count: 3, amount: '700000' }, renewals: { due_within_30_days: 2, amount_due_within_30_days: '335000', overdue: 1 },
      by_department: [g('Frontend Development'), g('A department with a really long name to see how the table copes', { paid: '50000', net: '50000', refunded: '0' })], by_category: [g('domain')], by_vendor: [g('Namecheap')], by_project: [g('(no project)')],
      by_month: [{ month: '2026-09', paid: '120000', refunded: '0', income: '300000' }, { month: '2026-10', paid: '300000', refunded: '40000', income: '650000' }] }) }
    if (p.startsWith('/rest/v1/rpc/list_budget_status')) return json([
      { budget_id: 'b1', department_id: did('frontend-development'), department_name: 'Frontend Development', category: 'domain', period_kind: 'month', period_start: '2026-10-01', period_end: '2026-10-31', amount: '1000000', currency: 'NGN', note: 'Domains and renewals for the quarter ahead', version: 1, pending: '100000', approved_unpaid: '200000', paid: '250000', reconciled: '50000', refunded: '40000', spent: '260000', committed: '460000', remaining: '540000' },
      { budget_id: 'b2', department_id: null, department_name: null, category: null, period_kind: 'quarter', period_start: '2026-10-01', period_end: '2026-12-31', amount: '3000000', currency: 'NGN', note: '', version: 2, pending: '0', approved_unpaid: '1900000', paid: '1200000', reconciled: '0', refunded: '0', spent: '1200000', committed: '3100000', remaining: '-100000' }])
    if (p.startsWith('/rest/v1/rpc/list_missing_receipts')) return json([{ request_id: 'f1111111-1111-4111-8111-111111111111', ref: 'FR-2026-00009', title: 'Annual hosting for the portfolio website and staging environments', department_name: 'Frontend Development', amount_paid: '250000', currency: 'NGN', paid_on: '2026-10-05', days_open: 20 }])
    if (p.startsWith('/rest/v1/rpc/budget_utilisation_for_request')) return json([{ budget_id: 'b1', scope: 'department_category', period_kind: 'month', period_start: '2026-10-01', period_end: '2026-10-31', amount: '1000000', currency: 'NGN', pending: '0', approved_unpaid: '200000', paid: '250000', reconciled: '50000', refunded: '40000', this_request: '600000', remaining_after: '-60000', over_budget: true }])
    // Customer Service completion
    if (p.startsWith('/rest/v1/rpc/support_workload')) return json({ unassigned: 2, people: [
      { user_id: 'u1', name: 'Agent One', open: 3, overdue: 1, waiting_for_customer: 2, resolved_7d: 5, avg_first_response_minutes_7d: 95, avg_rating_30d: 4.5, on_shift: true },
      { user_id: 'u2', name: 'Agent Two', open: 0, overdue: 0, waiting_for_customer: 0, resolved_7d: 0, avg_first_response_minutes_7d: null, avg_rating_30d: null, on_shift: false }] })
    if (p.startsWith('/rest/v1/rpc/support_roster')) return json([{ id: 's1', user_id: 'u1', name: 'Agent One', starts_at: new Date(Date.now() - 3600000).toISOString(), ends_at: new Date(Date.now() + 3600000).toISOString(), note: 'morning cover', on_now: true }])
    if (p.startsWith('/rest/v1/rpc/support_callbacks_overview')) return json([
      { source_id: 's1', name: 'Portfolio site', configured: true, enabled: true, host: 'api.shopfront.dev', pending: 1, dead: 2, delivered_24h: 9, last_delivery_at: new Date().toISOString(), last_error: null },
      { source_id: 's2', name: 'Other site', configured: false, enabled: false, host: '', pending: 0, dead: 0, delivered_24h: 0, last_delivery_at: null, last_error: null }])
    if (p.startsWith('/rest/v1/rpc/support_callback_events_list')) return json([{ id: 'e1', event: 'ticket.reply', ticket_ref: 'TCK-1', status: 'dead', attempts: 6, last_http: 503, last_error: 'The receiver answered HTTP 503.', created_at: new Date().toISOString(), delivered_at: null }])
    if (p.startsWith('/rest/v1/support_sources')) return json([{ id: 's1', name: 'Portfolio site', key_prefix: 'ctfs_ab12', active: true, created_at: new Date().toISOString(), last_used_at: null }, { id: 's2', name: 'Other site', key_prefix: 'ctfs_cd34', active: true, created_at: new Date().toISOString(), last_used_at: null }])
    // Super Monitor
    if (p.startsWith('/rest/v1/rpc/monitor_overview')) return json([
      { id: 'a1111111-1111-4111-8111-111111111111', name: 'Portfolio site', slug: 'portfolio', kind: 'web', active: true, owner_department: 'Backend Development', health: 'degraded', heartbeat_seconds: 300, last_heartbeat_at: new Date().toISOString(), last_event_at: new Date().toISOString(), sdk_name: 'ctf-super-monitor', sdk_version: '0.1.0', release: '1.2.0', open_incidents: 2, worst_severity: 'high', events_24h: 4210, errors_24h: 37, p95_ms_24h: 500 },
      { id: 'a2222222-2222-4222-8222-222222222222', name: 'Internal API', slug: 'internal-api', kind: 'api', active: true, owner_department: 'DevOps', health: 'down', heartbeat_seconds: 60, last_heartbeat_at: new Date(Date.now() - 3600000).toISOString(), last_event_at: null, sdk_name: null, sdk_version: null, release: null, open_incidents: 1, worst_severity: 'critical', events_24h: 0, errors_24h: 0, p95_ms_24h: null },
      { id: 'a3333333-3333-4333-8333-333333333333', name: 'Marketing site', slug: 'marketing-site', kind: 'web', active: true, owner_department: null, health: 'healthy', heartbeat_seconds: 300, last_heartbeat_at: new Date().toISOString(), last_event_at: new Date().toISOString(), sdk_name: 'ctf-super-monitor', sdk_version: '0.1.0', release: '3.0.1', open_incidents: 0, worst_severity: null, events_24h: 900, errors_24h: 0, p95_ms_24h: 250 }])
    if (p.startsWith('/rest/v1/rpc/monitor_incidents_list')) return json([
      { id: 'b1111111-1111-4111-8111-111111111111', ref: 'INC-000007', title: 'Errors in Portfolio site: DB timeout after N ms', severity: 'high', status: 'open', source: 'auto_errors', project_id: 'a1111111-1111-4111-8111-111111111111', project_name: 'Portfolio site', assignee_id: null, assignee_name: null, opened_at: new Date(Date.now() - 900000).toISOString(), acknowledged_at: null, resolved_at: null, ack_due_at: new Date(Date.now() - 60000).toISOString(), escalation_level: 1, reopen_count: 0, duplicate_of_ref: null },
      { id: 'b2222222-2222-4222-8222-222222222222', ref: 'INC-000008', title: 'No heartbeat from Internal API for 60 minutes', severity: 'critical', status: 'investigating', source: 'auto_down', project_id: 'a2222222-2222-4222-8222-222222222222', project_name: 'Internal API', assignee_id: 'u1', assignee_name: 'Devon DevOps', opened_at: new Date(Date.now() - 3000000).toISOString(), acknowledged_at: new Date(Date.now() - 2800000).toISOString(), resolved_at: null, ack_due_at: null, escalation_level: 0, reopen_count: 1, duplicate_of_ref: null }])
    if (p.startsWith('/rest/v1/rpc/monitor_incident_detail')) return json({ incident: { id: 'b1111111-1111-4111-8111-111111111111', ref: 'INC-000007', title: 'Errors in Portfolio site: DB timeout', severity: 'high', status: 'open', source: 'auto_errors', fingerprint: 'abc', project_id: 'a1111111-1111-4111-8111-111111111111', project_name: 'Portfolio site', assignee_id: null, assignee_name: null, root_cause: null, opened_at: new Date().toISOString(), acknowledged_at: null, resolved_at: null, ack_due_at: new Date().toISOString(), escalation_level: 0, reopen_count: 0, duplicate_of_ref: null }, duplicates: [], notes: [{ id: 'n1', kind: 'system', body: 'Opened automatically: the same error kept repeating.', created_at: new Date().toISOString(), author_name: null }] })
    if (p.startsWith('/rest/v1/rpc/monitor_series')) return json(Array.from({ length: 24 }, (_, i) => ({ bucket: new Date(Math.floor(Date.now() / 3600000) * 3600000 - (23 - i) * 3600000).toISOString(), events: 100 + i, errors: i % 5, fatals: 0, heartbeats: 12, avg_ms: 120, p95_ms: 250, max_ms: 900 })))
    if (p.startsWith('/rest/v1/rpc/monitor_top_errors')) return json([{ fingerprint: 'abcdef0123456789', message: 'DB timeout after N ms', level: 'error', occurrences: 17, first_seen: new Date().toISOString(), last_seen: new Date().toISOString(), release: '1.2.0', incident_ref: 'INC-000007' }])
    if (p.startsWith('/rest/v1/rpc/monitor_assignable')) return json([{ id: 'u1', name: 'Devon DevOps' }])
    if (p.startsWith('/rest/v1/monitor_keys')) return json([{ id: 'k1', project_id: 'a1111111-1111-4111-8111-111111111111', label: 'production API', key_prefix: 'ctfm_ab12', scopes: ['events', 'heartbeat'], active: true, expires_at: null, created_at: new Date().toISOString(), revoked_at: null, last_used_at: new Date().toISOString() }])
    if (p.startsWith('/rest/v1/rpc/super_dashboard')) return json({ generated_at: new Date().toISOString(), sections: ['monitoring', 'support', 'finance', 'renewals', 'audit'],
      monitoring: { projects: { total: 3, healthy: 1, degraded: 1, down: 1, unknown: 0, paused: 0 }, incidents: { open: 3, critical: 1, high: 1, unacknowledged: 1, oldest_unacknowledged_minutes: 15 }, errors_24h: 37 },
      support: { open: 12, overdue: 3, unassigned: 2, urgent: 1 },
      finance: { needs_attention: 1, pending_decision: [{ currency: 'NGN', amount: 250000, count: 2, basis: 'pending' }], approved_unpaid: [{ currency: 'NGN', amount: 80000, count: 1, basis: 'pending' }], paid_30d: [{ currency: 'NGN', amount: 120000, count: 3, basis: 'actual' }], reconciled_30d: [] },
      renewals: { due_30d_count: 2, critical_due_30d: 1, overdue: 1, due_30d_amount: [{ currency: 'NGN', amount: 185000, basis: 'estimated' }] },
      audit: { events_24h: 140, warnings_24h: 4, critical_24h: 0, failed_24h: 2, recent: [{ action: 'monitor.key.revoke', severity: 'warning', created_at: new Date().toISOString() }] } })
    if (p.startsWith('/rest/v1/rpc/')) return json(null)
    if (p.startsWith('/rest/v1/')) {
      const t = p.slice('/rest/v1/'.length); const one = (req.headers()['accept'] || '').includes('pgrst.object')
      let rows = []
      if (t === 'profiles') rows = [profileFor(role), ...people]
      else if (t === 'departments') rows = depts
      else if (t === 'finance_renewals') rows = [
        { id: 'n1', department_id: did('frontend-development'), title: 'codextechfoundation.com domain registration and privacy protection', category: 'domain', vendor: 'Namecheap', amount: '85000', currency: 'NGN', frequency: 'yearly', next_due: '2026-11-01', critical: true, remind_days: [30, 14, 7, 1], status: 'active', notes: '', last_request_id: null, version: 1 },
        { id: 'n2', department_id: did('devops'), title: 'API credits top-up', category: 'api_credits', vendor: 'Provider', amount: '250000', currency: 'NGN', frequency: 'monthly', next_due: '2026-10-22', critical: false, remind_days: [7, 1], status: 'active', notes: '', last_request_id: null, version: 1 }]
      else if (t === 'finance_income') rows = [{ id: 'i1', kind: 'income', reversal_of: null, source: 'client_work_fee', amount: '500000', currency: 'NGN', reference: 'INV-2026-0001', received_on: '2026-10-20', description: 'Fee for the Acme Ltd website redesign project' }, { id: 'i2', kind: 'reversal', reversal_of: 'i1', source: 'client_work_fee', amount: '50000', currency: 'NGN', reference: 'REV-1', received_on: '2026-10-22', description: 'Part of the fee was refunded to the client' }]
      else if (t === 'finance_vendors') rows = [{ id: 'v1', name: 'Namecheap', category: 'domain', website: 'https://www.namecheap.com/domains/registration', status: 'active' }, { id: 'v2', name: 'A very long vendor name that goes on and on for testing', category: null, website: null, status: 'inactive' }]
      else if (t === 'finance_refunds') rows = [{ id: 'r1', request_id: 'f1111111-1111-4111-8111-111111111111', kind: 'refund', amount: '40000', currency: 'NGN', reference: 'RFD-2026-001', received_on: '2026-10-10', note: 'Vendor credited the card', created_at: '2026-10-10T10:00:00Z' }]
      else if (t === 'fund_requests') rows = [
        { id: 'f1111111-1111-4111-8111-111111111111', ref: 'FR-2026-00009', requester_id: people[0].id, department_id: did('frontend-development'), category: 'hosting', title: 'Annual hosting for the portfolio website and staging environments', description: 'Covers production, staging and the preview builds for the whole year.', justification: 'The current plan expires on 1 November and the site would go offline.', amount: '250000', currency: 'NGN', vendor: 'Vercel', required_by: '2026-10-28', project_id: null, recurrence: 'yearly', status: 'paid', version: 3, submitted_at: '2026-10-01T09:00:00Z', decided_at: '2026-10-03T09:00:00Z', payment_reference: 'TRX-99812-ABCDEF', amount_paid: '250000', paid_on: '2026-10-05', payment_recorded_by: people[1].id, payment_note: 'Paid by bank transfer', reconciled_at: null, created_at: '2026-10-01T08:00:00Z', updated_at: '2026-10-05T09:00:00Z' },
        { id: 'f2222222-2222-4222-8222-222222222222', ref: 'FR-2026-00010', requester_id: people[1].id, department_id: did('devops'), category: 'cloud', title: 'Cloud credits', description: '', justification: 'Running low.', amount: '600000', currency: 'NGN', vendor: '', required_by: null, project_id: null, recurrence: 'none', status: 'finance_review', version: 1, submitted_at: '2026-10-20T09:00:00Z', decided_at: null, payment_reference: null, amount_paid: null, paid_on: null, payment_recorded_by: null, payment_note: null, reconciled_at: null, created_at: '2026-10-20T08:00:00Z', updated_at: '2026-10-20T09:00:00Z' }]
      else if (t === 'worker_profiles') rows = [{ ...wp({ id: UID }, 0), user_id: UID }, ...people.map((x, i) => wp(x, i + 1))]
      else if (t === 'worker_departments') rows = [{ user_id: UID, department_id: did('frontend-development'), department_role: 'admin', is_primary: true }, { user_id: UID, department_id: did('finance'), department_role: 'member', is_primary: false }, ...people.map((x, i) => ({ user_id: x.id, department_id: did(DEPTS[(i + 1) % 8]), department_role: 'member', is_primary: true }))]
      if (url.searchParams.get('user_id') === 'eq.' + UID) rows = rows.filter((r) => r.user_id === UID)
      if (url.searchParams.get('slug')) { const s = url.searchParams.get('slug').replace('eq.', ''); rows = rows.filter((r) => r.slug === s) }
      if (one) return rows.length ? json(rows[0]) : json({ code: 'PGRST116', message: 'no rows' }, 406)
      return json(rows)
    }
    return route.fulfill({ status: 200, body: '' })
  }
}
const METRIC = () => {
  const vw = innerWidth; const out = { hOverflow: document.documentElement.scrollWidth - vw, offenders: [], small: [] }
  const scroller = (el) => { for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) { const o = getComputedStyle(n).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true } return false }
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.position !== 'fixed' }
  const sel = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '')
  for (const el of document.querySelectorAll('body *')) { if (!vis(el)) continue; const r = el.getBoundingClientRect(); if (r.right > vw + 2 && !scroller(el)) { out.offenders.push(sel(el) + ' r=' + Math.round(r.right)); if (out.offenders.length > 6) break } }
  for (const el of document.querySelectorAll('button, a[href], [role=button], [role=tab], input:not([type=hidden]), select, textarea')) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect(); const inline = getComputedStyle(el).display === 'inline' && el.closest('p, li, span, h1, h2, h3')
    if (inline) continue; if (r.height < 40 || r.width < 40) out.small.push(sel(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 18) + '"')
  }
  if (out.hOverflow > 0) { // which elements actually push the page wide (including ones inside scroll boxes, and fixed/absolute ones)
    const all = [...document.querySelectorAll('body *')].map((el) => ({ el, r: el.getBoundingClientRect() })).filter((x) => x.r.right > vw + 2 && x.r.width > 0).sort((a, b) => b.r.right - a.r.right).slice(0, 4)
    out.wide = all.map((x) => sel(x.el) + ' r=' + Math.round(x.r.right) + ' pos=' + getComputedStyle(x.el).position + ' parent=' + sel(x.el.parentElement))
  }
  out.smallCount = out.small.length; out.small = out.small.slice(0, 8)
  out.body = (document.body.innerText || '').trim().slice(0, 140).replace(/\s+/g, ' ')
  return out
}
const ROUTES = {
  public: ['/', '/what-we-build', '/projects', '/case-studies', '/about', '/team', '/blog', '/careers', '/contact', '/start-project', '/privacy', '/terms', '/login'],
  worker: ['/worker', '/worker/company', '/worker/department', '/worker/department/finance', '/worker/department/customer-service', '/worker/department/devops', '/worker/department/cybersecurity', '/worker/department/ui-ux-design', '/worker/department/graphics-creative', '/worker/department/content', '/worker/department/marketing', '/worker/department/backend-development', '/worker/knowledge', '/worker/calendar', '/worker/approvals', '/worker/projects', '/worker/tasks', '/worker/clients', '/worker/chat', '/worker/funds', '/worker/funds?tab=all', '/worker/funds?tab=all&open=f1111111-1111-4111-8111-111111111111', '/worker/funds?tab=all&open=f2222222-2222-4222-8222-222222222222', '/worker/finance', '/worker/finance?tab=renewals', '/worker/finance?tab=vendors', '/worker/finance?tab=receipts', '/worker/finance?tab=reports', '/worker/finance?tab=income', '/worker/support', '/worker/present', '/worker/tools', '/worker/status', '/worker/notifications', '/worker/settings', '/worker/settings?tab=notifications', '/worker/monitor', '/worker/monitor?tab=incidents', '/worker/super-dashboard'],
  admin: ['/admin', '/admin/workers', '/admin/company', '/admin/departments', '/admin/departments/finance', '/admin/departments/frontend-development', '/admin/knowledge', '/admin/calendar', '/admin/approvals', '/admin/integrations', '/admin/roles', '/admin/clients', '/admin/applications', '/admin/projects', '/admin/tasks', '/admin/leads', '/admin/chat', '/admin/funds', '/admin/finance', '/admin/finance?tab=renewals', '/admin/finance?tab=vendors', '/admin/finance?tab=receipts', '/admin/finance?tab=reports', '/admin/finance?tab=income', '/admin/support', '/admin/present', '/admin/content', '/admin/content/team', '/admin/content/careers', '/admin/resources', '/admin/tools', '/admin/status', '/admin/notifications', '/admin/audit', '/admin/trash', '/admin/security', '/admin/settings', '/admin/monitor', '/admin/monitor?tab=incidents', '/admin/monitor?tab=setup', '/admin/super-dashboard', '/admin/support?tab=team', '/admin/support?tab=projects'],
  client: ['/client', '/client/updates', '/client/files', '/client/requests', '/client/maintenance', '/client/settings'],
}
const ROLE = { public: null, worker: 'worker', admin: 'superadmin', client: 'client' }
const only = process.argv[2]; const widths = (process.argv[3] || '360,768,1280').split(',').map(Number)
const shotDir = '/tmp/shots'; mkdirSync(shotDir, { recursive: true })
const browser = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter((a) => !/single-process|no-zygote/.test(a)), headless: true })
const results = []
for (const group of Object.keys(ROUTES)) {
  if (only && only !== 'all' && only !== group) continue
  for (const w of widths) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 780 : 900 }, reducedMotion: 'reduce' })
    const role = ROLE[group]
    await ctx.route('https://mock.supabase.co/**', handler(role))
    await ctx.route(/googletagmanager|google-analytics|fonts\.(googleapis|gstatic)/, (r) => r.abort())
    if (role) {
      const tok = { access_token: 'a.b.c', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: { id: UID, email: 'test@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }
      await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), ['sb-mock-auth-token', JSON.stringify(tok)])
    }
    for (const path of ROUTES[group].filter((x) => !process.env.ONLY_RE || new RegExp(process.env.ONLY_RE).test(x))) {
      const page = await ctx.newPage(); const errs = []
      page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 120)))
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|net::ERR/.test(m.text())) errs.push(m.text().slice(0, 120)) })
      try { await page.goto(BASE + path, { waitUntil: 'load', timeout: 20000 }); await page.waitForTimeout(w === widths[0] ? 1400 : 1000); if (process.env.CLICK && path.includes(process.env.CLICK_ON || 'reports')) { await page.getByRole('button', { name: process.env.CLICK }).click(); await page.waitForTimeout(900) } } catch (e) { errs.push('nav: ' + e.message.slice(0, 80)) }
      let axe = null
      if (process.env.AXE) { try { await page.addScriptTag({ path: '/tmp/br/node_modules/axe-core/axe.min.js' }); axe = await page.evaluate(async () => { const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] } }); return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, sample: v.nodes.slice(0, 2).map((n) => n.target.join(' ') + ' :: ' + (n.html || '').slice(0, 90) + (v.id === 'color-contrast' && n.any?.[0]?.data ? ' [fg ' + n.any[0].data.fgColor + ' on ' + n.any[0].data.bgColor + ' = ' + n.any[0].data.contrastRatio + ':1, ' + n.any[0].data.fontSize + ']' : '')) })) }) } catch (e) { axe = [{ id: 'axe-failed', impact: 'n/a', n: 0, help: e.message.slice(0, 80), sample: [] }] } }
      let m = {}; try { m = await page.evaluate(METRIC) } catch (e) { m = { err: e.message.slice(0, 80) } }
      const slug = group + path.replace(/[\/?&=]/g, '_') + '_' + w
      if (process.env.SHOTS) await page.screenshot({ path: `${shotDir}/${slug}.png`, fullPage: !!process.env.FULL }).catch(() => {})
      results.push({ group, path, w, axe, final: new URL(page.url()).pathname + (path.includes('?') ? '' : ''), ...m, errs: errs.slice(0, 3) })
      await page.close()
    }
    await ctx.close()
  }
}
await browser.close()
writeFileSync('/tmp/scan.json', JSON.stringify(results, null, 1))
const bad = results.filter((r) => r.hOverflow > 0 || r.offenders?.length || r.errs?.length || r.final !== r.path.split('?')[0])
console.log('pages scanned:', results.length, ' with problems:', bad.length)
