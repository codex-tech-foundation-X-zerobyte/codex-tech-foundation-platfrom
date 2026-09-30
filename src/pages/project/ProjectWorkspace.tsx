import { useRef, useState } from 'react'
import { useParams } from 'react-router'
import { Download, FolderOpen, Plus, Trash2, Upload } from 'lucide-react'
import {
  Button, EmptyState, ErrorState, FieldWrap, Input, Modal, ProgressBar,
  Select, SkeletonRows, StatusBadge, Tabs, Textarea, useToast,
} from '../../components/ui'
import {
  createMilestone, createTask, deleteProjectFile, getProject, getProjectFileUrl,
  listProjectFiles, listProjectMilestones, listProjectUpdates, listTasks,
  publishProjectUpdate, updateMilestone, updateProjectStatus, updateTaskStatus,
  uploadProjectFile, type ProjectFile,
} from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import type { ProjectStatus, TaskStatus } from '../../lib/types'
import { RequestsTab } from './RequestsTab'
import './ProjectWorkspace.css'

const STATUSES: ProjectStatus[] = ['planning', 'in_development', 'active', 'maintenance', 'paused', 'completed', 'archived']
const TASK_COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: 'todo', label: 'To do' }, { id: 'in_progress', label: 'In progress' },
  { id: 'blocked', label: 'Blocked' }, { id: 'done', label: 'Done' },
]

export function ProjectWorkspace() {
  const { id } = useParams()
  const { data: project, error, loading, reload } = useAsyncData(id ?? '', () => getProject(id ?? ''))
  const [tab, setTab] = useState('overview')
  const { push } = useToast()

  if (error) return <ErrorState onRetry={reload} />
  if (loading) return <SkeletonRows rows={4} height="60px" />
  if (!project) return <ErrorState title="Project not found" />

  const changeStatus = async (status: ProjectStatus) => {
    const { error: err } = await updateProjectStatus(project.id, status)
    push(err ? 'Could not update status.' : 'Status updated', err ? 'error' : 'success')
    reload()
  }

  return (
    <div className="ctf-project-workspace">
      <div className="ctf-project-workspace__head">
        <div>
          <StatusBadge status={project.status} />
          <h1>{project.name}</h1>
          <p className="lead">{project.description}</p>
        </div>
        <Select value={project.status} onChange={(e) => void changeStatus(e.target.value as ProjectStatus)} style={{ width: 180 }}>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </Select>
      </div>

      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' }, { id: 'milestones', label: 'Milestones' },
          { id: 'tasks', label: 'Tasks' }, { id: 'updates', label: 'Updates' },
          { id: 'files', label: 'Files' }, { id: 'requests', label: 'Requests' },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="ctf-project-workspace__body">
        {tab === 'overview' && <OverviewTab projectId={project.id} dueDate={project.due_date} />}
        {tab === 'milestones' && <MilestonesTab projectId={project.id} />}
        {tab === 'tasks' && <TasksTab projectId={project.id} />}
        {tab === 'updates' && <UpdatesTab projectId={project.id} />}
        {tab === 'files' && <FilesTab projectId={project.id} />}
        {tab === 'requests' && <RequestsTab projectId={project.id} />}
      </div>
    </div>
  )
}

function OverviewTab({ projectId, dueDate }: { projectId: string; dueDate: string | null }) {
  const { data: milestones, loading } = useAsyncData(projectId, () => listProjectMilestones(projectId))
  if (loading) return <SkeletonRows rows={2} />
  const avg = milestones && milestones.length > 0 ? Math.round(milestones.reduce((s, m) => s + m.percentage, 0) / milestones.length) : null
  return (
    <div className="ctf-project-workspace__overview">
      {avg !== null && (
        <div className="ctf-project-workspace__stat">
          <span>Overall progress</span>
          <ProgressBar value={avg} />
        </div>
      )}
      <div className="ctf-project-workspace__stat">
        <span>Due date</span>
        <strong>{dueDate ?? 'Not set'}</strong>
      </div>
    </div>
  )
}

function MilestonesTab({ projectId }: { projectId: string }) {
  const { data: milestones, loading, reload } = useAsyncData(projectId, () => listProjectMilestones(projectId))
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [saving, setSaving] = useState(false)
  const { push } = useToast()

  const create = async () => {
    if (!title.trim()) return
    setSaving(true)
    const { error } = await createMilestone({ project_id: projectId, title: title.trim(), description: description.trim(), target_date: targetDate || null })
    setSaving(false)
    if (error) { push('Could not create milestone.', 'error'); return }
    setOpen(false); setTitle(''); setDescription(''); setTargetDate('')
    reload()
  }

  const setStatus = async (id: string, status: string) => {
    await updateMilestone(id, { status, percentage: status === 'complete' ? 100 : undefined })
    reload()
  }

  return (
    <div>
      <div className="ctf-project-workspace__tab-head">
        <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setOpen(true)}>Add milestone</Button>
      </div>
      {loading && <SkeletonRows rows={3} />}
      {!loading && milestones?.length === 0 && <EmptyState title="No milestones yet" description="Break the project down into milestones to track progress." />}
      <div className="ctf-project-workspace__list">
        {milestones?.map((m) => (
          <div key={m.id} className="ctf-project-workspace__row">
            <div>
              <strong>{m.title}</strong>
              {m.description && <p>{m.description}</p>}
              <ProgressBar value={m.percentage} />
            </div>
            <Select value={m.status} onChange={(e) => void setStatus(m.id, e.target.value)}>
              <option value="planned">Planned</option>
              <option value="in_progress">In progress</option>
              <option value="complete">Complete</option>
            </Select>
          </div>
        ))}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Add milestone">
        <FieldWrap label="Title" htmlFor="ms-title" required><Input id="ms-title" required value={title} onChange={(e) => setTitle(e.target.value)} /></FieldWrap>
        <FieldWrap label="Description" htmlFor="ms-desc"><Textarea id="ms-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></FieldWrap>
        <FieldWrap label="Target date" htmlFor="ms-date"><Input id="ms-date" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} /></FieldWrap>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={!title.trim()} onClick={create}>Add</Button>
        </div>
      </Modal>
    </div>
  )
}

function TasksTab({ projectId }: { projectId: string }) {
  const { data: tasks, loading, reload } = useAsyncData(projectId, () => listTasks({ projectId }))
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const { push } = useToast()

  const create = async () => {
    if (!title.trim()) return
    setSaving(true)
    const { error } = await createTask({ project_id: projectId, title: title.trim(), description: '', priority: 'normal', due_date: null, assignee_id: null })
    setSaving(false)
    if (error) { push('Could not create task.', 'error'); return }
    setOpen(false); setTitle('')
    reload()
  }

  const move = async (id: string, status: TaskStatus) => {
    await updateTaskStatus(id, status)
    reload()
  }

  if (loading) return <SkeletonRows rows={3} />

  return (
    <div>
      <div className="ctf-project-workspace__tab-head">
        <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setOpen(true)}>Add task</Button>
      </div>
      {tasks?.length === 0 && <EmptyState title="No tasks yet" description="Tasks for this project will appear here." />}
      <div className="ctf-project-workspace__task-board">
        {TASK_COLUMNS.map((col) => (
          <div key={col.id} className="ctf-project-workspace__task-col">
            <span>{col.label}</span>
            {tasks?.filter((t) => t.status === col.id).map((t) => (
              <div key={t.id} className="ctf-project-workspace__task-card">
                <strong>{t.title}</strong>
                <Select value={t.status} onChange={(e) => void move(t.id, e.target.value as TaskStatus)}>
                  {TASK_COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </Select>
              </div>
            ))}
          </div>
        ))}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Add task">
        <FieldWrap label="Title" htmlFor="tk-title" required><Input id="tk-title" required value={title} onChange={(e) => setTitle(e.target.value)} /></FieldWrap>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={!title.trim()} onClick={create}>Add</Button>
        </div>
      </Modal>
    </div>
  )
}

function UpdatesTab({ projectId }: { projectId: string }) {
  const { data: updates, loading, reload } = useAsyncData(projectId, () => listProjectUpdates(projectId))
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const { push } = useToast()

  const publish = async () => {
    if (!title.trim() || !body.trim()) return
    setSaving(true)
    const { error } = await publishProjectUpdate({ project_id: projectId, title: title.trim(), body: body.trim() })
    setSaving(false)
    if (error) { push('Could not publish update.', 'error'); return }
    setOpen(false); setTitle(''); setBody('')
    push('Update published')
    reload()
  }

  if (loading) return <SkeletonRows rows={3} />

  return (
    <div>
      <div className="ctf-project-workspace__tab-head">
        <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setOpen(true)}>Publish update</Button>
      </div>
      {updates?.length === 0 && <EmptyState title="No updates yet" description="Published updates will appear here and be visible to the client." />}
      <div className="ctf-project-workspace__list">
        {updates?.map((u) => (
          <div key={u.id} className="ctf-project-workspace__row">
            <div>
              <strong>{u.title}</strong>
              <p>{u.body}</p>
              <span className="ctf-project-workspace__meta">{new Date(u.created_at).toLocaleDateString()}</span>
            </div>
          </div>
        ))}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Publish update">
        <FieldWrap label="Title" htmlFor="up-title" required><Input id="up-title" required value={title} onChange={(e) => setTitle(e.target.value)} /></FieldWrap>
        <FieldWrap label="Details" htmlFor="up-body" required hint="Visible to the client immediately."><Textarea id="up-body" required rows={4} value={body} onChange={(e) => setBody(e.target.value)} /></FieldWrap>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={!title.trim() || !body.trim()} onClick={publish}>Publish</Button>
        </div>
      </Modal>
    </div>
  )
}

function FilesTab({ projectId }: { projectId: string }) {
  const { data: files, loading, reload } = useAsyncData(projectId, () => listProjectFiles(projectId))
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { push } = useToast()

  const upload = async (file: File) => {
    setUploading(true)
    const { error } = await uploadProjectFile(projectId, file)
    setUploading(false)
    if (error) { push('Upload failed.', 'error'); return }
    push('File uploaded')
    reload()
  }

  const download = async (f: ProjectFile) => {
    const { url, error } = await getProjectFileUrl(f.storage_path)
    if (error || !url) { push('Could not generate a download link.', 'error'); return }
    window.open(url, '_blank', 'noopener')
  }

  const remove = async (f: ProjectFile) => {
    const { error } = await deleteProjectFile(f.id, f.storage_path)
    push(error ? 'Could not delete that file.' : 'File deleted', error ? 'error' : 'success')
    reload()
  }

  if (loading) return <SkeletonRows rows={3} />

  return (
    <div>
      <div className="ctf-project-workspace__tab-head">
        <label className="ctf-project-workspace__upload">
          <Upload size={14} /> {uploading ? 'Uploading…' : 'Upload file'}
          <input ref={inputRef} type="file" style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        </label>
      </div>
      {files?.length === 0 && <EmptyState icon={FolderOpen} title="No files yet" description="Files shared for this project will appear here." />}
      <div className="ctf-project-workspace__list">
        {files?.map((f) => (
          <div key={f.id} className="ctf-project-workspace__row">
            <div><strong>{f.name}</strong><span className="ctf-project-workspace__meta">{new Date(f.created_at).toLocaleDateString()}</span></div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="ghost" size="sm" icon={<Download size={14} />} onClick={() => void download(f)}>Download</Button>
              <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => void remove(f)}>Delete</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
