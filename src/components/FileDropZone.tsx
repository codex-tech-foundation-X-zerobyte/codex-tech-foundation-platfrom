import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent } from 'react'
import { Link2, UploadCloud } from 'lucide-react'
import { Button, Input } from './ui'
import { normalizeUrl, parseUrlInput } from '../lib/links'
import './FileDropZone.css'

interface FileDropZoneProps {
  onFiles: (files: File[]) => void
  /** Called with clean, validated http(s) addresses whenever a link is dropped, pasted or typed in. */
  onLinks: (urls: string[]) => void
  onReject?: (message: string) => void
  disabled?: boolean
  maxMb?: number
  /** One line under the headline, e.g. who can see what is added. */
  hint?: string
}

/** True if the event came from somewhere text is being typed — we must not hijack a paste meant for a text field. */
function isTextTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

/** Pulls links out of text from a drop/paste: only when the text is nothing but link(s). */
function linksFromText(text: string): string[] | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#')) // text/uri-list allows # comments
  return parseUrlInput(lines.join('\n'))
}

/**
 * One place to put things in: drag files or links onto it, paste them anywhere on the page, click to browse, or type a link.
 * It does the recognising (file vs link vs "that's neither") so every screen using it behaves the same way.
 */
export function FileDropZone({ onFiles, onLinks, onReject, disabled = false, maxMb = 25, hint }: FileDropZoneProps) {
  const [dragging, setDragging] = useState(false)
  const [linkText, setLinkText] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const depth = useRef(0)

  const accept = (files: File[]) => {
    const ok = files.filter((f) => f.size <= maxMb * 1024 * 1024)
    const tooBig = files.filter((f) => f.size > maxMb * 1024 * 1024)
    if (tooBig.length) onReject?.(`${tooBig.map((f) => f.name).join(', ')} ${tooBig.length === 1 ? 'is' : 'are'} over ${maxMb} MB and was skipped.`)
    if (ok.length) onFiles(ok)
  }

  // Pasting anywhere on the page works (a screenshot, a copied file, a copied link) unless the person is typing in a field.
  // The listener always calls the latest handlers through a ref that is refreshed after each render.
  const latest = useRef({ accept, onLinks, disabled })
  useEffect(() => { latest.current = { accept, onLinks, disabled } })
  useEffect(() => {
    const onPaste = (e: globalThis.ClipboardEvent) => {
      const { accept: acceptFiles, onLinks: addLinks, disabled: off } = latest.current
      if (off || isTextTarget(e.target)) return
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length) { e.preventDefault(); acceptFiles(files); return }
      const links = linksFromText(e.clipboardData?.getData('text/plain') ?? '')
      if (links) { e.preventDefault(); addLinks(links) }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    depth.current = 0
    setDragging(false)
    if (disabled) return
    const files = Array.from(e.dataTransfer.files)
    if (files.length) { accept(files); return }
    const links = linksFromText(e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain'))
    if (links) onLinks(links)
    else onReject?.("That wasn't a file or a web link.")
  }
  const onDragEnter = (e: DragEvent) => { e.preventDefault(); if (!disabled) { depth.current += 1; setDragging(true) } }
  const onDragLeave = () => { depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setDragging(false) }

  const submitLink = (e: FormEvent) => {
    e.preventDefault()
    const text = linkText.trim()
    if (!text) return
    // Allow "example.com/page" without the https:// — but only for something that is plainly an address.
    const links = parseUrlInput(text) ?? (/^[^\s/]+\.[^\s/]+(\/\S*)?$/.test(text) && normalizeUrl(`https://${text}`) ? [normalizeUrl(`https://${text}`) as string] : null)
    if (links) { onLinks(links); setLinkText('') } else onReject?.("That doesn't look like a web link.")
  }
  // Pasting a clean link into the field adds it straight away — no extra click.
  const onLinkPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const links = linksFromText(e.clipboardData.getData('text/plain'))
    if (links) { e.preventDefault(); onLinks(links); setLinkText('') }
  }

  return (
    <div className={`ctf-drop ${dragging ? 'is-dragging' : ''} ${disabled ? 'is-disabled' : ''}`} onDragEnter={onDragEnter} onDragOver={(e) => e.preventDefault()} onDragLeave={onDragLeave} onDrop={onDrop}>
      <button type="button" className="ctf-drop__area" disabled={disabled} onClick={() => input.current?.click()}>
        <UploadCloud size={26} aria-hidden />
        <strong>{dragging ? 'Drop to add' : 'Drop files or links here'}</strong>
        <span>or click to browse · paste works too · up to {maxMb} MB each{hint ? ` · ${hint}` : ''}</span>
      </button>
      <input ref={input} type="file" multiple hidden onChange={(e) => { accept(Array.from(e.target.files ?? [])); e.target.value = '' }} />
      <form className="ctf-drop__link" onSubmit={submitLink}>
        <Link2 size={16} aria-hidden />
        <Input value={linkText} onChange={(e) => setLinkText(e.target.value)} onPaste={onLinkPaste} placeholder="Paste a link…" aria-label="Add a link" disabled={disabled} autoComplete="off" inputMode="url" />
        <Button type="submit" variant="secondary" size="sm" disabled={disabled || !linkText.trim()}>Add link</Button>
      </form>
    </div>
  )
}
