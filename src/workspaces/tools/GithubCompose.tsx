import { useState } from 'react'
import { Button, FieldWrap, Input, Surface, Textarea, useToast } from '../../components/ui'
import { githubComment, githubCreateIssue, isGithubUrl } from '../../lib/services'
import { Open } from './GithubParts'

const MAX_COMMENT = 8000
const MAX_TITLE = 256

/**
 * Add a comment to an issue or pull request. Shown only when the database says this person may; the server checks again on every post.
 * The comment is posted by the GitHub App and signed with the person's name, so GitHub shows who asked for it.
 */
export function CommentBox({ repo, number, allowed, onPosted }: { repo: string; number: number; allowed: boolean; onPosted: () => void }) {
  const { push } = useToast()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  if (!allowed) return <p className="ctf-denv__muted">Commenting from the Workspace is turned off for this repository. Use the GitHub link to reply there.</p>
  const send = async () => {
    setBusy(true); setLink(null)
    const { data, error } = await githubComment(repo, number, text)
    setBusy(false)
    if (error || !data) { push(error?.message ?? 'The comment could not be posted.', 'error'); return }
    setText(''); setLink(isGithubUrl(data.url) ? data.url : null); push(data.warning ?? 'Comment posted to GitHub.'); onPosted()
  }
  return (
    <Surface>
      <FieldWrap label="Add a comment" htmlFor={`gh-comment-${number}`} hint="Posted to GitHub by the Workspace and signed with your name. Markdown works.">
        <Textarea id={`gh-comment-${number}`} rows={4} value={text} maxLength={MAX_COMMENT} onChange={(e) => setText(e.target.value)} />
      </FieldWrap>
      <div className="ctf-code__compose">
        <Button variant="primary" loading={busy} disabled={text.trim().length === 0} onClick={() => void send()}>Post comment</Button>
        {link && <Open href={link} />}
      </div>
    </Surface>
  )
}

/** Open a new issue. Shown only when the database says this person may. */
export function NewIssueForm({ repo, onCreated }: { repo: string; onCreated: () => void }) {
  const { push } = useToast()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    const { data, error } = await githubCreateIssue(repo, title, text)
    setBusy(false)
    if (error || !data) { push(error?.message ?? 'The issue could not be created.', 'error'); return }
    setTitle(''); setText(''); setOpen(false); push(data.number ? `Issue #${data.number} created on GitHub.` : 'Issue created on GitHub.'); onCreated()
  }
  if (!open) return <div><Button variant="secondary" size="sm" onClick={() => setOpen(true)}>New issue</Button></div>
  return (
    <Surface>
      <FieldWrap label="Title" htmlFor="gh-issue-title"><Input id="gh-issue-title" value={title} maxLength={MAX_TITLE} onChange={(e) => setTitle(e.target.value)} /></FieldWrap>
      <FieldWrap label="Description" htmlFor="gh-issue-body" hint="Optional. Posted to GitHub by the Workspace and signed with your name. Markdown works.">
        <Textarea id="gh-issue-body" rows={5} value={text} maxLength={MAX_COMMENT} onChange={(e) => setText(e.target.value)} />
      </FieldWrap>
      <div className="ctf-code__compose">
        <Button variant="primary" loading={busy} disabled={title.trim().length === 0} onClick={() => void submit()}>Create issue</Button>
        <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </Surface>
  )
}
