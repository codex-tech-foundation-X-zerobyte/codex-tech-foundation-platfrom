import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { ProtectedRoute } from '../../src/components/ProtectedRoute'
import { Table } from '../../src/components/ui/Table'
import { Button } from '../../src/components/ui/Button'

describe('ProtectedRoute', () => {
  const tree = (role: 'worker' | 'client' | null) => (
    <MemoryRouter initialEntries={['/worker/tasks']}>
      <Routes>
        <Route path="/login" element={<div>LOGIN PAGE</div>} />
        <Route path="/worker/*" element={<ProtectedRoute allowedRoles={['worker']} activeRole={role}><div>WORKER AREA</div></ProtectedRoute>} />
        <Route path="/client" element={<div>CLIENT HOME</div>} />
      </Routes>
    </MemoryRouter>
  )

  it('sends a signed-out visitor to the login page instead of a dead end', () => {
    render(tree(null))
    expect(screen.getByText('LOGIN PAGE')).toBeTruthy()
    expect(screen.queryByText('WORKER AREA')).toBeNull()
  })
  it('lets the right role in', () => {
    render(tree('worker'))
    expect(screen.getByText('WORKER AREA')).toBeTruthy()
  })
  it('blocks the wrong role but gives them a way back to their own workspace', () => {
    render(tree('client'))
    expect(screen.queryByText('WORKER AREA')).toBeNull()
    expect(screen.getByRole('link', { name: /go to your workspace/i }).getAttribute('href')).toBe('/client')
  })
})

describe('Table', () => {
  const columns = [{ key: 'n', header: 'Name', render: (r: { id: string; n: string }) => r.n }]
  it('rows are reachable by keyboard and open with Enter / Space', async () => {
    const user = userEvent.setup()
    const onRowClick = vi.fn()
    render(<Table columns={columns} rows={[{ id: '1', n: 'Acme' }]} rowKey={(r) => r.id} onRowClick={onRowClick} />)
    await user.tab()
    expect(document.activeElement?.tagName).toBe('TR')
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onRowClick).toHaveBeenCalledTimes(2)
  })
  it('plain (non-clickable) rows are not focus stops', () => {
    render(<Table columns={columns} rows={[{ id: '1', n: 'Acme' }]} rowKey={(r) => r.id} />)
    expect(document.querySelector('tr[tabindex]')).toBeNull()
  })
})

describe('Button', () => {
  it('defaults to type="button" so Cancel inside a form never submits it', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault())
    render(<form onSubmit={onSubmit}><Button>Cancel</Button><Button type="submit">Save</Button></form>)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onSubmit).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})
