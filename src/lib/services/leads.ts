import { supabase } from '../supabase'
import type { Lead, StartProjectRequest } from '../types'
<<<<<<< HEAD
=======
import { toError } from './shared'
>>>>>>> ac4f45b (Codex Tech Foundation platform — through Pass 8)

export async function submitLead(lead: Lead) {
  const { error } = await supabase.functions.invoke('submit-lead', { body: lead })
  return { error: error ? new Error('Unable to submit your enquiry right now. Please try again.') : null }
}

export async function submitStartProjectRequest(payload: StartProjectRequest) {
  const { error } = await supabase.functions.invoke('submit-lead', { body: { ...payload, source: 'start-project' } })
  return { error: error ? new Error('Unable to submit your request right now. Please try again.') : null }
}

export async function submitContactMessage(payload: { name: string; email: string; message: string }) {
  const { error } = await supabase.functions.invoke('submit-contact', { body: payload })
  return { error: error ? new Error('Unable to send your message right now. Please try again.') : null }
}
<<<<<<< HEAD
=======

// Admin/worker lead management — gated by the leads.view/leads.manage RLS
// policies from Pass 3 (already correct; no policy changes needed here).
export async function listLeads() {
  const { data, error } = await supabase.from('leads').select('*').order('created_at', { ascending: false })
  return { data: (data ?? []) as Lead[], error: toError(error) }
}

export async function updateLeadStatus(id: string, status: Lead['status']) {
  const { error } = await supabase.from('leads').update({ status }).eq('id', id)
  return { error: toError(error) }
}

export async function updateLeadNotes(id: string, notes: string) {
  const { error } = await supabase.from('leads').update({ notes }).eq('id', id)
  return { error: toError(error) }
}

export async function assignLead(id: string, userId: string | null) {
  const { error } = await supabase.from('leads').update({ assigned_to: userId }).eq('id', id)
  return { error: toError(error) }
}
>>>>>>> ac4f45b (Codex Tech Foundation platform — through Pass 8)
