import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Briefcase, ExternalLink, Mail } from 'lucide-react'
import { Badge, EmptyState, ErrorState, Modal, SearchInput, StatusBadge, Table } from '../../components/ui'
import { listClients, listMyProjects } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useAuth } from '../../lib/auth'
import type { Client, Project } from '../../lib/types'
import './WorkerClients.css'

interface Row extends Client { projects: Project[] }

/** Client directory: who we work for, and which projects are linked to them. Read-only for workers. */
export function WorkerClients() {
  const { profile } = useAuth()
  const base = profile?.role === 'superadmin' || profile?.role === 'manager' ? '/admin' : '/worker'
  const clients = useAsyncData('clients', listClients)
  const projects = useAsyncData('projects', listMyProjects)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Row | null>(null)

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase()
    return (clients.data ?? [])
      .map((c) => ({ ...c, projects: (projects.data ?? []).filter((p) => p.client_account_id === c.id) }))
      .filter((c) => !q || c.organization.toLowerCase().includes(q) || (c.contact_name ?? '').toLowerCase().includes(q) || (c.contact_email ?? '').toLowerCase().includes(q))
  }, [clients.data, projects.data, query])

  if (clients.error || projects.error) {
    return <ErrorState title="Clients didn't load" description="We couldn't load the client list. Check your connection and try again." onRetry={() => { clients.reload(); projects.reload() }} />
  }

  return (
    <div>
      <div className="ctf-clients__toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Search clients…" />
        <span className="ctf-muted">{clients.data ? `${rows.length} of ${clients.data.length} client${clients.data.length === 1 ? '' : 's'}` : ''}</span>
      </div>
      <Table
        caption="Clients"
        loading={clients.loading || projects.loading}
        rows={rows}
        rowKey={(c) => c.id}
        onRowClick={setSelected}
        emptyState={<EmptyState icon={Briefcase} title={query ? 'No clients match your search' : 'No clients yet'} description={query ? 'Try a different name or email.' : 'Clients are added by an administrator. Once they are, they will be listed here along with their projects.'} />}
        columns={[
          { key: 'org', header: 'Client', render: (c) => <div className="ctf-clients__name"><strong>{c.organization}</strong><span>{c.contact_name ?? '—'}</span></div> },
          { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
          { key: 'projects', header: 'Projects', render: (c) => (c.projects.length === 0 ? <span className="ctf-muted">None yet</span> : <Badge tone="accent">{c.projects.length} project{c.projects.length === 1 ? '' : 's'}</Badge>) },
          { key: 'since', header: 'Client since', render: (c) => new Date(c.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) },
        ]}
      />

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.organization ?? ''} description={selected?.contact_name ?? undefined}>
        {selected && (
          <>
            <div className="ctf-clients__detail">
              <div><span>Status</span><StatusBadge status={selected.status} /></div>
              <div><span>Contact</span>{selected.contact_email ? <a href={`mailto:${selected.contact_email}`}><Mail size={13} /> {selected.contact_email}</a> : <em>Not provided</em>}</div>
            </div>
            <h4 className="ctf-clients__sub">Projects ({selected.projects.length})</h4>
            {selected.projects.length === 0 ? (
              <p className="ctf-muted">No projects are linked to this client yet.</p>
            ) : (
              <ul className="ctf-clients__projects">
                {selected.projects.map((p) => (
                  <li key={p.id}>
                    <Link to={`${base}/projects/${p.id}`} onClick={() => setSelected(null)}>
                      <span>{p.name}</span>
                      <StatusBadge status={p.status} />
                      <ExternalLink size={13} aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Modal>
    </div>
  )
}
