import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Clapperboard, Maximize, RefreshCw, Upload, Volume2, VolumeX } from 'lucide-react'
import { expectedPosition, needsSeek, toEmbedUrl, normalizeStageUrl, validatePresentationFile, type CinemaState } from '../../../lib/presentation'
import { presentationFileUrl, uploadPresentationFile } from '../../../lib/services'
import type { StageProps } from './types'

/**
 * A cinema for watching video together. The presenter's play, pause and seek are stamped with the SERVER clock and everyone's player
 * follows, correcting only when it drifts more than a second and a half. Uploaded files and direct video links are fully synced.
 * YouTube and Vimeo are shown in their own player: those cannot be remote-controlled, so the stage says so.
 */
export function CinemaStage({ state, isPresenter, commit, sessionId, serverOffset }: StageProps) {
  const cs = state as CinemaState
  const embed = cs.source === 'url' && cs.url ? toEmbedUrl(cs.url) : null
  const [src, setSrc] = useState<string | null>(null)
  const [srcError, setSrcError] = useState('')
  const [needsTap, setNeedsTap] = useState(false)
  const [muted, setMuted] = useState(false)
  const [link, setLink] = useState('')
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const applying = useRef(false)   // our own corrections must not be mistaken for the presenter acting

  // Where the picture comes from
  useEffect(() => {
    let alive = true
    setSrc(null); setSrcError('')
    if (cs.source === 'upload' && cs.path) {
      void presentationFileUrl(cs.path).then((r) => { if (!alive) return; if (r.url) setSrc(r.url); else setSrcError('This video is no longer available.') })
    } else if (cs.source === 'url' && cs.url && !embed) {
      // Re-checked on every viewer's device: the address came from the shared state, which a presenter can also write straight to the database.
      const safe = normalizeStageUrl(cs.url)
      if (safe) setSrc(safe); else setSrcError('This video link is not a safe https:// address.')
    }
    return () => { alive = false }
  }, [cs.source, cs.path, cs.url, embed])

  // Viewers: follow the presenter
  const follow = useCallback(() => {
    const v = video.current
    if (!v || isPresenter) return
    const want = expectedPosition(cs, Date.now(), serverOffset)
    applying.current = true
    if (needsSeek(v.currentTime, want) && Number.isFinite(want)) v.currentTime = want
    if (cs.playing) { void v.play().then(() => setNeedsTap(false)).catch(() => setNeedsTap(true)) } else v.pause()
    setTimeout(() => { applying.current = false }, 300)
  }, [cs, isPresenter, serverOffset])
  useEffect(() => { follow() }, [follow, src])

  // Keep a playing viewer from creeping out of sync over a long video
  useEffect(() => {
    if (isPresenter || !cs.playing) return
    const t = setInterval(follow, 10_000)
    return () => clearInterval(t)
  }, [isPresenter, cs.playing, follow])

  // Presenter: whatever they do with the player is what everyone gets
  const announce = (playing: boolean) => {
    const v = video.current
    if (!v || applying.current || !isPresenter) return
    commit({ ...state, playing, position: v.currentTime, at: Date.now() + serverOffset, rate: v.playbackRate }, { immediate: true })
  }

  const setSource = (next: Partial<CinemaState>) => commit({ playing: false, position: 0, at: Date.now() + serverOffset, rate: 1, ...next }, { immediate: true })
  const onFile = async (f: File | undefined) => {
    if (!f) return
    const bad = validatePresentationFile(f)
    if (bad) { setError(bad); return }
    setError(''); setUploading(true)
    const { path, error: err } = await uploadPresentationFile(sessionId, f)
    setUploading(false)
    if (err || !path) { setError(err?.message ?? 'Upload failed.'); return }
    setSource({ source: 'upload', path, name: f.name })
  }
  const onLink = (e: FormEvent) => {
    e.preventDefault()
    const u = normalizeStageUrl(link)
    if (!u) { setError('Enter a full https:// link to a video.'); return }
    setError(''); setLink('')
    setSource({ source: 'url', url: u, name: u })
  }
  const fullscreen = () => { void stage.current?.requestFullscreen?.() }

  const hasVideo = !!(cs.source && (cs.path || cs.url))
  return (
    <div className="ctf-stage ctf-stage--cinema">
      <div className="ctf-cinema" ref={stage}>
        {!hasVideo ? (
          <div className="ctf-stage__empty ctf-stage__empty--cinema"><Clapperboard size={34} aria-hidden="true" /><strong>{isPresenter ? 'Pick something to screen' : 'The screen is dark'}</strong><span>{isPresenter ? 'Upload a video (up to 50 MB) or paste a link below.' : 'The presenter has not chosen a video yet.'}</span></div>
        ) : embed ? (
          <iframe className="ctf-cinema__embed" title="Video" src={embed.src} allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
        ) : srcError ? (
          <div className="ctf-stage__empty ctf-stage__empty--cinema"><strong>{srcError}</strong></div>
        ) : !src ? (
          <div className="ctf-stage__empty ctf-stage__empty--cinema"><span>Loading the video…</span></div>
        ) : (
          <video
            ref={video} className="ctf-cinema__video" src={src} playsInline preload="auto" controls={isPresenter} muted={muted}
            onPlay={() => announce(true)} onPause={() => announce(false)} onSeeked={() => announce(!video.current?.paused)} onRateChange={() => announce(!video.current?.paused)}
            onError={() => setSrcError("This video can't be played here (the link may not allow it, or the format isn't supported).")}
          />
        )}
        {needsTap && !isPresenter && (
          <button type="button" className="ctf-cinema__tap" onClick={() => { setNeedsTap(false); follow() }}>Tap to join the screening</button>
        )}
        {hasVideo && !embed && !isPresenter && src && (
          <div className="ctf-cinema__viewerbar">
            <button type="button" className="ctf-bar__btn" onClick={() => setMuted((m) => !m)} aria-label={muted ? 'Unmute' : 'Mute'}>{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
            <button type="button" className="ctf-bar__btn" onClick={follow} aria-label="Re-sync with the presenter" title="Re-sync with the presenter"><RefreshCw size={16} /></button>
            <button type="button" className="ctf-bar__btn" onClick={fullscreen} aria-label="Full screen"><Maximize size={16} /></button>
          </div>
        )}
      </div>
      {embed && <p className="ctf-stage__help" role="note">{isPresenter ? 'YouTube and Vimeo play in their own player, so play and pause cannot be synced. Everyone controls their own copy. Upload the file for a synced screening.' : 'This video plays in its own player: press play yourself. The presenter cannot control it for you.'}</p>}
      {isPresenter && (
        <div className="ctf-cinema__source">
          <input type="file" id="cinema-file" accept="video/mp4,video/webm,video/quicktime" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }} />
          <button type="button" className="ctf-btn-solid" disabled={uploading} onClick={() => document.getElementById('cinema-file')?.click()}><Upload size={14} /> {uploading ? 'Uploading…' : hasVideo ? 'Change video' : 'Upload video'}</button>
          <form onSubmit={onLink}><input aria-label="Video link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="…or paste a link (mp4, webm, YouTube, Vimeo)" spellCheck={false} autoComplete="off" /><button type="submit" className="ctf-btn-ghost" disabled={!link.trim()}>Use link</button></form>
          {cs.name && <span className="ctf-cinema__name" title={cs.name}>{cs.source === 'upload' ? cs.name : 'Link'}</span>}
        </div>
      )}
      {error && <p className="ctf-stage__error" role="alert">{error}</p>}
    </div>
  )
}
