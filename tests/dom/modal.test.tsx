import { useEffect, useRef, useState, type ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Modal } from '../../src/components/ui/Modal'

/** A parent shaped exactly like CreateProjectModal & friends: state in the parent, and a FRESH onClose every render. */
function Harness({ Dialog = Modal }: { Dialog?: (p: { open: boolean; onClose: () => void; title: string; children: ReactNode }) => ReactNode }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const close = () => setName('') // new function identity on every render, like the real forms
  return (
    <Dialog open onClose={close} title="Create thing">
      <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <input aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
    </Dialog>
  )
}

/** The ORIGINAL Modal's focus logic, kept verbatim as a fixture so this suite proves it can detect the bug. */
function OriginalBuggyModal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    dialogRef.current?.focus() // <- steals focus every time the effect re-runs
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose]) // <- onClose changes identity every render => effect re-runs on every keystroke
  if (!open) return null
  return (
    <div role="dialog" ref={dialogRef} tabIndex={-1} aria-label={title}>{children}</div>
  )
}

describe('Modal focus (the "type one letter, it drops out" bug)', () => {
  it('the original implementation loses focus after the first keystroke (bug reproduced)', async () => {
    const user = userEvent.setup()
    render(<Harness Dialog={OriginalBuggyModal} />)
    const input = screen.getByLabelText('Name') as HTMLInputElement
    await user.click(input)
    await user.keyboard('hello')
    // Only the first letter lands; focus was pulled to the dialog before the rest.
    expect(input.value).toBe('h')
    expect(document.activeElement).not.toBe(input)
  })

  it('the fixed Modal keeps focus while typing a whole word', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const input = screen.getByLabelText('Name') as HTMLInputElement
    await user.click(input)
    await user.keyboard('hello world')
    expect(input.value).toBe('hello world')
    expect(document.activeElement).toBe(input)
  })

  it('moves focus into the dialog once on open, and typing in a second field also works', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(document.activeElement).toBe(screen.getByLabelText('Name')) // first field focused on open
    await user.tab()
    await user.keyboard('a@b.co')
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('a@b.co')
    expect(document.activeElement).toBe(screen.getByLabelText('Email'))
  })

  it('Escape still closes (uses the latest onClose)', async () => {
    const user = userEvent.setup()
    let closed = 0
    function Closer() {
      const [n, setN] = useState(0)
      return <Modal open onClose={() => { closed += 1; setN(n + 1) }} title="t"><input aria-label="x" /></Modal>
    }
    render(<Closer />)
    await user.keyboard('{Escape}')
    expect(closed).toBe(1)
  })

  it('a non-dismissible modal ignores Escape and backdrop clicks (one-time password screens)', async () => {
    const user = userEvent.setup()
    let closed = 0
    render(<Modal open dismissible={false} onClose={() => { closed += 1 }} title="Secret"><p>shown once</p></Modal>)
    await user.keyboard('{Escape}')
    await user.pointer({ keys: '[MouseLeft]', target: document.querySelector('.ctf-modal-overlay')! })
    expect(closed).toBe(0)
    await user.click(screen.getByRole('button', { name: 'Close dialog' }))
    expect(closed).toBe(1) // the explicit close button still works
  })

  it('restores focus to the trigger when it closes', async () => {
    const user = userEvent.setup()
    function WithTrigger() {
      const [open, setOpen] = useState(false)
      return (<><button onClick={() => setOpen(true)}>Open</button><Modal open={open} onClose={() => setOpen(false)} title="t"><input aria-label="x" /></Modal></>)
    }
    render(<WithTrigger />)
    const trigger = screen.getByRole('button', { name: 'Open' })
    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(document.activeElement).toBe(trigger)
  })
})
