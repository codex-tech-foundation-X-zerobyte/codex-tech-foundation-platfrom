import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, Info, X, XCircle } from 'lucide-react'
import './Toast.css'

type ToastTone = 'success' | 'error' | 'info'
interface ToastAction { label: string; onClick: () => void | Promise<void> }
interface ToastOptions { action?: ToastAction; durationMs?: number }
interface ToastItem { id: number; tone: ToastTone; message: string; action?: ToastAction }

const ToastContext = createContext<{ push: (message: string, tone?: ToastTone, options?: ToastOptions) => void } | null>(null)

const MAX_VISIBLE = 4
const DURATION_MS = 4500

/** Wrap the app once; use useToast() anywhere to fire a toast for saved/published/deleted/failed etc. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const idRef = useRef(0)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer) clearTimeout(timer)
    timers.current.delete(id)
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const push = useCallback((message: string, tone: ToastTone = 'success', options?: ToastOptions) => {
    const id = ++idRef.current
    setToasts((prev) => [...prev.slice(-(MAX_VISIBLE - 1)), { id, tone, message, action: options?.action }])
    // Errors linger a little longer — they usually need reading twice. A toast with an action (Undo) lingers long enough to use it.
    const duration = options?.durationMs ?? (options?.action ? 9000 : tone === 'error' ? DURATION_MS + 2500 : DURATION_MS)
    timers.current.set(id, setTimeout(() => dismiss(id), duration))
  }, [dismiss])

  useEffect(() => {
    const pending = timers.current
    return () => { pending.forEach(clearTimeout); pending.clear() }
  }, [])

  // Stable identity so useToast() consumers don't re-render on every toast.
  const value = useMemo(() => ({ push }), [push])
  const icon = { success: CheckCircle2, error: XCircle, info: Info }

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="ctf-toast-stack" role="region" aria-label="Notifications" aria-live="polite">
        {toasts.map((t) => {
          const Icon = icon[t.tone]
          return (
            <div key={t.id} className={`ctf-toast ctf-toast--${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
              <Icon size={16} />
              <span>{t.message}</span>
              {t.action && (
                <button type="button" className="ctf-toast__action" onClick={() => { const run = t.action?.onClick; dismiss(t.id); void run?.() }}>{t.action.label}</button>
              )}
              <button className="ctf-toast__close" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}><X size={13} /></button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
