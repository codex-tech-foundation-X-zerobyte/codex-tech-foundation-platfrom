# Architecture Correction (authoritative; supersedes any earlier reading of the master prompt)

_Condensed from the owner's "Architecture Correction + Full Implementation Directive" (2026-10-07). Where this file and
`WORKSPACE_MASTER_PROMPT.md` disagree about departments, this file wins._

## The rule
**Do not build a generic department manager. Build Codex Tech Foundation Workspace as a pre-structured digital company.**
Departments are part of the product. The Main Admin assigns people and projects to them; the Main Admin does not create,
configure or wire up departments.

> One company. One Workspace. Multiple specialised department environments. Shared projects. Controlled access.

## Pre-provisioned departments (exactly these eight, today)
1. Frontend Development  2. Backend Development  3. DevOps  4. Cybersecurity  5. UI/UX Design  6. Graphics & Creative  7. Content  8. Marketing

Do not create other departments now. Future departments (Sales, HR, Finance, Support, Research, Legal, BD...) must be
addable through department **templates/definitions**, never by rewriting the app. A generic "Create Department" screen is
NOT the way the company is built.

## Each department already has
identity, dashboard, navigation, tools, boards, task workflows, permissions, metrics, channels, project views,
integrations, settings, a Department Admin experience and a worker experience. Dashboards must differ in substance
(Frontend = developer env, Backend = API env, DevOps = infrastructure env, Security = ops + lab, UI/UX = design env with
whiteboard, Graphics = creative env, Content = production studio, Marketing = campaigns/analytics). Never "same dashboard,
different name".

## Roles
- **Main Admin**: whole company. Creates workers and projects, assigns workers to departments, assigns Department Admins,
  reviews approvals / suspensions / offboarding, announcements, integrations, audit, org settings.
- **Department Admin**: administers one department only (receives project assignments, breaks them into tasks, assigns
  workers, reviews work, manages department channels/tools/resources, *requests* suspensions). NOT a Main Admin: no access
  to other private departments, HR/financial data, company security settings, audit deletion, or permanent worker removal.
- **Worker**: sees only their department environment and relevant work.
- Worker lifecycle: INVITED -> ACTIVE -> SUSPENSION_PENDING -> SUSPENDED -> REVIEW -> ACTIVE | OFFBOARDED. History is kept.

## Worker creation
Main Admin selects **Department** (+ role/position). The worker automatically gets that department's workspace, dashboard,
tools, boards, channels and relevant projects. No per-worker configuration.

## Projects (one project, many departments)
Main Admin creates ONE project (name, description, priority, dates, departments, objectives, deliverables) in a multi-step
flow (info -> departments -> objectives -> suggested tasks -> review -> create & distribute). Each department receives an
assignment; the Department Admin accepts / breaks into tasks / assigns workers / monitors / reviews / requests
clarification / submits. Flow: Main Admin -> Project -> Department assignment -> Department Admin -> Tasks -> Workers ->
Execution -> Review -> Approval -> Completion.

## Department specifics (boards / workflows)
- Frontend: Backlog > Ready > In development > Code review > QA > Ready for deployment > Deployed. GitHub, PRs, API/JSON/HTTP tools.
- Backend: Backlog > Development > API testing > Code review > QA > Staging > Production.
- DevOps: Requested > Planned > Configuration > Testing > Staging > Deployment > Verified. GitHub Actions, health, domains/SSL, incidents.
- Cybersecurity: TWO surfaces. Security Operations (Identified > Triage > Investigating > Risk assessment > Remediation >
  Verification > Closed) and a Security Lab of defensive utilities for company-owned / authorised / controlled use only.
  Never an unrestricted offensive platform.
- UI/UX: Design Studio + lightweight collaborative whiteboard (text, shapes, lines, arrows, frames, cards, connectors,
  colours, comments, drag/drop, zoom, selection). "Open in Figma" for advanced work.
- Graphics & Creative: Request > Assigned > Designing > Review > Changes requested > Approved > Final asset. Canva integration; do not rebuild Canva.
- Content: Idea > Draft > Review > Approved > Scheduled > Published. Script editor (title, hook, intro, main point,
  supporting points, CTA, caption, hashtags), calendar. No video editor; link to CapCut/Canva.
- Marketing: campaigns, leads, audience, social, calendar, analytics, reports. **Never fake analytics**: show "No connected data source".

## Honesty rules (non-negotiable)
No fake repositories, deployments, analytics, incidents or activity. Unconnected integration => "<X> not connected" + connect
action. Demo data only if clearly labelled. No secrets in the frontend. Authorisation is enforced by RLS / Edge Functions,
never by hiding buttons. Use Lucide icons, no emoji as icons; premium, calm, desktop-first (1280/1440/1920) with a solid mobile fallback.

## Company Core (shared by every department)
Home, My Work, Projects, Tasks, Messages/DMs, department + project channels, Meetings, Calendar, Files, Notifications,
Announcements, Knowledge Base, Global Search (permission-aware), Worker Profiles, Approvals, Activity, Audit, Integrations,
Settings, Help.

## Phase order
A Audit -> B Architecture correction (pre-provision departments) -> C Company Core -> D Department environments ->
E Project orchestration -> F Integrations (GitHub first) -> G Security verification -> H Polish.
