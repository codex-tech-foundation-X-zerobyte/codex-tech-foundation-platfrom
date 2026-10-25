import { useEffect, useState } from 'react'

/** The current time, refreshed on an interval — so "expires in 3 minutes" can't go stale, and render stays pure. */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
