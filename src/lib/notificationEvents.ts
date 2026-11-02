/**
 * The kinds of event a person can switch on or off, and who is offered which. Pure data + two tiny functions, shared in
 * spirit with supabase/functions/_shared/pushPayload.ts (isPushAllowed) and the SQL in migration 20260930000002 — the kind
 * names here MUST match public.notification_kind() and set_notification_event_pref().
 */

export type NotificationKind = 'chat' | 'calls' | 'mentions' | 'tasks' | 'projects' | 'announcements' | 'meetings' | 'approvals'
export type NotificationChannel = 'in_app' | 'push'

export interface NotificationEventDef {
  kind: NotificationKind
  label: string
  description: string
  /** Chat and calls have no in-app notification row (they have their own badges and ringing), so only push applies. */
  channels: NotificationChannel[]
  roles: string[]
}

const STAFF = ['worker', 'manager', 'superadmin']

export const NOTIFICATION_EVENTS: NotificationEventDef[] = [
  { kind: 'chat', label: 'Chat messages', description: 'New messages in your channels and direct messages.', channels: ['push'], roles: STAFF },
  { kind: 'calls', label: 'Calls', description: 'Someone calls you, or starts a group call in one of your channels.', channels: ['push'], roles: STAFF },
  { kind: 'mentions', label: 'Mentions', description: 'Someone @mentions you on a task.', channels: ['in_app', 'push'], roles: STAFF },
  { kind: 'tasks', label: 'Tasks', description: 'Comments, status changes and tasks or action items assigned to you.', channels: ['in_app', 'push'], roles: STAFF },
  { kind: 'projects', label: 'Project updates', description: 'Progress updates and new department assignments on your projects.', channels: ['in_app', 'push'], roles: [...STAFF, 'client'] },
  { kind: 'announcements', label: 'Announcements', description: 'Company and department announcements.', channels: ['in_app', 'push'], roles: STAFF },
  { kind: 'meetings', label: 'Meetings', description: 'Meeting invitations.', channels: ['in_app', 'push'], roles: STAFF },
  { kind: 'approvals', label: 'Approvals', description: 'Suspension reviews and decisions that need you.', channels: ['in_app', 'push'], roles: ['manager', 'superadmin'] },
]

export const eventsForRole = (role: string | null | undefined) => NOTIFICATION_EVENTS.filter((e) => role !== null && role !== undefined && e.roles.includes(role))

export type EventPrefs = Partial<Record<string, Partial<Record<NotificationChannel, boolean>>>>

/** Everything is ON until someone turns it off. */
export const isEventOn = (prefs: EventPrefs | null | undefined, kind: string, channel: NotificationChannel) => prefs?.[kind]?.[channel] !== false
