/*
  The GitHub setup guide, as data and pure logic (tested in tests/dom/githubSetupGuide.test.tsx). The screen is a thin layer over this.

  Principles: every step says WHY, exactly WHAT to do, and HOW YOU WILL KNOW it worked. Progress comes from the connection check's real
  findings, never from what the guide hopes is true; a step with no evidence is shown as "not checked", and the two steps that cannot be
  detected from here (deploying the functions before the webhook has ever worked, and scheduling the background job) are ticked by the
  person and are labelled that way. The guide never handles a secret: the only value it creates is a random webhook secret, in the browser,
  which is not stored or sent anywhere.
*/
import type { ConnectionReport } from './services'

export type StepState = 'done' | 'todo' | 'blocked' | 'unknown' | 'optional'
export type StepId = 'migrations' | 'deploy' | 'webhook-secret' | 'create-app' | 'secrets' | 'install' | 'select' | 'webhook-test' | 'link-repos' | 'schedule' | 'writes' | 'vercel'

export interface CopyValue { label: string; value: string; multiline?: boolean }
export interface SetupStep {
  id: StepId; title: string; required: boolean; why: string; actions: string[]; copy: CopyValue[]; proof: string
  /** True when nothing on the server can tell whether this was done, so the person ticks it themselves. */
  manual: boolean
}

export const MIGRATIONS = ['20261006000000_github_app_and_activity.sql', '20261007000000_github_write_access.sql', '20261008000000_deployment_targets.sql']
export const FUNCTION_COMMANDS = ['supabase functions deploy integrations', 'supabase functions deploy github-webhook --no-verify-jwt', 'supabase functions deploy workspace-sweep --no-verify-jwt']
export const APP_PERMISSIONS = ['Metadata: Read-only (GitHub sets this for you)', 'Contents: Read-only', 'Issues: Read-only (Read & write only if you want people to open issues from the Workspace)', 'Pull requests: Read-only (Read & write only if you want people to comment from the Workspace)', 'Actions: Read-only', 'Deployments: Read-only', 'Checks: Read-only']
export const APP_EVENTS = ['Push', 'Pull request', 'Pull request review', 'Issues', 'Workflow run', 'Deployment status']
export const SERVER_SECRETS = ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_WEBHOOK_SECRET']

export const webhookEndpoint = (ref: string | null) => `https://${ref ?? 'YOUR-PROJECT-REF'}.supabase.co/functions/v1/github-webhook`

/** 32 random bytes as 64 hex characters, made in the browser with the platform's secure random source. Not stored, not sent anywhere. */
export function makeWebhookSecret(cryptoImpl: Pick<Crypto, 'getRandomValues'> = globalThis.crypto): string {
  const bytes = new Uint8Array(32)
  cryptoImpl.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function buildSteps(ref: string | null): SetupStep[] {
  return [
    { id: 'migrations', title: 'Run the three database files', required: true, manual: false,
      why: 'They create the tables for GitHub installations, the activity feed, write permissions, the history of changes and deployments. Nothing works without them.',
      actions: ['Open your Supabase project and go to the SQL editor.', 'Paste each file\u2019s contents and run it, in this order. Running one twice is safe.'],
      copy: MIGRATIONS.map((m, i) => ({ label: `File ${i + 1} (in supabase/migrations/)`, value: m })),
      proof: 'The connection check shows \u201cDatabase migrations\u201d as OK.' },
    { id: 'deploy', title: 'Deploy the three functions', required: true, manual: true,
      why: 'The Workspace talks to GitHub through these. The webhook one must be deployed with the flag shown, because GitHub cannot send a Supabase login token: its signature check is what protects it.',
      actions: ['In a terminal in the project folder, with the Supabase CLI logged in and linked to your project, run each command.'],
      copy: FUNCTION_COMMANDS.map((c, i) => ({ label: ['Integrations (needs login)', 'Webhook receiver (public on purpose)', 'Background job (public on purpose)'][i], value: c })),
      proof: 'Ticks itself once GitHub has successfully delivered a webhook. Until then, tick it yourself when the commands finished without errors.' },
    { id: 'webhook-secret', title: 'Make a webhook secret', required: true, manual: false,
      why: 'GitHub signs every message it sends with a shared secret, so nobody else can fake one. You choose it once and give the SAME value to GitHub and to Supabase.',
      actions: ['Press \u201cMake a secret\u201d below and copy it somewhere safe for the next two steps.', 'It is made in your browser and is not saved or sent anywhere. It disappears when you leave this page.'],
      copy: [], proof: 'After the secrets step, the connection check shows GITHUB_WEBHOOK_SECRET as set.' },
    { id: 'create-app', title: 'Create the GitHub App', required: true, manual: false,
      why: 'The App is how the Workspace gets its own limited access to your repositories, instead of using one person\u2019s password-like token.',
      actions: ['On GitHub, go to Settings, then Developer settings, then GitHub Apps, then New GitHub App. If the repositories belong to an organisation, do it from the organisation\u2019s settings so the organisation owns the App. (GitHub moves menus around; these names are from memory.)',
        'Give it a name and set the Homepage URL to your Workspace address.',
        'Under Webhook: tick Active, paste the Webhook URL below, and paste the secret from the last step.',
        'Under Repository permissions, set the permissions listed below. Leave the user-authorization options as they are: the Workspace does not use them.',
        'Under Subscribe to events (it appears after permissions are saved), tick the events listed below.',
        'Set \u201cWhere can this GitHub App be installed\u201d to \u201cOnly on this account\u201d, then create it.',
        'On the App\u2019s page, note the App ID (a number), then generate a private key. GitHub downloads a .pem file once; keep it safe.'],
      copy: [{ label: 'Webhook URL', value: webhookEndpoint(ref) }, { label: 'Repository permissions to set', value: APP_PERMISSIONS.join('\n'), multiline: true }, { label: 'Events to tick', value: APP_EVENTS.join('\n'), multiline: true }],
      proof: 'After the secrets step, the connection check shows the App signing in, with its read permissions and events OK.' },
    { id: 'secrets', title: 'Give the three secrets to Supabase', required: true, manual: false,
      why: 'These let the server sign in as the App and verify GitHub\u2019s messages. They live only in Supabase\u2019s function secrets, never in the database or the browser.',
      actions: ['In Supabase, open Edge Functions, then Secrets, and add each one by its exact name.', 'GITHUB_APP_PRIVATE_KEY is the entire text of the .pem file, including the BEGIN and END lines.', 'GITHUB_WEBHOOK_SECRET is the same value you gave GitHub.', 'Never paste the private key into a chat, an email or the repository.'],
      copy: SERVER_SECRETS.map((s, i) => ({ label: ['The number from the App\u2019s page', 'The whole .pem text', 'The secret you made earlier'][i], value: s })),
      proof: 'The connection check shows all three as set, and the private key as readable.' },
    { id: 'install', title: 'Install the App on your organisation', required: true, manual: false,
      why: 'Creating the App is not enough: it can only see repositories you install it on. You choose which ones.',
      actions: ['On the App\u2019s page choose Install App, pick your organisation or account, and choose the repositories it may see (you can add more later).'],
      copy: [], proof: 'GitHub tells the Workspace, and the installation appears in the GitHub App section above.' },
    { id: 'select', title: 'Choose the installation in the Workspace', required: true, manual: false,
      why: 'You may have installed the App in more than one place. This tells the Workspace which one to use, and proves a real connection is possible before saving.',
      actions: ['In the GitHub App section above, press \u201cUse this installation\u201d.'],
      copy: [], proof: 'The connection check shows \u201cInstallation\u201d as OK and the card says it is connected through the GitHub App.' },
    { id: 'link-repos', title: 'Link repositories to departments', required: true, manual: false,
      why: 'The App may see many repositories, but a person only sees the ones you link to their department or project.',
      actions: ['In \u201cRepositories shown in the Workspace\u201d below, choose a repository and a department, and link it.'],
      copy: [], proof: 'The repository appears in the list below, and the right department sees it under Code & activity.' },
    { id: 'webhook-test', title: 'Confirm GitHub can reach you', required: true, manual: false,
      why: 'This is what makes the activity feed and failed-build alerts live. A wrong secret or URL only shows up here.',
      actions: ['Make a small change in a linked repository (or use Redeliver on the App\u2019s Advanced tab), then run the connection check. The change shows under Code & activity, Activity.'],
      copy: [], proof: 'The connection check shows \u201cWebhook deliveries\u201d as OK.' },
    { id: 'schedule', title: 'Schedule the background job', required: true, manual: true,
      why: 'It trims the GitHub history to 90 days and closes any change request that never got an answer. It also runs the monitoring and support checks. Without a schedule none of that happens.',
      actions: ['Set the secret WORKSPACE_SWEEP_SECRET (a long random value) in Supabase, then make a scheduler call the function every 1 to 2 minutes, as described in docs/workspace/UPDATE_CUSTOMER_SERVICE.md.'],
      copy: [{ label: 'Secret to set', value: 'WORKSPACE_SWEEP_SECRET' }, { label: 'Address to call (POST, with header x-sweep-secret)', value: `https://${ref ?? 'YOUR-PROJECT-REF'}.supabase.co/functions/v1/workspace-sweep` }],
      proof: 'Nothing here can detect it. Tick it when your scheduler is running.' },
    { id: 'writes', title: 'Optional: let people comment and open issues', required: false, manual: false,
      why: 'Off by default, deliberately. Viewing a repository never lets anyone change it.',
      actions: ['In the App\u2019s settings change Issues and Pull requests to Read & write, and have the organisation approve the change.', 'In \u201cRepositories shown in the Workspace\u201d below, set Comments and New issues for each repository to Admins only or Everyone who can see it.', 'Try the first one on a throwaway repository.'],
      copy: [], proof: 'The connection check shows \u201cApp permissions (write)\u201d as OK. Who may write is shown per repository below.' },
    { id: 'vercel', title: 'Optional: show deployments from Vercel', required: false, manual: false,
      why: 'Adds a Deployments tab showing whether production is healthy. Read-only.',
      actions: ['In Vercel, create an access token (Account Settings, Tokens). If your plan has a Viewer role, create it from an account with that role.', 'Add it in Supabase as the secret below.', 'In \u201cRepositories shown in the Workspace\u201d below, enter each repository\u2019s Vercel project name and press Connect deployments.'],
      copy: [{ label: 'Secret to set', value: 'VERCEL_TOKEN' }], proof: 'The connection check shows each Vercel project as OK.' },
  ]
}

export interface GuideContext { installationsCount: number | null; linkedCount: number | null }
export interface StepStatus { state: StepState; note: string }

/** Where each step stands, from the connection check's real findings. A missing report never produces "done". */
export function stepStatuses(steps: SetupStep[], report: ConnectionReport | null, ctx: GuideContext, ticks: ReadonlySet<string>): Record<StepId, StepStatus> {
  const f = (id: string) => report?.checks.find((c) => c.id === id)
  const s = (id: string) => f(id)?.status
  const out = {} as Record<StepId, StepStatus>
  const unknown = (note = 'Run the connection check to see this.'): StepStatus => ({ state: 'unknown', note })
  const fromCheck = (id: string, okNote: string): StepStatus => {
    const c = f(id)
    if (!report) return unknown()
    if (!c) return unknown('The check did not report on this.')
    return c.status === 'ok' ? { state: 'done', note: okNote } : c.status === 'skipped' ? { state: 'blocked', note: c.detail } : { state: 'todo', note: c.detail }
  }
  for (const step of steps) {
    let r: StepStatus
    switch (step.id) {
      case 'migrations': r = fromCheck('migrations', 'Every GitHub table is present.'); break
      case 'deploy': r = s('webhook') === 'ok' ? { state: 'done', note: 'GitHub has delivered to the webhook, so it is deployed.' } : ticks.has('deploy') ? { state: 'done', note: 'You marked this done.' } : { state: 'unknown', note: 'Tick it when the three commands finished without errors.' }; break
      case 'webhook-secret': r = !report ? unknown() : s('secret-webhook') === 'ok' ? { state: 'done', note: 'The server has a usable webhook secret.' } : { state: 'todo', note: f('secret-webhook')?.detail ?? 'Make a secret and set it as GITHUB_WEBHOOK_SECRET.' }; break
      case 'create-app': r = !report ? unknown() : s('app') === 'ok' ? (s('app-read') === 'ok' && s('app-events') !== 'warn' ? { state: 'done', note: f('app')?.detail ?? 'The App signs in.' } : { state: 'todo', note: [f('app-read'), f('app-events')].filter((c) => c && c.status !== 'ok').map((c) => c!.detail).join(' ') }) : s('app') === 'skipped' ? unknown('The App cannot be checked until the secrets are set.') : { state: 'todo', note: f('app')?.detail ?? 'The App did not sign in.' }; break
      case 'secrets': r = !report ? unknown() : ['secret-app-id', 'secret-key', 'secret-webhook'].every((id) => s(id) === 'ok') ? { state: 'done', note: 'All three are set and the key is readable.' } : { state: 'todo', note: ['secret-app-id', 'secret-key', 'secret-webhook'].map(f).filter((c) => c && c.status !== 'ok').map((c) => `${c!.label}: ${c!.detail}`).join(' ') }; break
      case 'install': r = ctx.installationsCount === null ? unknown('Checking for installations\u2026') : ctx.installationsCount > 0 ? { state: 'done', note: 'GitHub has reported an installation.' } : { state: 'todo', note: 'GitHub has not reported any installation yet. Install the App, and make sure the webhook works so GitHub can tell the Workspace.' }; break
      case 'select': r = ctx.installationsCount === 0 ? { state: 'blocked', note: 'Install the App first.' } : fromCheck('installation', 'The installation is in use.'); break
      case 'webhook-test': { const c = f('webhook'); r = !report ? unknown() : !c ? unknown('The check did not report on this.') : c.status === 'ok' ? { state: 'done', note: c.detail } : c.status === 'skipped' ? { state: 'blocked', note: c.detail } : { state: 'todo', note: c.detail }; break }
      case 'link-repos': r = ctx.linkedCount === null ? unknown('Checking\u2026') : ctx.linkedCount > 0 ? { state: 'done', note: `${ctx.linkedCount} repositor${ctx.linkedCount === 1 ? 'y is' : 'ies are'} linked.` } : { state: 'todo', note: 'No repository is linked yet, so nobody sees any code.' }; break
      case 'schedule': r = ticks.has('schedule') ? { state: 'done', note: 'You marked this done.' } : { state: 'unknown', note: 'Tick it when your scheduler is calling the function.' }; break
      case 'writes': r = s('app-write') === 'ok' ? { state: 'done', note: 'The App is allowed to write. Choose per repository who may.' } : { state: 'optional', note: 'Writing is switched off at GitHub. That is a fine choice.' }; break
      case 'vercel': { const v = report?.checks.filter((c) => c.group === 'vercel') ?? []; r = v.some((c) => c.status === 'fail') ? { state: 'todo', note: v.find((c) => c.status === 'fail')!.detail } : v.some((c) => c.status === 'ok') ? { state: 'done', note: 'Vercel answers for the connected projects.' } : { state: 'optional', note: 'Not set up. Only needed for the Deployments tab.' }; break }
    }
    out[step.id] = r
  }
  return out
}

/** Progress over the REQUIRED steps only, and which one to do next. */
export function progress(steps: SetupStep[], st: Record<StepId, StepStatus>) {
  const required = steps.filter((x) => x.required)
  const done = required.filter((x) => st[x.id].state === 'done').length
  const next = required.find((x) => st[x.id].state !== 'done') ?? null
  return { done, total: required.length, next: next?.id ?? null, complete: done === required.length }
}

const KEY = 'ctf.githubSetup.v1'
export function loadTicks(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): Set<string> {
  try { const v = JSON.parse(storage?.getItem(KEY) ?? '[]'); return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []) } catch { return new Set() }
}
export function saveTicks(ticks: ReadonlySet<string>, storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage) {
  try { storage?.setItem(KEY, JSON.stringify([...ticks])) } catch { /* private mode or full: the tick simply does not persist */ }
}
