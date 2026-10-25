import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowRight, ExternalLink, Laptop, Monitor, RefreshCw, Smartphone, Tablet, ShieldAlert, TriangleAlert } from 'lucide-react'
import { DEVICES, isBlockedStageOrigin, normalizeStageUrl, stageBlockedOrigins, type DeviceKind } from '../../../lib/presentation'
import type { StageProps } from './types'

const DEVICE_ICON = { desktop: Monitor, tablet: Tablet, mobile: Smartphone } as const

/**
 * An in-app browser. The presenter types an address and everyone's frame follows. Sites choose whether they may be shown inside
 * another page; many (banks, Google, GitHub...) refuse, and the browser gives us no way to tell the difference between "still loading"
 * and "refused", so the stage always offers "Open in a new tab" and says why a frame may stay blank.
 */
export function BrowserStage({ state, isPresenter, commit }: StageProps) {
  const blockedOrigins = useMemo(() => stageBlockedOrigins(), [])
  // What is on stage came from the presenter's browser, but anyone allowed to present can also write it straight to the database, so it is
  // checked again HERE, by every viewer, before it goes anywhere near a frame. A javascript: address in this frame would run as the Workspace.
  const shown = typeof state.url === 'string' ? state.url : ''
  const url = shown ? (normalizeStageUrl(shown, { blockedOrigins }) ?? '') : ''
  const refused = Boolean(shown) && !url
  let host = ''
  try { host = url ? new URL(url).host : '' } catch { host = '' }
  const device = (typeof state.device === 'string' && state.device in DEVICES ? state.device : 'desktop') as DeviceKind
  const [draft, setDraft] = useState(url)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [showHelp, setShowHelp] = useState(false)
  useEffect(() => { setDraft(url); setShowHelp(false) }, [url])

  const go = (e: FormEvent) => {
    e.preventDefault()
    const next = normalizeStageUrl(draft, { blockedOrigins })
    if (!next) { setError(isBlockedStageOrigin(draft, blockedOrigins) ? 'That is this Workspace itself. Present your own app or another site instead.' : 'Enter a full https:// address (http is only allowed for localhost).'); return }
    setError('')
    commit({ ...state, url: next, device }, { immediate: true })
  }
  const width = DEVICES[device].width

  return (
    <div className="ctf-stage ctf-stage--browser">
      <div className="ctf-bar">
        {isPresenter ? (
          <form className="ctf-bar__form" onSubmit={go}>
            <input aria-label="Address" className="ctf-bar__input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="https://your-app.vercel.app" spellCheck={false} autoComplete="off" inputMode="url" />
            <button type="submit" className="ctf-bar__btn" aria-label="Go"><ArrowRight size={15} /></button>
          </form>
        ) : (
          <div className="ctf-bar__form ctf-bar__readonly" title="The presenter controls the address">{url || 'Waiting for the presenter to open a page…'}</div>
        )}
        {isPresenter && (
          <div className="ctf-bar__group" role="group" aria-label="Screen size">
            {(Object.keys(DEVICES) as DeviceKind[]).map((d) => {
              const Icon = DEVICE_ICON[d]
              return <button key={d} type="button" className={`ctf-bar__btn ${device === d ? 'is-on' : ''}`} aria-pressed={device === d} aria-label={DEVICES[d].label} title={DEVICES[d].label} onClick={() => commit({ ...state, device: d }, { immediate: true })}><Icon size={15} /></button>
            })}
          </div>
        )}
        <button type="button" className="ctf-bar__btn" onClick={() => setReloadKey((k) => k + 1)} aria-label="Reload" title="Reload" disabled={!url}><RefreshCw size={15} /></button>
        {url && <a className="ctf-bar__btn" href={url} target="_blank" rel="noopener noreferrer" aria-label="Open in a new tab" title="Open in a new tab"><ExternalLink size={15} /></a>}
        {url && <button type="button" className={`ctf-bar__btn ${showHelp ? 'is-on' : ''}`} onClick={() => setShowHelp((v) => !v)} aria-pressed={showHelp} aria-label="Page is blank?" title="Page is blank?"><TriangleAlert size={15} /></button>}
      </div>
      {error && <p className="ctf-stage__error" role="alert">{error}</p>}
      {refused && <p className="ctf-stage__error" role="alert">The address on stage was not shown because it is not a safe https:// address (or it points at this Workspace).</p>}
      {url && <p className="ctf-stage__external" role="note"><ShieldAlert size={14} aria-hidden="true" /><span>You are looking at an outside website (<strong>{host}</strong>), not the Workspace. Never type your Workspace password, a payment passcode or a verification code into it.</span></p>}
      {showHelp && (
        <p className="ctf-stage__help" role="note">
          Some sites refuse to appear inside other pages (the site owner sets this). If this one is blank, open it in a new tab, or present your own app: apps you build can allow the Workspace to show them.
          Your app must not send <code>X-Frame-Options: DENY</code> or a restrictive <code>frame-ancestors</code>.
        </p>
      )}
      <div className="ctf-stage__canvas ctf-browser">
        {url ? (
          <div className={`ctf-browser__device ${width ? 'is-framed' : ''}`} style={width ? { width } : undefined}>
            <iframe key={`${url}:${reloadKey}`} title="Presented page" src={url} className="ctf-browser__frame" referrerPolicy="no-referrer" allow="clipboard-write; fullscreen" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads" />
          </div>
        ) : (
          <div className="ctf-stage__empty"><Laptop size={30} aria-hidden="true" /><strong>{isPresenter ? 'Open a page to show' : 'Nothing on stage yet'}</strong><span>{isPresenter ? 'Type an address above. Everyone watching sees the same page.' : 'The presenter has not opened a page.'}</span></div>
        )}
      </div>
    </div>
  )
}
