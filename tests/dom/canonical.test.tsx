import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { useCanonicalUrl } from '../../src/hooks/useCanonicalUrl'

const ORIGIN = 'https://codex-tech-foundation-platform.vercel.app'

function Probe() { useCanonicalUrl(); return null }
const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><Routes><Route path="*" element={<Probe />} /></Routes></MemoryRouter>)
const canonical = () => document.querySelector('link[rel="canonical"]')?.getAttribute('href')
const ogUrl = () => document.querySelector('meta[property="og:url"]')?.getAttribute('content')

describe('per-page canonical address', () => {
  beforeEach(() => {
    // Exactly what the owner's index.html ships: the homepage as canonical and as og:url.
    document.head.innerHTML = `<link rel="canonical" href="${ORIGIN}/" /><meta property="og:url" content="${ORIGIN}/" />`
  })

  it('points a blog post at itself, on the site domain declared in index.html', () => {
    at('/blog/my-first-post?utm_source=x#top')
    expect(canonical()).toBe(`${ORIGIN}/blog/my-first-post`) // no query string, no fragment
    expect(ogUrl()).toBe(`${ORIGIN}/blog/my-first-post`)
  })

  it('follows the route when the visitor navigates (the SPA never reloads the HTML)', () => {
    const { unmount } = at('/team')
    expect(canonical()).toBe(`${ORIGIN}/team`)
    unmount()
    at('/careers/engineer')
    expect(canonical()).toBe(`${ORIGIN}/careers/engineer`)
  })

  it('leaves the homepage as the owner wrote it', () => {
    at('/')
    expect(canonical()).toBe(`${ORIGIN}/`)
  })

  it('does nothing when index.html has no canonical tag', () => {
    document.head.innerHTML = ''
    at('/team')
    expect(canonical()).toBeUndefined()
  })
})
