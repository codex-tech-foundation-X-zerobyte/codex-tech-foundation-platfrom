# File Storage

## Actual state today

Everything uses **Supabase Storage** directly via `src/lib/services/shared.ts`'s
`storage` object (`upload`, `getPublicUrl`, `getSignedUrl`, `remove`) and
`resourceFiles.ts` for the resources file manager. There is no storage
abstraction layer and no Cloudflare R2 adapter — the spec calls for one;
it has not been built. This doc describes both the real thing and the
intended target so nobody builds a second, competing abstraction later.

## Buckets (all private except where noted)

- **`project-assets`** — legacy bucket. Had a real confidentiality bug: its
  policies checked `bucket_id` only, not project ownership, so any
  authenticated user (including a client on an unrelated project) could
  read/upload any file in it. Fixed in `20260913000000_rls_audit_fixes.sql`
  to scope by project ownership, matching `private-project-files`'s pattern.
- **`private-project-files`** — newer bucket, correctly project-scoped from
  the start.
- **`applications`** — résumé uploads. No public write policy at all;
  uploads only happen via a signed URL minted by `create-resume-upload-url`
  (see API-CONTRACT.md). Reads are superadmin-only.
- **`resources`** — internal team file manager. Added in
  `20260913000002_resources_bucket.sql` (the `resources` table existed with
  a `storage_path` column but had no bucket backing it until then). Worker/
  superadmin read/upload/delete.
- **`public-content`** — the one genuinely public bucket, for things like
  blog cover images. Not yet wired into the blog editor's UI (the editor has
  no image upload yet, just text).

## Target abstraction (not built)

```
Application code
      │
Storage Service  (src/lib/services/storage.ts — does not exist yet)
      │
Storage Adapter interface (upload/download/delete/signedUrl)
      │
   ┌──┴──┐
Supabase   Cloudflare R2
Storage    (adapter not built —
(working)   no credentials available
            in this environment)
```

The point of the adapter interface is that `resourceFiles.ts`,
`create-resume-upload-url`, etc. would call the abstraction, not
`supabase.storage` directly — swapping to R2 later would mean writing one
new adapter, not touching every call site. **This has not been done.**
Current code calls `supabase.storage` directly throughout. Do this before
wiring R2, not at the same time as wiring R2 — get the abstraction in with
Supabase Storage as the only adapter first, verify nothing broke, then add
the R2 adapter.

R2 credentials (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, etc.) must live
only as edge-function secrets (`supabase secrets set`), never in frontend
env vars — the frontend must never receive R2 credentials directly, only
signed URLs or proxied responses from an edge function, same pattern as the
Supabase Storage signed-URL approach already in use.

## File security checklist — actual status

- ✅ Private buckets by default, signed URLs for downloads
  (`getResourceDownloadUrl`, `getSignedUrl`).
- ✅ Extension allowlist on résumé uploads (`.pdf/.doc/.docx`).
- ⚠️ MIME type is not independently verified server-side beyond the
  extension check — the spec explicitly warns "do not trust MIME type from
  the browser alone," and right now the extension is the only check. Not a
  MIME-sniffing bypass fix, just noting the gap.
- ❌ No malware scanning strategy implemented or even stubbed.
- ❌ No file versioning, trash/recovery, or folder hierarchy in the
  `resources` file manager — it's a flat list today.
