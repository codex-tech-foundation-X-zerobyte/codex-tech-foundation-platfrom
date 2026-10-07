import { useMemo, useState } from 'react'
import { CheckSquare } from 'lucide-react'
import { EmptyState, ErrorState, SectionHeading, Select, SkeletonRows, StatusBadge, Table } from '../../components/ui'
import { listTasks, updateTaskStatus } from '../../lib/services'
import { supabase } from '../../lib/supabase'
import { useAsyncData } from '../../hooks/useAsyncData'
import type { TaskStatus } from '../../lib/types'

const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'blocked', 'done']

async function fetchTasksWithProjectNames() {
  const { data: tasks, error } = await listTasks()
  if (error) return { data: [], error }
  const projectIds = [...new Set(tasks.map((t) => t.project_id))]
  const { data: projects } = projectIds.length
    ? await supabase.from('projects').select('id, name').in('id', projectIds)
    : { data: [] }
  const nameById = new Map((projects ?? []).map((p) => [p.id, p.name]))
  return { data: tasks.map((t) => ({ ...t, projectName: nameById.get(t.project_id) ?? 'Unknown project' })), error: null }
}

export function AdminTasks() {
  const { data: tasks, error, loading, reload } = useAsyncData('once', fetchTasksWithProjectNames)
  const [filter, setFilter] = useState('all')

  const filtered = useMemo(() => (tasks ?? []).filter((t) => filter === 'all' || t.status === filter), [tasks, filter])

  const changeStatus = async (id: string, status: TaskStatus) => {
    await updateTaskStatus(id, status)
    reload()
  }

  if (error) return <ErrorState onRetry={reload} />

  return (
    <div>
      <SectionHeading eyebrow="Operations" title="Tasks" description="Across every project you have access to." />
      <div style={{ marginBottom: 20 }}>
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 200 }}>
          <option value="all">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </Select>
      </div>
      {loading && <SkeletonRows rows={5} />}
      {!loading && (
        <Table
          rows={filtered}
          rowKey={(t) => t.id}
          emptyState={<EmptyState icon={CheckSquare} title="No tasks yet" description="Tasks created across projects will appear here." />}
          columns={[
            { key: 'title', header: 'Task', render: (t) => <strong>{t.title}</strong> },
            { key: 'project', header: 'Project', render: (t) => t.projectName },
            { key: 'priority', header: 'Priority', render: (t) => t.priority },
            { key: 'due', header: 'Due', render: (t) => t.due_date ?? '—' },
            { key: 'status', header: 'Status', render: (t) => <StatusBadge status={t.status} /> },
            {
              key: 'actions',
              header: 'Update',
              render: (t) => (
                <Select value={t.status} onChange={(e) => void changeStatus(t.id, e.target.value as TaskStatus)}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </Select>
              ),
            },
          ]}
        />
      )}
    </div>
  )
}
