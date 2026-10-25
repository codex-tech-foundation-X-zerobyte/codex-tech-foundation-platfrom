import { supabase } from '../supabase'
import { storageKey } from '../storagePath'
import type { StageKind } from '../presentation'
import { getCurrentUserId, storage, toError } from './shared'

export type PresentationVisibility = 'department' | 'company'
export type StageState = Record<string, unknown>

export interface PresentationSession {
  id: string
  department_id: string | null
  presenter_id: string
  title: string
  kind: StageKind
  visibility: PresentationVisibility
  status: 'live' | 'ended'
  state: StageState
  state_version: number
  started_at: string
  ended_at: string | null
  updated_at: string
}

export interface PresentationListItem extends PresentationSession { presenter_name: string; department_name: string | null }

const COLUMNS = 'id, department_id, presenter_id, title, kind, visibility, status, state, state_version, started_at, ended_at, updated_at'
const BUCKET = 'presentations'
/** A live session untouched for this long is treated as abandoned (a presenter pings every minute while the stage is open). */
const LIVE_WINDOW_MS = 8 * 60 * 60 * 1000

/** Live sessions you can see, then the most recent finished ones. Row-level security decides what "you can see" means. */
export async function listPresentations() {
  const since = new Date(Date.now() - LIVE_WINDOW_MS).toISOString()
  const [live, ended] = await Promise.all([
    supabase.from('presentation_sessions').select(COLUMNS).eq('status', 'live').gte('updated_at', since).order('started_at', { ascending: false }).limit(50),
    supabase.from('presentation_sessions').select(COLUMNS).eq('status', 'ended').order('ended_at', { ascending: false }).limit(12),
  ])
  const error = live.error ?? ended.error
  if (error) return { data: { live: [] as PresentationListItem[], recent: [] as PresentationListItem[] }, error: toError(error) }
  const rows = [...(live.data ?? []), ...(ended.data ?? [])] as PresentationSession[]
  const presenterIds = [...new Set(rows.map((r) => r.presenter_id))]
  const deptIds = [...new Set(rows.map((r) => r.department_id).filter((x): x is string => !!x))]
  const [profiles, depts] = await Promise.all([
    presenterIds.length ? supabase.from('profiles').select('id, display_name').in('id', presenterIds) : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
    deptIds.length ? supabase.from('departments').select('id, name').in('id', deptIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ])
  const names = new Map((profiles.data ?? []).map((p) => [p.id, p.display_name]))
  const deptNames = new Map((depts.data ?? []).map((d) => [d.id, d.name]))
  const decorate = (r: PresentationSession): PresentationListItem => ({ ...r, presenter_name: names.get(r.presenter_id) || 'A teammate', department_name: r.department_id ? deptNames.get(r.department_id) ?? null : null })
  return { data: { live: (live.data as PresentationSession[]).map(decorate), recent: (ended.data as PresentationSession[]).map(decorate) }, error: null }
}

export async function getPresentation(id: string) {
  const { data, error } = await supabase.from('presentation_sessions').select(COLUMNS).eq('id', id).maybeSingle()
  if (error) return { data: null, error: toError(error) }
  if (!data) return { data: null, error: null }
  const [{ data: p }, { data: d }] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', data.presenter_id).maybeSingle(),
    data.department_id ? supabase.from('departments').select('name').eq('id', data.department_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  return { data: { ...(data as PresentationSession), presenter_name: p?.display_name || 'A teammate', department_name: (d as { name: string } | null)?.name ?? null } as PresentationListItem, error: null }
}

export interface StartPresentationInput { department_id: string | null; title: string; kind: StageKind; visibility: PresentationVisibility; state?: StageState }

export async function startPresentation(input: StartPresentationInput) {
  const userId = await getCurrentUserId()
  if (!userId) return { data: null, error: new Error('Your session has expired. Please sign in again.') }
  const { data, error, status } = await supabase.from('presentation_sessions')
    .insert({ presenter_id: userId, department_id: input.department_id, title: input.title.trim(), kind: input.kind, visibility: input.visibility, state: input.state ?? {} })
    .select(COLUMNS).single()
  if (error || !data) return { data: null, error: toError(error, status) ?? new Error('Could not start the presentation.') }
  return { data: data as PresentationSession, error: null }
}

/** Replaces what is on stage. Only the presenter can; the database refuses anyone else. */
export async function writeStageState(id: string, state: StageState) {
  const { data, error, status } = await supabase.from('presentation_sessions').update({ state }).eq('id', id).eq('status', 'live').select('state_version')
  if (error) return { version: null, error: toError(error, status) }
  if ((data?.length ?? 0) === 0) return { version: null, error: new Error('This presentation has ended, or you are not the presenter.') }
  return { version: data![0].state_version as number, error: null }
}

/** Presenter heartbeat: keeps the session "live" in everyone's list. */
export async function pingPresentation(id: string) {
  await supabase.from('presentation_sessions').update({ status: 'live' }).eq('id', id).eq('status', 'live')
}

export async function endPresentation(id: string) {
  const { data, error, status } = await supabase.from('presentation_sessions').update({ status: 'ended' }).eq('id', id).select('id')
  if (error) return { error: toError(error, status) }
  if ((data?.length ?? 0) === 0) return { error: new Error('Only the presenter or a Main Admin can end this.') }
  return { error: null }
}

/** Deletes the session and the files shown in it. */
export async function deletePresentation(id: string) {
  const { data: files } = await supabase.storage.from(BUCKET).list(id, { limit: 100 })
  if (files?.length) await storage.remove(BUCKET, files.map((f) => `${id}/${f.name}`))
  const { data, error, status } = await supabase.from('presentation_sessions').delete().eq('id', id).select('id')
  if (error) return { error: toError(error, status) }
  if ((data?.length ?? 0) === 0) return { error: new Error('Only the presenter or a Main Admin can delete this.') }
  return { error: null }
}

export async function uploadPresentationFile(sessionId: string, file: File) {
  const path = storageKey([sessionId], file.name)
  const { error } = await storage.upload(BUCKET, path, file)
  return error ? { path: null, error } : { path, error: null }
}

export async function presentationFileUrl(path: string) {
  return storage.getSignedUrl(BUCKET, path, 60 * 60)
}

/** serverNow - localNow, in ms, measured once and corrected for half the round trip. */
export async function measureServerOffset(): Promise<number> {
  const t0 = Date.now()
  const { data, error } = await supabase.rpc('server_time_ms')
  const t1 = Date.now()
  if (error || typeof data !== 'number') return 0
  return data - (t0 + (t1 - t0) / 2)
}

/** Live updates for one session. Unchanged large columns can be missing from an UPDATE payload, so callers must MERGE the row. */
export function subscribeToPresentation(id: string, onRow: (row: Partial<PresentationSession>) => void, onStatus?: (ok: boolean) => void): () => void {
  const channel = supabase.channel(`presentation:${id}:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'presentation_sessions', filter: `id=eq.${id}` }, (p) => onRow(p.new as Partial<PresentationSession>))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'presentation_sessions', filter: `id=eq.${id}` }, () => onRow({ status: 'ended' }))
    .subscribe((s) => onStatus?.(s === 'SUBSCRIBED'))
  return () => { void supabase.removeChannel(channel) }
}

/** Anything started, updated or ended among the sessions you can see: lets the list refresh itself. */
export function subscribeToPresentationList(onChange: () => void): () => void {
  const channel = supabase.channel(`presentations-list:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'presentation_sessions' }, () => onChange())
    .subscribe()
  return () => { void supabase.removeChannel(channel) }
}
