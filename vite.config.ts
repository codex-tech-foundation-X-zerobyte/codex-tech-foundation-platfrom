import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

<<<<<<< HEAD
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
=======
// GitHub Pages serves a project site from a subpath (/<repo-name>/), so
// every asset URL needs that prefix — Vercel serves from the domain root
// and needs none. The GitHub Actions Pages workflow (.github/workflows/
// pages.yml) sets VITE_BASE_PATH to the real repo name automatically; a
// Vercel build never sets it, so it defaults to root there. Don't hardcode
// a repo name here — it would silently break whichever target didn't match it.
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || '/',
>>>>>>> ac4f45b (Codex Tech Foundation platform — through Pass 8)
})
