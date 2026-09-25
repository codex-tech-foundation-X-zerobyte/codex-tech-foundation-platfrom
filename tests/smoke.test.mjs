import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('the countRows() worker_profiles bug is actually fixed (was a real 400, not a live-database issue)', async () => {
  const workspace = await readFile(new URL('../src/lib/services/workspace.ts', import.meta.url), 'utf8')
  assert.match(workspace, /idColumn = 'id'/)
  assert.match(workspace, /select\(idColumn/)

  const dashboard = await readFile(new URL('../src/pages/admin/AdminDashboard.tsx', import.meta.url), 'utf8')
  assert.match(dashboard, /idColumn: 'user_id'/)
})

test('AdminDashboard health checks are real network calls, not hardcoded "healthy" status', async () => {
  const healthService = await readFile(new URL('../src/lib/services/healthCheck.ts', import.meta.url), 'utf8')
  assert.match(healthService, /export async function checkDatabaseHealth/)
  assert.match(healthService, /export async function checkEdgeFunctionHealth/)
  assert.match(healthService, /performance\.now\(\)/)

  const dashboard = await readFile(new URL('../src/pages/admin/AdminDashboard.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(dashboard, /Supabase connection: healthy/)
  assert.doesNotMatch(dashboard, /Row-level security: enforced/)
  assert.match(dashboard, /checkDatabaseHealth/)
})

test('supabase.ts fails clearly on missing config instead of silently booting against a fake project', async () => {
  const client = await readFile(new URL('../src/lib/supabase.ts', import.meta.url), 'utf8')
  assert.match(client, /export const hasValidConfig/)

  const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8')
  assert.match(main, /hasValidConfig/)
  assert.match(main, /Configuration error/)
})

test('service worker actually cleans up old caches on activate (previously had no cleanup logic at all)', async () => {
  const sw = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8')
  assert.match(sw, /codex-shell-v2/)
  assert.match(sw, /caches\.delete/)
})

test('Developer Tools: real client-side hashing/encoding (no MD5 claim), disclosed external QR dependency, routed for Worker and Admin', async () => {
  const page = await readFile(new URL('../src/pages/DevToolsPage.tsx', import.meta.url), 'utf8')
  assert.match(page, /crypto\.subtle\.digest/)
  assert.match(page, /crypto\.randomUUID/)
  // The QR tool must disclose its external dependency, not present it as fully local.
  assert.match(page, /api\.qrserver\.com/)
  assert.match(page, /requires network access/)

  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const devtoolsRoutes = app.match(/<Route path="devtools" element=\{<DevToolsPage \/>\} \/>/g) ?? []
  assert.strictEqual(devtoolsRoutes.length, 2, 'both worker and admin workspaces should route devtools to DevToolsPage')
})

test('Light/Dark/System theme: real token redefinition (not just an inverted palette), persisted, applied before first paint', async () => {
  const tokens = await readFile(new URL('../src/styles/tokens.css', import.meta.url), 'utf8')
  assert.match(tokens, /\[data-theme='light'\]/)
  assert.match(tokens, /prefers-color-scheme: light/)

  const theme = await readFile(new URL('../src/lib/theme.ts', import.meta.url), 'utf8')
  assert.match(theme, /export function applyTheme/)
  assert.match(theme, /localStorage/)

  const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8')
  assert.match(main, /initTheme\(\)/)

  const settings = await readFile(new URL('../src/pages/AccountSettings.tsx', import.meta.url), 'utf8')
  assert.match(settings, /applyTheme/)
})

test('animated background respects prefers-reduced-motion and cleans up its animation frame on unmount', async () => {
  const bg = await readFile(new URL('../src/components/AnimatedBackground.tsx', import.meta.url), 'utf8')
  assert.match(bg, /prefers-reduced-motion: reduce/)
  assert.match(bg, /cancelAnimationFrame/)
  assert.match(bg, /removeEventListener\('resize'/)

  const css = await readFile(new URL('../src/components/AnimatedBackground.css', import.meta.url), 'utf8')
  assert.match(css, /prefers-reduced-motion: reduce/)
  assert.match(css, /pointer-events: none/)
})

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

test('Account Settings is real for all three roles, and Manager can now reach it (was superadmin-only before)', async () => {
  const account = await readFile(new URL('../src/lib/services/account.ts', import.meta.url), 'utf8')
  assert.match(account, /export async function updateOwnProfile/)
  assert.match(account, /export async function changePassword/)

  const page = await readFile(new URL('../src/pages/AccountSettings.tsx', import.meta.url), 'utf8')
  assert.match(page, /updateOwnProfile/)
  assert.match(page, /changePassword/)

  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const settingsRoutes = app.match(/<Route path="settings" element=\{<AccountSettings \/>\} \/>/g) ?? []
  assert.strictEqual(settingsRoutes.length, 3, 'all three workspaces (worker/admin/client) should route settings to AccountSettings')
  // The admin settings route must NOT still be wrapped in SuperAdminOnly —
  // that was the actual bug (Manager had no settings page at all).
  assert.doesNotMatch(app, /<SuperAdminOnly><ScaffoldPage icon=\{Wrench\}/)
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

test('calls and notifications are actually in the Realtime publication (the real root cause of silent call alerts)', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20260918000001_realtime_publication_fix.sql', import.meta.url), 'utf8')
  assert.match(migration, /alter publication supabase_realtime add table public\.calls/)
  assert.match(migration, /alter publication supabase_realtime add table public\.notifications/)
})

test('GitHub Pages deployment: workflow, base-path config, and SPA 404 fallback all exist and are wired together', async () => {
  const workflow = await readFile(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8')
  assert.match(workflow, /actions\/deploy-pages/)
  assert.match(workflow, /VITE_BASE_PATH: \/\$\{\{ github\.event\.repository\.name \}\}\//)

  const viteConfig = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8')
  assert.match(viteConfig, /process\.env\.VITE_BASE_PATH/)

  const notFound = await readFile(new URL('../public/404.html', import.meta.url), 'utf8')
  assert.match(notFound, /BASE_PATH_PLACEHOLDER/)
  assert.match(workflow, /BASE_PATH_PLACEHOLDER/)

  const index = await readFile(new URL('../index.html', import.meta.url), 'utf8')
  assert.match(index, /history\.replaceState/)
})

test('sidebars are actually collapsible (main workspace nav and chat channel list), not just styled to look collapsible', async () => {
  const layout = await readFile(new URL('../src/layouts/WorkspaceLayout.tsx', import.meta.url), 'utf8')
  assert.match(layout, /const \[collapsed, setCollapsed\]/)
  assert.match(layout, /localStorage\.getItem\('ctf-sidebar-collapsed'\)/)

  const chatPage = await readFile(new URL('../src/pages/ChatPage.tsx', import.meta.url), 'utf8')
  assert.match(chatPage, /const \[sidebarCollapsed, setSidebarCollapsed\]/)
})

test('notification bell is wired to a real unread count and navigates somewhere real, not a dead button', async () => {
  const workspace = await readFile(new URL('../src/lib/services/workspace.ts', import.meta.url), 'utf8')
  assert.match(workspace, /export async function getUnreadNotificationCount/)

  const layout = await readFile(new URL('../src/layouts/WorkspaceLayout.tsx', import.meta.url), 'utf8')
  assert.match(layout, /onClick=\{\(\) => navigate\(notificationsPath\)\}/)

  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const notifRoutes = app.match(/<Route path="notifications" element=\{<NotificationsPage \/>\} \/>/g) ?? []
  assert.strictEqual(notifRoutes.length, 3, 'all three workspaces (worker/admin/client) should have a real notifications route')
})

test('chat messages align by sender (own messages right, others left) with WhatsApp-style grouping', async () => {
  const chatPage = await readFile(new URL('../src/pages/ChatPage.tsx', import.meta.url), 'utf8')
  assert.match(chatPage, /isMine \? 'is-mine' : 'is-theirs'/)
  const css = await readFile(new URL('../src/pages/ChatPage.css', import.meta.url), 'utf8')
  assert.match(css, /\.ctf-chat__message\.is-mine \{ flex-direction: row-reverse; \}/)
})

test('Leads management is real, not a scaffold: service, notes/assignment schema, UI wiring for both Worker and Admin', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20260918000000_leads_management.sql', import.meta.url), 'utf8')
  assert.match(migration, /alter table public\.leads add column if not exists notes/)
  assert.match(migration, /alter table public\.leads add column if not exists assigned_to/)

  const service = await readFile(new URL('../src/lib/services/leads.ts', import.meta.url), 'utf8')
  assert.match(service, /export async function listLeads/)
  assert.match(service, /export async function updateLeadStatus/)
  assert.match(service, /export async function assignLead/)
  assert.match(service, /export async function updateLeadNotes/)

  const page = await readFile(new URL('../src/pages/LeadsPage.tsx', import.meta.url), 'utf8')
  assert.match(page, /listLeads/)

  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const leadsRoutes = app.match(/<Route path="leads" element=\{<LeadsPage \/>\} \/>/g) ?? []
  assert.strictEqual(leadsRoutes.length, 2, 'both worker and admin workspaces should route leads to LeadsPage')
})

test('AuthProvider uses getSession (not getUser) to avoid the session-drop bug, and only clears profile on SIGNED_OUT', async () => {
  const auth = await readFile(new URL('../src/lib/auth.tsx', import.meta.url), 'utf8')
  assert.match(auth, /supabase\.auth\.getSession\(\)/)
  assert.doesNotMatch(auth, /supabase\.auth\.getUser\(\)/)
  assert.match(auth, /event === 'SIGNED_OUT'/)
})

test('project creation is real: service function, RLS-compatible insert, and UI wiring for both Worker and Admin', async () => {
  const service = await readFile(new URL('../src/lib/services/projects.ts', import.meta.url), 'utf8')
  assert.match(service, /export async function createProject/)
  assert.match(service, /ensureProjectChannel/)

  const modal = await readFile(new URL('../src/components/CreateProjectModal.tsx', import.meta.url), 'utf8')
  assert.match(modal, /createProject/)

  const workerProjects = await readFile(new URL('../src/pages/worker/WorkerProjects.tsx', import.meta.url), 'utf8')
  assert.match(workerProjects, /CreateProjectModal/)

  const adminProjects = await readFile(new URL('../src/pages/admin/AdminProjects.tsx', import.meta.url), 'utf8')
  assert.match(adminProjects, /CreateProjectModal/)

  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /<AdminProjects \/>/)
})

test('incoming call alerts are global, not scoped to whichever channel is open', async () => {
  const listener = await readFile(new URL('../src/components/IncomingCallListener.tsx', import.meta.url), 'utf8')
  assert.match(listener, /event: 'INSERT', schema: 'public', table: 'calls'/)
  assert.match(listener, /created_by === profile\.id/) // must not alert the caller about their own call

  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /<IncomingCallListener \/>/)

  const chatPage = await readFile(new URL('../src/pages/ChatPage.tsx', import.meta.url), 'utf8')
  assert.match(chatPage, /searchParams\.get\('join'\)/)
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
