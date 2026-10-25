import { supabase } from '../supabase'
import type { Lead, StartProjectRequest } from '../types'

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

export async function listAllLeads() {
  const { data, error } = await supabase.from('leads').select('*').order('created_at', { ascending: false })
  return { data: (data ?? []) as Lead[], error: error ? new Error(error.message) : null }
}

export async function updateLeadStatus(id: string, status: Lead['status']) {
  const { error } = await supabase.from('leads').update({ status }).eq('id', id)
  return { error: error ? new Error(error.message) : null }
}

export async function updateLeadNotes(id: string, notes: string) {
  const { data, error } = await supabase.from('leads').update({ internal_notes: notes.slice(0, 4000) }).eq('id', id).select('id')
  if (error) return { error: new Error(error.message) }
  if ((data?.length ?? 0) === 0) return { error: new Error("You don't have permission to edit this lead.") }
  return { error: null }
}

/** Sets one status on many leads. Returns how many actually changed (RLS can silently skip rows). */
export async function updateLeadStatusMany(ids: string[], status: NonNullable<Lead['status']>) {
  const { data, error } = await supabase.from('leads').update({ status }).in('id', ids).select('id')
  return { updated: data?.length ?? 0, error: error ? new Error(error.message) : null }
}
