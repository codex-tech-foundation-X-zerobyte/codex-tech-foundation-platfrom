import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
<<<<<<< HEAD
import { initTheme } from './lib/theme'
import { hasValidConfig } from './lib/supabase'

// Applied synchronously before the first paint — doing this after React
// mounts would cause a visible flash of the wrong theme on every load.
initTheme()

const root = createRoot(document.getElementById('root')!)

if (!hasValidConfig) {
  // One clear message instead of letting the app boot and produce a wall
  // of per-request network errors (timeouts, 403s, 400s, WebSocket
  // failures) that all trace back to this one root cause — missing or
  // wrong Supabase environment variables. See docs/DEPLOYMENT.md.
  root.render(
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'system-ui, sans-serif', background: '#05070b', color: '#f5f7fa' }}>
      <div style={{ maxWidth: 480, textAlign: 'center' }}>
        <h1 style={{ fontSize: 20, marginBottom: 12 }}>Configuration error</h1>
        <p style={{ color: '#8e9aaa', lineHeight: 1.6 }}>
          This deployment is missing <code>VITE_SUPABASE_URL</code> and/or <code>VITE_SUPABASE_ANON_KEY</code>.
          The app cannot connect to Supabase without them. Check your environment variables
          (Vercel: Project Settings → Environment Variables; local dev: <code>.env.local</code>)
          and redeploy or restart.
        </p>
      </div>
    </div>,
  )
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
=======

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
>>>>>>> 061b8d9550595bf4603704f9a719614dc376af1a

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'))
}
