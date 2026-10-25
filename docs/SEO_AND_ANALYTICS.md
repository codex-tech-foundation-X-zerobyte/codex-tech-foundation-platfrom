# SEO, Search Console and Analytics

## These three files belong to the site owner — keep them exactly as written

| File | Where | Contains |
|---|---|---|
| `index.html` | project root | description, canonical, Open Graph / Twitter tags, `WebSite` structured data, Google Analytics 4 |
| `robots.txt` | `public/` | blocks `/worker`, `/admin`, `/client`, `/login`; points at the sitemap |
| `sitemap.xml` | `public/` | the ten main public pages, on the production domain |

Production domain: `https://codex-tech-foundation-platform.vercel.app` (the Vercel project was renamed from the earlier misspelled "platfrom" address; add the new address in Google Search Console and resubmit the sitemap).

**On every project update, these three files must be carried over unchanged.** `tests/seoFiles.test.mjs` fails if they are replaced by placeholders or drift out of sync with the rest of the project.

## What the app adds around them (without editing them)

- **Per-page canonical.** `index.html` can only declare one canonical address, and every route is served from that one file. `src/hooks/useCanonicalUrl.ts` (called from `PublicLayout`) updates the canonical link and `og:url` to the page being viewed, using the domain declared in `index.html`. Without it, `/blog/<post>`, `/team`, `/careers/<role>` … would all say their canonical page is the homepage, and Google could fold them into it.
- **Security policy.** `vercel.json` allows the Google Analytics script: `https://www.googletagmanager.com`, plus the SHA-256 fingerprint of the inline `gtag` snippet. *If that snippet in `index.html` is edited in any way (even whitespace), its fingerprint changes and the policy must be updated* — `tests/seoFiles.test.mjs` tells you the new value. (The policy is currently report-only, so a stale hash would only produce console reports, not break Analytics — but keep it right in case it is ever enforced.)
- **Service worker.** `public/sw.js` only handles the site's own files; Analytics, fonts and Supabase requests go straight to the network.

## Known gaps (not changed — they are your call)

1. **Analytics also loads on the private areas** (`/admin`, `/worker`, `/client`), because it is in the one shared `index.html`. `robots.txt` stops search engines crawling them, but not Analytics recording visits, and those URLs contain record IDs. If that isn't wanted, the snippet can be made to skip those paths.
2. **No share image.** `twitter:card` is `summary_large_image` but there is no `og:image` / `twitter:image`, so links shared on social platforms show no picture. Add a 1200×630 image and the two tags.
3. **Individual posts, case studies and careers are not in `sitemap.xml`** (they live in the database). Google can still find them by following links, but a generated sitemap would list them directly.
4. **Page descriptions are the same everywhere** (the homepage one). Page *titles* are set per page; descriptions are not.
