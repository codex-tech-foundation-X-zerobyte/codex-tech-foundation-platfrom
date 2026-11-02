import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const css = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')

test('a page that draws its own heading hides the shell title (no double titles)', () => {
  assert.match(css('src/layouts/WorkspaceLayout.css'), /\.ctf-workspace__content:has\(\.ctf-page-header,\s*\.ctf-denv__head\)\s*>\s*\.ctf-workspace__title\s*\{\s*display:\s*none/)
})

test('the breadcrumb keeps the current page name readable on a phone', () => {
  const c = css('src/layouts/WorkspaceLayout.css')
  assert.match(c, /\.ctf-crumbs strong \{[^}]*min-width: 7ch/)
  assert.match(c, /max-width: 960px\) \{[\s\S]*\.ctf-crumbs > span:first-child/)
})

test('the calendar toolbar wraps instead of pushing the New button off screen', () => {
  assert.match(css('src/workspaces/DepartmentEnvironment.css'), /\.ctf-denv__board-head \{[^}]*flex-wrap: wrap/)
})

test('touch targets are at least 40px on phones and touch screens', () => {
  const touch = '@media (pointer: coarse), (max-width: 960px)'
  assert.ok(css('src/components/ui/Button.css').includes(touch + ' { .ctf-btn--sm, .ctf-btn:not(.ctf-btn--lg) { --btn-h: 40px; } }'))
  assert.ok(css('src/components/ui/Primitives.css').includes(touch + ' { .ctf-tabs__item { min-height: 40px; } }'))
  assert.ok(css('src/pages/worker/WorkerDepartment.css').includes(touch + ' { .ctf-dswitch__chip { height: 40px; } }'))
  assert.match(css('src/layouts/WorkspaceLayout.css'), /\.ctf-icon-btn \{ width: 40px; height: 40px; \}/)
  assert.match(css('src/layouts/WorkspaceLayout.css'), /\.ctf-sidebar__link \{ min-height: 42px; \}/)
})

test('finance pages let wide content scroll inside its own box instead of widening the page', () => {
  const c = css('src/pages/finance/FinanceOffice.css')
  assert.match(c, /\.ctf-fin__report > \*[^{]*\{ min-width: 0; \}/)
  assert.match(c, /\.ctf-fin table \{ min-width: 680px; \}/)
  assert.match(c, /@media print \{[\s\S]*\.ctf-sidebar, \.ctf-topbar/)   // a printed report has no app chrome
  assert.match(c, /@media \(max-width: 560px\) \{[^\n]*\.ctf-kpi strong \{[^}]*white-space: nowrap/)
})

// ---- Accessibility regression guards (axe-core findings from the first clean audit) ----
import { readdirSync } from 'node:fs'
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const token = (name) => { const m = css('src/styles/tokens.css').match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`)); assert.ok(m, `token ${name} missing`); return m[1] }

test('every text colour token is readable (WCAG AA 4.5:1) on every background and surface token', () => {
  const texts = ['text-primary', 'text-secondary', 'text-tertiary', 'text-faint']
  const grounds = ['bg-0', 'bg-1', 'bg-2', 'surface-1', 'surface-2', 'surface-3']
  for (const t of texts) for (const g of grounds) {
    const r = ratio(token(t), token(g))
    assert.ok(r >= 4.5, `--${t} on --${g} is ${r.toFixed(2)}:1, below 4.5:1`)
  }
})

test('the fainter text tokens keep their order, so hierarchy survives the contrast fix', () => {
  assert.ok(ratio(token('text-faint'), token('bg-0')) < ratio(token('text-tertiary'), token('bg-0')))
  assert.ok(ratio(token('text-tertiary'), token('bg-0')) < ratio(token('text-secondary'), token('bg-0')))
})

test('public pages never nest a second <main> inside the layout main (one main landmark per page)', () => {
  const dir = new URL('../src/pages/public/', import.meta.url)
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.tsx'))) {
    assert.ok(!/<main[\s>]/.test(readFileSync(new URL(f, dir), 'utf8')), `${f} has its own <main>; PublicLayout already provides it`)
  }
  assert.match(css('src/layouts/PublicLayout.tsx'), /<main id="ctf-public-main"/)
})

test('the sign-in page has a main landmark', () => {
  assert.match(css('src/pages/auth/Login.tsx'), /<main className="ctf-auth"/)
})

test('dialogs do not create extra banner/contentinfo landmarks (they sit at the top of <body> in a portal)', () => {
  const m = css('src/components/ui/Modal.tsx')
  assert.ok(!/<header|<footer/.test(m))
})

test('every public page that opens with a section heading makes it the one h1', () => {
  for (const f of ['BlogList', 'CareersList', 'CaseStudiesList', 'Contact', 'ProjectsList', 'StartProject', 'Team']) {
    assert.match(css(`src/pages/public/${f}.tsx`), /<SectionHeading level=\{1\}/, f)
  }
})

test('a department page has exactly one visible h1: its own title, with the shell title hidden', () => {
  assert.match(css('src/workspaces/DepartmentEnvironment.tsx'), /<h1>\{def\.dashboardTitle\}<\/h1>/)
  assert.ok(!/<h2>\{def\.dashboardTitle\}/.test(css('src/workspaces/DepartmentEnvironment.tsx')))
})

test('no two landmarks share the name "Notifications" (push prompt, toast stack and settings section)', () => {
  assert.ok(!/aria-label="Notifications"/.test(css('src/components/PushControls.tsx')))
  assert.ok(!/aria-label="Notifications"/.test(css('src/components/ui/Toast.tsx')))
})

test('accent colour used as text goes through --accent-text, never the 3.7:1 --accent-9', () => {
  const dir = new URL('../src/', import.meta.url)
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(new URL(e.name + '/', d)) : [new URL(e.name, d)]))
  for (const f of walk(dir).filter((u) => u.pathname.endsWith('.css'))) {
    const bad = readFileSync(f, 'utf8').match(/(?<![-\w])color:\s*var\(--accent-9/g)
    assert.ok(!bad, `${f.pathname.split('/src/')[1]} sets text colour to --accent-9; use var(--accent-text)`)
  }
  for (const g of ['bg-0', 'surface-1', 'surface-2', 'surface-3']) assert.ok(ratio(token('accent-7'), token(g)) >= 4.5, `--accent-text on --${g}`)
})

test('a disabled switch fades its label only, so its explanation stays readable', () => {
  assert.ok(!/\.is-disabled \.ctf-switch__text \{/.test(css('src/components/ui/Switch.css')))
  assert.match(css('src/components/ui/Switch.css'), /\.is-disabled \.ctf-switch__text strong \{ opacity/)
})

test('the Main Admin tasks status filter has an accessible name', () => {
  assert.match(css('src/pages/admin/AdminTasks.tsx'), /<Select aria-label="Filter tasks by status"/)
})

test('department and integration section titles sit one level under the page h1 (h2), not at h3', () => {
  for (const f of ['src/workspaces/DepartmentEnvironment.tsx', 'src/workspaces/DepartmentToolPage.tsx', 'src/workspaces/DepartmentWork.tsx', 'src/workspaces/RecordViews.tsx', 'src/pages/admin/AdminIntegrations.tsx']) {
    assert.ok(!/<h3[\s>]/.test(css(f)), `${f} still has an h3`)
  }
})

test('the scrolling table wrapper is positioned, so visually-hidden text inside it cannot widen the page', () => {
  assert.match(css('src/components/ui/Table.css'), /\.ctf-table-wrap \{[^}]*position: relative/)
})
