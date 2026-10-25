/** Pure SEO helpers (no DOM), unit-tested in tests/seo.test.mjs. */

/**
 * The canonical address of a page: the site's own origin + the page's path. Query strings and #fragments are dropped
 * (they don't make a different page), and so is a trailing slash — except on the homepage, which keeps its single "/".
 */
export function canonicalUrl(origin: string, pathname: string): string {
  const path = `/${pathname.replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/').replace(/\/+$/, '')
  return `${origin.replace(/\/+$/, '')}${path || '/'}`
}

/** The origin out of a canonical <link>'s href, or null if it is missing or not a valid absolute URL. */
export function originOf(href: string | null | undefined): string | null {
  if (!href) return null
  try { return new URL(href).origin } catch { return null }
}
