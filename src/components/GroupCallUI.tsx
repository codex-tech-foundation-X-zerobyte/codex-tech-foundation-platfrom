import { useEffect, useRef } from 'react'
import { Mic, MicOff, Phone, PhoneOff, Users, Video, VideoOff, X } from 'lucide-react'
import { Avatar } from './ui'
import { useGroupCall } from './GroupCallProvider'
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
  const { call, localStream, remoteStreams, names, muted, cameraOff, leave, toggleMute, toggleCamera } = useGroupCall()
  if (!call) return null

  const isVideo = call.type === 'video'
  const participantCount = remoteStreams.size + 1

  return (
    <section className="ctf-group-call" aria-label="Group call">
      <header className="ctf-group-call__head">
        <Users size={14} />
        <strong>{participantCount} in call</strong>
        {participantCount === 1 && <span>Waiting for others to join…</span>}
      </header>
      <div className="ctf-group-call__grid" data-count={Math.min(participantCount, 6)}>
        <Tile stream={localStream} label="You" isVideo={isVideo} local off={cameraOff} />
        {[...remoteStreams.entries()].map(([peerId, stream]) => (
          <Tile key={peerId} stream={stream} label={names[peerId] ?? 'Team member'} isVideo={isVideo} />
        ))}
      </div>
      <footer className="ctf-group-call__controls">
        <button className={`ctf-call-round ${muted ? 'is-on' : ''}`} onClick={toggleMute} aria-pressed={muted} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}>
          {muted ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        {isVideo && (
          <button className={`ctf-call-round ${cameraOff ? 'is-on' : ''}`} onClick={toggleCamera} aria-pressed={cameraOff} aria-label={cameraOff ? 'Turn camera on' : 'Turn camera off'}>
            {cameraOff ? <VideoOff size={18} /> : <Video size={18} />}
          </button>
        )}
        <button className="ctf-call-round ctf-call-round--decline" onClick={() => void leave()} aria-label="Leave call"><PhoneOff size={18} /></button>
      </footer>
    </section>
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
