import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BrowserStage } from '../../src/pages/present/stages/BrowserStage'
import { isBlockedStageOrigin, normalizeStageUrl, stageBlockedOrigins } from '../../src/lib/presentation'

const props = (state: Record<string, unknown>, isPresenter = false) => ({ state, isPresenter, commit: vi.fn(), sessionId: 's1', serverOffset: 0 })
const frame = () => document.querySelector('iframe')

describe('the in-app browser never frames an unsafe address (it may have been written straight to the database)', () => {
  it.each(['javascript:fetch(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'blob:https://x/abc', 'file:///etc/passwd', 'http://example.com/', 'https://user:pw@example.com/'])('refuses %s', (url) => {
    render(<BrowserStage {...props({ url })} />)
    expect(frame()).toBeNull()
    expect(screen.getByRole('alert').textContent).toMatch(/not shown/i)
  })

  it("refuses this app's own address, so a framed page can't remove its own sandbox", () => {
    render(<BrowserStage {...props({ url: `${window.location.origin}/worker` })} />)
    expect(frame()).toBeNull()
    expect(screen.getByRole('alert').textContent).toMatch(/not shown/i)
  })

  it('frames a normal https page, and tells everyone it is an outside site', () => {
    render(<BrowserStage {...props({ url: 'https://example.com/app' })} />)
    expect(frame()?.getAttribute('src')).toBe('https://example.com/app')
    expect(screen.getByRole('note').textContent).toMatch(/outside website/i)
    expect(screen.getByRole('note').textContent).toContain('example.com')
    expect(screen.getByRole('note').textContent).toMatch(/never type your Workspace password/i)
  })

  it('shows nothing and no warning when nothing is on stage', () => {
    render(<BrowserStage {...props({})} />)
    expect(frame()).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('the presenter is told when they try to present the Workspace itself', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    render(<BrowserStage {...props({}, true)} />)
    await userEvent.type(screen.getByLabelText('Address'), `${window.location.origin}/admin{enter}`)
    expect(screen.getByRole('alert').textContent).toMatch(/this Workspace itself/i)
  })
})

describe('normalizeStageUrl blocked origins', () => {
  it('blocks only the exact origins given', () => {
    const blocked = ['https://app.example.com']
    expect(normalizeStageUrl('https://app.example.com/x', { blockedOrigins: blocked })).toBeNull()
    expect(normalizeStageUrl('https://other.example.com/x', { blockedOrigins: blocked })).not.toBeNull()
    expect(normalizeStageUrl('https://app.example.com.evil.io/', { blockedOrigins: blocked })).not.toBeNull()
    expect(isBlockedStageOrigin('app.example.com', blocked)).toBe(true)
    expect(isBlockedStageOrigin('javascript:1', blocked)).toBe(false)
  })
  it('includes this app and the database', () => {
    expect(stageBlockedOrigins('https://ws.example.com', 'https://abc.supabase.co/rest')).toEqual(['https://ws.example.com', 'https://abc.supabase.co'])
    expect(stageBlockedOrigins('https://ws.example.com', 'nonsense')).toEqual(['https://ws.example.com'])
  })
})
