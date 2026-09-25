# File Storage

## Current state: 100% Supabase Storage, no R2

Every file (`resources`, `private-project-files`, `project-assets`,
`applications`, `public-content`) lives in a Supabase Storage bucket today.
There is no Cloudflare R2 integration, and no storage abstraction layer
(`storage.service.ts`) separating "what the UI calls" from "which provider
actually stores the bytes" — `src/lib/services/shared.ts`'s `storage` object
calls `supabase.storage.from(bucket)...` directly.

This is a real gap against the brief (§22/§35), not a stub — don't assume an
abstraction exists.

## Why R2 wasn't added in this pass

R2 needs account-level Cloudflare credentials (account ID, access key,
secret key) that this environment has no way to obtain or verify against —
and per the brief itself (§36), R2 billing/setup should never block the rest
of the platform. This has since also been made explicit by the platform
owner: **Supabase Storage is the deliberate choice for now**, with R2 to be
migrated to later when ready — not a stopgap forced by missing credentials
alone. Rather than half-wire an untestable integration, storage stays on
Supabase (which already works end-to-end, verified by existing RLS-scoped
buckets and, as of Pass 4, real folders/trash/versioning) and this document
records the abstraction point below for whenever that migration happens.

## What already matches the target shape

Every current upload/download already goes through
`src/lib/services/shared.ts`'s `storage` helper (`upload`, `getPublicUrl`,
`getSignedUrl`, `remove`) rather than pages calling
`supabase.storage.from(...)` directly — this is already the "one place to
change" the brief asks for. **When R2 is added, this is the only file that
needs to grow a provider branch**; no page component should need to change.

## Target architecture (not yet built)

```
React (storage helper in shared.ts, unchanged call sites)
  ↓
storage.service.ts  ← new: provider-agnostic interface
  ↓
  ├─ SupabaseStorageAdapter  (today's behavior, default)
  └─ R2StorageAdapter         (new, behind an Edge Function —
                                 R2 credentials are server-side secrets,
                                 never in frontend code, exactly like
                                 SUPABASE_SERVICE_ROLE_KEY today)
```

For R2 specifically, uploads/downloads should go through a signed-URL Edge
Function pattern identical to `create-resume-upload-url` — the browser never
receives an R2 access key or secret key, only a short-lived signed URL.

Database metadata (already correct, doesn't need to change for R2):
`project_files` and `resources` already store `storage_path`, `mime_type`,
`size_bytes`/`file_size`, `uploaded_by`/`owner_id` — an R2 migration is a
storage-backend swap under an unchanged metadata schema, not a schema
migration.

## What "Team Files" (§21/§34 of the brief) needs — status: implemented on Supabase Storage

As of Pass 4, `resources` (the team file library) supports folders
(`parent_id`/`is_folder`), drag-and-drop multi-file upload, real trash
(`deleted_at` — the storage object is preserved and restorable; only
"delete forever" from the trash view actually removes bytes), versioning
(`resource_versions`, one row per uploaded version, old versions never
overwritten), download tracking (`download_count`, incremented server-round-trip
on each signed-URL request), search (`ilike` on title), and aggregate
storage usage (a real query summing `size_bytes`, not a fabricated number).
See `src/lib/services/resourceFiles.ts` and `src/pages/ResourcesManager.tsx`.

**What's still missing from the full §21 wishlist:** file previews (no
inline PDF/image preview — download-only), internal file links (no
"share a link to this file within chat/a task" — partly blocked on Team
Chat not existing yet), and per-file granular permissions beyond the
existing team-wide worker/manager/superadmin access (there's no "private to
me" or "shared with these people only" option — every team member with
resources access sees every file). Client-visible deliverables are a
separate, still-unbuilt surface — see ARCHITECTURE.md's "what doesn't
exist" list.

A real bug was fixed while building this: the previous `deleteResource()`
called `storage.remove()` immediately on "delete," so anything in the
(then-misleadingly-named) "archived" state was **not actually recoverable**
despite `archived_at` looking like a soft-delete flag. `moveToTrash()` now
genuinely preserves the object until an explicit `permanentlyDelete()` call.
