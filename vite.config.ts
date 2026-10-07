import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import { findExposedSecrets } from './src/lib/keyGuard.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Fail the BUILD (not just the page load) if a secret would be compiled into the public bundle.
  const problems = findExposedSecrets(loadEnv(mode, process.cwd(), 'VITE_'))
  if (problems.length) throw new Error(`Refusing to build — secrets would be published to the browser:\n  - ${problems.join('\n  - ')}`)

  return {
    plugins: [react()],
    test: {
      environment: 'jsdom',
      // Tests run as if served from a normal HTTPS site, so code that (rightly) treats plain http as unsafe sees production-like conditions.
      environmentOptions: { jsdom: { url: 'https://portal.example.com/' } },
      include: ['tests/dom/**/*.test.{ts,tsx}'],
      globals: false,
      css: false,
      setupFiles: ['tests/dom/setup.ts'],
    },
  }
})
