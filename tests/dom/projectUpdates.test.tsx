import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let role = 'worker'
let managerHasPermission = false
let publishResult: { error: Error | null } = { error: null }
const toasts: { message: string; tone?: string }[] = []
const published: unknown[] = []

vi.mock('../../src/lib/auth', () => ({ useAuth: () => ({ profile: { id: 'u1', display_name: 'U', role } }) }))
vi.mock('../../src/lib/services', () => ({
  listProjectUpdates: async () => ({ data: [], error: null }),
  hasPermission: async (key: string) => key === 'projects.update' && managerHasPermission,
  publishProjectUpdate: async (input: unknown) => { published.push(input); return publishResult },
  // the rest of ProjectWorkspace's imports, unused by UpdatesTab
  createMilestone: vi.fn(), createTask: vi.fn(), deleteProjectFile: vi.fn(), getProject: vi.fn(), getProjectFileUrl: vi.fn(),
  listProjectFiles: vi.fn(), listProjectMilestones: vi.fn(), listTasks: vi.fn(), updateMilestone: vi.fn(),
  updateProjectStatus: vi.fn(), updateTaskStatus: vi.fn(), uploadProjectFile: vi.fn(),
}))
vi.mock('../../src/components/ui', async (orig) => ({ ...(await orig<typeof import('../../src/components/ui')>()), useToast: () => ({ push: (message: string, tone?: string) => toasts.push({ message, tone }) }) }))
vi.mock('../../src/pages/project/RequestsTab', () => ({ RequestsTab: () => null }))

import { UpdatesTab } from '../../src/pages/project/ProjectWorkspace'

describe('Publish update (project_updates 403)', () => {
  beforeEach(() => { role = 'worker'; managerHasPermission = false; publishResult = { error: null }; toasts.length = 0; published.length = 0 })

  it('workers and superadmins see the Publish button', async () => {
    for (const r of ['worker', 'superadmin']) {
      role = r
      const { unmount } = render(<UpdatesTab projectId="p1" />)
      expect(await screen.findByRole('button', { name: /publish update/i })).toBeTruthy()
      unmount()
    }
  })

  it('a client never sees it, and is not offered a way to try', async () => {
    role = 'client'
    render(<UpdatesTab projectId="p1" />)
    await screen.findByText(/no updates yet/i)
    expect(screen.queryByRole('button', { name: /publish update/i })).toBeNull()
  })

  it('a manager WITHOUT projects.update is blocked in the UI with a clear explanation', async () => {
    role = 'manager'; managerHasPermission = false
    render(<UpdatesTab projectId="p1" />)
    expect(await screen.findByText(/needs project edit access/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /publish update/i })).toBeNull()
  })

  it('a manager WITH projects.update can publish', async () => {
    role = 'manager'; managerHasPermission = true
    render(<UpdatesTab projectId="p1" />)
    expect(await screen.findByRole('button', { name: /publish update/i })).toBeTruthy()
  })

  it('publishes trimmed content and confirms', async () => {
    const user = userEvent.setup()
    render(<UpdatesTab projectId="p1" />)
    await user.click(await screen.findByRole('button', { name: /publish update/i }))
    await user.type(screen.getByLabelText(/title/i), '  Launch week  ')
    await user.type(screen.getByLabelText(/details/i), 'All green.')
    await user.click(screen.getAllByRole('button', { name: /publish/i }).at(-1)!)
    await waitFor(() => expect(published).toHaveLength(1))
    expect(published[0]).toMatchObject({ project_id: 'p1', title: 'Launch week', body: 'All green.' })
    await waitFor(() => expect(toasts.map((t) => t.message)).toContain('Update published'))
  })

  it('when the server refuses, the user sees the REAL reason rather than a generic line', async () => {
    publishResult = { error: new Error("You don't have permission to do that.") }
    const user = userEvent.setup()
    render(<UpdatesTab projectId="p1" />)
    await user.click(await screen.findByRole('button', { name: /publish update/i }))
    await user.type(screen.getByLabelText(/title/i), 'T')
    await user.type(screen.getByLabelText(/details/i), 'B')
    await user.click(screen.getAllByRole('button', { name: /publish/i }).at(-1)!)
    await waitFor(() => expect(toasts.at(-1)).toEqual({ message: "You don't have permission to do that.", tone: 'error' }))
  })
})
