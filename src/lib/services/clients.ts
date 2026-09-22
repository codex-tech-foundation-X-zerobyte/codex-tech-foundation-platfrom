import { supabase } from '../supabase'
import type { Client } from '../types'
import { toError } from './shared'

export async function listClients() {
  const { data, error } = await supabase.from('clients').select('*').order('created_at', { ascending: false })
  return { data: (data ?? []) as Client[], error: toError(error) }
}

export async function updateClientStatus(id: string, status: Client['status']) {
  const { error } = await supabase.from('clients').update({ status }).eq('id', id)
  return { error: toError(error) }
}

export interface CreateClientInput {
  contact_name: string
  email: string
  organization?: string
  client_id?: string
  project_ids?: string[]
}

export interface CreateClientResult {
  user_id: string
  client_id: string
  client_code: string
  email: string
  temporary_password: string
}

// Calls the create-client Edge Function — the Supabase Auth account,
// clients row (or link to an existing one), client_users row, and Client ID
// are all generated server-side. Mirrors createWorker() in workers.ts
// exactly; see /docs/API-CONTRACT.md.
export async function createClientAccount(input: CreateClientInput) {
  const { data, error } = await supabase.functions.invoke('create-client', { body: input })
  if (error) return { data: null as CreateClientResult | null, error: new Error(error.message ?? 'Could not create the account.') }
  if (data?.error) return { data: null as CreateClientResult | null, error: new Error(data.error) }
  return { data: data as CreateClientResult, error: null }
}
<<<<<<< HEAD
=======

export async function getMyClient() {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { data: null as Client | null, error: null }
  const { data: link } = await supabase.from('client_users').select('client_id').eq('user_id', user.id).eq('status', 'active').maybeSingle()
  if (!link) return { data: null as Client | null, error: null }
  const { data, error } = await supabase.from('clients').select('*').eq('id', link.client_id).maybeSingle()
  return { data: data as Client | null, error: toError(error) }
}
>>>>>>> ac4f45b (Codex Tech Foundation platform — through Pass 8)
