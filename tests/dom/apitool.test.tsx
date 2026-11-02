import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ApiTool from '../../src/pages/tools/tools/ApiTool'

// httpbin semantics: each endpoint serves exactly one method; anything else is 405.
const SERVES: Record<string, string> = { '/get': 'GET', '/post': 'POST', '/put': 'PUT', '/patch': 'PATCH', '/delete': 'DELETE' }
const calls: { url: string; method: string }[] = []

beforeEach(() => {
  calls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    calls.push({ url: url.href, method })
    const ok = SERVES[url.pathname] === method || (url.pathname === '/get' && method === 'HEAD')
    return new Response(ok ? '{"ok":true}' : '', { status: ok ? 200 : 405, headers: { 'content-type': 'application/json', ...(ok ? {} : { allow: SERVES[url.pathname] ?? 'GET' }) } })
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('API tool method handling', () => {
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
    it(`${method}: sends exactly ${method} to an endpoint that serves it (no 405)`, async () => {
      const user = userEvent.setup()
      render(<ApiTool />)
      await user.selectOptions(screen.getByLabelText('Method'), method)
      await user.click(screen.getByRole('button', { name: /send request/i }))
      await waitFor(() => expect(calls).toHaveLength(1))
      expect(calls[0].method).toBe(method)
      expect(calls[0].url).toBe(method === 'HEAD' ? 'https://httpbin.org/get' : `https://httpbin.org/${method.toLowerCase()}`)
      await waitFor(() => expect(screen.getByText(/200/)).toBeTruthy())
      expect(screen.queryByText(/405/)).toBeNull()
    })
  }

  it('PATCH specifically (the reported bug) no longer produces PATCH /get', async () => {
    const user = userEvent.setup()
    render(<ApiTool />)
    await user.selectOptions(screen.getByLabelText('Method'), 'PATCH')
    expect((screen.getByLabelText('URL') as HTMLInputElement).value).toBe('https://httpbin.org/patch')
    await user.click(screen.getByRole('button', { name: /send request/i }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual({ url: 'https://httpbin.org/patch', method: 'PATCH' })
  })

  it('a URL the user typed is never rewritten when they change the method', async () => {
    const user = userEvent.setup()
    render(<ApiTool />)
    const url = screen.getByLabelText('URL') as HTMLInputElement
    await user.clear(url)
    await user.type(url, 'https://api.example.com/v1/things/42')
    await user.selectOptions(screen.getByLabelText('Method'), 'PATCH')
    expect(url.value).toBe('https://api.example.com/v1/things/42')
    await user.click(screen.getByRole('button', { name: /send request/i }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual({ url: 'https://api.example.com/v1/things/42', method: 'PATCH' })
  })

  it('a deliberate mismatch is sent as configured (not hidden), with a warning beforehand and an explanation after', async () => {
    const user = userEvent.setup()
    render(<ApiTool />)
    await user.selectOptions(screen.getByLabelText('Method'), 'PATCH')
    const url = screen.getByLabelText('URL') as HTMLInputElement
    await user.clear(url)
    await user.type(url, 'https://httpbin.org/get')
    expect(screen.getByText(/only accepts GET \/ HEAD, so PATCH will get 405/)).toBeTruthy() // advice, before sending
    await user.click(screen.getByRole('button', { name: /send request/i }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual({ url: 'https://httpbin.org/get', method: 'PATCH' }) // the user's intent is respected, not rewritten
    await waitFor(() => expect(screen.getByText(/The server doesn't accept/)).toBeTruthy())
    expect(screen.getAllByText(/405/).length).toBeGreaterThan(0) // the error is shown, not suppressed
  })

  it('never sends the app\'s cookies or referrer to a third-party URL', async () => {
    const user = userEvent.setup()
    render(<ApiTool />)
    await user.click(screen.getByRole('button', { name: /send request/i }))
    await waitFor(() => expect(calls).toHaveLength(1))
    const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit
    expect(init.credentials).toBe('omit')
    expect(init.referrerPolicy).toBe('no-referrer')
  })
})
