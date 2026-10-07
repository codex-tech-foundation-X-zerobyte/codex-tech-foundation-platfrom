import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import { CheckCircle2, GripVertical } from 'lucide-react'
import { EmptyState, ErrorState, Select, SearchInput, SkeletonRows, useToast } from '../../components/ui'
import { listTasks, updateTaskStatus } from '../../lib/services'
import type { Task, TaskStatus } from '../../lib/types'
import './WorkerTasks.css'

const COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: 'todo', label: 'To do' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'done', label: 'Completed' },
]

export function WorkerTasks() {
  const { push } = useToast()
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [overColumn, setOverColumn] = useState<TaskStatus | null>(null)

  const load = useCallback(() => {
    void listTasks()
      .then((r) => { if (r.error) setFailed(true); else { setFailed(false); setTasks(r.data) } })
      .catch(() => setFailed(true))
  }, [])
  useEffect(() => { load() }, [load])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (tasks ?? []).filter((t) => !q || t.title.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q))
  }, [tasks, query])

  const move = async (id: string, status: TaskStatus) => {
    const before = tasks?.find((t) => t.id === id)
    if (!before || before.status === status) return
    setTasks((prev) => prev?.map((t) => (t.id === id ? { ...t, status } : t)) ?? prev) // optimistic
    const { error } = await updateTaskStatus(id, status)
    if (error) {
      // Roll back: leaving the card in the new column would show a status the database never accepted.
      setTasks((prev) => prev?.map((t) => (t.id === id ? { ...t, status: before.status } : t)) ?? prev)
      push(error.message || 'Could not move that task.', 'error')
    }
  }

  const onDrop = (e: DragEvent, status: TaskStatus) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain') || dragId
    setOverColumn(null)
    setDragId(null)
    if (id) void move(id, status)
  }

  if (failed) return <ErrorState title="Tasks didn't load" description="Check your connection and try again." onRetry={load} />
  if (tasks === null) return <SkeletonRows rows={4} height="80px" />
  if (tasks.length === 0) {
    return <EmptyState icon={CheckCircle2} title="No tasks yet" description="Tasks assigned to you across your projects will appear here." />
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}><SearchInput value={query} onChange={setQuery} placeholder="Filter tasks…" /></div>
      <div className="ctf-task-board">
        {COLUMNS.map((col) => {
          const items = visible.filter((t) => t.status === col.id)
          return (
            <section
              className={`ctf-task-column ${overColumn === col.id ? 'is-over' : ''}`}
              key={col.id}
              aria-label={col.label}
              onDragOver={(e) => { if (dragId) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOverColumn(col.id) } }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverColumn((c) => (c === col.id ? null : c)) }}
              onDrop={(e) => onDrop(e, col.id)}
            >
              <div className="ctf-task-column__head">
                <span>{col.label}</span>
                <span className="ctf-task-column__count">{items.length}</span>
              </div>
              <div className="ctf-task-column__list">
                {items.map((task) => (
                  <div
                    className={`ctf-task-card ${dragId === task.id ? 'is-dragging' : ''}`}
                    key={task.id}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', task.id); e.dataTransfer.effectAllowed = 'move'; setDragId(task.id) }}
                    onDragEnd={() => { setDragId(null); setOverColumn(null) }}
                  >
                    <div className="ctf-task-card__title">
                      <GripVertical size={14} aria-hidden="true" />
                      <strong>{task.title}</strong>
                    </div>
                    {task.description && <p>{task.description}</p>}
                    <div className="ctf-task-card__foot">
                      <span className={`ctf-task-priority ctf-task-priority--${task.priority}`}>{task.priority}</span>
                      <Select value={task.status} onChange={(e) => void move(task.id, e.target.value as TaskStatus)} aria-label={`Move ${task.title}`}>
                        {COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </Select>
                    </div>
                  </div>
                ))}
                {items.length === 0 && <div className="ctf-task-column__empty">{dragId ? 'Drop here' : 'Nothing here'}</div>}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
