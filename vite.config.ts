import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/dom/**/*.test.tsx'],
    globals: false,
    css: false,
    setupFiles: ['tests/dom/setup.ts'],
  },
})
