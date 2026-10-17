import { supabase } from '../supabase'
import { toError } from './shared'
import { getCurrentUserId } from './shared'
import type { EventPrefs, NotificationChannel, NotificationKind } from '../notificationEvents'

/** The signed-in person's per-event notification choices. Missing = on. */
export async function getEventPrefs() {
  const userId = await getCurrentUserId()
  if (!userId) return { data: {} as EventPrefs, error: null }
  const { data, error } = await supabase.from('notification_preferences').select('events').eq('user_id', userId).maybeSingle()
  return { data: ((data?.events as EventPrefs | null) ?? {}) as EventPrefs, error: toError(error) }
}

export async function setEventPref(kind: NotificationKind, channel: NotificationChannel, enabled: boolean) {
  const { error, status } = await supabase.rpc('set_notification_event_pref', { p_kind: kind, p_channel: channel, p_enabled: enabled })
  return { error: toError(error, status) }
}
