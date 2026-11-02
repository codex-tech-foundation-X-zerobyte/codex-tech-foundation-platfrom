import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import './ErrorBoundary.css'

interface Props {
  children: ReactNode
  /** When this value changes (e.g. the route), a tripped boundary clears itself. */
  resetKey?: string
  /** 'page' fills the viewport; 'section' sits inline inside a layout. */
  scope?: 'page' | 'section'
}

interface State { error: Error | null; lastResetKey?: string }

/**
 * Without a boundary, one thrown render error anywhere unmounts the ENTIRE app to a
 * blank page (React 19 drops the tree). This contains the blast radius: a broken
 * page shows a recoverable message while the sidebar, calls and auth stay alive.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, lastResetKey: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.lastResetKey) return { error: null, lastResetKey: props.resetKey }
    return null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const scope = this.props.scope ?? 'section'
    // A page chunk that no longer exists on the server (we deployed while this tab was open) is not a bug in the page.
    const stale = /dynamically imported module|Importing a module script failed|ChunkLoadError|error loading dynamically/i.test(error.message)
    if (stale) {
      return (
        <div className={`ctf-crash ctf-crash--${scope}`} role="alert">
          <div className="ctf-crash__icon"><RefreshCw size={22} /></div>
          <h2>A new version is available</h2>
          <p>The app was updated while this tab was open. Reload to get the latest version — nothing you've saved is lost.</p>
          <div className="ctf-crash__actions">
            <button className="ctf-btn ctf-btn--primary ctf-btn--md" onClick={() => window.location.reload()}>
              <span className="ctf-btn__content"><RefreshCw size={14} /> Reload</span>
            </button>
          </div>
        </div>
      )
    }
    return (
      <div className={`ctf-crash ctf-crash--${scope}`} role="alert">
        <div className="ctf-crash__icon"><AlertTriangle size={22} /></div>
        <h2>This page hit a problem</h2>
        <p>Something unexpected broke while rendering. Your data is safe — nothing was changed by this error.</p>
        <pre className="ctf-crash__detail mono">{error.message}</pre>
        <div className="ctf-crash__actions">
          <button className="ctf-btn ctf-btn--primary ctf-btn--md" onClick={() => this.setState({ error: null })}>
            <span className="ctf-btn__content"><RefreshCw size={14} /> Try again</span>
          </button>
          <button className="ctf-btn ctf-btn--secondary ctf-btn--md" onClick={() => window.location.reload()}>
            <span className="ctf-btn__content">Reload the app</span>
          </button>
        </div>
      </div>
    )
  }
}
