import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ImagePlus, Lock, Unlock } from 'lucide-react'
import { Markdown } from '../../../components/Markdown'
import { clampIndex, slideBlocks, splitSlides } from '../../../lib/presentation'
import { presentationFileUrl, uploadPresentationFile } from '../../../lib/services'
import { validatePresentationFile } from '../../../lib/presentation'
import type { StageProps } from './types'

/** An image on a slide: an https address, or a file the presenter uploaded to this session (`file:<path>`). */
function SlideImage({ src, alt }: { src: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(src.startsWith('file:') ? null : /^https:\/\//i.test(src) ? src : '')
  useEffect(() => {
    if (!src.startsWith('file:')) return
    let alive = true
    void presentationFileUrl(src.slice(5)).then((r) => { if (alive) setUrl(r.url ?? '') })
    return () => { alive = false }
  }, [src])
  if (url === null) return <div className="ctf-slide__img ctf-slide__img--loading" aria-hidden="true" />
  if (!url) return <p className="ctf-slide__missing">Image not available: {alt || src}</p>
  return <img className="ctf-slide__img" src={url} alt={alt} loading="lazy" />
}

/**
 * Slides written as plain text, separated by `---`. The presenter's slide number is synced; viewers follow it unless they choose to
 * look around on their own, and can jump back with one click.
 */
export function SlidesStage({ state, isPresenter, commit, sessionId }: StageProps) {
  const markdown = typeof state.markdown === 'string' ? state.markdown : ''
  const slides = useMemo(() => splitSlides(markdown), [markdown])
  const presenterIndex = clampIndex(Number(state.index ?? 0), slides.length)
  const [own, setOwn] = useState<number | null>(null)       // a viewer who has wandered off
  const [editing, setEditing] = useState(isPresenter && !markdown)
  const [draft, setDraft] = useState(markdown)
  const [uploadError, setUploadError] = useState('')
  const [uploading, setUploading] = useState(false)
  const insertImage = async (f: File | undefined) => {
    if (!f) return
    const bad = validatePresentationFile(f)
    if (bad || !f.type.startsWith('image/')) { setUploadError(bad ?? 'Choose an image file here (PNG, JPEG, WebP or GIF).'); return }
    setUploadError(''); setUploading(true)
    const { path, error } = await uploadPresentationFile(sessionId, f)
    setUploading(false)
    if (error || !path) { setUploadError(error?.message ?? 'Upload failed.'); return }
    setDraft((d) => `${d.replace(/\s*$/, '')}\n\n![${f.name.replace(/\.[^.]+$/, '')}](file:${path})\n`)
  }

  const index = isPresenter ? presenterIndex : own ?? presenterIndex
  const following = isPresenter || own === null
  const go = (i: number) => {
    const next = clampIndex(i, slides.length)
    if (isPresenter) commit({ ...state, index: next }, { immediate: true })
    else setOwn(next === presenterIndex ? null : next)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select')) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(index + 1) }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(index - 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (editing && isPresenter) {
    return (
      <div className="ctf-stage ctf-stage--slides">
        <div className="ctf-slides-edit">
          <label htmlFor="slides-src">Write your slides. Put <code>---</code> on its own line between slides. Use <code># Title</code>, lists, <strong>**bold**</strong>, links, and <code>![caption](https://…)</code> for images.</label>
          <textarea id="slides-src" value={draft} onChange={(e) => setDraft(e.target.value)} rows={16} spellCheck placeholder={'# Our launch plan\n\nThree things matter this quarter.\n\n---\n\n## 1. Ship the portal\n\n- Calls\n- Presentation board\n- Personal projects'} />
          {uploadError && <p className="ctf-stage__error" role="alert">{uploadError}</p>}
          <div className="ctf-slides-edit__actions">
            <input type="file" id="slide-image" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { void insertImage(e.target.files?.[0]); e.target.value = '' }} />
            <button type="button" className="ctf-btn-ghost" disabled={uploading} onClick={() => document.getElementById('slide-image')?.click()}><ImagePlus size={14} /> {uploading ? 'Uploading…' : 'Add image'}</button>
            {markdown && <button type="button" className="ctf-btn-ghost" onClick={() => { setDraft(markdown); setEditing(false) }}>Cancel</button>}
            <button type="button" className="ctf-btn-solid" disabled={!draft.trim()} onClick={() => { commit({ ...state, markdown: draft, index: 0 }, { immediate: true }); setEditing(false) }}>Present {splitSlides(draft).length} slide{splitSlides(draft).length === 1 ? '' : 's'}</button>
          </div>
        </div>
      </div>
    )
  }
  if (!markdown) return <div className="ctf-stage ctf-stage--slides"><div className="ctf-stage__empty"><strong>Nothing on stage yet</strong><span>The presenter has not added slides.</span></div></div>

  return (
    <div className="ctf-stage ctf-stage--slides">
      <div className="ctf-slide" key={index} aria-live="polite">
        {slideBlocks(slides[index]).map((b, i) => b.t === 'img' ? <SlideImage key={i} src={b.src} alt={b.alt} /> : <Markdown key={i} source={b.text} />)}
      </div>
      <div className="ctf-slidebar">
        <button type="button" className="ctf-bar__btn" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous slide"><ChevronLeft size={16} /></button>
        <span className="ctf-slidebar__count" aria-label={`Slide ${index + 1} of ${slides.length}`}>{index + 1} / {slides.length}</span>
        <button type="button" className="ctf-bar__btn" onClick={() => go(index + 1)} disabled={index >= slides.length - 1} aria-label="Next slide"><ChevronRight size={16} /></button>
        {!isPresenter && (
          following
            ? <span className="ctf-slidebar__follow"><Lock size={12} /> Following the presenter</span>
            : <button type="button" className="ctf-slidebar__follow is-off" onClick={() => setOwn(null)}><Unlock size={12} /> Browsing on your own. Back to presenter (slide {presenterIndex + 1})</button>
        )}
        {isPresenter && <button type="button" className="ctf-btn-ghost ctf-slidebar__edit" onClick={() => { setDraft(markdown); setEditing(true) }}>Edit slides</button>}
      </div>
    </div>
  )
}
