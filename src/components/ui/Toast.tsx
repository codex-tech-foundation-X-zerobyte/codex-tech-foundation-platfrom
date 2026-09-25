import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, XCircle, Info } from 'lucide-react'
import './Toast.css'

type ToastTone = 'success' | 'error' | 'info'
interface ToastItem { id: number; tone: ToastTone; message: string }

const ToastContext = createContext<{ push: (message: string, tone?: ToastTone) => void } | null>(null)

/** Wrap the app once; use useToast() anywhere to fire a toast for saved/published/deleted/failed etc. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const idRef = useRef(0)

  const push = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = ++idRef.current
    setToasts((prev) => [...prev, { id, tone, message }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000)
  }, [])

  const icon = { success: CheckCircle2, error: XCircle, info: Info }

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="ctf-toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => {
          const Icon = icon[t.tone]
          return (
            <div key={t.id} className={`ctf-toast ctf-toast--${t.tone}`}>
              <Icon size={16} />
              <span>{t.message}</span>
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
