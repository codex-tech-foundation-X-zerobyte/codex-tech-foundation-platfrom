import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, MonitorUp, Phone, PhoneOff, ScreenShare, ScreenShareOff, Video, VideoOff } from 'lucide-react'
import { Avatar } from './ui'
import { useCall } from './CallProvider'
import { FloatingPanel } from './FloatingPanel'
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
  const {
    phase, session, peerName, startedAt, localStream, remoteStream, muted, cameraOff, hangUp, toggleMute, toggleCamera,
    canShareScreen, screenSharing, remoteScreen, toggleScreenShare,
  } = useCall()
  const localRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)
  const screenRef = useRef<HTMLVideoElement>(null)

  useEffect(() => { if (localRef.current) localRef.current.srcObject = localStream }, [localStream])
  useEffect(() => { if (screenRef.current) { screenRef.current.srcObject = remoteScreen; void screenRef.current.play().catch(() => { /* autoplay blocked */ }) } }, [remoteScreen])
  useEffect(() => {
    // Voice calls have no <video>, so remote audio MUST be routed to an <audio> element — without one a voice
    // call connects perfectly and is completely silent. Video calls play their audio through the <video>, except while a
    // screen is on stage: the camera shrinks to a muted thumbnail and the <audio> element carries the voice.
    const videoCall = session?.type === 'video'
    const videoEl = remoteVideoRef.current
    const audioEl = remoteAudioRef.current
    if (videoEl && videoCall) {
      videoEl.srcObject = remoteStream
      videoEl.muted = Boolean(remoteScreen)
      void videoEl.play().catch(() => { /* autoplay blocked: the user's accept/start click normally unlocks it */ })
    }
    if (audioEl) {
      audioEl.srcObject = !videoCall || remoteScreen ? remoteStream : null
      void audioEl.play().catch(() => { /* autoplay blocked */ })
    }
  }, [remoteStream, remoteScreen, session?.type])

  const isVideo = session?.type === 'video'
  const label = phase === 'ringing-outgoing' ? 'Ringing…' : phase === 'connecting' ? 'Connecting…' : null
  const name = peerName ?? 'Team member'
  const status = label ?? (startedAt ? <Elapsed since={startedAt} /> : 'Connected')
  const showShare = canShareScreen && phase === 'active'

  const controls = (
    <>
      <button className={`ctf-call-round ${muted ? 'is-on' : ''}`} onClick={toggleMute} aria-pressed={muted} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}>
        {muted ? <MicOff size={18} /> : <Mic size={18} />}
      </button>
      {isVideo && (
        <button className={`ctf-call-round ${cameraOff ? 'is-on' : ''}`} onClick={toggleCamera} aria-pressed={cameraOff} aria-label={cameraOff ? 'Turn camera on' : 'Turn camera off'}>
          {cameraOff ? <VideoOff size={18} /> : <Video size={18} />}
        </button>
      )}
      {showShare && (
        <button className={`ctf-call-round ${screenSharing ? 'is-on' : ''}`} onClick={() => void toggleScreenShare()} aria-pressed={screenSharing} aria-label={screenSharing ? 'Stop sharing your screen' : 'Share your screen'} title={screenSharing ? 'Stop sharing' : 'Share your screen'}>
          {screenSharing ? <ScreenShareOff size={18} /> : <ScreenShare size={18} />}
        </button>
      )}
      <button className="ctf-call-round ctf-call-round--decline" onClick={() => void hangUp()} aria-label={phase === 'ringing-outgoing' ? 'Cancel call' : 'End call'}>
        <PhoneOff size={18} />
      </button>
    </>
  )

  // The quick actions that stay on the title bar when the window is shrunk to a bar.
  const quick = (
    <>
      <button type="button" className={`ctf-fp__btn ${muted ? 'is-on' : ''}`} onClick={toggleMute} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'} title={muted ? 'Unmute' : 'Mute'}>
        {muted ? <MicOff size={14} /> : <Mic size={14} />}
      </button>
      <button type="button" className="ctf-fp__btn ctf-fp__btn--danger" onClick={() => void hangUp()} aria-label={phase === 'ringing-outgoing' ? 'Cancel call' : 'End call'} title="End call">
        <PhoneOff size={14} />
      </button>
    </>
  )

  return (
    <FloatingPanel
      id={isVideo ? 'call-video' : 'call-voice'}
      label={`Call with ${name}`}
      title={name}
      subtitle={<span className={phase === 'active' ? 'ctf-call-live' : ''} aria-live="polite">{status}</span>}
      defaultSize={isVideo ? { w: 420, h: 360 } : { w: 320, h: 260 }}
      minSize={{ w: 260, h: 200 }}
      headerActions={quick}
      footer={controls}
      growTo={remoteScreen ? { w: 640, h: 460, key: remoteScreen.id || 'screen' } : null}
      className="ctf-call-window"
    >
      <audio ref={remoteAudioRef} autoPlay />
      {remoteScreen ? (
        <div className="ctf-call-stage ctf-call-stage--screen">
          <video ref={screenRef} autoPlay playsInline className="ctf-call-stage__screen" />
          <span className="ctf-call-stage__tag"><MonitorUp size={12} /> {name} is sharing their screen</span>
          {isVideo && <video ref={remoteVideoRef} autoPlay playsInline muted className="ctf-call-stage__pip" />}
        </div>
      ) : isVideo ? (
        <div className="ctf-call-stage">
          <video ref={remoteVideoRef} autoPlay playsInline className="ctf-call-stage__remote" />
          {!remoteStream && <div className="ctf-call-stage__placeholder"><Avatar name={name} size={72} /></div>}
          <video ref={localRef} autoPlay playsInline muted className={`ctf-call-stage__local ${cameraOff ? 'is-off' : ''}`} />
        </div>
      ) : (
        <div className="ctf-call-stage ctf-call-stage--voice">
          <div className={`ctf-call-stage__avatar ${phase === 'active' ? 'is-live' : ''}`}><Avatar name={name} size={72} /></div>
        </div>
      )}
      {screenSharing && (
        <div className="ctf-call-banner" role="status">
          <MonitorUp size={14} /> You are sharing your screen
          <button type="button" onClick={() => void toggleScreenShare()}>Stop</button>
        </div>
      )}
    </FloatingPanel>
  )
}
