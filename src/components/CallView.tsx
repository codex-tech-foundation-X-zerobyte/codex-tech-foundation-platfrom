import { useEffect, useRef } from 'react'
import { Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react'
import { Avatar, Button } from './ui'
import { useCallSession } from '../lib/useCallSession'
import type { Call } from '../lib/types'
import './CallView.css'

function VideoTile({ stream, label, muted }: { stream: MediaStream | null; label: string; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current && stream) ref.current.srcObject = stream
  }, [stream])
  const hasVideo = !!stream?.getVideoTracks().some((t) => t.enabled)
  return (
    <div className="ctf-call__tile">
      {hasVideo ? (
        <video ref={ref} autoPlay playsInline muted={muted} />
      ) : (
        <div className="ctf-call__tile-avatar"><Avatar name={label} size={56} /></div>
      )}
      <span className="ctf-call__tile-label">{label}</span>
    </div>
  )
}

export function CallView({
  call,
  names,
  onLeave,
}: {
  call: Call
  names: Map<string, string>
  onLeave: () => void
}) {
  const { localStream, remoteStreams, muted, cameraOff, connecting, error, toggleMute, toggleCamera } = useCallSession(call)

  if (error) {
    return (
      <div className="ctf-call__overlay">
        <div className="ctf-call__error">
          <p>{error}</p>
          <Button variant="primary" onClick={onLeave}>Close</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="ctf-call__overlay">
      <div className="ctf-call__header">{call.kind === 'video' ? 'Video call' : 'Voice call'}{connecting ? ' · Connecting…' : ''}</div>
      <div className="ctf-call__grid">
        <VideoTile stream={localStream} label="You" muted />
        {Array.from(remoteStreams.entries()).map(([userId, stream]) => (
          <VideoTile key={userId} stream={stream} label={names.get(userId) ?? 'Team member'} />
        ))}
      </div>
      <div className="ctf-call__controls">
        <Button variant={muted ? 'primary' : 'secondary'} icon={muted ? <MicOff size={16} /> : <Mic size={16} />} onClick={toggleMute}>
          {muted ? 'Unmute' : 'Mute'}
        </Button>
        {call.kind === 'video' && (
          <Button variant={cameraOff ? 'primary' : 'secondary'} icon={cameraOff ? <VideoOff size={16} /> : <Video size={16} />} onClick={toggleCamera}>
            {cameraOff ? 'Start video' : 'Stop video'}
          </Button>
        )}
        <Button variant="danger" icon={<PhoneOff size={16} />} onClick={onLeave}>Leave call</Button>
      </div>
    </div>
  )
}
