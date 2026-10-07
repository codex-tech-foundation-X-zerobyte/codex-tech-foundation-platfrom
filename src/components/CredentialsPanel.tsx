import { useState } from 'react'
import { Check, Copy, KeyRound } from 'lucide-react'
import { Button, copyToClipboard } from './ui'
import './CredentialsPanel.css'

/** Shown once after an account is created. The password cannot be retrieved later, so make saving it hard to get wrong. */
export function CredentialsPanel({ idLabel, id, password, onDone }: { idLabel: string; id: string; password: string; onDone: () => void }) {
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null)

  const copy = async () => {
    const ok = await copyToClipboard(`${idLabel}: ${id}\nTemporary password: ${password}`)
    setCopied(ok ? 'yes' : 'no')
  }

  return (
    <div className="ctf-creds">
      <div className="ctf-creds__note"><KeyRound size={15} /> Share these now. The password is shown only this once and can't be retrieved later.</div>
      <dl>
        <div><dt>{idLabel}</dt><dd className="mono">{id}</dd></div>
        <div><dt>Temporary password</dt><dd className="mono">{password}</dd></div>
      </dl>
      {copied === 'no' && <p className="ctf-form-error" role="alert">Couldn't copy automatically — select the text above and copy it manually.</p>}
      <div className="ctf-form__actions">
        <Button variant="secondary" icon={copied === 'yes' ? <Check size={14} /> : <Copy size={14} />} onClick={() => void copy()}>{copied === 'yes' ? 'Copied' : 'Copy credentials'}</Button>
        <Button variant="primary" onClick={onDone}>Done</Button>
      </div>
    </div>
  )
}
