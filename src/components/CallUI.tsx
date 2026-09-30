import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from 'lucide-react'
import { Avatar } from './ui'
import { useCall } from './CallProvider'
import './CallUI.css'

export function CallUI() {
  const { phase } = useCall()
  if (phase === 'idle') return null
  if (phase === 'ringing-incoming') return <IncomingCall />
  return <ActiveCall />
}

function IncomingCall() {
  const { acceptIncoming, declineIncoming, session, peerName } = useCall()
  const acceptRef = useRef<HTMLButtonElement>(null)
  const isVideo = session?.type === 'video'

  // Keyboard users must be able to answer without hunting for the button.
  useEffect(() => { acceptRef.current?.focus() }, [])

  return (
    <div className="ctf-call-incoming" role="alertdialog" aria-live="assertive" aria-label={`Incoming ${isVideo ? 'video' : 'voice'} call from ${peerName ?? 'a teammate'}`}>
      <div className="ctf-call-incoming__avatar">
        <span className="ctf-call-incoming__ring" aria-hidden="true" />
        <Avatar name={peerName ?? '?'} size={48} />
      </div>
      <div className="ctf-call-incoming__info">
        <strong>{peerName ?? 'Someone on your team'}</strong>
        <span>Incoming {isVideo ? 'video' : 'voice'} call…</span>
      </div>
      <div className="ctf-call-incoming__actions">
        <button className="ctf-call-round ctf-call-round--decline" onClick={() => void declineIncoming()} aria-label="Decline call"><PhoneOff size={18} /></button>
        <button ref={acceptRef} className="ctf-call-round ctf-call-round--accept" onClick={() => void acceptIncoming()} aria-label="Accept call">
          {isVideo ? <Video size={18} /> : <Phone size={18} />}
        </button>
      </div>
    </div>
  )
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const total = Math.max(0, Math.floor((now - since) / 1000))
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return <span className="mono">{mm}:{ss}</span>
}

function ActiveCall() {
  const { phase, session, peerName, startedAt, localStream, remoteStream, muted, cameraOff, hangUp, toggleMute, toggleCamera } = useCall()
  const localRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => { if (localRef.current) localRef.current.srcObject = localStream }, [localStream])
  useEffect(() => {
    // Voice calls have no <video>, so remote audio MUST be routed to an <audio> element — without one a voice
    // call connects perfectly and is completely silent. Video calls play their audio through the <video>.
    const el = session?.type === 'video' ? remoteVideoRef.current : remoteAudioRef.current
    if (el) {
      el.srcObject = remoteStream
      void el.play().catch(() => { /* autoplay blocked: the user's accept/start click normally unlocks it */ })
    }
  }, [remoteStream, session?.type])

  const isVideo = session?.type === 'video'
  const label = phase === 'ringing-outgoing' ? 'Ringing…' : phase === 'connecting' ? 'Connecting…' : null
  const name = peerName ?? 'Team member'

  return (
    <section className={`ctf-call-window ${isVideo ? 'is-video' : ''}`} aria-label={`Call with ${name}`}>
      <audio ref={remoteAudioRef} autoPlay />
      <header className="ctf-call-window__head">
        <div className="ctf-call-window__who">
          <strong>{name}</strong>
          <span className={`ctf-call-window__status ${phase === 'active' ? 'is-live' : ''}`} aria-live="polite">
            {label ?? (startedAt ? <Elapsed since={startedAt} /> : 'Connected')}
          </span>
        </div>
      </header>

      {isVideo ? (
        <div className="ctf-call-window__stage">
          <video ref={remoteVideoRef} autoPlay playsInline className="ctf-call-window__remote" />
          {!remoteStream && <div className="ctf-call-window__placeholder"><Avatar name={name} size={72} /></div>}
          <video ref={localRef} autoPlay playsInline muted className={`ctf-call-window__local ${cameraOff ? 'is-off' : ''}`} />
        </div>
      ) : (
        <div className="ctf-call-window__voice">
          <div className={`ctf-call-window__avatar ${phase === 'active' ? 'is-live' : ''}`}><Avatar name={name} size={72} /></div>
        </div>
      )}

      <footer className="ctf-call-window__controls">
        <button className={`ctf-call-round ${muted ? 'is-on' : ''}`} onClick={toggleMute} aria-pressed={muted} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}>
          {muted ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        {isVideo && (
          <button className={`ctf-call-round ${cameraOff ? 'is-on' : ''}`} onClick={toggleCamera} aria-pressed={cameraOff} aria-label={cameraOff ? 'Turn camera on' : 'Turn camera off'}>
            {cameraOff ? <VideoOff size={18} /> : <Video size={18} />}
          </button>
        )}
        <button className="ctf-call-round ctf-call-round--decline" onClick={() => void hangUp()} aria-label={phase === 'ringing-outgoing' ? 'Cancel call' : 'End call'}>
          <PhoneOff size={18} />
        </button>
      </footer>
    </section>
  )
}
