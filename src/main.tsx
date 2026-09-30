import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

/*
  Route code-splitting means each page is its own hashed file. After a deploy, a tab that was already open asks for a
  chunk name that no longer exists and the navigation fails. Vite emits `vite:preloadError` for exactly this; the fix is a
  reload to pick up the new build. The sessionStorage flag stops a genuinely broken deploy from reload-looping.
*/
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  if (sessionStorage.getItem('ctf:chunk-reload') === '1') return
  sessionStorage.setItem('ctf:chunk-reload', '1')
  window.location.reload()
})
window.addEventListener('load', () => setTimeout(() => sessionStorage.removeItem('ctf:chunk-reload'), 10_000))

const rootEl = document.getElementById('root')!
const root = createRoot(rootEl)

// supabase.ts throws synchronously if required env vars are missing — catch
// that specific case here and render a visible, actionable message instead
// of the blank white page a thrown module-level error would otherwise leave
// behind (an uncaught error during the initial import graph never reaches
// React's own error boundaries, since it happens before render).
try {
  const { default: App } = await import('./App.tsx')
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
} catch (err) {
  const message = err instanceof Error ? err.message : 'Unknown startup error.'
  root.render(
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'system-ui, sans-serif', background: '#05070b', color: '#f5f7fa' }}>
      <div style={{ maxWidth: 520 }}>
        <h1 style={{ fontSize: 20, marginBottom: 12 }}>Codex Tech Foundation couldn&rsquo;t start</h1>
        <p style={{ fontSize: 14, color: '#8e9aaa', lineHeight: 1.6 }}>{message}</p>
      </div>
    </div>,
  )
  console.error(err)
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'))
}
