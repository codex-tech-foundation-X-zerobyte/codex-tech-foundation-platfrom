import { supabase } from '../supabase'

export interface CreateClientInput {
  organization: string
  contact_name: string
  email: string
  project_id?: string
}

export interface CreateClientResult {
  client_id: string
  temp_password: string
  user_id: string
}

export async function createClient(input: CreateClientInput) {
  const { data, error } = await supabase.functions.invoke('create-client', { body: input })
  if (error || data?.error) {
    return { data: null, error: new Error(data?.error ?? 'Unable to create this client account right now.') }
  }
  return { data: data as CreateClientResult, error: null }
}
