import { describe, expect, it, vi } from 'vitest'

/*
  Mimics the supabase-js behaviour that caused a crash: channel(topic) returns the EXISTING channel for a repeated topic,
  and .on() after .subscribe() throws. The unread badge (shell) and the worker overview both subscribe for one user.
*/
vi.mock('../../src/lib/supabase', () => {
  const channels = new Map<string, { subscribed: boolean; on: () => unknown; subscribe: () => unknown }>()
  const supabase = {
    channel(topic: string) {
      const existing = channels.get(topic)
      if (existing) return existing
      const ch = {
        subscribed: false,
        on() { if (ch.subscribed) throw new Error('cannot add `postgres_changes` callbacks after `subscribe()`'); return ch },
        subscribe() { ch.subscribed = true; return ch },
      }
      channels.set(topic, ch)
      return ch
    },
    removeChannel: vi.fn(),
  }
  return { supabase }
})

import { subscribeToNotifications } from '../../src/lib/services/notifications'

describe('subscribeToNotifications', () => {
  it('lets two components subscribe for the same user at once', () => {
    const a = subscribeToNotifications('u-1', () => {})
    expect(() => subscribeToNotifications('u-1', () => {})).not.toThrow()
    a()
  })
})
