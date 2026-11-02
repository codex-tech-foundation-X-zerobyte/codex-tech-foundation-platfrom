import { useCallback, useEffect, useRef, useState } from 'react'
import {
  endPresentation, getPresentation, measureServerOffset, pingPresentation, subscribeToPresentation, writeStageState,
  type PresentationListItem, type PresentationSession, type StageState,
} from '../lib/services'

const PING_MS = 60_000
const SAFETY_REFRESH_MS = 15_000
const WRITE_GAP_MS = 250

/**
 * One presentation, live. Everyone gets the row and its updates over Realtime; the presenter additionally gets `commit` to change what
 * is on stage. Writes are coalesced (latest wins, at most ~4 a second) and the screen updates immediately, before the server confirms.
 * A slow safety refresh heals any Realtime message that was missed (a laptop waking from sleep, a flaky network).
 */
export function usePresentation(id: string, myId: string | undefined) {
  const [session, setSession] = useState<PresentationListItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [connected, setConnected] = useState(true)
  const [writeError, setWriteError] = useState<string | null>(null)
  const [serverOffset, setServerOffset] = useState(0)
  const sessionRef = useRef<PresentationListItem | null>(null)
  const pending = useRef<StageState | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastWrite = useRef(0)

  const apply = useCallback((patch: Partial<PresentationSession>) => {
    const cur = sessionRef.current
    if (!cur) return
    // Ignore a stale message that arrives after a newer one.
    if (typeof patch.state_version === 'number' && patch.state !== undefined && patch.state_version < cur.state_version) return
    const next = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as PresentationListItem
    sessionRef.current = next
    setSession(next)
  }, [])

  const load = useCallback(async () => {
    const { data, error: err } = await getPresentation(id)
    if (err) { setError(err); setLoading(false); return }
    sessionRef.current = data
    setSession(data)
    setLoading(false)
  }, [id])

  useEffect(() => {
    let alive = true
    sessionRef.current = null
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when switching rooms
    setLoading(true); setError(null); setSession(null)
    void load()
    void measureServerOffset().then((o) => { if (alive) setServerOffset(o) })
    const unsub = subscribeToPresentation(id, (row) => { if (alive) apply(row) }, (ok) => { if (alive) setConnected(ok) })
    const refresh = setInterval(() => { if (document.visibilityState === 'visible') void load() }, SAFETY_REFRESH_MS)
    const wake = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', wake)
    return () => { alive = false; unsub(); clearInterval(refresh); document.removeEventListener('visibilitychange', wake) }
  }, [id, apply, load])

  const isPresenter = !!myId && session?.presenter_id === myId
  const live = session?.status === 'live'

  // Presenter heartbeat
  useEffect(() => {
    if (!isPresenter || !live) return
    const t = setInterval(() => { void pingPresentation(id) }, PING_MS)
    return () => clearInterval(t)
  }, [id, isPresenter, live])

  const flush = useCallback(async () => {
    timer.current = null
    const state = pending.current
    if (!state) return
    pending.current = null
    lastWrite.current = Date.now()
    const { version, error: err } = await writeStageState(id, state)
    if (err) { setWriteError(err.message); return }
    setWriteError(null)
    if (version !== null) apply({ state_version: Math.max(version, sessionRef.current?.state_version ?? 0) })
  }, [id, apply])

  /** Show this on stage now (locally) and send it to everyone (coalesced). */
  const commit = useCallback((state: StageState, opts: { immediate?: boolean } = {}) => {
    if (!isPresenter) return
    apply({ state })
    pending.current = state
    if (opts.immediate) { if (timer.current) clearTimeout(timer.current); void flush(); return }
    if (timer.current) return
    const wait = Math.max(0, WRITE_GAP_MS - (Date.now() - lastWrite.current))
    timer.current = setTimeout(() => void flush(), wait)
  }, [isPresenter, apply, flush])

  // Never lose the last change when the presenter leaves.
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); void flush() } }, [flush])

  const end = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); await flush() }
    const { error: err } = await endPresentation(id)
    if (!err) apply({ status: 'ended' })
    return err
  }, [id, apply, flush])

  return { session, loading, error, connected, writeError, serverOffset, isPresenter, live, commit, end, reload: load }
}
