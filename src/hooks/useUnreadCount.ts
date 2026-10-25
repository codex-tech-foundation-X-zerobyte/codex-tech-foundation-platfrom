import { useCallback, useEffect, useState } from 'react'
import { countUnreadNotifications, subscribeToNotifications } from '../lib/services'

const POLL_MS = 90_000

/** Unread notification count that stays fresh via realtime, a slow poll, and window focus. */
export function useUnreadCount(userId: string | undefined) {
  const [count, setCount] = useState(0)

  const refresh = useCallback(() => {
    if (!userId) return
    void countUnreadNotifications().then(({ count: c, error }) => { if (!error) setCount(c) })
  }, [userId])

  useEffect(() => {
    if (!userId) return
    refresh()
    const unsubscribe = subscribeToNotifications(userId, refresh)
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
