# CODEX TECH FOUNDATION — WORKSPACE MASTER BUILD SPECIFICATION
## Migration: Codex Tech Foundation Portal / Platform → Codex Tech Foundation Workspace

> **Document purpose:** This is the canonical product/build specification for transforming the existing Codex Tech Foundation internal portal/platform into **Codex Tech Foundation Workspace**, the company's digital headquarters and online office.
>
> **IMPORTANT:** Read this entire document before making architectural decisions or writing major code. Do not treat this as a request for a cosmetic dashboard redesign. The existing platform should be evolved into a department-aware company operating system while preserving and extending useful existing functionality.

---

# 1. PRODUCT IDENTITY

The product is no longer conceptually a generic "Codex Tech Foundation Portal."

The new product identity is:

# Codex Tech Foundation Workspace

Short name where appropriate:

**Codex Workspace**

Core positioning:

> **Codex Tech Foundation Workspace is the digital headquarters of Codex Tech Foundation — a unified environment where projects are created, departments collaborate, work is distributed, workers operate inside specialized workspaces, communication happens in context, and company leadership maintains organization-wide oversight.**

The product should feel like a real online company office, not simply a developer project-management dashboard.

It should combine concepts found in serious workplace products:

- company intranet
- project management
- team collaboration
- department workspaces
- internal communication
- task management
- document/file management
- meetings
- employee management
- approvals
- company knowledge
- department-specific professional tools
- GitHub/development workflows
- design workflows
- content workflows
- marketing analytics
- cybersecurity operations
- AI/ML project workflows
- organizational oversight

Do NOT blindly copy another company's UI. Build a cohesive Codex-specific system.

---

# 2. MOST IMPORTANT PRODUCT PRINCIPLE

The current platform has a developer/project-management orientation.

That must evolve.

The system must support different types of workers without forcing everyone to use a developer-oriented interface.

A developer should feel that the system was designed for developers.

A cybersecurity worker should feel that the system was designed for cybersecurity.

A UI/UX designer should feel that the system was designed for design.

A marketer should feel that the system was designed for marketing.

A content creator should feel that the system was designed for content.

An executive should feel that the system was designed for organizational oversight.

However, they must all still work inside ONE company and ONE connected platform.

The architecture is therefore:

**Shared Company Core + Department Workspaces + Role/Permission Layer + Specialized Tools + Cross-Department Projects**

Do NOT build six completely separate applications.

Build one platform with a shared core and modular department experiences.

---

# 3. CORE EXPERIENCE

When a worker logs in, the system should determine:

1. Organization
2. Department
3. Role
4. Workspace
5. Permissions
6. Projects they belong to
7. Tools available to their department/role

Conceptually:

```text
Worker
  ↓
Organization
  ↓
Department
  ↓
Workspace
  ↓
Role
  ↓
Permissions
  ↓
Available Tools
  ↓
Projects / Tasks / Collaboration
```

Department must not be the same thing as permission.

For example:

```text
Department: Cybersecurity
Role: Security Analyst
Permissions:
- View security projects
- Create security tasks
- Upload reports
- Create vulnerability records
- Comment
- Join meetings

No:
- Company administration
- Employee termination
- Organization deletion
- Main security configuration
```

Use explicit role/permission checks rather than hardcoding "department = permission."

---

# 4. ORGANIZATIONAL HIERARCHY

The system should support these primary levels.

## Level 1 — Main Admin / Executive

Organization-wide authority.

Responsibilities:

- create projects
- create company-level objectives
- distribute work to departments
- assign departments to projects
- create and manage company announcements
- oversee all departments
- review organizational activity
- manage workers and department administrators
- review suspension requests
- approve/reject high-level requests
- manage organization-wide settings
- access audit logs
- manage integrations
- manage company knowledge
- view company operational overview

The Main Admin is the highest organizational authority inside Workspace.

---

## Level 2 — Department Administrator

Each department can have one or more Department Administrators.

Examples:

- Development Admin
- Cybersecurity Admin
- UI/UX Admin
- Marketing Admin
- Content Admin
- AI/ML Admin
- Business/Growth Admin

A Department Administrator is powerful inside their department but is NOT a Main Admin.

They can:

- view their department
- view department projects
- receive assignments from Main Admin
- create department tasks
- break objectives into worker tasks
- assign tasks
- create workers for their department
- edit workers
- temporarily suspend workers
- view department activity
- manage department workspace
- manage department-specific tools
- review department work
- approve department-level work
- escalate matters to Main Admin
- view department reports

They cannot:

- manage other departments
- manage Main Admins
- permanently terminate workers without Main Admin approval
- permanently delete workers
- delete the organization
- change organization-wide security settings
- bypass Main Admin controls
- gain unrestricted access to another department

---

## Level 3 — Team Lead / Senior Worker

Optional but architect the system so this role can exist later.

Can coordinate a subset of workers.

---

## Level 4 — Worker

Workers receive:

- assigned projects
- assigned tasks
- relevant department tools
- relevant communication
- relevant files
- meetings
- notifications
- approvals/reviews applicable to them

They should NOT see administrative controls they are not authorized to use.

---

## Level 5 — External Collaborator

Do not necessarily implement fully in V1, but keep the architecture extensible for:

- clients
- contractors
- temporary collaborators
- partners

with restricted project access.

---

# 5. WORKER LIFECYCLE

Worker accounts need proper lifecycle states.

Recommended model:

```text
INVITED
   ↓
ACTIVE
   ↓
SUSPENSION_PENDING
   ↓
SUSPENDED
   ↓
REVIEW
   ↓
ACTIVE
or
OFFBOARDED
```

Do not make immediate destructive deletion the normal employee-exit workflow.

When someone leaves:

**OFFBOARDED**

is preferable to deleting historical records.

Preserve:

- tasks
- comments
- project history
- activity
- audit records
- files
- contribution history

while disabling authentication/access.

---

# 6. SUSPENSION / OFFBOARDING WORKFLOW

Department Administrators may initiate a temporary suspension.

Example:

```text
Worker: John Doe
Department: Development
Action: Suspend
Reason: Repeated policy/workflow violations
Requested by: Development Admin
```

The system records the request.

Depending on the configured security policy, access can be immediately restricted while awaiting review.

Main Admin receives:

**Suspension Request**

Main Admin actions:

- Approve Temporary Suspension
- Reject Suspension
- Restore Access
- Extend Suspension
- Mark for Offboarding
- Terminate/Disable Employment Access
- Preserve account history

Permanent account deletion must be highly restricted and should not be a normal Department Admin action.

All employee lifecycle changes must be auditable.

---

# 7. SHARED COMPANY CORE

All departments use the same foundational platform.

Shared modules:

- Home
- My Work
- Projects
- Tasks
- Calendar
- Chat
- Meetings
- Files
- Notifications
- Search
- Company Announcements
- Knowledge Base
- Worker Profiles
- Activity
- Approvals
- Settings
- Help
- Integrations where authorized

These are the company's common operating system.

---

# 8. COMPANY HOME / DIGITAL RECEPTION

Create a company-level Home experience.

It should immediately answer:

- What is happening today?
- What do I need to do?
- What changed?
- What meetings do I have?
- What projects am I involved in?
- What announcements matter to me?

Example:

```text
CODEX TECH WORKSPACE

Good morning, Alex.

Company Announcements
"Zerøbyte Business launch meeting — Friday"

Your Day
7 Tasks
2 Meetings
4 Messages

Your Projects
Zerøbyte Business      82%
Codex Workspace         64%
Marketing Campaign      91%

Company Activity
Ike completed Backend API
Sarah uploaded a new design
David completed security assessment
Mary published campaign report
```

This is the digital reception of the company.

---

# 9. MY WORK

Every worker should have a universal "My Work" view regardless of department.

It includes:

- today's tasks
- overdue tasks
- upcoming tasks
- assigned projects
- meetings
- mentions
- approvals
- recent activity

Example:

```text
MY WORK

Today
- Security review
- Design meeting
- Content approval

Assigned Tasks
- Fix authentication issue
- Review campaign assets
- Complete security checklist

Upcoming
- Project meeting
- Sprint review
- Campaign launch
```

This prevents specialized workspaces from becoming confusing.

---

# 10. PROJECT SYSTEM

Projects are cross-department entities.

Example:

**ZERØBYTE BUSINESS V2**

The project may include:

```text
Development
- Frontend
- Backend
- Testing
- Deployment

UI/UX
- Research
- Wireframes
- Design
- Review

Cybersecurity
- Threat assessment
- Security testing
- Final audit

Content
- Product content
- Documentation
- Launch materials

Marketing
- Campaign
- Social promotion
- Analytics

AI/ML
- Customer-service assistant
- Model evaluation
```

Multiple departments can work on the SAME project simultaneously.

Do not duplicate the project for each department.

Use:

- project membership
- department participation
- project roles
- task ownership
- permissions

to determine what each person sees.

---

# 11. PROJECT ORCHESTRATION

Main Admin should be able to create a project at the organization level.

Example:

> "Create the new Codex website."

The Main Admin can specify:

```text
Project
Description
Priority
Start date
Deadline
Departments required
Objectives
Deliverables
```

Then select departments:

- Development
- UI/UX
- Cybersecurity
- Content
- Marketing

The system distributes the relevant project objectives to those department workspaces.

Department Admin then breaks them down into worker-level tasks.

Workflow:

```text
Main Admin
    ↓
Project / Objective
    ↓
Department Assignment
    ↓
Department Admin
    ↓
Worker Tasks
    ↓
Execution
    ↓
Review
    ↓
Completion
    ↓
Main Admin visibility
```

Main Admin can also create specific department tasks directly when necessary.

---

# 12. PROJECT TEMPLATES

Create reusable project templates.

Example:

**Website Project**

Automatically creates suggested structures:

```text
Development
- Frontend
- Backend
- Testing
- Deployment

UI/UX
- Research
- Wireframes
- UI
- Design Review

Content
- Copy
- Documentation

Marketing
- Launch Campaign
- Social Campaign

Security
- Security Assessment
- Final Review
```

Templates must be editable before/after creation.

Do not hardcode one workflow for every project.

---

# 13. TASK SYSTEM

Tasks should support:

- title
- description
- project
- department
- assignee
- creator
- priority
- status
- due date
- labels/tags
- attachments
- comments
- checklist/subtasks
- dependencies
- watchers
- mentions
- activity history
- approvals
- review state

Recommended universal workflow:

```text
BACKLOG
↓
ASSIGNED
↓
IN PROGRESS
↓
IN REVIEW
↓
CHANGES REQUESTED
↓
APPROVED
↓
COMPLETED
```

Departments may have specialized workflows.

### Content:

```text
IDEA
↓
DRAFT
↓
REVIEW
↓
APPROVED
↓
SCHEDULED
↓
PUBLISHED
```

### Development:

```text
BACKLOG
↓
DEVELOPMENT
↓
CODE REVIEW
↓
QA
↓
PRODUCTION
```

### Security:

```text
IDENTIFIED
↓
INVESTIGATING
↓
TESTING
↓
REMEDIATION
↓
VERIFIED
↓
CLOSED
```

---

# 14. REAL-TIME COLLABORATION

The Workspace must feel alive.

Support presence:

- Online
- Away
- Busy
- Offline

Show contextual presence where useful:

- "Sarah is viewing this project"
- "Ike is editing this task"
- "David is in a meeting"

Use real-time updates for:

- task changes
- comments
- chat
- notifications
- project activity
- worker status
- approvals
- meeting state

Do not create distracting animations. The experience should feel professional and calm.

---

# 15. COMPANY COMMUNICATION

Build communication into the Workspace.

## Direct Messages

Worker-to-worker messaging.

## Department Channels

Example:

```text
Development
#general
#frontend
#backend
#deployment
```

## Project Channels

Example:

```text
Zerøbyte Business
#general
#development
#design
#security
#marketing
```

## Company Channels

```text
Company
#announcements
#general
```

Users should be able to mention people and departments where authorized.

Example:

`@Ike`

`@Development`

---

# 16. COMPANY ANNOUNCEMENTS

Main Admin can create announcements.

Fields:

- title
- body
- priority
- audience
- attachments
- publish date
- expiration
- acknowledgement required

Audience:

- everyone
- department
- selected workers

Important announcements should appear prominently on Home and Notifications.

---

# 17. MEETINGS

Meetings should be a first-class module, not just a random video-call button.

Meeting record:

```text
Title
Project
Date/time
Participants
Department
Agenda
Notes
Files
Action items
Recording reference if supported
```

Example:

```text
ZERØBYTE LAUNCH MEETING

Participants: 8

Agenda
✓ Development status
✓ Design review
○ Marketing launch
○ Security approval

Files
launch-plan.pdf
marketing-assets.zip

[Join Meeting]
```

After the meeting:

- meeting notes
- decisions
- action items
- attachments
- recording reference if available

---

# 18. COMPANY CALENDAR

Calendar should combine:

- meetings
- project deadlines
- task deadlines
- campaign launches
- company events
- training
- reviews
- important announcements

Views:

- month
- week
- day
- agenda

Allow filtering by:

- company
- department
- project
- personal

---

# 19. KNOWLEDGE BASE

Create **Codex Knowledge**.

This is the internal company wiki/documentation system.

Structure:

```text
Codex Knowledge

Getting Started
- New Worker Guide
- Company Rules
- Department Guide

Engineering
- Coding Standards
- Git Workflow
- Deployment Guide

Security
- Security Policy
- Incident Response
- Security Procedures

Design
- Brand Guidelines
- UI Standards

Marketing
- Brand Voice
- Campaign Guidelines
```

Support:

- search
- categories
- permissions
- version/history
- attachments
- markdown/rich text where appropriate
- owner
- last updated
- department visibility

---

# 20. ONBOARDING

New workers should receive an onboarding experience.

Example:

```text
WELCOME TO CODEX TECH FOUNDATION

✓ Account created
✓ Department assigned
○ Read company guidelines
○ Complete security briefing
○ Meet your department
○ Complete your first task

Progress: 50%
```

Department Administrators should be able to configure department onboarding checklists.

---

# 21. WORKER PROFILES

Internal professional profiles should include:

- name
- employee ID where appropriate
- department
- role
- profile image
- status/presence
- assigned projects
- skills where appropriate
- current work
- contribution/activity history where permitted
- join date
- contact information according to privacy rules

Do not turn this into a social media profile.

---

# 22. APPROVAL SYSTEM

Create a central approval queue.

Examples:

- design approval
- content approval
- security report approval
- marketing campaign approval
- project milestone approval
- worker suspension approval

Example:

```text
APPROVALS

Website Design
Requested by UI/UX
[Review]

Marketing Campaign
Requested by Marketing
[Review]

Security Report
Requested by Cybersecurity
[Review]
```

Permissions determine who can approve each type.

---

# 23. DEPARTMENT WORKSPACES

Every department gets a specialized workspace.

The following are initial target departments.

---

## 23.1 DEVELOPMENT WORKSPACE

Purpose:

A professional engineering environment connected to company projects.

Core navigation:

- Dashboard
- Projects
- Tasks
- GitHub
- Issues
- Pull Requests
- Deployments
- API Tools
- Code Reviews
- Files
- Team
- Settings

Dashboard should prioritize:

- assigned development tasks
- active projects
- pull requests
- deployments
- issues
- repository activity
- sprint progress

Do not force non-developers to see this interface.

---

## 23.2 GITHUB INTEGRATION

Integrate GitHub into Development Workspace using secure OAuth/GitHub App/API mechanisms as appropriate.

Where supported, allow:

- repository browsing
- repository information
- branches
- commits
- issues
- pull requests
- reviews
- releases
- actions/deployment status
- creating supported GitHub objects
- opening repository links
- connecting repository to Workspace project

Potential workflow:

```text
Workspace Project
↓
Connected GitHub Repository
↓
Task
↓
Branch
↓
Pull Request
↓
Review
↓
Merge
↓
Deployment
```

Do not attempt to replace GitHub's Git hosting.

Use GitHub as the source of truth for repositories and Git operations.

Use least-privilege permissions.

---

# 24. UI/UX DESIGN WORKSPACE

This should feel like a design studio, not a developer dashboard.

Core tools:

- Dashboard
- Projects
- Design Board
- Whiteboard
- Components
- Prototypes
- Brand Library
- Assets
- Design Reviews
- Feedback
- Tasks
- Team

## Built-in Whiteboard

Build a lightweight collaborative canvas supporting useful basic elements:

- text
- shapes
- lines
- arrows
- frames
- cards
- connectors
- colors
- basic component blocks
- comments
- drag/drop
- zoom
- selection

Do NOT attempt to recreate Figma.

The built-in board is for quick internal planning, wireframes, architecture sketches, flows and collaboration.

For advanced design:

**Open in Figma**

Keep the system extensible for future Figma integration/connector support.

---

# 25. CONTENT WORKSPACE

Call this something like:

**Content Studio**

Core sections:

- Dashboard
- Content Calendar
- Drafts
- Media Library
- Script Editor
- Caption Editor
- Briefs
- Review Queue
- Approvals
- Publishing
- Analytics
- Projects
- Team

Simple built-in tools:

- script editor
- caption editor
- basic rich-text editor
- content brief
- content checklist
- asset organization

Do NOT build a full professional video editor.

Heavy video editing should be handled by external tools.

Provide links/integration points for tools such as:

- Canva
- CapCut
- Adobe
- Figma
- other approved tools

depending on future integrations.

---

# 26. MARKETING WORKSPACE

Call this:

**Marketing Hub**

It should not look like the Development Workspace.

Core sections:

- Dashboard
- Campaigns
- Campaign Calendar
- Leads
- Audience
- Social
- Analytics
- Reports
- Tasks
- Projects
- Team

Marketing dashboard should surface relevant business metrics where data sources are connected:

- reach
- followers
- engagement
- conversions
- leads
- campaign performance
- audience information
- revenue attribution where available
- content performance

Do not invent live numbers.

If an integration is not connected, clearly show that the metric is unavailable/not connected.

Potential future integrations should be modular.

---

# 27. CYBERSECURITY WORKSPACE

Call this:

**Security Workspace**

Core sections:

- Security Dashboard
- Projects
- Vulnerabilities
- Incidents
- Security Tasks
- Risk Register
- Reports
- Audit Logs
- Security Tools
- Security Lab
- Team

## Security Tools

Provide safe, authorized utilities such as:

- network diagnostics
- DNS utilities
- header analysis
- encoding/decoding
- hash calculation/verification
- JWT inspection
- IP/domain information
- log analysis
- basic security configuration checks

Any security tooling must be designed for authorized use.

Do not create unrestricted offensive tooling for attacking arbitrary external systems.

## Security Lab

Provide a controlled, isolated environment for training/testing.

Example:

```text
CYBER LAB

Training Web App #01
Status: Online
Environment: Isolated Sandbox

[Launch Lab]
```

External training platforms can be linked/integrated, such as TryHackMe, rather than recreated.

---

# 28. AI/ML WORKSPACE

Call this:

**AI Lab**

Core sections:

- Dashboard
- AI Projects
- Models
- Datasets
- Experiments
- Evaluations
- Prompts
- Reports
- Tasks
- Team

Keep architecture extensible for future model/API integrations.

---

# 29. BUSINESS / GROWTH WORKSPACE

If enabled:

- Dashboard
- Leads
- Partnerships
- Growth Projects
- Campaigns
- Reports
- Tasks
- Team
- Revenue-related metrics where authorized

Do not expose sensitive financial information to workers who don't have permission.

---

# 30. DEPARTMENT ADMIN WORKSPACE

Department Admin dashboard should be different from normal workers.

Example:

```text
DEVELOPMENT DEPARTMENT

Workers: 12
Active Projects: 7
Tasks: 43
Pending: 6
Suspensions: 1

Workers
Name | Role | Status | Last Active

Projects
Project | Progress | Owner

Quick Actions
Create Task
Create Worker
Assign Work
Review Approvals
View Reports
```

Department Admin should see department operational information, not unrestricted company information.

---

# 31. MAIN ADMIN / EXECUTIVE WORKSPACE

Main Admin gets the company-wide overview.

Example:

```text
CODEX TECH WORKSPACE

Company Overview

Active Projects: 14
Active Workers: 38
Pending Approvals: 4
Department Tasks: 126
Overdue Tasks: 8

Department Overview

Development       12 workers
Cybersecurity      4 workers
UI/UX              5 workers
Marketing          6 workers
Content            4 workers
AI/ML              3 workers
```

Clicking a department opens its operational overview.

---

# 32. COMPANY PULSE

Create a Main Admin feature called:

**Company Pulse**

It is an operational overview, not an employee ranking.

Example:

```text
COMPANY PULSE

Projects: 14
Active Workers: 38
Tasks: 126
Completed Today: 19
Pending Approvals: 6

Department Activity

Development
Cybersecurity
UI/UX
Marketing
Content
AI/ML

Today's Activity
19 tasks completed
7 files uploaded
4 meetings held
3 projects updated
2 deployments
1 security incident
```

Do not turn employee metrics into simplistic performance scores.

---

# 33. AUDIT CENTER

Main Admin should have an audit center.

Track important actions:

- login
- logout
- worker creation
- role changes
- permission changes
- task creation
- task assignment
- project creation
- project membership
- file upload/delete
- suspension request
- suspension approval
- offboarding
- integration changes
- security events
- settings changes

Example:

```text
17:42 Ike changed project permissions
17:36 Sarah uploaded design
17:22 David created vulnerability
17:10 Admin submitted worker suspension
16:55 Marketing published campaign
```

Filters:

- user
- department
- project
- action
- date
- severity

Audit records should be protected against unauthorized modification.

---

# 34. FILES / DOCUMENT MANAGEMENT

Create a structured company file system.

```text
Files

Company
├── Policies
├── Branding
└── Documents

Projects
├── Zerøbyte Business
│   ├── Development
│   ├── Design
│   ├── Marketing
│   └── Security

Departments
├── Development
├── Cybersecurity
├── Design
└── Marketing
```

Permissions must control visibility.

Support:

- upload
- download
- preview where practical
- folders
- metadata
- search
- version/history where practical
- project association
- department association

---

# 35. GLOBAL SEARCH

Create universal search across authorized data.

Search:

- projects
- tasks
- workers
- files
- messages
- knowledge base
- GitHub-linked objects where supported
- announcements

Example:

```text
Search: "authentication"

Projects
Zerøbyte Business

Tasks
Implement authentication

People
Ike

Files
auth-flow.pdf

Messages
"authentication bug"

GitHub
authentication-api
```

Only return data the current user is authorized to see.

---

# 36. COMMAND PALETTE

PC-first Workspace should have a command palette.

Recommended shortcut:

**Ctrl + K**

Examples:

- Create task
- Create project
- Search worker
- Open project
- Message worker
- Start meeting
- Upload file
- Open GitHub
- Create announcement
- Go to Security Lab

The command system should respect permissions.

---

# 37. NOTIFICATION CENTER

Notifications must be contextual.

Types:

```text
TASK
You've been assigned "Build API Authentication"

MENTION
Sarah mentioned you in Zerøbyte Business

APPROVAL
Marketing campaign requires your review

SECURITY
Critical security event reported

DEPLOYMENT
Production deployment succeeded
```

Notification channels can eventually include:

- in-app
- browser/desktop push
- email
- Telegram
- other approved integrations

Do not implement external notifications unless the corresponding service/integration is configured.

---

# 38. INTEGRATIONS HUB

Create a centralized integrations area.

Examples:

Development:
- GitHub

Design:
- Figma
- Canva

Communication:
- Telegram
- Email where appropriate

AI:
- OpenAI
- Anthropic
- other configured providers

Automation:
- n8n

Analytics:
- Google Analytics or other supported analytics

Integrations must be permission-aware and modular.

Do not make a user connect an integration that their role cannot use.

Never expose secret API tokens in client-side code.

---

# 39. COMPANY STATUS

Main Admin can have a small operational status view:

```text
CODEX SYSTEM STATUS

Workspace
● Operational

Authentication
● Operational

GitHub Integration
● Operational

Video Meetings
● Operational

Notifications
● Operational
```

This should be based on actual health checks where possible.

Do not display fake "operational" information.

---

# 40. DESKTOP-FIRST UI/UX

The Workspace is primarily a PC/desktop application.

Target layouts:

- 1280px
- 1440px
- 1920px+

Prioritize:

- persistent sidebar
- dense but readable information layouts
- multi-column dashboards
- tables
- split views
- resizable panels where useful
- keyboard shortcuts
- drag/drop
- command palette
- project timelines
- real-time activity
- professional workspace density

Mobile support should exist for basic access and emergency actions, but mobile is NOT the primary design target.

Do not compromise the desktop experience just to make everything mobile-first.

---

# 41. VISUAL DESIGN DIRECTION

Use the existing Codex visual identity as the foundation but evolve it into a mature workplace product.

Desired qualities:

- premium
- professional
- modern
- calm
- technical
- trustworthy
- highly usable
- not overly flashy
- not gaming-like
- not childish

Use:

- consistent spacing
- strong typography
- clear hierarchy
- subtle motion
- polished cards
- clear states
- meaningful icons
- accessible contrast
- responsive layouts
- theme-aware components

Avoid:

- excessive gradients
- unnecessary neon
- huge decorative animations
- excessive glass effects
- confusing dashboards
- developer jargon in non-developer workspaces

Use Lucide, Font Awesome, or appropriate SVG/icon systems rather than emoji as UI icons.

---

# 42. SHARED DESIGN SYSTEM

Create reusable components:

- AppShell
- Sidebar
- Topbar
- Breadcrumbs
- PageHeader
- DashboardCard
- StatCard
- ProjectCard
- TaskCard
- DataTable
- Modal
- Drawer
- CommandPalette
- Search
- NotificationCenter
- Avatar
- PresenceIndicator
- StatusBadge
- Tabs
- Dropdown
- Toast
- ActivityFeed
- Timeline
- Calendar
- Kanban
- RichTextEditor
- FileUploader
- FilePreview
- EmptyState
- LoadingState
- ErrorState
- PermissionGate

Department workspaces should reuse the same design system.

---

# 43. SECURITY ARCHITECTURE

Security is critical.

Do not rely on frontend hiding alone.

Enforce authorization server-side.

Implement:

- role-based access control
- department-level authorization
- project-level authorization
- row-level security where applicable
- audit logs
- secure authentication
- secure sessions
- least-privilege integrations
- secret management
- no frontend secrets
- validation
- rate limiting where applicable
- safe file handling
- secure external integrations

A user must never gain access simply by manually navigating to a hidden URL.

---

# 44. EXISTING PROJECT PRESERVATION

IMPORTANT:

Do NOT destroy the existing working platform.

Before major changes:

1. inspect the current repository
2. understand current architecture
3. identify existing authentication
4. identify worker system
5. identify projects
6. identify tasks
7. identify chat
8. identify meetings/video functionality
9. identify notifications
10. identify Supabase schema/functions
11. identify admin routes
12. identify current permissions
13. identify reusable components
14. identify deployment configuration
15. identify existing integrations

Then extend/refactor intelligently.

Do not rewrite everything simply because the product identity changed.

Preserve working functionality.

Fix architecture where necessary.

---

# 45. DATA MODEL DIRECTION

The architecture should support entities such as:

```text
organizations
departments
workers
roles
permissions
workspaces
workspace_tools
projects
project_members
project_departments
tasks
task_assignees
task_comments
task_dependencies
task_checklists
files
file_permissions
messages
channels
channel_members
meetings
meeting_participants
calendar_events
announcements
notifications
knowledge_documents
approvals
audit_logs
integrations
worker_status
onboarding_templates
onboarding_progress
```

Do not blindly create every table if an existing schema already represents the same concept.

Reuse existing structures where appropriate.

Avoid duplicate sources of truth.

---

# 46. DATABASE / BACKEND PRINCIPLES

If the current stack uses Supabase:

- continue using Supabase/PostgreSQL as the backend unless there is a compelling architectural reason not to
- use Edge Functions where server-side logic is required
- enforce RLS
- validate input
- use secure service-role access only server-side
- do not expose service-role keys
- maintain clear migration files
- make migrations reversible where practical
- document schema changes

If existing Edge Functions exist, audit and preserve their CORS behavior correctly.

Do not break currently working functionality.

---

# 47. GITHUB / REPOSITORY WORKFLOW

The Development Workspace should be capable of linking company projects to GitHub repositories.

The Workspace can act as the company-level interface for:

- repository discovery
- repository status
- issues
- branches
- pull requests
- reviews
- actions
- deployment status
- links to GitHub

Do not reinvent Git.

If a Git operation is not safely or practically supported from the web application, provide a clear "Open in GitHub" action.

Free/available GitHub capabilities should be preferred where appropriate, but do not assume every GitHub API feature is free or unlimited. Build the integration so limitations are handled gracefully.

---

# 48. EXTERNAL TOOLS PRINCIPLE

Do not recreate specialist software unnecessarily.

Build simple native tools where they are genuinely useful.

Link/integrate external tools for heavyweight workflows.

Examples:

UI/UX:
- simple Whiteboard in Workspace
- Figma for advanced design

Content:
- script/caption editor in Workspace
- external video editor for advanced editing

Cybersecurity:
- safe internal utilities
- controlled sandbox
- external training environments for advanced labs

Development:
- Workspace project/task layer
- GitHub for Git/repositories

This keeps the Workspace powerful without becoming bloated.

---

# 49. REAL COMPANY WORKFLOW EXAMPLE

The implementation must support a workflow like this:

Main Admin creates:

**Project: New Product Launch**

They select:

- Development
- UI/UX
- Cybersecurity
- Content
- Marketing

Then:

### Development Admin receives

> Build the product backend and frontend.

They assign:

```text
Ike → Backend
David → Frontend
John → QA
```

### UI/UX Admin receives

> Create the product interface.

They assign:

```text
Sarah → UX
Mary → UI
```

### Cybersecurity Admin receives

> Perform security assessment.

They assign:

```text
David → Security testing
```

### Content Admin receives

> Produce launch content.

They assign:

```text
John → Product script
Mary → Documentation
```

### Marketing Admin receives

> Create launch campaign.

They assign:

```text
Kemi → Campaign
Alex → Analytics
```

Everyone works on the same project.

Everyone sees the appropriate parts.

Everyone communicates inside the same company Workspace.

Main Admin can see the overall project status.

This workflow must be possible without manually duplicating projects.

---

# 50. MAIN ADMIN PROJECT CREATION FLOW

Design a polished multi-step project creation experience.

Step 1:
Project information

Step 2:
Departments

Step 3:
Objectives/deliverables

Step 4:
Templates/tasks

Step 5:
Review

Step 6:
Create and distribute

After creation:

```text
Project Created

✓ Development notified
✓ UI/UX notified
✓ Cybersecurity notified
✓ Content notified
✓ Marketing notified
```

Department Admins receive the assignment in their dashboards and notifications.

---

# 51. DEPARTMENT ADMIN PROJECT FLOW

Department Admin sees:

```text
NEW DEPARTMENT ASSIGNMENT

Project:
Codex Website

Objective:
Create complete website interface.

Deadline:
October 15

Required deliverables:
- Wireframes
- UI
- Responsive design
- Design review

[Accept Assignment]
[Open Project]
```

They can then:

- accept
- break into tasks
- assign workers
- monitor
- request clarification
- submit for review

---

# 52. WORKER PROJECT FLOW

Worker sees only the relevant work.

Example:

```text
YOUR TASK

Build authentication UI

Project:
Codex Website

Department:
Development

Priority:
High

Due:
Friday

Description:
Build login, registration and password reset UI.

Checklist:
☐ Login
☐ Registration
☐ Password reset
☐ Validation
☐ Mobile fallback

[Start Task]
```

The worker should not be overwhelmed by the entire organization.

---

# 53. CROSS-DEPARTMENT PROJECT VISIBILITY

Project-level visibility should be controlled.

For example:

A content creator may see:

- project overview
- content tasks
- relevant design assets
- approved product information
- relevant discussions

They should not automatically see:

- private security incidents
- HR information
- sensitive development secrets
- organization administration

Similarly, a developer should not automatically see sensitive HR/financial information.

Use explicit permissions and project membership.

---

# 54. COMPANY PULSE VS EMPLOYEE PERFORMANCE

Company Pulse should measure operational activity.

Avoid simplistic employee ranking systems.

Use:

- project progress
- completed work
- pending work
- deadlines
- approvals
- incidents
- department workload
- operational status

Do not create arbitrary employee "scores" that could be misleading.

---

# 55. ACCESSIBILITY

Implement:

- keyboard navigation
- visible focus states
- adequate contrast
- accessible labels
- semantic HTML
- reduced motion support
- readable typography
- sensible touch targets where applicable
- screen-reader-friendly controls where practical

---

# 56. PERFORMANCE

Because this is an internal company application with potentially many modules:

- lazy load department workspaces
- lazy load heavy integrations
- paginate large datasets
- virtualize long lists where useful
- optimize images/assets
- avoid unnecessary realtime subscriptions
- clean up subscriptions
- cache appropriate read-heavy data
- handle offline/network failure gracefully
- show useful loading states

Do not load every department's heavy tooling when a developer logs in.

---

# 57. ERROR / EMPTY / LOADING STATES

Every major page needs professional:

- loading state
- empty state
- error state
- permission-denied state
- offline/network state

Example:

```text
No Marketing Campaigns

Your department doesn't have any active campaigns yet.

[Create Campaign]
```

Do not leave blank screens.

---

# 58. PRODUCT SAFETY / TRUST

For every external integration:

- ask for only necessary permissions
- clearly show connection state
- allow disconnect
- do not expose tokens
- handle revoked permissions
- log important integration events
- display failures clearly

For cybersecurity features, keep tools authorized and controlled.

For employee data, follow least-privilege access.

---

# 59. SETTINGS

Settings should be separated by authority.

## Worker Settings

- profile
- password/security
- notification preferences
- appearance
- connected personal integrations where supported

## Department Admin Settings

- department information
- department tools
- department notification defaults
- onboarding
- workflows
- department members

## Main Admin Settings

- organization
- departments
- roles
- permissions
- integrations
- company policies
- security
- audit
- system configuration

---

# 60. CONTINUATION / HANDOFF SYSTEM

This is mandatory.

Create a directory in the project repository:

```text
/docs/workspace/
```

At minimum create:

```text
/docs/workspace/WORKSPACE_MASTER_PROMPT.md
/docs/workspace/WORKSPACE_PROGRESS.md
/docs/workspace/WORKSPACE_ARCHITECTURE.md
/docs/workspace/WORKSPACE_CONTINUE_PROMPT.md
```

## WORKSPACE_MASTER_PROMPT.md

Copy the canonical requirements from this document.

It should be the permanent source of truth for the Workspace vision.

## WORKSPACE_PROGRESS.md

Maintain:

```text
Completed
In Progress
Blocked
Not Started
Known Bugs
Architecture Decisions
Database Changes
Environment/Integration Notes
Next Recommended Tasks
```

Update it whenever substantial work is completed.

## WORKSPACE_ARCHITECTURE.md

Document:

- frontend architecture
- backend architecture
- database entities
- permissions
- department structure
- routing
- integrations
- realtime subscriptions
- security model
- important design decisions

## WORKSPACE_CONTINUE_PROMPT.md

Create a ready-to-paste prompt for a new Claude session.

The prompt should tell Claude:

1. Read WORKSPACE_MASTER_PROMPT.md
2. Read WORKSPACE_PROGRESS.md
3. Read WORKSPACE_ARCHITECTURE.md
4. Inspect the current repository
5. Determine what is already implemented
6. Do not rebuild completed features
7. Continue from the documented current state
8. Update WORKSPACE_PROGRESS.md after meaningful work
9. Update architecture documentation when architecture changes
10. Run tests/build/lint as appropriate
11. Fix regressions before moving on
12. Keep the Workspace vision intact

This is important because another Claude account/session may receive a ZIP of the repository later.

The repository documentation must allow a new AI agent to understand the project without relying on previous chat history.

---

# 61. CLAUDE HANDOFF PROMPT

Create a reusable continuation prompt similar to:

```text
You are continuing development of Codex Tech Foundation Workspace.

Before changing code:

1. Read /docs/workspace/WORKSPACE_MASTER_PROMPT.md
2. Read /docs/workspace/WORKSPACE_PROGRESS.md
3. Read /docs/workspace/WORKSPACE_ARCHITECTURE.md
4. Read /docs/workspace/WORKSPACE_CONTINUE_PROMPT.md
5. Inspect the actual repository and current implementation.

Do not assume previous chat context exists.

The repository documentation is the persistent project memory.

Identify:
- what is complete
- what is partially complete
- what is broken
- what should be implemented next

Do not rebuild working features unnecessarily.

Preserve existing functionality.

Make changes incrementally.

After completing work:
- update WORKSPACE_PROGRESS.md
- update WORKSPACE_ARCHITECTURE.md if needed
- record important decisions
- record remaining issues
- run appropriate tests/build/lint
- verify no major regressions

Continue implementing Codex Tech Foundation Workspace according to the master specification.
```

The actual file can be more detailed than this example.

---

# 62. DEVELOPMENT METHODOLOGY

Do not attempt to implement the entire specification in one giant uncontrolled rewrite.

Recommended sequence:

### Phase A — Audit

- inspect repository
- inspect current UI
- inspect routing
- inspect authentication
- inspect database
- inspect existing worker roles
- inspect projects/tasks/chat/meetings
- inspect admin functionality
- inspect integrations
- document current state

### Phase B — Workspace Foundation

- rename/product identity
- AppShell
- navigation
- Home
- My Work
- notifications
- search
- command palette
- worker profile
- presence

### Phase C — Organization

- departments
- department admins
- role/permission architecture
- worker lifecycle
- approvals
- announcements
- audit

### Phase D — Project Orchestration

- project creation
- department assignment
- project membership
- task workflows
- project templates
- cross-department collaboration

### Phase E — Communication

- channels
- DMs
- meetings
- calendar
- activity feeds

### Phase F — Department Workspaces

- Development
- Cybersecurity
- UI/UX
- Marketing
- Content
- AI/ML
- Business/Growth

### Phase G — Integrations

- GitHub
- Figma
- Canva
- external security/training tools
- analytics
- automation
- AI providers

### Phase H — Polish

- performance
- accessibility
- security
- mobile fallback
- onboarding
- documentation
- QA
- deployment

---

# 63. DO NOT DO THESE THINGS

Do NOT:

- create six disconnected applications
- hardcode department permissions into frontend components
- expose admin APIs to unauthorized workers
- trust hidden buttons as security
- expose secrets
- rebuild GitHub
- rebuild Figma
- build a full video editor
- build an unrestricted offensive security platform
- create fake analytics data
- create fake system status
- delete employee history unnecessarily
- make every worker see every department's sensitive data
- make the UI developer-centric for every department
- sacrifice usability for visual effects
- rewrite working backend functionality without first understanding it
- create duplicate database sources of truth
- make mobile the primary design target
- over-engineer every feature before the core workflow works

---

# 64. DEFINITION OF SUCCESS

Codex Tech Foundation Workspace is successful when this scenario works naturally:

A Main Admin logs in.

They create:

**"Zerøbyte Business Launch"**

They select:

- Development
- UI/UX
- Cybersecurity
- Content
- Marketing

The project is created once.

Each Department Admin receives the relevant assignment.

Development Admin creates backend/frontend tasks.

UI/UX Admin creates design tasks.

Security Admin creates assessment tasks.

Content Admin creates scripts/documentation tasks.

Marketing Admin creates campaign tasks.

Workers receive only the relevant work.

Workers communicate with each other.

Files are attached to the project.

Meetings are scheduled.

Tasks move through department-specific workflows.

GitHub is connected for development.

Figma is available for advanced design.

Content creators use the Content Studio.

Cybersecurity workers use safe security tools and authorized labs.

Marketing workers see marketing-specific analytics.

Main Admin can see the entire organization.

Department Admin can see and manage their department.

Workers cannot access unauthorized areas.

Suspension requests flow from Department Admin to Main Admin review.

Offboarded workers retain appropriate historical records.

The entire organization feels like it is operating inside one coherent digital office.

---

# 65. FINAL IMPLEMENTATION PRINCIPLE

The goal is not:

> "Build a dashboard for every department."

The goal is:

> **Build one digital company where every department has the environment, tools, information and permissions required to perform its work while remaining connected to the rest of the organization.**

The Workspace should make Codex Tech Foundation feel like a real online company.

Build the infrastructure so it can grow from a small team into a larger organization without requiring a complete rewrite.

When uncertain between a quick visual patch and a clean scalable architecture, prefer the clean architecture — but avoid unnecessary over-engineering.

Always inspect the current implementation first.

Always preserve working functionality.

Always document major decisions.

Always update the project handoff files.

**This document is the canonical product direction.**
