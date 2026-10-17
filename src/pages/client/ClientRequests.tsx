import { useMemo, useState } from 'react'
import { Inbox, LifeBuoy, Plus } from 'lucide-react'
import { Button, EmptyState, ErrorState, SkeletonRows, Stat, Tabs } from '../../components/ui'
import { listMyClientProjects, listProjectRequests } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import type { ProjectRequest, RequestKind } from '../../lib/types'
import { NewRequestModal, RequestCard } from './requestUi'
import './requestUi.css'

const CONFIG = {
  requests: {
    kinds: ['request', 'change'] as RequestKind[],
    icon: Inbox,
    cta: 'New request',
    modalTitle: 'New request',
    modalDescription: 'Ask for new work or a change to something already built.',
    emptyTitle: 'No requests yet',
    emptyBody: 'Need a change or something new? Send a request and it lands with the team straight away.',
  },
  maintenance: {
    kinds: ['bug', 'maintenance'] as RequestKind[],
    icon: LifeBuoy,
    cta: 'Report an issue',
    modalTitle: 'Report an issue',
    modalDescription: 'Something broken, slow or behaving oddly? Tell us and we will look into it.',
    emptyTitle: 'No issues reported',
    emptyBody: "Nothing has been reported. If something isn't working the way it should, let us know here.",
  },
}

/** One page component for both "Requests" and "Maintenance" — same data, filtered by kind. */
export function ClientRequests({ mode }: { mode: 'requests' | 'maintenance' }) {
  const cfg = CONFIG[mode]
  const projects = useAsyncData('projects', listMyClientProjects)
  const requests = useAsyncData('requests', () => listProjectRequests())
  const [tab, setTab] = useState<'open' | 'resolved' | 'all'>('open')
  const [creating, setCreating] = useState(false)

  const scoped = useMemo<ProjectRequest[]>(() => (requests.data ?? []).filter((r) => cfg.kinds.includes(r.kind ?? 'request')), [requests.data, cfg.kinds])
  const isOpen = (r: ProjectRequest) => r.status === 'open' || r.status === 'in_review'
  const counts = { open: scoped.filter(isOpen).length, resolved: scoped.filter((r) => !isOpen(r)).length, all: scoped.length }
  const shown = scoped.filter((r) => (tab === 'all' ? true : tab === 'open' ? isOpen(r) : !isOpen(r)))
  const nameOf = (id: string) => projects.data?.find((p) => p.id === id)?.name
  const inMaintenance = projects.data?.filter((p) => p.status === 'maintenance').length ?? 0

  if (projects.error || requests.error) {
    return <ErrorState title="This page didn't load" description="We couldn't load your requests. Check your connection and try again." onRetry={() => { projects.reload(); requests.reload() }} />
  }
  if (projects.loading || requests.loading) return <SkeletonRows rows={4} height="64px" />

  return (
    <div>
      <div className="ctf-req-toolbar">
        <Tabs
          label="Filter by status"
          active={tab}
          onChange={(id) => setTab(id as typeof tab)}
          tabs={[{ id: 'open', label: 'Open', count: counts.open }, { id: 'resolved', label: 'Resolved', count: counts.resolved }, { id: 'all', label: 'All', count: counts.all }]}
        />
        <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)}>{cfg.cta}</Button>
      </div>

      {mode === 'maintenance' && (
        <div className="ctf-req-stats">
          <Stat label="Open issues" value={String(counts.open)} />
          <Stat label="Resolved" value={String(counts.resolved)} />
          <Stat label="Projects in maintenance" value={String(inMaintenance)} />
        </div>
      )}

      {shown.length === 0 ? (
        <EmptyState
          icon={cfg.icon}
          title={tab === 'open' && counts.all > 0 ? 'Nothing open right now' : cfg.emptyTitle}
          description={tab === 'open' && counts.all > 0 ? 'Everything you have raised has been dealt with. Switch to “Resolved” to look back.' : cfg.emptyBody}
          action={<Button variant="secondary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>{cfg.cta}</Button>}
        />
      ) : (
        <div className="ctf-req-list">
          {shown.map((r) => <RequestCard key={r.id} request={r} projectName={projects.data && projects.data.length > 1 ? nameOf(r.project_id) : undefined} />)}
        </div>
      )}

      <NewRequestModal
        open={creating}
        onClose={() => setCreating(false)}
        projects={projects.data ?? []}
        kinds={cfg.kinds}
        title={cfg.modalTitle}
        description={cfg.modalDescription}
        onCreated={() => { requests.reload(); setTab('open') }}
      />
    </div>
  )
}
