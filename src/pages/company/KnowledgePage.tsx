import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { BookOpen, Plus, Search } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, FieldWrap, Input, Modal, Select, SkeletonRows, Surface, Textarea, useToast } from '../../components/ui'
import { Markdown } from '../../components/Markdown'
import { KB_CATEGORIES, deleteKnowledge, getMyDepartments, listKnowledge, listDepartmentSummaries, saveKnowledge, type KbCategory, type KnowledgeDoc, type MyDepartment } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useAuth } from '../../lib/auth'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { departmentBySlug } from '../../workspaces/definitions'
import './CompanyHQ.css'
import '../../workspaces/DepartmentEnvironment.css'

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

/** The company's memory: policies, runbooks, standards and how-tos, searchable, by category and department. */
export function KnowledgePage() {
  useDocumentTitle('Knowledge base')
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const depts = useAsyncData('kb-depts', listDepartmentSummaries)
  const mine = useAsyncData(`kb-mine:${profile?.id}`, () => (profile && profile.role !== 'superadmin' ? getMyDepartments(profile.id) : Promise.resolve({ data: [] as MyDepartment[], error: null })))
  const [typed, setTyped] = useState(params.get('q') ?? '')
  const [q, setQ] = useState(typed)
  const [editing, setEditing] = useState<KnowledgeDoc | 'new' | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const { push } = useToast()

  useEffect(() => { const t = setTimeout(() => setQ(typed), 300); return () => clearTimeout(t) }, [typed])

  const category = params.get('category') ?? ''
  const slug = params.get('department') ?? ''
  const rows = depts.data?.departments ?? []
  const scope = slug === 'company' ? null : rows.find((d) => d.slug === slug)?.id
  const docs = useAsyncData(`kb:${category}:${slug}:${q}:${scope}`, () => listKnowledge({ category: category || undefined, q, departmentId: slug ? (scope ?? (slug === 'company' ? null : undefined)) : undefined }))

  const isMainAdmin = profile?.role === 'superadmin'
  const adminDeptIds = (mine.data ?? []).filter((m) => m.role === 'admin').map((m) => m.department.id)
  const isDeptAdmin = adminDeptIds.length > 0
  const canWrite = isMainAdmin || isDeptAdmin
  const canEdit = (d: KnowledgeDoc) => isMainAdmin || (!!d.department_id && adminDeptIds.includes(d.department_id))
  const set = (key: string, value: string) => setParams((p) => { const n = new URLSearchParams(p); if (value) n.set(key, value); else n.delete(key); return n }, { replace: true })
  const deptName = (id: string | null) => (id ? rows.find((d) => d.id === id)?.name ?? 'Department' : 'Company-wide')
  const current = (docs.data ?? []).find((d) => d.id === open) ?? null

  const remove = async (d: KnowledgeDoc) => {
    const { error } = await deleteKnowledge(d.id)
    if (error) push(error.message, 'error'); else { push('Document deleted.'); setOpen(null); docs.reload() }
  }

  return (
    <div className="ctf-denv__stack">
      <div className="ctf-kb__filters">
        <div className="ctf-kb__search"><Search size={15} aria-hidden="true" /><Input aria-label="Search the knowledge base" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search titles and text" autoComplete="off" /></div>
        <Select aria-label="Category" value={category} onChange={(e) => set('category', e.target.value)}><option value="">All categories</option>{KB_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select>
        <Select aria-label="Scope" value={slug} onChange={(e) => set('department', e.target.value)}><option value="">Everything I can see</option><option value="company">Company-wide</option>{rows.filter((d) => d.slug).map((d) => <option key={d.id} value={d.slug as string}>{d.name}</option>)}</Select>
        {canWrite && <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setEditing('new')}>New document</Button>}
      </div>

      {docs.loading ? <SkeletonRows rows={4} height="60px" /> : docs.error ? <ErrorState title="The knowledge base couldn't load" description={docs.errorDetail?.message ?? 'Try again.'} onRetry={docs.reload} /> : (docs.data ?? []).length === 0 ? (
        <EmptyState icon={BookOpen} title={q || category || slug ? 'No documents match' : 'No documents yet'} description={q || category || slug ? 'Try a different search or filter.' : canWrite ? 'Write the first document: a policy, a runbook, a standard.' : 'Documents your Department Admins and the Main Admin publish will appear here.'} action={canWrite && !q && !category && !slug ? <Button size="sm" variant="primary" onClick={() => setEditing('new')}>New document</Button> : undefined} />
      ) : (
        <div className="ctf-kb__layout">
          <ul className="ctf-kb__list" aria-label="Documents">
            {(docs.data ?? []).map((d) => (
              <li key={d.id}>
                <button type="button" aria-pressed={open === d.id} className={open === d.id ? 'is-on' : ''} onClick={() => setOpen(d.id)}>
                  <strong>{d.title}</strong>
                  <span><Badge tone="neutral">{d.category}</Badge> <Badge tone={d.department_id ? 'accent' : 'neutral'}>{deptName(d.department_id)}</Badge></span>
                  <small>{d.author_name} · {day(d.updated_at)}</small>
                </button>
              </li>
            ))}
          </ul>
          <Surface className="ctf-kb__doc">
            {current ? (
              <article>
                <header><h2>{current.title}</h2>{canEdit(current) && <div className="ctf-denv__actions"><Button size="sm" variant="secondary" onClick={() => setEditing(current)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => void remove(current)}>Delete</Button></div>}</header>
                <p className="ctf-denv__muted">{current.category} · {deptName(current.department_id)} · updated {day(current.updated_at)} by {current.author_name}</p>
                {current.body.trim() ? <Markdown source={current.body} /> : <p className="ctf-denv__muted">This document is empty.</p>}
              </article>
            ) : <EmptyState icon={BookOpen} title="Pick a document" description="Choose one on the left to read it here." />}
          </Surface>
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' || !editing ? 'New document' : 'Edit document'} size="lg">
        {editing && <DocForm key={editing === 'new' ? 'new' : editing.id} doc={editing === 'new' ? null : editing} isMainAdmin={isMainAdmin} ownDepartmentIds={adminDeptIds} departments={rows.filter((d) => d.slug).map((d) => ({ id: d.id, name: d.name, slug: d.slug as string }))} defaultCategory={(category as KbCategory) || undefined}
          onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); docs.reload() }} />}
      </Modal>
    </div>
  )
}

function DocForm({ doc, isMainAdmin, ownDepartmentIds, departments, defaultCategory, onCancel, onSaved }: { doc: KnowledgeDoc | null; isMainAdmin: boolean; ownDepartmentIds: string[]; departments: { id: string; name: string; slug: string }[]; defaultCategory?: KbCategory; onCancel: () => void; onSaved: () => void }) {
  const { push } = useToast()
  const [title, setTitle] = useState(doc?.title ?? '')
  const [category, setCategory] = useState<KbCategory>(doc?.category ?? defaultCategory ?? 'Company')
  const [scope, setScope] = useState(doc ? doc.department_id ?? '' : isMainAdmin ? '' : ownDepartmentIds[0] ?? '')
  const [body, setBody] = useState(doc?.body ?? '')
  const [preview, setPreview] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    setSaving(true); setError('')
    const { error: err } = await saveKnowledge({ id: doc?.id, title, category, department_id: scope || null, body })
    setSaving(false)
    if (err) { setError(err.message); return }
    push(doc ? 'Document saved.' : 'Document published.'); onSaved()
  }
  const hint = departmentBySlug(departments.find((d) => d.id === scope)?.slug)?.name
  return (
    <form className="ctf-form" onSubmit={(e) => void submit(e)}>
      <FieldWrap label="Title" htmlFor="kb-title" required><Input id="kb-title" autoFocus maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" /></FieldWrap>
      <div className="ctf-form-row">
        <FieldWrap label="Category" htmlFor="kb-cat"><Select id="kb-cat" value={category} onChange={(e) => setCategory(e.target.value as KbCategory)}>{KB_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></FieldWrap>
        <FieldWrap label="Who can read it" htmlFor="kb-scope" hint={hint ? `Only ${hint} (and Main Admins).` : 'Everyone in the company.'}>
          <Select id="kb-scope" value={scope} disabled={!isMainAdmin && ownDepartmentIds.length < 2} onChange={(e) => setScope(e.target.value)}>{isMainAdmin && <option value="">Whole company</option>}{departments.filter((d) => isMainAdmin || ownDepartmentIds.includes(d.id)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
        </FieldWrap>
      </div>
      <div className="ctf-kb__tabs"><button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>Write</button><button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>Preview</button></div>
      {preview ? <Surface>{body.trim() ? <Markdown source={body} /> : <p className="ctf-denv__muted">Nothing to preview.</p>}</Surface>
        : <FieldWrap label="Content" htmlFor="kb-body" hint="Markdown: # headings, **bold**, lists, `code` and links."><Textarea id="kb-body" rows={14} maxLength={60000} value={body} onChange={(e) => setBody(e.target.value)} /></FieldWrap>}
      {error && <p className="ctf-form-error" role="alert">{error}</p>}
      <div className="ctf-form__actions"><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button type="submit" variant="primary" loading={saving} disabled={!title.trim()}>{doc ? 'Save' : 'Publish'}</Button></div>
    </form>
  )
}
