import { useState } from 'react'
import { SkeletonRows, useToast } from './ui'
import { getEventPrefs, setEventPref } from '../lib/services'
import { eventsForRole, isEventOn, type EventPrefs, type NotificationChannel, type NotificationKind } from '../lib/notificationEvents'
import { useAsyncData } from '../hooks/useAsyncData'
import { useAuth } from '../lib/auth'
import './NotificationEvents.css'

/** Settings → Notifications: choose, per kind of event, whether it shows in the app and whether it pushes to your devices. */
export function NotificationEvents() {
  const { profile } = useAuth()
  const { push } = useToast()
  const { data, loading } = useAsyncData('event-prefs', getEventPrefs)
  const [local, setLocal] = useState<EventPrefs>({})
  const events = eventsForRole(profile?.role)
  if (events.length === 0) return null
  if (loading) return <SkeletonRows rows={3} height="44px" />

  const prefs: EventPrefs = { ...(data ?? {}), ...local }
  const toggle = async (kind: NotificationKind, channel: NotificationChannel, enabled: boolean) => {
    const before = local[kind]
    setLocal((cur) => ({ ...cur, [kind]: { ...(prefs[kind] ?? {}), [channel]: enabled } })) // instant feedback
    const { error } = await setEventPref(kind, channel, enabled)
    if (error) {
      setLocal((cur) => ({ ...cur, [kind]: before })) // put it back — the choice did not save
      push(error.message || "Couldn't save that choice.", 'error')
    }
  }

  return (
    <div className="ctf-nevents" role="group" aria-label="What to be told about">
      <div className="ctf-nevents__head" aria-hidden>
        <span>Tell me about</span><span>In app</span><span>Push</span>
      </div>
      {events.map((e) => (
        <div key={e.kind} className="ctf-nevents__row">
          <div className="ctf-nevents__what">
            <strong>{e.label}</strong>
            <span>{e.description}</span>
          </div>
          {(['in_app', 'push'] as const).map((channel) => e.channels.includes(channel) ? (
            <label key={channel} className="ctf-nevents__toggle">
              <input type="checkbox" checked={isEventOn(prefs, e.kind, channel)} onChange={(ev) => void toggle(e.kind, channel, ev.target.checked)} aria-label={`${e.label}: ${channel === 'push' ? 'push notification' : 'in-app notification'}`} />
              <span className="ctf-nevents__label">{channel === 'push' ? 'Push' : 'In app'}</span>
            </label>
          ) : <span key={channel} className="ctf-nevents__na" aria-hidden>—</span>)}
        </div>
      ))}
      <p className="ctf-nevents__note">Push also needs to be switched on for each device above. Messages an admin sends you on purpose always arrive.</p>
    </div>
  )
}
