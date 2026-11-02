import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { canonicalUrl, originOf } from '../lib/seo'

/** The site's own origin as declared in index.html, read once before anything changes it. */
let declaredOrigin: string | null | undefined
function siteOrigin(): string | null {
  if (declaredOrigin === undefined) declaredOrigin = originOf(document.querySelector('link[rel="canonical"]')?.getAttribute('href'))
  return declaredOrigin
}

/**
 * index.html declares ONE canonical address (the homepage) because it is the single file every route is served from. Left
 * alone, /blog/some-post, /team, /careers/… would all announce "my canonical page is the homepage", and Google may then fold
 * them into it instead of indexing them. This keeps the canonical (and og:url) pointing at the page actually being viewed,
 * on the site's own domain as declared in index.html — never the preview or localhost address it happens to be served from.
 *
 * It only edits what index.html already contains, so the owner's file stays exactly as written. If index.html has no
 * canonical tag it does nothing.
 */
export function useCanonicalUrl() {
  const { pathname } = useLocation()
  useEffect(() => {
    const origin = siteOrigin()
    const link = document.querySelector('link[rel="canonical"]')
    if (!origin || !link) return
    const url = canonicalUrl(origin, pathname)
    link.setAttribute('href', url)
    document.querySelector('meta[property="og:url"]')?.setAttribute('content', url)
  }, [pathname])
}
