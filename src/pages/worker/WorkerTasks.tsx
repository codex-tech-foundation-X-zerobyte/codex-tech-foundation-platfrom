import { useEffect, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { EmptyState, Select } from '../../components/ui'
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
  const [tasks, setTasks] = useState<Task[] | null>(null)

  const load = () => void listTasks().then((r) => setTasks(r.data))
  useEffect(load, [])

  const move = async (id: string, status: TaskStatus) => {
    setTasks((prev) => prev?.map((t) => (t.id === id ? { ...t, status } : t)) ?? prev)
    await updateTaskStatus(id, status)
  }

  if (tasks === null) return null
  if (tasks.length === 0) {
    return <EmptyState icon={CheckCircle2} title="No tasks yet" description="Tasks assigned to you across your projects will appear here." />
  }

  return (
    <div className="ctf-task-board">
      {COLUMNS.map((col) => (
        <div className="ctf-task-column" key={col.id}>
          <div className="ctf-task-column__head">
            <span>{col.label}</span>
            <span className="ctf-task-column__count">{tasks.filter((t) => t.status === col.id).length}</span>
          </div>
          <div className="ctf-task-column__list">
            {tasks.filter((t) => t.status === col.id).map((task) => (
              <div className="ctf-task-card" key={task.id}>
                <strong>{task.title}</strong>
                {task.description && <p>{task.description}</p>}
                <div className="ctf-task-card__foot">
                  <span className={`ctf-task-priority ctf-task-priority--${task.priority}`}>{task.priority}</span>
                  <Select value={task.status} onChange={(e) => void move(task.id, e.target.value as TaskStatus)} aria-label={`Move ${task.title}`}>
                    {COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </Select>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
