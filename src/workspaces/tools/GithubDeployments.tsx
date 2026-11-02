import { Rocket } from 'lucide-react'
import { Badge, EmptyState, ErrorState, SkeletonRows, Surface } from '../../components/ui'
import { githubDeployments, type DeployState, type DeploymentItem, type ProductionSummary } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import { ago } from './githubHooks'

const STATE_LABEL: Record<DeployState, string> = { READY: 'Ready', ERROR: 'Failed', BUILDING: 'Building', QUEUED: 'Queued', INITIALIZING: 'Starting', CANCELED: 'Canceled', UNKNOWN: 'Unknown' }
const stateTone = (s: DeployState): 'success' | 'danger' | 'warning' | 'neutral' => (s === 'READY' ? 'success' : s === 'ERROR' ? 'danger' : s === 'BUILDING' || s === 'QUEUED' || s === 'INITIALIZING' ? 'warning' : 'neutral')

const HEADLINE: Record<ProductionSummary['status'], { tone: 'success' | 'danger' | 'warning' | 'neutral'; text: string }> = {
  live: { tone: 'success', text: 'The latest production deployment finished successfully' },
  failed: { tone: 'danger', text: 'The latest production deployment failed' },
  building: { tone: 'warning', text: 'A production deployment is in progress' },
  canceled: { tone: 'neutral', text: 'The latest production deployment was canceled' },
  unknown: { tone: 'neutral', text: 'The latest production deployment has a status this screen does not recognise' },
  none: { tone: 'neutral', text: 'No production deployment was found' },
}

function Line({ d }: { d: DeploymentItem }) {
  return (
    <>
      <strong>{d.message ?? 'Deployment'}</strong>
      <span className="ctf-denv__muted">{[d.branch, d.sha, d.author, d.created_at ? ago(d.created_at) : null].filter(Boolean).join(' · ')}</span>
    </>
  )
}

/** Read-only deployment status from Vercel for a linked repository. Nothing here can deploy, roll back or change anything. */
export function DeploymentsView({ repo }: { repo: string }) {
  const d = useAsyncData(`gh-deploys:${repo}`, async () => { const r = await githubDeployments(repo); return { data: r.data, error: r.error } })
  if (d.loading) return <SkeletonRows rows={3} />
  if (d.error) return <ErrorState title="Deployments couldn't load" description={d.errorDetail?.message ?? 'Try again.'} onRetry={d.reload} />
  const r = d.data
  if (!r) return null
  if (r.status === 'not_mapped') return <EmptyState icon={Rocket} title="Deployments aren't connected for this repository" description="The Main Admin can connect a Vercel project to this repository in Admin, Integrations." />
  if (r.status === 'not_configured') return <EmptyState icon={Rocket} title="Vercel isn't set up on the server yet" description="The Main Admin needs to add the VERCEL_TOKEN secret before deployment status can be shown." />
  const head = HEADLINE[r.production.status]
  const open = (u: string | null, label: string) => (u ? <a className="ctf-gh__open" href={u} target="_blank" rel="noopener noreferrer">{label}</a> : null)
  return (
    <div className="ctf-denv__stack">
      <Surface>
        <p className="ctf-gh__badges"><Badge tone={head.tone}>Production</Badge></p>
        <strong>{head.text}</strong>
        {r.production.latest && <p className="ctf-denv__muted">{[r.production.latest.message, r.production.latest.sha, r.production.latest.created_at ? ago(r.production.latest.created_at) : null].filter(Boolean).join(' · ')}</p>}
        {r.production.status === 'failed' && r.production.last_ready && <p className="ctf-denv__muted">The last good production deployment was {r.production.last_ready.created_at ? ago(r.production.last_ready.created_at) : 'earlier'}{r.production.last_ready.sha ? ` (${r.production.last_ready.sha})` : ''}. Visitors are probably still seeing that one.</p>}
        <p className="ctf-denv__muted">This shows what Vercel reports. It does not check that the website itself is answering.</p>
        {open(r.production.latest?.url ?? null, 'Open this deployment')}
      </Surface>
      {r.deployments.length === 0 ? <EmptyState icon={Rocket} title="No deployments yet" description="Vercel has not deployed this project." /> : (
        <ul className="ctf-rec__list">
          {r.deployments.map((x) => (
            <li key={x.id} className="ctf-rec__row">
              <div className="ctf-rec__main"><Line d={x} /></div>
              <span className="ctf-gh__badges"><Badge tone="neutral">{x.target === 'production' ? 'Production' : 'Preview'}</Badge><Badge tone={stateTone(x.state)}>{STATE_LABEL[x.state]}</Badge></span>
              {open(x.url, 'Open')}{!x.url && open(x.inspector_url, 'Details')}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
