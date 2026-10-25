import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const css = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')

test('a page that draws its own heading hides the shell title (no double titles)', () => {
  assert.match(css('src/layouts/WorkspaceLayout.css'), /\.ctf-workspace__content:has\(\.ctf-page-header\)\s*>\s*\.ctf-workspace__title\s*\{\s*display:\s*none/)
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
