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
  for (const fn of ['submit-lead', 'submit-contact', 'submit-job-application', 'resolve-worker-login', 'create-worker', 'create-resume-upload-url', 'create-client', 'resolve-client-login']) {
    const src = await readFile(new URL(`../supabase/functions/${fn}/index.ts`, import.meta.url), 'utf8')
    assert.match(src, /Deno\.serve/)
  }
})

test('public/lightly-authenticated edge functions call the shared rate limiter', async () => {
  for (const fn of ['submit-lead', 'submit-contact', 'submit-job-application', 'resolve-worker-login', 'create-worker', 'create-resume-upload-url', 'create-client', 'resolve-client-login']) {
    const src = await readFile(new URL(`../supabase/functions/${fn}/index.ts`, import.meta.url), 'utf8')
    assert.match(src, /check_rate_limit/)
  }
})

test('resolve-worker-login and resolve-client-login never return the account email to the caller', async () => {
  for (const fn of ['resolve-worker-login', 'resolve-client-login']) {
    const src = await readFile(new URL(`../supabase/functions/${fn}/index.ts`, import.meta.url), 'utf8')
    assert.doesNotMatch(src, /JSON\.stringify\(\{\s*email/)
    assert.match(src, /access_token/)
    assert.match(src, /refresh_token/)
  }
})

test('manager role exists in the schema, types, and route guards', async () => {
  const types = await readFile(new URL('../src/lib/types.ts', import.meta.url), 'utf8')
  assert.match(types, /'worker' \| 'manager' \| 'superadmin' \| 'client'/)

  const enumMigration = await readFile(new URL('../supabase/migrations/20260914000000_manager_role_enum.sql', import.meta.url), 'utf8')
  assert.match(enumMigration, /add value if not exists 'manager'/)

  const rbacMigration = await readFile(new URL('../supabase/migrations/20260914000001_manager_role_rbac.sql', import.meta.url), 'utf8')
  assert.match(rbacMigration, /bootstrap_super_admin/)
  assert.match(rbacMigration, /revoke all on function public\.bootstrap_super_admin/)

  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /allowedRoles=\{\['manager', 'superadmin'\]\}/)
  assert.match(app, /SuperAdminOnly/)

  const nav = await readFile(new URL('../src/layouts/navConfig.tsx', import.meta.url), 'utf8')
  assert.match(nav, /MANAGER_NAV/)
})

test('Voice/Video Calls: schema reuses can_access_channel, WebRTC hook, and UI wiring all exist', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20260917000000_calls.sql', import.meta.url), 'utf8')
  assert.match(migration, /create table public\.calls/)
  assert.match(migration, /create table public\.call_participants/)
  // Calls must reuse the Chat migration's access function, not invent a
  // second membership model.
  assert.match(migration, /public\.can_access_channel\(channel_id\)/)

  const realtime = await readFile(new URL('../src/lib/realtime.ts', import.meta.url), 'utf8')
  assert.match(realtime, /export function subscribeToCallSignaling/)
  assert.match(realtime, /export function sendCallSignal/)
  assert.match(realtime, /'broadcast'/)

  const session = await readFile(new URL('../src/lib/useCallSession.ts', import.meta.url), 'utf8')
  assert.match(session, /RTCPeerConnection/)
  assert.match(session, /getUserMedia/)
  // Every subscribed realtime channel and every open peer connection must
  // actually get torn down — a leaked WebRTC connection keeps the camera/
  // mic indicator on and the browser tab pinned in memory indefinitely.
  assert.match(session, /connection\.close\(\)/)
  assert.match(session, /unsubscribe\(signalChannelRef\.current\)/)

  const service = await readFile(new URL('../src/lib/services/calls.ts', import.meta.url), 'utf8')
  assert.match(service, /export async function startCall/)
  assert.match(service, /export async function joinCall/)
  assert.match(service, /export async function leaveCall/)

  const chatPage = await readFile(new URL('../src/pages/ChatPage.tsx', import.meta.url), 'utf8')
  assert.match(chatPage, /CallView/)
  assert.match(chatPage, /startOrJoinCall/)
})

test('the canonical docs referenced by CONTRIBUTING.md actually exist', async () => {
  for (const doc of ['ARCHITECTURE', 'DATABASE-SCHEMA', 'AUTH-RULES', 'RBAC', 'API-CONTRACT', 'REALTIME', 'FILE-STORAGE', 'NOTIFICATIONS', 'CONTRIBUTING', 'DEVELOPMENT']) {
    const src = await readFile(new URL(`../docs/${doc}.md`, import.meta.url), 'utf8')
    assert.ok(src.length > 200, `${doc}.md should have real content, not a stub`)
  }
})

test('client provisioning: Client ID schema, RLS, and Login.tsx wiring all exist', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20260915000000_client_provisioning.sql', import.meta.url), 'utf8')
  assert.match(migration, /client_code text unique/)
  assert.match(migration, /clients view own company/)

  const createClientFn = await readFile(new URL('../supabase/functions/create-client/index.ts', import.meta.url), 'utf8')
  assert.match(createClientFn, /clients\.create/)
  assert.match(createClientFn, /CTF-CLT-/)

  const login = await readFile(new URL('../src/pages/auth/Login.tsx', import.meta.url), 'utf8')
  assert.match(login, /resolve-client-login/)
  assert.match(login, /resolve-worker-login/)
  assert.match(login, /superadmin/)
})

test('Team Chat: schema, can_access_channel scoping, and DM creation via security-definer function all exist', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20260916000000_team_chat.sql', import.meta.url), 'utf8')
  assert.match(migration, /create table public\.channels/)
  assert.match(migration, /create table public\.channel_members/)
  assert.match(migration, /create table public\.messages/)
  assert.match(migration, /create or replace function public\.can_access_channel/)
  assert.match(migration, /create or replace function public\.create_dm_channel/)
  assert.match(migration, /alter publication supabase_realtime add table public\.messages/)
  // The profiles RLS bug fix found while building this (any non-self,
  // non-superadmin viewer got a blank display_name) must be present.
  assert.match(migration, /team views colleague profiles/)

  const realtime = await readFile(new URL('../src/lib/realtime.ts', import.meta.url), 'utf8')
  assert.match(realtime, /export function subscribeToChannelMessages/)
  assert.match(realtime, /export function unsubscribe/)
  assert.match(realtime, /postgres_changes/)

  const service = await readFile(new URL('../src/lib/services/chat.ts', import.meta.url), 'utf8')
  assert.match(service, /export async function sendMessage/)
  assert.match(service, /export async function editMessage/)
  assert.match(service, /export async function deleteMessage/)
  // openDirectMessage must go through the RPC, not a raw insert that RLS
  // would reject (self-insert-only on channel_members).
  assert.match(service, /rpc\('create_dm_channel'/)

  const chatPage = await readFile(new URL('../src/pages/ChatPage.tsx', import.meta.url), 'utf8')
  assert.match(chatPage, /subscribeToChannelMessages/)
  assert.match(chatPage, /unsubscribe\(channel\)/)

  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /path="chat" element={<ChatPage \/>}/)
})

test('Team Files: folders, real trash (storage object preserved), and versioning all exist', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20260915000001_team_files.sql', import.meta.url), 'utf8')
  assert.match(migration, /is_folder boolean/)
  assert.match(migration, /deleted_at timestamptz/)
  assert.match(migration, /create table if not exists public\.resource_versions/)
  assert.match(migration, /team logs their own file activity/)

  const service = await readFile(new URL('../src/lib/services/resourceFiles.ts', import.meta.url), 'utf8')
  assert.match(service, /export async function moveToTrash/)
  assert.match(service, /export async function restoreFromTrash/)
  assert.match(service, /export async function permanentlyDelete/)
  assert.match(service, /export async function uploadNewVersion/)
  assert.match(service, /export async function createFolder/)
  // The old behavior removed the storage object immediately on "delete" —
  // moveToTrash must NOT call storage.remove(); only permanentlyDelete may.
  const moveToTrashBody = service.split('export async function moveToTrash')[1].split('export async function')[0]
  assert.doesNotMatch(moveToTrashBody, /storage\.remove/)
})
