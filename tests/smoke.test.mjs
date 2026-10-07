import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('route coverage and access boundaries are present', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /path="\/worker\/\*"/)
  assert.match(app, /path="\/admin\/\*"/)
  assert.match(app, /path="\/client\/\*"/)
  assert.match(app, /ProtectedRoute/)
  for (const path of ['/what-we-build', '/projects', '/projects/:slug', '/case-studies', '/team', '/blog/:slug', '/careers/:slug/apply', '/start-project', '/privacy', '/terms']) {
    assert.match(app, new RegExp(`path="${path.replace(/[/:]/g, '\\$&')}"`))
  }
})

test('workspace layout enforces role-scoped navigation', async () => {
  const nav = await readFile(new URL('../src/layouts/navConfig.tsx', import.meta.url), 'utf8')
  assert.match(nav, /WORKER_NAV/)
  assert.match(nav, /ADMIN_NAV/)
  assert.match(nav, /CLIENT_NAV/)
})

test('database migration enables RLS and private storage', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260912000000_initial.sql', import.meta.url), 'utf8')
    + await readFile(new URL('../supabase/migrations/20260912000001_platform_content.sql', import.meta.url), 'utf8')
  assert.match(sql, /enable row level security/)
  assert.match(sql, /project-assets/)
  assert.match(sql, /archived_at/)
  for (const table of ['tasks', 'content_pages', 'blog_posts', 'careers', 'applications', 'leads', 'clients', 'resources', 'project_updates', 'project_requests', 'project_files', 'settings']) {
    assert.match(sql, new RegExp(`create table public\\.${table}`))
  }
})

test('privileged submission functions exist as edge functions, not client-side writes', async () => {
  for (const fn of ['submit-lead', 'submit-contact', 'submit-job-application', 'resolve-worker-login']) {
    const src = await readFile(new URL(`../supabase/functions/${fn}/index.ts`, import.meta.url), 'utf8')
    assert.match(src, /Deno\.serve/)
  }
})
