import { useEffect, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { FileUp } from 'lucide-react'
import { PublicLayout } from '../../layouts/PublicLayout'
import { Button, ErrorState, FieldWrap, Input, SkeletonRows, Textarea } from '../../components/ui'
import { getCareer, submitJobApplication, uploadResume } from '../../lib/services'
import type { Career } from '../../lib/types'
import './Careers.css'

export function CareerApply() {
  const { slug } = useParams()
  const [role, setRole] = useState<Career | null | undefined>(undefined)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [coverNote, setCoverNote] = useState('')
  const [resumeFile, setResumeFile] = useState<File | null>(null)
  const [resumeError, setResumeError] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'sent' | 'error'>('idle')

  useEffect(() => {
    if (!slug) return
    void getCareer(slug).then(({ data }) => setRole(data))
  }, [slug])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!role) return
    setStatus('submitting')
    setResumeError('')

    let resume_path: string | null = null
    if (resumeFile) {
      const { path, error: uploadErr } = await uploadResume(resumeFile)
      if (uploadErr) {
        setResumeError(uploadErr.message)
        setStatus('idle')
        return
      }
      resume_path = path
    }

    const { error } = await submitJobApplication({ career_id: role.id, name, email, cover_note: coverNote, resume_path })
    setStatus(error ? 'error' : 'sent')
  }

  return (
    <PublicLayout>
      <main className="container ctf-career-apply">
        {role === undefined && <SkeletonRows rows={2} height="60px" />}
        {role === null && <ErrorState title="Role not found" description="This role isn't open, or the link has changed." />}
        {role && status !== 'sent' && (
          <>
            <span className="eyebrow">Apply</span>
            <h1>{role.title}</h1>
            <form onSubmit={submit} className="ctf-career-apply__form">
              <FieldWrap label="Full name" htmlFor="name" required>
                <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
              </FieldWrap>
              <FieldWrap label="Email" htmlFor="email" required>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </FieldWrap>
              <FieldWrap label="Why this role" htmlFor="cover" hint="A short note is enough — no need for a formal cover letter.">
                <Textarea id="cover" value={coverNote} onChange={(e) => setCoverNote(e.target.value)} rows={6} />
              </FieldWrap>
              <FieldWrap label="Résumé" htmlFor="resume" hint="PDF or Word document. Optional." error={resumeError || undefined}>
                <label className="ctf-resume-drop" htmlFor="resume">
                  <FileUp size={16} />
                  {resumeFile ? resumeFile.name : 'Choose a file…'}
                </label>
                <input
                  id="resume"
                  type="file"
                  accept=".pdf,.doc,.docx"
                  style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
                  onChange={(e) => setResumeFile(e.target.files?.[0] ?? null)}
                />
              </FieldWrap>
              {status === 'error' && <p className="ctf-form-error">Something went wrong submitting your application. Please try again.</p>}
              <Button type="submit" variant="primary" size="lg" loading={status === 'submitting'}>Submit application</Button>
            </form>
          </>
        )}
        {status === 'sent' && (
          <div className="ctf-career-apply__success">
            <h1>Thank you.</h1>
            <p className="lead">Your application has been received. The team will follow up if there's a fit.</p>
          </div>
        )}
      </main>
    </PublicLayout>
  )
}
