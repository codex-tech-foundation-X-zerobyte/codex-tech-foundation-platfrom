import type { ReactNode } from 'react'
import { PublicLayout } from '../../layouts/PublicLayout'
import './ContentPage.css'

export function ContentPage({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead?: string; children?: ReactNode }) {
  return (
    <PublicLayout>
      <main className="container ctf-content-page">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
        {children}
      </main>
    </PublicLayout>
  )
}
