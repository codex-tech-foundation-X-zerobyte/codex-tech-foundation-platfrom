import { useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { ArrowLeft, Maximize2, Minimize2, Square, WifiOff } from 'lucide-react'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, SkeletonRows } from '../../components/ui'
import { STAGES, isStale, isStageKind } from '../../lib/presentation'
import { useAuth } from '../../lib/auth'
import { usePresentation } from '../../hooks/usePresentation'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { presentBase } from './paths'
import { STAGE_COMPONENT, STAGE_ICON } from './stageRegistry'
import './Present.css'

/** One live presentation: the stage in the middle, who is presenting above it. Only the presenter can change the stage. */
export function PresentationRoom() {
  const { id = '' } = useParams()
  const { profile } = useAuth()
  const { pathname } = useLocation()
  const back = presentBase(pathname)
  const { session, loading, error, connected, writeError, serverOffset, isPresenter, live, commit, end, reload } = usePresentation(id, profile?.id)
  useDocumentTitle(session ? `${session.title} · Presentation` : 'Presentation')
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [full, setFull] = useState(false)
  const frame = useRef<HTMLDivElement>(null)

  if (loading) return <SkeletonRows rows={4} height="72px" />
  if (error) return <ErrorState title="This presentation couldn't load" description={error.message} onRetry={() => void reload()} />
  if (!session) return <EmptyState title="Presentation not found" description="It may have been deleted, or it is not shared with you." action={<Link to={back} className="ctf-link">Back to the board</Link>} />
  if (!isStageKind(session.kind)) return <ErrorState title="Unknown stage" description="This presentation uses a stage this version doesn't know." />

  const Stage = STAGE_COMPONENT[session.kind]
  const Icon = STAGE_ICON[session.kind]
  const paused = live && !isPresenter && isStale(session.updated_at)
  const toggleFull = () => {
    const el = frame.current
    if (!el) return
    if (document.fullscreenElement) { void document.exitFullscreen(); setFull(false) } else { void el.requestFullscreen?.().then(() => setFull(true)).catch(() => undefined) }
  }

  return (
    <div className="ctf-room">
      <div className="ctf-room__head">
        <Link to={back} className="ctf-room__back" aria-label="Back to the board"><ArrowLeft size={16} /></Link>
        <span className="ctf-pcard__icon"><Icon size={18} aria-hidden="true" /></span>
        <div className="ctf-room__title">
          <h1>{session.title}</h1>
          <span>{isPresenter ? 'You are presenting' : `${session.presenter_name} is presenting`} · {session.visibility === 'company' ? 'Whole company' : session.department_name ?? 'Department'} · {STAGES[session.kind].label} stage</span>
        </div>
        {live ? (paused ? <Badge tone="warning">Presenter paused</Badge> : <Badge tone="danger">● Live</Badge>) : <Badge tone="neutral">Ended</Badge>}
        <div className="ctf-room__actions">
          <Button size="sm" variant="ghost" icon={full ? <Minimize2 size={14} /> : <Maximize2 size={14} />} onClick={toggleFull}>{full ? 'Exit full screen' : 'Full screen'}</Button>
          {live && (isPresenter || profile?.role === 'superadmin') && <Button size="sm" variant="danger" icon={<Square size={13} />} onClick={() => setConfirmEnd(true)}>End presentation</Button>}
        </div>
      </div>
      {!connected && live && <p className="ctf-room__warn" role="status"><WifiOff size={14} /> Live updates are reconnecting. What you see may be a few seconds behind.</p>}
      {writeError && isPresenter && <p className="ctf-room__warn ctf-room__warn--err" role="alert">Your last change did not reach the audience: {writeError}</p>}
      {!live && <p className="ctf-room__ended" role="status">This presentation has ended. You are looking at how the stage was left.</p>}
      <div className="ctf-room__frame" ref={frame}>
        <Stage state={session.state} isPresenter={isPresenter && live} commit={commit} sessionId={session.id} serverOffset={serverOffset} />
      </div>
      <ConfirmDialog open={confirmEnd} onClose={() => setConfirmEnd(false)} title="End this presentation?" confirmLabel="End presentation" onConfirm={async () => { const e = await end(); return e ? e.message : null }}>
        Viewers will see it marked as ended. {isPresenter ? 'You can start a new one at any time.' : ''}
      </ConfirmDialog>
    </div>
  )
}
