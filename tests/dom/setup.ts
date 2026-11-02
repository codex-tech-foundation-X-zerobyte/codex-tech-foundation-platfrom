import { configure } from '@testing-library/react'

// Interaction tests wait for async UI (data loads, debounces). One second is tight when many files run at once; a stuck wait still fails.
configure({ asyncUtilTimeout: 4000 })

import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Modal renders through a portal into <body>; without explicit cleanup, dialogs leak between tests.
afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
})
