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

<<<<<<< HEAD
=======
<<<<<<< HEAD
=======
>>>>>>> 061b8d9550595bf4603704f9a719614dc376af1a
export async function getMyWorkerProfile() {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { data: null as WorkerProfile | null, error: null }
  const { data, error } = await supabase.from('worker_profiles').select('*').eq('user_id', user.id).maybeSingle()
  return { data: data as WorkerProfile | null, error: toError(error) }
}
<<<<<<< HEAD
=======
>>>>>>> ac4f45b (Codex Tech Foundation platform — through Pass 8)
>>>>>>> 061b8d9550595bf4603704f9a719614dc376af1a
export async function updateWorkerStatus(userId: string, status: WorkerProfile['status']) {
  const { error } = await supabase.from('worker_profiles').update({ status }).eq('user_id', userId)
  return { error: toError(error) }
}

export interface CreateWorkerInput {
  display_name: string
  email: string
  phone?: string
  position?: string
  bio?: string
  role?: 'worker' | 'manager'
}

export interface CreateWorkerResult {
  user_id: string
  worker_id: string
  email: string
  temporary_password: string
  role: 'worker' | 'manager'
}

// Calls the create-worker Edge Function — the Supabase Auth account and
// worker_id are generated server-side with the service role. This client
// never sees or holds a service-role key; the Edge Function checks the
// caller's own `workers.create` permission before doing anything.
export async function createWorker(input: CreateWorkerInput) {
  const { data, error } = await supabase.functions.invoke('create-worker', { body: input })
  if (error) return { data: null as CreateWorkerResult | null, error: new Error(error.message ?? 'Could not create the account.') }
  if (data?.error) return { data: null as CreateWorkerResult | null, error: new Error(data.error) }
  return { data: data as CreateWorkerResult, error: null }
}
