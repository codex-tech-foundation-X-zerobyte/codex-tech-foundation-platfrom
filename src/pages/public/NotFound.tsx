import { PublicLayout } from '../../layouts/PublicLayout'
import { ButtonLink } from '../../components/ui'

export function NotFound() {
  return (
    <PublicLayout>
      <main className="container" style={{ padding: '120px 0', textAlign: 'center' }}>
        <span className="eyebrow" style={{ justifyContent: 'center' }}>404</span>
        <h1 style={{ marginTop: 16, fontSize: 'var(--text-3xl)' }}>This page doesn't exist.</h1>
        <p className="lead" style={{ margin: '16px auto 32px', textAlign: 'center' }}>
          The page you're looking for may have moved or been unpublished.
        </p>
        <ButtonLink to="/" variant="primary" size="lg">Back to Codex</ButtonLink>
      </main>
    </PublicLayout>
  )
}
