import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_TYPES, CALLBACK_EVENT_LABEL, CALLBACK_STATUS_LABEL, CALLBACK_STATUS_TONE, CALLBACK_VERIFY_SNIPPET, checkAttachment, localToIso, minutesLabel, shiftLabel } from '../src/lib/supportRules.ts'
import { signWebhook } from '../supabase/functions/_shared/webhookSign.ts'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const sql = read('supabase/migrations/20261005000000_support_completion.sql')

test('the verification example shown to a project\'s developers really verifies a real signature', async () => {
  const body = '{"event":"ticket.reply","sequence":3}'
  const header = await signWebhook('s'.repeat(64), 1700000000, body)
  const code = CALLBACK_VERIFY_SNIPPET.replace(/^import .*$/m, '').replace('export function', 'function')
  const verify = new Function('createHmac', 'timingSafeEqual', 'Buffer', `${code}\nreturn verifyCodexCallback`)(createHmac, timingSafeEqual, Buffer)
  assert.equal(verify('s'.repeat(64), header, body, 1700000100), true)
  assert.equal(verify('s'.repeat(64), header, body + ' ', 1700000100), false, 'tampered body')
  assert.equal(verify('t'.repeat(64), header, body, 1700000100), false, 'wrong secret')
  assert.equal(verify('s'.repeat(64), header, body, 1700000000 + 301), false, 'stale')
  assert.equal(verify('s'.repeat(64), null, body, 1700000100), false, 'no header')
  assert.equal(verify('s'.repeat(64), 't=1700000000,v1=zz', body, 1700000100), false, 'bad header')
})

test('attachment limits and file types equal the database and the bucket', () => {
  assert.equal(ATTACHMENT_MAX_BYTES, 10485760)
  const dbTypes = [...sql.match(/mime_type\s+text not null check \(mime_type in \(([^)]*)\)\)/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
  const bucket = [...sql.match(/allowed_mime_types\) values \([^]*?array\[([^\]]*)\]\)/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
  assert.deepEqual(Object.keys(ATTACHMENT_TYPES).sort(), dbTypes)
  assert.deepEqual(Object.keys(ATTACHMENT_TYPES).sort(), bucket)
  assert.match(sql, /size_bytes\s+integer not null check \(size_bytes between 1 and 10485760\)/)
  assert.match(sql, /file_size_limit[^]*10485760/)
})

test('a file is checked in the browser before upload', () => {
  assert.equal(checkAttachment({ name: 'a.png', type: 'image/png', size: 1 }), null)
  assert.equal(checkAttachment({ name: 'a.pdf', type: 'application/pdf', size: ATTACHMENT_MAX_BYTES }), null)
  assert.match(checkAttachment({ name: 'a.pdf', type: 'application/pdf', size: ATTACHMENT_MAX_BYTES + 1 }), /larger than 10 MB/)
  assert.match(checkAttachment({ name: 'a.exe', type: 'application/x-msdownload', size: 5 }), /not a type we accept/)
  assert.match(checkAttachment({ name: 'a.svg', type: 'image/svg+xml', size: 5 }), /not a type we accept/)   // SVG can carry script
  assert.match(checkAttachment({ name: 'a.txt', type: 'text/plain', size: 0 }), /is empty/)
  assert.match(checkAttachment({ name: '', type: '', size: 5 }), /That file is not a type/)
})

test('callback event names and delivery states in the screens equal the database ones', () => {
  const events = [...sql.match(/event\s+text not null check \(event in \(([^)]*)\)\)/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
  assert.deepEqual(Object.keys(CALLBACK_EVENT_LABEL).sort(), events)
  const states = [...sql.match(/status\s+text not null default 'pending' check \(status in \(([^)]*)\)\)/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
  assert.deepEqual(Object.keys(CALLBACK_STATUS_LABEL).sort(), states)
  assert.deepEqual(Object.keys(CALLBACK_STATUS_TONE).sort(), states)
})

test('response times and shifts read plainly', () => {
  assert.equal(minutesLabel(null), '—'); assert.equal(minutesLabel(0), 'under a minute'); assert.equal(minutesLabel(45), '45m'); assert.equal(minutesLabel(95), '1h 35m'); assert.equal(minutesLabel(60 * 72), '3 days')
  assert.match(shiftLabel('2026-11-02T09:00:00', '2026-11-02T17:30:00', 'en-GB'), /^Mon,? 2 Nov, 09:00 to 17:30$/)   // the comma after the weekday depends on the ICU data of the runtime
  assert.match(shiftLabel('2026-11-02T22:00:00', '2026-11-03T06:00:00', 'en-GB'), /Mon,? 2 Nov 22:00 to Tue,? 3 Nov 06:00/)
})

test('a form time becomes an exact moment, and an empty one stays empty', () => {
  assert.equal(localToIso(''), '')
  assert.equal(localToIso('2026-11-02T09:00'), new Date('2026-11-02T09:00').toISOString())
})

test('the Support Desk shows Team and callbacks to leads only, and the ticket panel on every ticket', () => {
  const f = read('src/pages/support/SupportDesk.tsx')
  assert.match(f, /\.\.\.\(isLead \? \[\{ id: 'projects', label: 'Connected projects' \}, \{ id: 'team', label: 'Team' \}/)
  assert.match(f, /tab === 'team' && isLead \? <SupportTeam \/>/)
  assert.match(f, /<CallbacksPanel canManage=\{canManage\} \/>/)
  assert.match(f, /<TicketExtras ticketId=\{t\.id\} isAgent=\{isAgent\} canLink=\{profile\?\.role === 'superadmin' \|\| !isAgent\} closed=\{t\.status === 'closed'\} \/>/)
  assert.ok(!/<h4>Conversation/.test(f), 'the ticket dialog must not skip a heading level')
})

test('the new screens never show or store a signing secret, and never call a database table directly for callbacks', () => {
  const panel = read('src/pages/support/CallbacksPanel.tsx'), svc = read('src/lib/services/supportExtras.ts')
  assert.ok(!/localStorage|sessionStorage/.test(panel + svc))
  assert.ok(!/from\('support_callbacks'\)|from\('support_callback_events'\)/.test(svc), 'callback tables are reachable only through the lead-checked functions')
  assert.match(svc, /rpc\('support_set_callback'|'support_set_callback'/)
})

test('the Support Desk page can never be stretched by a wide child (the grid column may shrink)', () => {
  assert.match(read('src/pages/support/SupportDesk.css'), /\.ctf-support \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/)
  assert.ok(!/<h3 id="cbp-h"/.test(read('src/pages/support/CallbacksPanel.tsx')), 'the callbacks heading sits directly under the page h1, so it is an h2')
})
