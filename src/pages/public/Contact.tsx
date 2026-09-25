import { useState, type FormEvent } from 'react'
import { Mail, MessageCircle } from 'lucide-react'
import { PublicLayout } from '../../layouts/PublicLayout'
import { Button, FieldWrap, Input, SectionHeading, Textarea } from '../../components/ui'
import { submitContactMessage } from '../../lib/services'
import './Contact.css'

// Configured values only — never invented. Falls back to a neutral placeholder if unset.
const CONTACT_EMAIL = import.meta.env.VITE_CONTACT_EMAIL as string | undefined
const CONTACT_WHATSAPP = import.meta.env.VITE_CONTACT_WHATSAPP_URL as string | undefined

export function Contact() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'sent' | 'error'>('idle')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setStatus('submitting')
    const { error } = await submitContactMessage({ name, email, message })
    setStatus(error ? 'error' : 'sent')
  }

  return (
    <PublicLayout>
      <main className="container ctf-contact">
        <SectionHeading eyebrow="Contact" title="Start a conversation." />
        <div className="ctf-contact__grid">
          <form onSubmit={submit} className="ctf-contact__form">
            {status === 'sent' ? (
              <div className="ctf-contact__sent">
                <h3>Message sent</h3>
                <p>Thanks — we'll get back to you shortly.</p>
              </div>
            ) : (
              <>
                <FieldWrap label="Name" htmlFor="c-name" required>
                  <Input id="c-name" required value={name} onChange={(e) => setName(e.target.value)} />
                </FieldWrap>
                <FieldWrap label="Email" htmlFor="c-email" required>
                  <Input id="c-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </FieldWrap>
                <FieldWrap label="Message" htmlFor="c-message" required>
                  <Textarea id="c-message" required rows={6} value={message} onChange={(e) => setMessage(e.target.value)} />
                </FieldWrap>
                {status === 'error' && <p className="ctf-form-error">Something went wrong. Please try again.</p>}
                <Button type="submit" variant="primary" size="lg" loading={status === 'submitting'}>Send message</Button>
              </>
            )}
          </form>

          <aside className="ctf-contact__options">
            <h3>Other ways to reach us</h3>
            <a className="ctf-contact__option" href={CONTACT_EMAIL ? `mailto:${CONTACT_EMAIL}` : undefined} aria-disabled={!CONTACT_EMAIL}>
              <Mail size={18} />
              <div>
                <strong>Email</strong>
                <span>{CONTACT_EMAIL ?? 'Not yet configured'}</span>
              </div>
            </a>
            <a className="ctf-contact__option" href={CONTACT_WHATSAPP} aria-disabled={!CONTACT_WHATSAPP} target="_blank" rel="noreferrer">
              <MessageCircle size={18} />
              <div>
                <strong>WhatsApp</strong>
                <span>{CONTACT_WHATSAPP ? 'Message us directly' : 'Not yet configured'}</span>
              </div>
            </a>
          </aside>
        </div>
      </main>
    </PublicLayout>
  )
}
