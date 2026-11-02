import { useEffect, useRef } from 'react'
import { Mic, MicOff, MonitorUp, Phone, PhoneOff, ScreenShare, ScreenShareOff, Users, Video, VideoOff, X } from 'lucide-react'
import { Avatar } from './ui'
import { useGroupCall } from './GroupCallProvider'
import { FloatingPanel } from './FloatingPanel'
import './GroupCallUI.css'

export function GroupCallUI() {
  return (
    <>
      <GroupCallInvites />
      <ActiveGroupCall />
    </>
  )
}

/** "Maya started a voice call in General — Join". Shown on every page, so nobody misses a call because they were elsewhere. */
function GroupCallInvites() {
  const { invites, dismissInvite, joinInvite, joining } = useGroupCall()
  if (invites.length === 0) return null
  return (
    <div className="ctf-gcall-invites" role="region" aria-label="Calls you can join" aria-live="assertive">
      {invites.map((invite) => {
        const video = invite.call.type === 'video'
        return (
          <div key={invite.call.id} className="ctf-gcall-invite" role="alert">
            <div className="ctf-gcall-invite__icon">{video ? <Video size={18} /> : <Phone size={18} />}</div>
            <div className="ctf-gcall-invite__text">
              <strong>{invite.starterName} {invite.isDirect ? `is calling you` : `started a ${invite.call.type} call`}</strong>
              <span>{invite.isDirect ? `${video ? 'Video' : 'Voice'} call in progress` : `in ${invite.channelName} · happening now`}</span>
            </div>
            <button className="ctf-gcall-invite__join" disabled={joining} onClick={() => void joinInvite(invite)}>Join</button>
            <button className="ctf-gcall-invite__close" aria-label="Dismiss" onClick={() => dismissInvite(invite.call.id)}><X size={14} /></button>
          </div>
        )
      })}
    </div>
  )
}

function ActiveGroupCall() {
  const { call, localStream, remoteStreams, names, muted, cameraOff, leave, toggleMute, toggleCamera, canShareScreen, screenSharing, screens, toggleScreenShare } = useGroupCall()
  if (!call) return null

  const isVideo = call.type === 'video'
  const participantCount = remoteStreams.size + 1
  const presenter = [...screens.entries()][0] ?? null // if two people present at once, the first one takes the stage
  const presenterName = presenter ? names[presenter[0]] ?? 'A teammate' : null

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
      {canShareScreen && (
        <button className={`ctf-call-round ${screenSharing ? 'is-on' : ''}`} onClick={() => void toggleScreenShare()} aria-pressed={screenSharing} aria-label={screenSharing ? 'Stop sharing your screen' : 'Share your screen'} title={screenSharing ? 'Stop sharing' : 'Share your screen'}>
          {screenSharing ? <ScreenShareOff size={18} /> : <ScreenShare size={18} />}
        </button>
      )}
      <button className="ctf-call-round ctf-call-round--decline" onClick={() => void leave()} aria-label="Leave call"><PhoneOff size={18} /></button>
    </>
  )
  const quick = (
    <>
      <button type="button" className={`ctf-fp__btn ${muted ? 'is-on' : ''}`} onClick={toggleMute} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'} title={muted ? 'Unmute' : 'Mute'}>
        {muted ? <MicOff size={14} /> : <Mic size={14} />}
      </button>
      <button type="button" className="ctf-fp__btn ctf-fp__btn--danger" onClick={() => void leave()} aria-label="Leave call" title="Leave call"><PhoneOff size={14} /></button>
    </>
  )

  return (
    <FloatingPanel
      id="group-call"
      label="Group call"
      title={<><Users size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />{participantCount} in call</>}
      subtitle={participantCount === 1 ? 'Waiting for others to join…' : presenterName ? `${presenterName} is sharing their screen` : undefined}
      defaultSize={{ w: 460, h: 400 }}
      minSize={{ w: 280, h: 220 }}
      headerActions={quick}
      footer={controls}
      growTo={presenter ? { w: 700, h: 500, key: presenter[1].id || presenter[0] } : null}
      className="ctf-group-call"
    >
      {presenter && <PresenterStage stream={presenter[1]} name={presenterName ?? 'A teammate'} />}
      {screenSharing && (
        <div className="ctf-call-banner" role="status"><MonitorUp size={14} /> You are sharing your screen<button type="button" onClick={() => void toggleScreenShare()}>Stop</button></div>
      )}
      <div className={`ctf-group-call__grid ${presenter ? 'is-strip' : ''}`} data-count={Math.min(participantCount, 6)}>
        <Tile stream={localStream} label="You" isVideo={isVideo} local off={cameraOff} />
        {[...remoteStreams.entries()].map(([peerId, stream]) => (
          <Tile key={peerId} stream={stream} label={names[peerId] ?? 'Team member'} isVideo={isVideo} />
        ))}
      </div>
    </FloatingPanel>
  )
}

function PresenterStage({ stream, name }: { stream: MediaStream; name: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => { if (ref.current) { ref.current.srcObject = stream; void ref.current.play().catch(() => { /* autoplay blocked */ }) } }, [stream])
  return (
    <div className="ctf-group-call__stage">
      <video ref={ref} autoPlay playsInline muted className="ctf-group-call__screen" />
      <span className="ctf-call-stage__tag"><MonitorUp size={12} /> {name} is sharing their screen</span>
    </div>
  )
}

function Tile({ stream, label, isVideo, local = false, off = false }: { stream: MediaStream | null; label: string; isVideo: boolean; local?: boolean; off?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    // Voice rooms have no <video>. Remote audio must go to an <audio> element or the room is silent.
    // Never attach our OWN stream to an audio element — that would play the mic back to us as an echo.
    const el = isVideo ? videoRef.current : local ? null : audioRef.current
    if (el) {
      el.srcObject = stream
      void el.play().catch(() => { /* autoplay blocked until the user interacts */ })
    }
  }, [stream, isVideo, local])

  return (
    <div className={`ctf-group-call__tile ${local ? 'is-local' : ''}`}>
      {isVideo ? (
        <video ref={videoRef} autoPlay playsInline muted={local} className={`ctf-group-call__video ${local ? 'is-mirrored' : ''} ${off ? 'is-off' : ''}`} />
      ) : (
        <>
          <div className="ctf-group-call__avatar"><Avatar name={label} size={44} /></div>
          {!local && <audio ref={audioRef} autoPlay />}
        </>
      )}
      <span className="ctf-group-call__label">{label}</span>
    </div>
  )
}
