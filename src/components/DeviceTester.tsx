import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Mic, Square } from 'lucide-react'
import { Button, FieldWrap, Select } from './ui'
import { describeMediaError, stopStream } from '../lib/rtc'
import { setPref, usePrefs } from '../lib/prefs'
import './DeviceTester.css'

/**
 * Pick the microphone and camera calls will use, and hear/see them before a real call. The selection is saved to this
 * device's preferences and used by every call (with a fallback to the system default if the device is unplugged).
 */
export function DeviceTester() {
  const prefs = usePrefs()
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [error, setError] = useState('')
  const [micLive, setMicLive] = useState(false)
  const [level, setLevel] = useState(0)
  const [camLive, setCamLive] = useState(false)
  const streamRef = useRef<MediaStream | null>(null)
  const camRef = useRef<MediaStream | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef(0)

  const refresh = useCallback(async () => {
    try { setDevices(await navigator.mediaDevices.enumerateDevices()) } catch { setDevices([]) }
  }, [])
  useEffect(() => {
    if (!navigator.mediaDevices) return
    void navigator.mediaDevices.enumerateDevices().then(setDevices, () => setDevices([]))
    navigator.mediaDevices.addEventListener('devicechange', refresh) // plugging in a headset updates the list live
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh)
  }, [refresh])

  const stopMic = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    stopStream(streamRef.current); streamRef.current = null
    void audioCtxRef.current?.close().catch(() => {}); audioCtxRef.current = null
    setMicLive(false); setLevel(0)
  }, [])
  const stopCam = useCallback(() => { stopStream(camRef.current); camRef.current = null; setCamLive(false) }, [])
  useEffect(() => () => { stopMic(); stopCam() }, [stopMic, stopCam]) // never leave the mic/camera light on after leaving the page

  const mics = devices.filter((d) => d.kind === 'audioinput')
  const cams = devices.filter((d) => d.kind === 'videoinput')
  const needsPermission = devices.length > 0 && devices.every((d) => !d.label)

  const allow = async () => {
    setError('')
    try { stopStream(await navigator.mediaDevices.getUserMedia({ audio: true, video: cams.length > 0 })); await refresh() } catch (e) { setError(describeMediaError(e, cams.length > 0)) }
  }

  const testMic = async () => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: prefs.micId ? { deviceId: { exact: prefs.micId } } : true })
      streamRef.current = stream
      const ctx = new AudioContext(); audioCtxRef.current = ctx
      const analyser = ctx.createAnalyser(); analyser.fftSize = 512
      ctx.createMediaStreamSource(stream).connect(analyser) // analysed only, never played back (no echo)
      const data = new Uint8Array(analyser.fftSize)
      const tick = () => {
        analyser.getByteTimeDomainData(data)
        let peak = 0
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128))
        setLevel(Math.min(1, peak / 64))
        rafRef.current = requestAnimationFrame(tick)
      }
      tick(); setMicLive(true); void refresh()
    } catch (e) { setError(describeMediaError(e, false)) }
  }
  const testCam = async () => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: prefs.camId ? { deviceId: { exact: prefs.camId } } : true })
      camRef.current = stream; setCamLive(true); void refresh()
      requestAnimationFrame(() => { if (videoRef.current) { videoRef.current.srcObject = stream; void videoRef.current.play().catch(() => {}) } })
    } catch (e) { setError(describeMediaError(e, true)) }
  }

  if (!navigator.mediaDevices) return <p className="ctf-muted">This browser can't access microphones or cameras, so calls won't work here. Try a current Chrome, Edge, Firefox or Safari over HTTPS.</p>

  return (
    <div className="ctf-devtest">
      {needsPermission && (
        <div className="ctf-devtest__allow">
          <span>Your browser hides device names until you allow access.</span>
          <Button variant="secondary" size="sm" onClick={() => void allow()}>Allow access</Button>
        </div>
      )}
      <div className="ctf-form-row">
        <FieldWrap label="Microphone" htmlFor="dev-mic">
          <Select id="dev-mic" value={prefs.micId} onChange={(e) => { setPref('micId', e.target.value); stopMic() }}>
            <option value="">System default</option>
            {mics.filter((d) => d.deviceId && d.deviceId !== 'default').map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}
          </Select>
        </FieldWrap>
        <FieldWrap label="Camera" htmlFor="dev-cam">
          <Select id="dev-cam" value={prefs.camId} onChange={(e) => { setPref('camId', e.target.value); stopCam() }}>
            <option value="">System default</option>
            {cams.filter((d) => d.deviceId).map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
          </Select>
        </FieldWrap>
      </div>
      <div className="ctf-devtest__tests">
        <div>
          <Button variant="secondary" size="sm" icon={micLive ? <Square size={13} /> : <Mic size={13} />} onClick={() => (micLive ? stopMic() : void testMic())}>{micLive ? 'Stop test' : 'Test microphone'}</Button>
          <div className="ctf-devtest__meter" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}><i style={{ width: `${level * 100}%` }} /></div>
          <small>{micLive ? 'Speak — the bar should move.' : 'Nothing is recorded or played back.'}</small>
        </div>
        <div>
          <Button variant="secondary" size="sm" icon={camLive ? <Square size={13} /> : <Camera size={13} />} onClick={() => (camLive ? stopCam() : void testCam())}>{camLive ? 'Stop preview' : 'Test camera'}</Button>
          {camLive && <video ref={videoRef} className="ctf-devtest__video" muted playsInline />}
        </div>
      </div>
      {error && <p className="ctf-form-error" role="alert">{error}</p>}
    </div>
  )
}
