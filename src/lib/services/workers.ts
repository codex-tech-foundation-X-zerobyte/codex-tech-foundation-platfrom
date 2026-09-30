import { supabase } from '../supabase'
import type { WorkerProfile } from '../types'
import { toError } from './shared'
export interface WorkerRow extends WorkerProfile {
  display_name: string
}

export async function listWorkers() {
  const { data: workers, error } = await supabase.from('worker_profiles').select('*').order('join_date', { ascending: false })
  if (error) return { data: [] as WorkerRow[], error: toError(error) }

  const userIds = (workers ?? []).map((w) => w.user_id)
  const { data: profiles } = userIds.length
    ? await supabase.from('profiles').select('id, display_name').in('id', userIds)
    : { data: [] }
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]))

  const rows = (workers ?? []).map((w) => ({ ...w, display_name: nameById.get(w.user_id) ?? 'Unnamed worker' }))
  return { data: rows as WorkerRow[], error: null }
}

export async function updateWorkerStatus(userId: string, status: WorkerProfile['status']) {
  const { error } = await supabase.from('worker_profiles').update({ status }).eq('user_id', userId)
  return { error: toError(error) }
}

export async function getWorkerById(userId: string) {
  const { data: worker, error } = await supabase.from('worker_profiles').select('*').eq('user_id', userId).maybeSingle()
  if (error || !worker) return { data: null, error: toError(error) }
  const { data: profile } = await supabase.from('profiles').select('display_name, organization').eq('id', userId).maybeSingle()
  return { data: { ...worker, display_name: profile?.display_name ?? 'Unnamed worker' } as WorkerRow, error: null }
}

export interface CreateWorkerInput {
  name: string
  email: string
  phone?: string
  position?: string
  department_id?: string
  role?: 'worker' | 'manager'
}

export interface CreateWorkerResult {
  worker_id: string
  temp_password: string
  user_id: string
}

/** Calls the create-worker edge function. The caller's session is attached automatically by supabase-js. */
export async function createWorker(input: CreateWorkerInput) {
  const { data, error } = await supabase.functions.invoke('create-worker', { body: input })
  if (error || data?.error) {
    return { data: null, error: new Error(data?.error ?? 'Unable to create this worker account right now.') }
  }
  return { data: data as CreateWorkerResult, error: null }
}
