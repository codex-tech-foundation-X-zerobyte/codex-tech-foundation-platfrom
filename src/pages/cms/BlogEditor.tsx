import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Bold, Heading2, Link2, List, Quote } from 'lucide-react'
import { Button, ErrorState, FieldWrap, Input, SkeletonRows, Textarea, useToast } from '../../components/ui'
import { createBlogPost, getBlogPostById, updateBlogPost } from '../../lib/services'
import type { BlogPost } from '../../lib/types'
import './BlogEditor.css'

function slugify(title: string) {
  return title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

const TOOLBAR: { icon: typeof Bold; label: string; wrap: [string, string] }[] = [
  { icon: Bold, label: 'Bold', wrap: ['**', '**'] },
  { icon: Heading2, label: 'Heading', wrap: ['## ', ''] },
  { icon: List, label: 'List item', wrap: ['- ', ''] },
  { icon: Quote, label: 'Quote', wrap: ['> ', ''] },
  { icon: Link2, label: 'Link', wrap: ['[', '](https://)'] },
]

export function BlogEditor({ basePath }: { basePath: string }) {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()
  const { push } = useToast()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [loaded, setLoaded] = useState(isNew)
  const [notFound, setNotFound] = useState(false)
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [excerpt, setExcerpt] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [existing, setExisting] = useState<BlogPost | null>(null)

  useEffect(() => {
    if (isNew) return
    void getBlogPostById(id!).then(({ data }) => {
      if (!data) { setNotFound(true); setLoaded(true); return }
      setExisting(data)
      setTitle(data.title)
      setSlug(data.slug)
      setExcerpt(data.excerpt)
      setBody(data.body)
      setSlugTouched(true)
      setLoaded(true)
    })
  }, [id, isNew])

  const applyFormat = (wrap: [string, string]) => {
    const el = textareaRef.current
    if (!el) return
    const [start, end] = [el.selectionStart, el.selectionEnd]
    const selected = body.slice(start, end)
    const next = body.slice(0, start) + wrap[0] + selected + wrap[1] + body.slice(end)
    setBody(next)
    requestAnimationFrame(() => el.focus())
  }

  const save = async () => {
    setSaving(true)
    const draft = { title, slug: slug || slugify(title), excerpt, body }
    const { error } = isNew ? await createBlogPost(draft) : await updateBlogPost(id!, draft)
    setSaving(false)
    if (error) { push('Could not save this post.', 'error'); return }
    push('Saved')
    navigate(basePath)
  }

  if (!loaded) return <SkeletonRows rows={4} height="60px" />
  if (notFound) return <ErrorState title="Post not found" />

  return (
    <div className="ctf-blog-editor">
      <div className="ctf-blog-editor__head">
        <FieldWrap label="Title" htmlFor="be-title" required>
          <Input
            id="be-title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              if (!slugTouched) setSlug(slugify(e.target.value))
            }}
          />
        </FieldWrap>
        <FieldWrap label="Slug" htmlFor="be-slug" hint="Used in the article URL">
          <Input id="be-slug" value={slug} onChange={(e) => { setSlug(e.target.value); setSlugTouched(true) }} />
        </FieldWrap>
      </div>

      <FieldWrap label="Excerpt" htmlFor="be-excerpt" hint="Shown on the blog list and as the social preview description">
        <Textarea id="be-excerpt" rows={2} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} />
      </FieldWrap>

      <div>
        <div className="ctf-blog-editor__toolbar">
          {TOOLBAR.map(({ icon: Icon, label, wrap }) => (
            <button key={label} type="button" aria-label={label} onClick={() => applyFormat(wrap)}><Icon size={15} /></button>
          ))}
        </div>
        <Textarea ref={textareaRef} rows={16} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write the article. Leave a blank line between paragraphs." />
      </div>

      <div className="ctf-blog-editor__actions">
        <Button variant="secondary" onClick={() => navigate(basePath)}>Cancel</Button>
        <Button variant="primary" loading={saving} onClick={save} disabled={!title.trim() || !body.trim()}>
          {existing ? 'Save changes' : 'Create post'}
        </Button>
      </div>
    </div>
  )
}
