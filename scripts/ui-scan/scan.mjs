// UI scan harness (headless Chromium against a MOCKED Supabase). Not part of the app or the test suites.
// Usage (see docs/workspace/UPDATE_SECURITY_AND_UI_REPAIR.md):
//   1. npm i --no-save playwright-core @sparticuz/chromium   (a Chromium that installs from npm)
//   2. build with a fake env: VITE_SUPABASE_URL=https://mock.supabase.co VITE_SUPABASE_ANON_KEY=<jwt with {"role":"anon"}> npx vite build --outDir /tmp/mockdist
//   3. serve /tmp/mockdist on 127.0.0.1:4173 with a single-page-app fallback to index.html
//   4. node scripts/ui-scan/scan.mjs [public|worker|admin|client|all] [360,768,1280]   (SHOTS=1 saves screenshots to /tmp/shots; results go to /tmp/scan.json)
// The mock returns empty lists, so it checks layout, overflow, errors, redirects and touch targets, not data-heavy screens.
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
    if (p.startsWith('/rest/v1/rpc/list_budget_status')) return json([
      { budget_id: 'b1', department_id: did('frontend-development'), department_name: 'Frontend Development', category: 'domain', period_kind: 'month', period_start: '2026-10-01', period_end: '2026-10-31', amount: '1000000', currency: 'NGN', note: 'Domains and renewals for the quarter ahead', version: 1, pending: '100000', approved_unpaid: '200000', paid: '250000', reconciled: '50000', refunded: '40000', spent: '260000', committed: '460000', remaining: '540000' },
      { budget_id: 'b2', department_id: null, department_name: null, category: null, period_kind: 'quarter', period_start: '2026-10-01', period_end: '2026-12-31', amount: '3000000', currency: 'NGN', note: '', version: 2, pending: '0', approved_unpaid: '1900000', paid: '1200000', reconciled: '0', refunded: '0', spent: '1200000', committed: '3100000', remaining: '-100000' }])
    if (p.startsWith('/rest/v1/rpc/list_missing_receipts')) return json([{ request_id: 'f1111111-1111-4111-8111-111111111111', ref: 'FR-2026-00009', title: 'Annual hosting for the portfolio website and staging environments', department_name: 'Frontend Development', amount_paid: '250000', currency: 'NGN', paid_on: '2026-10-05', days_open: 20 }])
    if (p.startsWith('/rest/v1/rpc/budget_utilisation_for_request')) return json([{ budget_id: 'b1', scope: 'department_category', period_kind: 'month', period_start: '2026-10-01', period_end: '2026-10-31', amount: '1000000', currency: 'NGN', pending: '0', approved_unpaid: '200000', paid: '250000', reconciled: '50000', refunded: '40000', this_request: '600000', remaining_after: '-60000', over_budget: true }])
    if (p.startsWith('/rest/v1/rpc/')) return json(null)
    if (p.startsWith('/rest/v1/')) {
      const t = p.slice('/rest/v1/'.length); const one = (req.headers()['accept'] || '').includes('pgrst.object')
      let rows = []
      if (t === 'profiles') rows = [profileFor(role), ...people]
      else if (t === 'departments') rows = depts
      else if (t === 'finance_renewals') rows = [
        { id: 'n1', department_id: did('frontend-development'), title: 'codextechfoundation.com domain registration and privacy protection', category: 'domain', vendor: 'Namecheap', amount: '85000', currency: 'NGN', frequency: 'yearly', next_due: '2026-11-01', critical: true, remind_days: [30, 14, 7, 1], status: 'active', notes: '', last_request_id: null, version: 1 },
        { id: 'n2', department_id: did('devops'), title: 'API credits top-up', category: 'api_credits', vendor: 'Provider', amount: '250000', currency: 'NGN', frequency: 'monthly', next_due: '2026-10-22', critical: false, remind_days: [7, 1], status: 'active', notes: '', last_request_id: null, version: 1 }]
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
  out.smallCount = out.small.length; out.small = out.small.slice(0, 8)
  out.body = (document.body.innerText || '').trim().slice(0, 140).replace(/\s+/g, ' ')
  return out
}
const ROUTES = {
  public: ['/', '/what-we-build', '/projects', '/case-studies', '/about', '/team', '/blog', '/careers', '/contact', '/start-project', '/privacy', '/terms', '/login'],
  worker: ['/worker', '/worker/company', '/worker/department', '/worker/department/finance', '/worker/department/customer-service', '/worker/department/devops', '/worker/department/cybersecurity', '/worker/department/ui-ux-design', '/worker/department/graphics-creative', '/worker/department/content', '/worker/department/marketing', '/worker/department/backend-development', '/worker/knowledge', '/worker/calendar', '/worker/approvals', '/worker/projects', '/worker/tasks', '/worker/clients', '/worker/chat', '/worker/funds', '/worker/funds?tab=all', '/worker/funds?tab=all&open=f1111111-1111-4111-8111-111111111111', '/worker/funds?tab=all&open=f2222222-2222-4222-8222-222222222222', '/worker/finance', '/worker/finance?tab=renewals', '/worker/finance?tab=vendors', '/worker/finance?tab=receipts', '/worker/support', '/worker/present', '/worker/tools', '/worker/status', '/worker/notifications', '/worker/settings'],
  admin: ['/admin', '/admin/workers', '/admin/company', '/admin/departments', '/admin/departments/finance', '/admin/departments/frontend-development', '/admin/knowledge', '/admin/calendar', '/admin/approvals', '/admin/integrations', '/admin/roles', '/admin/clients', '/admin/applications', '/admin/projects', '/admin/tasks', '/admin/leads', '/admin/chat', '/admin/funds', '/admin/finance', '/admin/finance?tab=renewals', '/admin/finance?tab=vendors', '/admin/finance?tab=receipts', '/admin/support', '/admin/present', '/admin/content', '/admin/content/team', '/admin/content/careers', '/admin/resources', '/admin/tools', '/admin/status', '/admin/notifications', '/admin/audit', '/admin/trash', '/admin/security', '/admin/settings'],
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
      try { await page.goto(BASE + path, { waitUntil: 'load', timeout: 20000 }); await page.waitForTimeout(w === widths[0] ? 1400 : 1000) } catch (e) { errs.push('nav: ' + e.message.slice(0, 80)) }
      let m = {}; try { m = await page.evaluate(METRIC) } catch (e) { m = { err: e.message.slice(0, 80) } }
      const slug = group + path.replace(/[\/?&=]/g, '_') + '_' + w
      if (process.env.SHOTS) await page.screenshot({ path: `${shotDir}/${slug}.png`, fullPage: false }).catch(() => {})
      results.push({ group, path, w, final: new URL(page.url()).pathname + (path.includes('?') ? '' : ''), ...m, errs: errs.slice(0, 3) })
      await page.close()
    }
    await ctx.close()
  }
}
await browser.close()
writeFileSync('/tmp/scan.json', JSON.stringify(results, null, 1))
const bad = results.filter((r) => r.hOverflow > 0 || r.offenders?.length || r.errs?.length || r.final !== r.path.split('?')[0])
console.log('pages scanned:', results.length, ' with problems:', bad.length)
