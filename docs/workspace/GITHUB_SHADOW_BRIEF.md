# CODEX TECH FOUNDATION WORKSPACE
## GitHub Shadow / Developer Hub — Project Recovery and Implementation Brief

> This is the project owner's brief, saved verbatim. Treat it as the product direction. Treat the codebase as the source of truth for what is already built (`CONTINUE.md`, section 3, item 5, lists what exists).

### 1. YOUR ROLE

Act as the senior software architect and implementation engineer responsible for the GitHub Shadow inside the Codex Tech Foundation Workspace.

You previously discussed this feature with the project owner, but you have lost the context of those discussions.

This document restores the intended direction.

Do not interpret this feature as a simple GitHub profile integration, a repository listing page, or a button that redirects users to GitHub.

The objective is to build a secure, integrated developer environment inside the existing Codex Workspace.

Your task is to recover the intended product direction, inspect the existing implementation, identify what has already been completed, and continue development without damaging existing workspace functionality.

### 2. PRODUCT VISION

The GitHub Shadow is the internal developer hub of Codex Tech Foundation.

It should allow authorized workspace members to manage development projects, work with repositories, collaborate on code, review contributions, track issues, and monitor deployments through the Codex Workspace interface.

The interface should make GitHub functionality accessible from inside Codex while preserving GitHub as the underlying source of truth for repositories and Git operations during the initial phase.

The long-term vision is to evolve this capability into a more independent developer platform, potentially supporting native Codex repositories in the future.

Do not attempt to build a complete Git hosting infrastructure from scratch in the initial implementation.

### 3. IMPORTANT ARCHITECTURAL DECISIONS

Preserve these original decisions:

- Integrate with real GitHub first.
- Use GitHub APIs and webhooks where appropriate.
- Use Supabase Edge Functions for secure server-side GitHub operations.
- Reuse the existing Codex Workspace authentication and authorization model.
- Enforce permissions on the backend, not only in the user interface.
- Use GitHub App authentication or another appropriate least-privilege authorization flow.
- Keep GitHub tokens, private credentials, and sensitive integration secrets out of frontend code.
- Design the integration so that future native Codex repositories remain possible.
- Prepare for deployment integrations such as Vercel and Netlify.
- Maintain compatibility with the existing React and TypeScript workspace architecture.

Do not introduce a separate authentication system without a compelling architectural reason.

Do not replace existing authentication, subscription logic, routing, database structures, or other workspace modules simply to implement this feature.

Inspect the current codebase before making architectural changes.

### 4. CORE MODULES

Implement the following modules in a phased, production-oriented manner.

#### A. Repository Management

Users with appropriate permissions should be able to:

- View repositories available to them.
- Connect their authorized GitHub account or organization.
- Import or connect existing repositories.
- Create repositories when their GitHub permissions allow it.
- View repository descriptions, visibility, default branches, and activity.
- Open a repository's file browser.
- Navigate directories and inspect source files.
- View README files where available.
- View recent commits and repository activity.
- Access the corresponding GitHub repository when external navigation is necessary.

Support private repositories securely.

Never assume a repository is public merely because it appears in a workspace listing.

Repository visibility and access must respect GitHub permissions and Codex workspace authorization.

#### B. Branch Management

Where supported by the connected GitHub permissions, provide:

- Branch listings.
- Default branch identification.
- Branch creation.
- Branch comparison.
- Commit history by branch.
- Branch protection awareness.
- Links to inspect branches directly on GitHub when necessary.

Do not falsely represent a branch as created, updated, or deleted until the operation has succeeded.

#### C. Commit History and Code Changes

Provide:

- Commit history.
- Commit authors and timestamps.
- Commit messages.
- Changed-file listings.
- Added and removed line summaries where available.
- Code diffs.
- Navigation between commits and associated pull requests.

Use pagination for large histories and avoid loading entire repositories unnecessarily.

#### D. Pull Requests and Code Review

Support:

- Viewing pull requests.
- Creating pull requests where permitted.
- Viewing pull request details and changed files.
- Reviewing code diffs.
- Adding review comments where supported.
- Submitting reviews or approvals where authorized.
- Tracking review status.
- Merging pull requests where permitted.
- Displaying merge conflicts or failed merge attempts accurately.

Respect GitHub branch protection rules, required reviews, and other repository policies.

Never bypass GitHub's security or approval requirements.

Never report a pull request as merged unless GitHub confirms that the merge succeeded.

#### E. Issues and Development Tasks

Support:

- Viewing issues.
- Creating issues.
- Updating issue descriptions and labels where authorized.
- Tracking open, closed, and assigned issues.
- Viewing issue comments.
- Connecting issues to repositories.
- Linking issues to development tasks in the Codex Workspace when appropriate.

Avoid creating duplicate task systems unnecessarily.

Inspect the existing workspace task-management module before designing additional functionality.

#### F. Deployment Center

Prepare an integration layer for deployment providers, initially including:

- Vercel.
- Netlify.

Where the connected provider and available permissions support it, display:

- Deployment status.
- Deployment history.
- Preview URLs.
- Production deployment URLs.
- Build status.
- Relevant logs.
- Failure information.
- Available rollback actions.

Deployment capabilities must reflect the actual provider APIs and permissions.

Do not invent deployment logs or statuses.

Do not expose provider access tokens.

Rollback, redeployment, and other consequential operations must be permission-checked and confirmed when appropriate.

Do not require both deployment providers to be connected. Users should be able to use whichever provider is configured for their project.

#### G. Team Collaboration and Access Control

Integrate repository permissions with the Codex Workspace's existing team and role structure.

Consider roles such as:

- Repository viewer.
- Contributor.
- Reviewer.
- Repository administrator.
- Workspace administrator.

These are proposed permission capabilities, not a requirement to create a conflicting new role system.

First inspect the existing workspace roles and permissions.

Map existing roles to GitHub operations where appropriate.

A user who can view a repository must not automatically be allowed to push code, approve pull requests, merge branches, change repository settings, or deploy applications.

Workspace membership alone must not grant access to every connected private GitHub repository.

Apply authorization checks to every sensitive server-side operation.

#### H. Development Automation

Create a foundation for:

- CI/CD status.
- GitHub Actions workflow status where authorized.
- Webhook-driven updates.
- Pull request notifications.
- Failed build notifications.
- Deployment notifications.
- Development activity feeds.

Only implement integrations that can be supported by the actual APIs and permissions.

Use webhooks for relevant events instead of relying exclusively on repeated polling.

Verify webhook signatures and prevent duplicate event processing.

Do not expose webhook secrets.

### 5. USER EXPERIENCE AND DESIGN

The Developer Hub must feel like a natural part of the existing Codex Workspace.

It should not look like a disconnected third-party dashboard.

Requirements:

- Reuse the workspace's existing design system and navigation conventions.
- Maintain the existing Codex branding.
- Use a professional, modern developer-focused interface.
- Prioritize mobile usability as well as desktop productivity.
- Use responsive repository lists, file browsers, tables, code diffs, and pull request views.
- Support loading, empty, success, error, permission-denied, and disconnected-account states.
- Include clear feedback for operations that succeed or fail.
- Use icons consistent with the existing interface.
- Avoid unnecessary decorative elements that reduce development efficiency.
- Preserve the existing workspace's functionality and visual identity.

On mobile, avoid forcing users to navigate excessively wide tables or horizontally overflowing pages.

Use responsive layouts, accessible controls, and appropriate touch targets.

Reuse existing UI components wherever practical.

Do not redesign the entire Codex Workspace as part of this task.

### 6. SECURITY REQUIREMENTS

Security is a core requirement, not a future enhancement.

Implement the following protections:

1. Store integration secrets in appropriate server-side secret storage.
2. Never hardcode GitHub tokens or provider credentials.
3. Never expose private tokens through client-side environment variables, API responses, browser storage, or logs.
4. Authenticate all sensitive backend operations.
5. Verify that the requesting user belongs to the relevant workspace.
6. Check repository-level permissions before every protected operation.
7. Use the least privileges required by each integration.
8. Validate request payloads and repository identifiers.
9. Verify GitHub webhook signatures.
10. Prevent unauthorized cross-workspace and cross-tenant access.
11. Protect against replayed or duplicate webhook processing where relevant.
12. Apply appropriate rate limits and handle GitHub API rate limits.
13. Avoid logging secrets, authorization headers, or sensitive repository content unnecessarily.
14. Handle revoked tokens, expired installations, missing permissions, and disconnected accounts gracefully.
15. Validate deployment-provider authorization independently from GitHub authorization.
16. Use secure redirects and verify OAuth state or other anti-CSRF protections where applicable.
17. Enforce branch protection and review requirements through GitHub rather than bypassing them.
18. Use database policies where applicable, but do not assume database row-level security alone secures every external API operation.

Do not trust a repository ID, workspace ID, role, or permission supplied by the frontend without validating it on the server.

Do not allow a user to access another workspace's private repository by changing a URL or request payload.

### 7. SUPABASE AND BACKEND DESIGN

Inspect the existing Supabase schema, authentication model, Edge Functions, and database policies before implementing anything.

Reuse existing structures wherever possible.

If additional persistence is required, design appropriate records for concepts such as:

- Connected GitHub installations or accounts.
- Workspace-to-repository associations.
- Repository access configuration.
- Webhook delivery identifiers and processing status.
- Deployment-provider connections.
- Relevant integration metadata.

These are conceptual data models, not instructions to create every table blindly.

Use appropriate foreign keys, uniqueness constraints, indexes, and row-level security policies.

Never store raw integration credentials in ordinary workspace tables without an appropriate secure design.

Prefer keeping provider credentials in server-side secret storage or a dedicated secure credential mechanism.

Create or update Supabase Edge Functions for operations that require privileged access to GitHub or deployment providers.

Each function must independently authenticate the caller and authorize the requested action.

Return only the information the caller is allowed to access.

Use clear error responses without leaking internal credentials or sensitive implementation details.

### 8. INTEGRATION STRATEGY

GitHub should remain the source of truth for repository state during the initial phase.

The Codex Workspace should act as the integrated user interface, authorization boundary, collaboration environment, and orchestration layer.

Do not attempt to maintain a second, inconsistent copy of repository state.

Use GitHub APIs for operations that require GitHub's authority.

Use webhooks to synchronize relevant events and refresh cached metadata when appropriate.

Treat cached information as potentially stale.

Handle API errors, permission changes, rate limits, deleted repositories, renamed repositories, and revoked access.

For operations that cannot reasonably be completed through the embedded interface, provide a clear path to the corresponding GitHub page.

Do not simulate unsupported GitHub functionality.

### 9. FUTURE NATIVE CODEX REPOSITORIES

Keep the architecture extensible enough to support native Codex repositories in a later phase.

Do not build the native repository hosting system now unless the project owner explicitly approves that scope.

Avoid tightly coupling every user-interface component directly to GitHub-specific response formats.

Where it provides real value, define an internal repository-provider interface that can later support multiple providers.

For example, conceptual operations may include:

- List repositories.
- Retrieve repository metadata.
- List branches.
- Retrieve commits.
- Retrieve file contents.
- Create pull requests.
- Retrieve issues.
- Retrieve deployment information.

Not every provider will support every operation.

Represent unsupported capabilities explicitly rather than pretending that all providers offer identical functionality.

Do not create an elaborate abstraction framework before it is needed.

The immediate objective is a reliable GitHub integration.

### 10. IMPLEMENTATION WORKFLOW

Before writing or modifying code:

STEP 1 — INSPECT

Examine the existing repository and identify:

- Framework and build configuration.
- Current workspace navigation.
- Existing Developer Hub or GitHub Shadow implementation.
- Authentication and role systems.
- Supabase schema and Edge Functions.
- Existing integrations.
- Relevant environment variables.
- Existing design components.
- Tests and deployment configuration.

STEP 2 — REPORT

Provide a concise assessment covering:

- What already exists.
- What works.
- What is incomplete.
- What is broken.
- What should be reused.
- What requires new implementation.
- Any architectural or security risks.

Distinguish verified findings from assumptions.

Do not claim to have tested something unless you actually tested it.

STEP 3 — PLAN

Divide implementation into small, testable phases.

Recommended order:

Phase 1: Existing architecture review and security assessment.

Phase 2: GitHub connection and secure authorization.

Phase 3: Repository listing, repository details, file browsing, and commits.

Phase 4: Branches, pull requests, and code review.

Phase 5: Issues and workspace task integration.

Phase 6: Deployment integrations.

Phase 7: Webhooks, notifications, and automation.

Phase 8: Hardening, responsive UI, testing, and documentation.

Adjust this order if the existing implementation already contains completed modules.

STEP 4 — IMPLEMENT

Implement complete vertical slices rather than creating many disconnected placeholder pages.

For each feature, build the necessary frontend, backend, authorization, error handling, and tests.

Do not replace working functionality merely to make the code appear cleaner.

Keep changes focused and reviewable.

STEP 5 — VERIFY

Run the project's available:

- TypeScript checks.
- Linting.
- Unit tests.
- Integration tests.
- Production build.
- Relevant security checks.

Test both successful operations and failure cases.

Include tests for unauthorized access and cross-workspace access attempts.

If live GitHub credentials are unavailable, implement what can be safely completed, use mocks or fixtures for automated tests, and clearly document which live integration tests remain unverified.

Never invent successful integration results.

STEP 6 — REPORT COMPLETION

At the end of each phase, report:

- What changed.
- Files or modules affected.
- Features completed.
- Tests executed and their actual results.
- Remaining issues.
- Required environment variables or secrets, without revealing their values.
- Any manual setup required.
- The next recommended phase.

### 11. NON-NEGOTIABLE CONSTRAINTS

- Do not destroy existing workspace features.
- Do not replace the authentication system unnecessarily.
- Do not expose integration credentials.
- Do not weaken workspace security.
- Do not implement frontend-only authorization.
- Do not create fake repositories, fake commits, or simulated successful operations in production.
- Do not claim unimplemented features are complete.
- Do not migrate the project to a different backend stack without explicit approval.
- Do not build native Git hosting infrastructure prematurely.
- Do not redesign unrelated workspace modules.
- Do not perform destructive database migrations without reviewing their impact and obtaining approval when required.
- Do not deploy breaking changes without appropriate verification and authorization.

### 12. YOUR FIRST RESPONSE

Do not immediately rewrite the entire feature.

First inspect the existing codebase and report:

1. The current state of the GitHub Shadow.
2. The existing implementation that should be preserved.
3. The missing functionality relative to this brief.
4. Security and architectural concerns.
5. The smallest useful implementation phase to complete next.

Then proceed with the first approved, testable implementation slice.

Treat this document as the restored product brief. Treat the actual codebase as the source of truth for implementation status.

The goal is a secure, useful GitHub-powered Developer Hub inside Codex Tech Foundation Workspace, with a clear path toward a more independent Codex developer platform in the future.
