import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Bell, Eye, EyeOff, Keyboard, KeyRound, LifeBuoy, LogOut, Monitor, Palette, Phone, ShieldCheck, User } from 'lucide-react'
import { Button, copyToClipboard, FieldWrap, Input, Modal, PageHeader, Switch, useToast } from '../components/ui'
import { DeviceTester } from '../components/DeviceTester'
import { useAuth } from '../lib/auth'
import { changePassword, getSessionInfo, signOutOtherSessions, updateOwnProfile, type SessionInfo } from '../lib/services'
import { assessPassword } from '../lib/passwordStrength'
import { describeDevice } from '../lib/device'
import { setPref, usePrefs } from '../lib/prefs'
import { playChime, startRingtone, stopRingtone } from '../lib/ringtone'
import './AccountSettings.css'

const ROLE_LABEL: Record<string, string> = { superadmin: 'Administrator', manager: 'Manager', worker: 'Worker', client: 'Client' }
const isMac = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)
const MOD = isMac ? '⌘' : 'Ctrl'

function Section({ id, icon: Icon, title, description, children }: { id: string; icon: typeof User; title: string; description?: string; children: ReactNode }) {
  return (
    <section className="ctf-settings__section" id={`settings-${id}`} aria-labelledby={`settings-${id}-h`}>
      <header>
        <span className="ctf-settings__icon"><Icon size={16} /></span>
        <div><h2 id={`settings-${id}-h`}>{title}</h2>{description && <p>{description}</p>}</div>
      </header>
      <div className="ctf-settings__body">{children}</div>
    </section>
  )
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—')

export function AccountSettings() {
  const { profile, refresh } = useAuth()
  const { push } = useToast()
  const prefs = usePrefs()
  const isClient = profile?.role === 'client'
  const statusPath = profile?.role === 'superadmin' || profile?.role === 'manager' ? '/admin/status' : '/worker/status'

  // ── profile ──
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '')
  const [savingProfile, setSavingProfile] = useState(false)
  const [session, setSession] = useState<SessionInfo | null>(null)
  useEffect(() => { void getSessionInfo().then(setSession) }, [])
  const saveProfile = async (e: FormEvent) => {
    e.preventDefault()
    if (!displayName.trim() || displayName.trim() === profile?.display_name) return
    setSavingProfile(true)
    const { error } = await updateOwnProfile({ display_name: displayName.trim() })
    setSavingProfile(false)
    if (error) { push(error.message, 'error'); return } // the real reason, not a generic line
    push('Profile saved')
    void refresh()
  }

  // ── password ──
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const personal = useMemo(() => [...(profile?.display_name ?? '').split(/\s+/), (session?.email ?? '').split('@')[0]], [profile?.display_name, session?.email])
  const strength = useMemo(() => assessPassword(newPassword, personal), [newPassword, personal])
  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword
  const submitPassword = async (e: FormEvent) => {
    e.preventDefault()
    setPasswordError('')
    if (!strength.meetsMinimum) { setPasswordError(strength.advice[0]); return }
    if (newPassword !== confirmPassword) { setPasswordError('Passwords do not match.'); return }
    setChangingPassword(true)
    const { error } = await changePassword(newPassword)
    setChangingPassword(false)
    if (error) { setPasswordError(error.message); return }
    push('Password changed')
    setNewPassword(''); setConfirmPassword('')
  }

  // ── sessions ──
  const [confirmOthers, setConfirmOthers] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const signOutOthers = async () => {
    setSigningOut(true)
    const { error } = await signOutOtherSessions()
    setSigningOut(false)
    setConfirmOthers(false)
    if (error) push(error.message, 'error')
    else push('Signed out of all other devices.')
  }

  // ── notifications ──
  const notificationsSupported = 'Notification' in window
  const [permission, setPermission] = useState<NotificationPermission>(notificationsSupported ? Notification.permission : 'denied')
  const toggleDesktop = async (on: boolean) => {
    if (!on) { setPref('desktopAlerts', false); return }
    if (!notificationsSupported) { push('This browser does not support desktop notifications.', 'error'); return }
    const result = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
    setPermission(result)
    if (result === 'granted') { setPref('desktopAlerts', true); push('Desktop alerts are on.') }
    else push("Notifications are blocked for this site. Allow them in your browser's site settings, then try again.", 'error')
  }
  const testRingtone = () => { startRingtone('incoming'); setTimeout(stopRingtone, 2600) }

  // ── support ──
  const [verbose, setVerbose] = useState(() => { try { return localStorage.getItem('ctf:debug') === '1' } catch { return false } })
  const toggleVerbose = (on: boolean) => {
    try {
      if (on) localStorage.setItem('ctf:debug', '1')
      else localStorage.removeItem('ctf:debug')
    } catch { /* storage blocked */ }
    setVerbose(on)
  }
  const copyDiagnostics = async () => {
    const lines = [
      `Role: ${profile?.role ?? 'unknown'}`,
      `Device: ${describeDevice(navigator.userAgent)}`,
      `Secure context (HTTPS): ${window.isSecureContext ? 'yes' : 'NO'}`,
      `Calls supported (WebRTC): ${typeof RTCPeerConnection !== 'undefined' ? 'yes' : 'NO'}`,
      `Camera/microphone API: ${navigator.mediaDevices ? 'yes' : 'NO'}`,
      `Desktop notifications: ${notificationsSupported ? Notification.permission : 'unsupported'}`,
      `Online: ${navigator.onLine ? 'yes' : 'NO'}`,
      `Language / time zone: ${navigator.language} / ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
      `Page: ${window.location.origin}`,
      `Time: ${new Date().toISOString()}`,
    ] // deliberately no tokens, emails or ids
    push((await copyToClipboard(lines.join('\n'))) ? 'Diagnostics copied — paste them into your message to support.' : "Couldn't copy automatically.", 'info')
  }

  const nav = [
    ['profile', 'Profile'], ['security', 'Security'], ...(isClient ? [] : [['notifications', 'Notifications'], ['calls', 'Calls & devices']]), ['appearance', 'Appearance'],
    ...(isClient ? [] : [['shortcuts', 'Shortcuts']]), ['support', 'Support'],
  ]

  return (
    <>
    <PageHeader title="Settings" description="Your profile, security, alerts and devices." />
    <div className="ctf-settings">
      <nav className="ctf-settings__nav" aria-label="Settings sections">{nav.map(([id, label]) => <a key={id} href={`#settings-${id}`}>{label}</a>)}</nav>
      <div className="ctf-settings__main">
        <Section id="profile" icon={User} title="Profile" description="How you appear to the people you work with.">
          <form onSubmit={saveProfile}>
            <FieldWrap label="Display name" htmlFor="settings-name" required>
              <Input id="settings-name" required maxLength={80} value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" />
            </FieldWrap>
            <div className="ctf-form-row">
              <FieldWrap label="Email" htmlFor="settings-email" hint="Used to sign in and recover your account.">
                <Input id="settings-email" value={session?.email ?? '…'} disabled />
              </FieldWrap>
              <FieldWrap label="Role" htmlFor="settings-role" hint="Set by an administrator.">
                <Input id="settings-role" value={ROLE_LABEL[profile?.role ?? ''] ?? profile?.role ?? ''} disabled />
              </FieldWrap>
            </div>
            <div><Button type="submit" variant="primary" loading={savingProfile} disabled={!displayName.trim() || displayName.trim() === profile?.display_name}>Save profile</Button></div>
          </form>
        </Section>

        <Section id="security" icon={KeyRound} title="Security" description="Your password and where you're signed in.">
          <form onSubmit={submitPassword}>
            <FieldWrap label="New password" htmlFor="settings-new-password" required hint="At least 10 characters. A few random words is stronger than a short, complicated one.">
              <div className="ctf-settings__pw">
                <Input id="settings-new-password" type={showPassword ? 'text' : 'password'} required autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((s) => !s)}>{showPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button>
              </div>
            </FieldWrap>
            {newPassword && (
              <div className="ctf-strength" aria-live="polite">
                <div className={`ctf-strength__bar level-${strength.level}`} role="meter" aria-label="Password strength" aria-valuemin={0} aria-valuemax={4} aria-valuenow={strength.level}><i /><i /><i /><i /></div>
                <strong>{strength.label}</strong>
                {strength.advice.length > 0 && <ul>{strength.advice.map((a) => <li key={a}>{a}</li>)}</ul>}
              </div>
            )}
            <FieldWrap label="Confirm password" htmlFor="settings-confirm-password" required>
              <Input id="settings-confirm-password" type={showPassword ? 'text' : 'password'} required autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} aria-invalid={mismatch} />
            </FieldWrap>
            {mismatch && <p className="ctf-muted" role="status">Passwords don't match yet.</p>}
            {passwordError && <p className="ctf-form-error" role="alert">{passwordError}</p>}
            <div><Button type="submit" variant="primary" loading={changingPassword} disabled={!strength.meetsMinimum || !confirmPassword || mismatch}>Change password</Button></div>
          </form>

          <div className="ctf-settings__divider" />
          <h3 className="ctf-settings__sub">This sign-in</h3>
          <dl className="ctf-settings__facts">
            <div><dt>Device</dt><dd>{describeDevice(navigator.userAgent)}</dd></div>
            <div><dt>Signed in</dt><dd>{fmt(session?.lastSignInAt ?? null)}</dd></div>
            <div><dt>Session renews</dt><dd>{fmt(session?.expiresAt ?? null)} <small>(automatic)</small></dd></div>
          </dl>
          <div className="ctf-settings__actions">
            <Button variant="secondary" icon={<LogOut size={14} />} onClick={() => setConfirmOthers(true)}>Sign out other devices</Button>
            <small>Lost a phone, or used a shared computer? This ends every other session and keeps this one.</small>
          </div>
        </Section>

        {!isClient && (
          <Section id="notifications" icon={Bell} title="Notifications" description="How you're alerted to calls and messages. These apply to this browser only.">
            <Switch label="Call ringtone" checked={prefs.callSounds} onChange={(v) => setPref('callSounds', v)} description={<>Ring when someone calls you. <button type="button" className="ctf-settings__link" onClick={testRingtone}>Play a test</button></>} />
            <Switch label="Message sounds" checked={prefs.messageSounds} onChange={(v) => setPref('messageSounds', v)} description={<>A soft chime for private messages and group-call invitations. <button type="button" className="ctf-settings__link" onClick={playChime}>Play a test</button></>} />
            <Switch label="Desktop alerts" checked={prefs.desktopAlerts && permission === 'granted'} onChange={(v) => void toggleDesktop(v)} disabled={!notificationsSupported}
              description={!notificationsSupported ? "This browser doesn't support desktop notifications." : permission === 'denied' ? 'Blocked for this site — allow notifications in your browser settings first.' : 'Pop-up alerts for private messages and call invitations while this tab is in the background.'} />
          </Section>
        )}

        {!isClient && (
          <Section id="calls" icon={Phone} title="Calls & devices" description="Choose and test what calls use. Trouble connecting? Run the network check.">
            <DeviceTester />
            <div className="ctf-settings__actions"><Link className="ctf-btn ctf-btn--ghost ctf-btn--sm" to={statusPath}><span className="ctf-btn__content"><ShieldCheck size={14} /> Check call connectivity (TURN, microphone, network)</span></Link></div>
          </Section>
        )}

        <Section id="appearance" icon={Palette} title="Appearance" description="Display options for this device.">
          <Switch label="Compact layout" checked={prefs.compact} onChange={(v) => setPref('compact', v)} description="Tighter spacing, so more fits on screen." />
          <Switch label="Reduce motion" checked={prefs.reducedMotion} onChange={(v) => setPref('reducedMotion', v)} description="Turns off animations and transitions. Also honoured automatically if your system asks for it." />
        </Section>

        {!isClient && (
          <Section id="shortcuts" icon={Keyboard} title="Keyboard shortcuts">
            <dl className="ctf-settings__keys">
              {([[`${MOD}+K`, 'Open the command palette: jump to any page, tool or action'], ['/', 'Open the command palette (when not typing)'], ['Enter', 'Send a message'], ['Shift+Enter', 'New line in a message'], ['Esc', 'Close a dialog, menu or the palette'], ['↑ ↓ then Enter', 'Move through and choose palette results']] as const).map(([k, d]) => (
                <div key={k}><dt>{k.split('+').map((p) => <span key={p} className="kbd">{p}</span>)}</dt><dd>{d}</dd></div>
              ))}
            </dl>
          </Section>
        )}

        <Section id="support" icon={LifeBuoy} title="Support" description="Something not working? These make it quick to fix.">
          <div className="ctf-settings__actions">
            <Button variant="secondary" icon={<Monitor size={14} />} onClick={() => void copyDiagnostics()}>Copy diagnostics</Button>
            <small>Copies your browser, device and connectivity details (no passwords, tokens or personal data) to paste to whoever is helping.</small>
          </div>
          <Switch label="Verbose error logging" checked={verbose} onChange={toggleVerbose} description="Prints the full database error details to this browser's console. Only turn this on when asked to; it may show record contents." />
        </Section>
      </div>

      <Modal open={confirmOthers} onClose={() => setConfirmOthers(false)} title="Sign out other devices?" size="sm"
        footer={<><Button variant="ghost" onClick={() => setConfirmOthers(false)}>Cancel</Button><Button variant="danger" loading={signingOut} onClick={() => void signOutOthers()}>Sign out others</Button></>}>
        <p className="ctf-muted">Every other browser and device signed in as you will be signed out. You'll stay signed in here.</p>
      </Modal>
    </div>
    </>
  )
}
