# Is Codex Workspace an "online organization"? (honest assessment, updated 2026-10-08)

**Verdict.** For a small technology company it now genuinely is one: a real hierarchy, eight departments that each work differently,
one project flowing through them, people with a full lifecycle, a company calendar, a knowledge base, onboarding, announcements,
approvals, and tools that exist rather than being promised. What it is not yet: proven against live GitHub, covered by a
company-wide search or an activity overview, or ready to be described as having integrations beyond GitHub, Figma and Canva.
Say "your company's online headquarters" freely; claim GitHub support only after the smoke tests in `WORKSPACE_DEPLOYMENT.md` pass.

## Scorecard (what is verifiably in the repo)

| Quality of an organization | Status | Evidence |
|---|---|---|
| Structure and hierarchy | **Built** | 8 pre-provisioned departments; Main Admin / Department Admin / worker; live org chart |
| Distinct departments | **Built** | 65 tools across 8 definitions, **0 placeholders** (a test fails if a tool points at nothing); 14 record types, 15 native tools |
| One project, many departments | **Built** | wizard -> assignments -> accept -> tasks -> stages -> review -> complete |
| Delegation and review | **Built** | task checklist, comments with @mentions, dependencies (no cycles, can't finish early), watchers, review state, GitHub links, attachments |
| Enforced boundaries | **Built (rows) / partial (storage)** | projects, files, clients, resources, tasks, records, knowledge, meetings scoped by department in the database (241 SQL checks). Storage object policies still role-based |
| People lifecycle | **Built** | INVITED -> ACTIVE -> SUSPENSION_PENDING -> SUSPENDED -> REVIEW -> ACTIVE/OFFBOARDED; Department Admin requests, Main Admin decides, full history kept, suspended accounts lose all access immediately |
| Approvals | **Built** | one inbox: suspension reviews, assignments to accept or sign off, work to review, work sent back |
| Communication | **Built** | announcements, chat, DMs, calls, presence, **department channels created and kept in sync automatically** |
| Meetings and calendar | **Built** | meetings with agenda, notes, recording link, action items; one calendar of meetings, deadlines, tasks and dated work |
| Company memory | **Built** | knowledge base (10 fixed categories, department-scoped, markdown, search) |
| Onboarding | **Built** | company + per-department checklist, progress per person |
| Department tooling | **Built** | security lab (headers, DNS + SPF/DMARC, logs, configuration audit), whiteboard, webhook tester, script/caption/article editor, bug/incident/domain/backup/campaign/report/brief records, files, calendars |
| Integrations | **Built, not yet proven live** | GitHub (repos, branches, commits, issues, PRs with review state, Actions, deployments, task links), Figma and Canva launchers. Token stays server-side. GitHub was never called for real while building, and the Edge Functions were not executed (no Deno) |
| Company-wide search | Missing | |
| Company Pulse (activity overview) | Missing | |
| Per-project channels | Missing | |

## Real limits to know about
- Domain/SSL expiry is a **manually maintained watch list** with warnings; nothing probes certificates automatically.
- Marketing analytics are **entered by the team with their source**; there is no automatic social/analytics ingestion.
- Whiteboards save the whole board and detect conflicts (last save wins only if you reload); there are no per-shape comment threads (sticky notes serve).
- @mentions match a person's display name.
- Figma/Canva are launchers to the company's own space, not embedded editors.

## What closes the remaining gap (in priority order)
1. Run the smoke tests (GitHub, webhook inbox, suspension flow) against a real deployment.
2. Department-scope the storage bucket policies.
3. Global, permission-aware search; Company Pulse; per-project channels.
4. Suggested-task templates in the project wizard; clarification requests; Department Admins creating workers.
5. Audit filters by user/department/severity; announcement acknowledgement; presence Away/Busy.
