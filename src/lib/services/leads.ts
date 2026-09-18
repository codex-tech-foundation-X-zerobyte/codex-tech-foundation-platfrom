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
