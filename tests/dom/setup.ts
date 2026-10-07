import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Modal renders through a portal into <body>; without explicit cleanup, dialogs leak between tests.
afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
})
