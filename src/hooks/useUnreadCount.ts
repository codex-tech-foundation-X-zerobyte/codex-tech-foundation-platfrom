import { useCallback, useEffect, useRef, useState } from 'react'
import { countUnreadNotifications, subscribeToNotifications, type LiveNotification } from '../lib/services'

const POLL_MS = 90_000

/** Unread notification count that stays fresh via realtime, a slow poll, and window focus. */
/** Tells every open list (the Notifications page) that something new arrived, so it can reload itself. */
export const NOTIFICATION_ARRIVED = 'ctf:notification-arrived'

/**
 * `onNew` is for the ONE place that announces new notifications to the person (the shell). Other callers leave it out, so a notification is
 * announced once however many parts of the app are listening.
 */
export function useUnreadCount(userId: string | undefined, onNew?: (n: LiveNotification) => void) {
  const [count, setCount] = useState(0)
  const onNewRef = useRef(onNew)
  useEffect(() => { onNewRef.current = onNew })

  const refresh = useCallback(() => {
    if (!userId) return
    void countUnreadNotifications().then(({ count: c, error }) => { if (!error) setCount(c) })
  }, [userId])

  useEffect(() => {
    if (!userId) return
    refresh()
    const unsubscribe = subscribeToNotifications(userId, (n) => {
      refresh()
      window.dispatchEvent(new CustomEvent(NOTIFICATION_ARRIVED, { detail: n }))
      onNewRef.current?.(n)
    })
    const timer = setInterval(refresh, POLL_MS)
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    // Lets the notifications page tell the shell "I just marked things read" without prop drilling.
    window.addEventListener('ctf:notifications-changed', onFocus)
    return () => {
      unsubscribe()
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('ctf:notifications-changed', onFocus)
    }
  }, [userId, refresh])

  return { count, refresh }
}
