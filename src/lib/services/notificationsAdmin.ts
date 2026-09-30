import { supabase } from '../supabase'

export type NotificationAudience =
  | { kind: 'user'; user_id: string }
  | { kind: 'project'; project_id: string }
  | { kind: 'workers' }
  | { kind: 'managers' }
  | { kind: 'everyone_internal' }

export async function sendNotification(input: { title: string; message: string; audience: NotificationAudience }) {
  const { data, error } = await supabase.functions.invoke('send-notification', { body: input })
  if (error || data?.error) {
    return { error: new Error(data?.error ?? 'Unable to send this notification right now.') }
  }
  return { error: null, sent: data?.sent as number | undefined }
}
