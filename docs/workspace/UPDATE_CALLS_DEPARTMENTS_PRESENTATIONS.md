# Update: floating calls, screen sharing, multi-department, personal projects, Presentation board, logo

## Apply, in this order
1. **Database**: in the Supabase SQL editor run, one at a time and in this order (each is safe to run twice):
   - `supabase/migrations/20261001000000_multi_department_membership.sql`
   - `supabase/migrations/20261001000001_personal_projects.sql`
   - `supabase/migrations/20261001000002_presentation_board.sql`
   The first prints a notice such as `multi-department: rewrote 18 policies/functions`. If it prints a **warning** listing a policy it could not rewrite (this can only happen for storage policies), tell me which one.
2. **Deploy the frontend** (Vercel). `index.html`, `robots.txt` and `sitemap.xml` are untouched.
3. `vercel.json` changed: `display-capture=(self)` (screen sharing) and `frame-src ... https:` (the in-app browser). The CSP is still report-only.
4. Realtime: the migration adds `presentation_sessions` to the `supabase_realtime` publication. If your project manages that list by hand, confirm the table is ticked in Database → Replication.

## What changed
**Calls.** Both call windows are now a floating panel: drag the title bar (or use the arrow keys), resize from any edge or corner, minimise to a bar (mute and hang-up stay on it, audio keeps playing), double-click to maximise. Position and size are remembered. **Screen sharing** works in 1:1 and group calls on desktop browsers: the shared screen takes the stage and the camera shrinks to a thumbnail. Phones cannot share their screen (a browser limitation), so the button is hidden there.

**Multi-department.** `worker_departments` holds any number of memberships per worker, each with its own member/admin role and one primary. `worker_profiles.department_id/department_role` still exist and mirror the primary (the create-worker function keeps working). Every access rule that compared against "the worker's department" now means "any of their departments" (rewritten from the installed policies, so none were missed). Main Admin edits departments from the worker's profile (**Edit departments**) or from a department's Team tab (**Add a worker**, **Remove from**, **Move to**). Workers switch between their departments with tabs at the top of **My department**; department chat channels, announcements, knowledge base rights and notifications follow all memberships.

**Personal projects.** Workers create *personal* projects (`projects.scope = 'personal'`): visible to the owner, people they invite and Main Admins only. Not visible to other workers or managers (even with `projects.view`), never client-linked, never published, not assignable to departments. The owner can invite collaborators and delete it; a Main Admin can convert it to a company project. **Workers can no longer create company projects** (the database refuses): those come from a Main Admin, as in the department model.

**Presentation board** (`/worker/present`, `/admin/present`). Start a presentation for a department or the whole company; members are notified. Stages: **Browser** (in-app browser with desktop/tablet/phone sizes), **Console** (commands, pasted output, real HTTP requests), **Dashboard** (CSV in, KPIs/charts/table out, all from the data), **Cinema** (uploaded video or direct link, play/pause/seek synced to the server clock) and **Slides** (plain text, `---` between slides, images). Each department is offered its own stage first; none are locked away. Only the presenter controls the stage; Main Admins can end any presentation.

**Logo.** Your logo is used for the sidebar/header/footer brand, the sign-in page, the loading splash, the favicon, the PWA icons (including a maskable one), the iOS home-screen icon, the push-notification icon and badge. `public/og-image.png` (1200×630) is ready if you want a social-sharing image: add `<meta property="og:image" content="https://codex-tech-foundation-platfrom.vercel.app/og-image.png">` to your `index.html` yourself (I left that file exactly as you wrote it).

## Honest limits
- Screen sharing needs a desktop browser. Presenting from a phone is what the board is for.
- The in-app browser can only show sites that allow being framed. Your own apps can; many third-party sites (Google, GitHub, banks) cannot. The stage says so and offers "open in a new tab".
- The Console does not run a shell. It logs commands, shows pasted output and sends real HTTP requests from the presenter's browser (the API must allow CORS).
- YouTube/Vimeo play in their own player and cannot be synced. Upload the file (max 50 MB on Supabase's default plan) or use a direct video link for a synced screening.
- Presentations are live: there is no recording.
- Main Admins can always see personal projects (they oversee the Workspace). The UI says this.

## Tests added
`supabase/tests/multi_department.test.sql` (31), `supabase/tests/personal_projects_and_presentations.test.sql` (40+), `tests/dom/floatingPanel.test.tsx`, `tests/dom/screenShare.test.tsx`, `tests/dom/presentation.test.ts` (39), `tests/dom/presentationBoard.test.tsx` (26). SQL tests run against a real PostgreSQL via `supabase/tests/local/run.sh`.

## Not verified
I could not open the app in a real browser or against your live Supabase from here. The behaviour above is covered by the tests listed; the visual polish (spacing, mobile layout of the new screens) and real-device screen sharing need your eyes.
