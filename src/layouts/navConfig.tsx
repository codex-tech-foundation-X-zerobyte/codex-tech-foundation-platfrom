import {
  Activity, Bell, Briefcase, FileText, FolderKanban, FolderOpen, Inbox, KeyRound, LayoutDashboard,
  LifeBuoy, MessageSquare, Newspaper, ShieldCheck, Terminal, UserCog, Users, CheckSquare, ClipboardList,
  ScrollText, Building2, Landmark, CalendarDays, BookOpen, ClipboardCheck, Plug, Trash2, Presentation, Banknote, Wallet, Headset,
} from 'lucide-react'
import type { NavGroup } from './WorkspaceLayout'

export const WORKER_NAV: NavGroup[] = [
  {
    items: [
      { label: 'Overview', path: '/worker', icon: LayoutDashboard, description: 'Your projects, tasks and what needs attention today.' },
      { label: 'Company', path: '/worker/company', icon: Landmark, description: 'Announcements, deadlines and who works where.' },
      { label: 'My department', path: '/worker/department', icon: Building2, description: 'Your department\'s workspace: boards, tools, channels and team.' },
    ],
  },
  {
    label: 'Company',
    items: [
      { label: 'Calendar', path: '/worker/calendar', icon: CalendarDays, description: 'Meetings, deadlines and dated work.' },
      { label: 'Knowledge base', path: '/worker/knowledge', icon: BookOpen, description: 'Policies, standards and how-tos.' },
      { label: 'Approvals', path: '/worker/approvals', icon: ClipboardCheck, description: 'What is waiting on you.' },
    ],
  },
  {
    label: 'Work',
    items: [
      { label: 'Projects', path: '/worker/projects', icon: FolderKanban, description: 'Every project you can access, with status and due dates.' },
      { label: 'Tasks', path: '/worker/tasks', icon: CheckSquare, description: 'Drag tasks between columns to update their status.' },
      { label: 'Clients', path: '/worker/clients', icon: Briefcase, description: 'Client companies and the projects linked to them.' },
      { label: 'Leads', path: '/worker/leads', icon: Inbox, description: 'Enquiries that came in through the public site.' },
      { label: 'Chat', path: '/worker/chat', icon: MessageSquare, description: 'Team channels, voice and video calls.' },
      { label: 'Fund requests', path: '/worker/funds', icon: Banknote, description: 'Ask for money the company needs to spend, and see where it goes.' },
      { label: 'Finance office', path: '/worker/finance', icon: Wallet, description: 'Budgets, renewals, vendors and missing receipts.' },
      { label: 'Support desk', path: '/worker/support', icon: Headset, description: 'Customer reports from every connected project.' },
      { label: 'Presentations', path: '/worker/present', icon: Presentation, description: 'Present your work live to your department, with a stage that fits what you do.' },
    ],
  },
  {
    label: 'Content',
    items: [
      { label: 'Case studies', path: '/worker/content/case-studies', icon: FileText, description: 'Write and publish case studies for the public site.' },
      { label: 'Blog', path: '/worker/content/blog', icon: Newspaper, description: 'Draft, publish and archive blog posts.' },
      { label: 'Team', path: '/worker/content/team', icon: Users, description: 'Public team profiles.' },
      { label: 'Careers', path: '/worker/content/careers', icon: ClipboardList, description: 'Open roles shown on the careers page.' },
    ],
  },
  {
    label: 'Toolbox',
    items: [
      { label: 'Files', path: '/worker/resources', icon: FolderOpen, description: 'Shared internal files and documents.' },
      { label: 'Dev tools', path: '/worker/tools', icon: Terminal, description: 'JSON, JWT, regex, hashing, cron and more — all run locally in your browser.' },
      { label: 'System status', path: '/worker/status', icon: Activity, description: 'Live health checks for the database, auth, realtime and storage.' },
    ],
  },
  { label: 'System', items: [{ label: 'Notifications', path: '/worker/notifications', icon: Bell, description: 'Updates about your projects, tasks and requests.' }] },
]

export const ADMIN_NAV: NavGroup[] = [
  {
    items: [
      { label: 'Overview', path: '/admin', icon: LayoutDashboard, description: 'Company-wide activity at a glance.' },
      { label: 'Company', path: '/admin/company', icon: Landmark, description: 'Announcements, deadlines and the organization chart.' },
    ],
  },
  {
    label: 'People',
    items: [
      { label: 'Workers', path: '/admin/workers', icon: Users, description: 'Worker accounts, status and access.' },
      { label: 'Departments', path: '/admin/departments', icon: Building2, description: 'The eight Codex departments, who works in each, and their Department Admins.' },
      { label: 'Roles', path: '/admin/roles', icon: KeyRound, superadminOnly: true, description: 'Grant or revoke permissions per role.' },
      { label: 'Clients', path: '/admin/clients', icon: Briefcase, description: 'Client accounts and their access to projects.' },
      { label: 'Applications', path: '/admin/applications', icon: UserCog, description: 'Job applications from the careers page.' },
    ],
  },
  {
    label: 'Work',
    items: [
      { label: 'Projects', path: '/admin/projects', icon: FolderKanban, description: 'All projects across the company.' },
      { label: 'Tasks', path: '/admin/tasks', icon: CheckSquare, description: 'Every task across every project.' },
      { label: 'Leads', path: '/admin/leads', icon: Inbox, description: 'Enquiries that came in through the public site.' },
      { label: 'Chat', path: '/admin/chat', icon: MessageSquare, description: 'Team channels, voice and video calls.' },
      { label: 'Fund requests', path: '/admin/funds', icon: Banknote, description: 'Review, approve and track company spending.' },
      { label: 'Finance office', path: '/admin/finance', icon: Wallet, description: 'Budgets, renewals, vendors and missing receipts.' },
      { label: 'Support desk', path: '/admin/support', icon: Headset, description: 'Customer reports from every connected project.' },
      { label: 'Presentations', path: '/admin/present', icon: Presentation, description: 'Watch and run live presentations from any department.' },
      { label: 'Resources', path: '/admin/resources', icon: FolderOpen, description: 'Shared internal files and documents.' },
    ],
  },
  {
    label: 'Company',
    items: [
      { label: 'Calendar', path: '/admin/calendar', icon: CalendarDays, description: 'Meetings, deadlines and dated work across the company.' },
      { label: 'Knowledge base', path: '/admin/knowledge', icon: BookOpen, description: 'Policies, standards and how-tos.' },
      { label: 'Approvals', path: '/admin/approvals', icon: ClipboardCheck, description: 'Suspension reviews, assignments and work to sign off.' },
      { label: 'Integrations', path: '/admin/integrations', icon: Plug, superadminOnly: true, description: 'Connect GitHub, Figma and Canva.' },
    ],
  },
  {
    label: 'Public site',
    items: [
      { label: 'Content', path: '/admin/content', icon: FileText, description: 'Blog posts and public content.' },
      { label: 'Case studies', path: '/admin/content/case-studies', icon: FileText, description: 'Write and publish case studies.' },
      { label: 'Team', path: '/admin/content/team', icon: Users, description: 'Public team profiles.' },
      { label: 'Careers', path: '/admin/content/careers', icon: ClipboardList, description: 'Open roles shown on the careers page.' },
    ],
  },
  {
    label: 'Toolbox',
    items: [
      { label: 'Dev tools', path: '/admin/tools', icon: Terminal, description: 'JSON, JWT, regex, hashing, cron and more — all run locally in your browser.' },
      { label: 'System status', path: '/admin/status', icon: Activity, description: 'Live health checks for the database, auth, realtime and storage.' },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'Notifications', path: '/admin/notifications', icon: Bell, description: 'Send and read notifications.' },
      { label: 'Trash', path: '/admin/trash', icon: Trash2, superadminOnly: true, description: 'Deleted items, kept for 30 days so they can be restored.' },
      { label: 'Audit log', path: '/admin/audit', icon: ScrollText, superadminOnly: true, description: 'Security-relevant events, newest first.' },
      { label: 'Security', path: '/admin/security', icon: ShieldCheck, superadminOnly: true, description: 'Account security overview.' },
    ],
  },
]

export const CLIENT_NAV: NavGroup[] = [
  { items: [{ label: 'Overview', path: '/client', icon: LayoutDashboard, description: 'Your project, progress and anything waiting on you.' }] },
  {
    items: [
      { label: 'Projects', path: '/client/projects', icon: FolderKanban, description: 'Your projects and their milestones.' },
      { label: 'Updates', path: '/client/updates', icon: Newspaper, description: 'Progress updates shared by the team.' },
      { label: 'Files', path: '/client/files', icon: FolderOpen, description: 'Files shared with you.' },
      { label: 'Requests', path: '/client/requests', icon: Inbox, description: 'Ask for changes or new work, and track the answer.' },
      { label: 'Maintenance', path: '/client/maintenance', icon: LifeBuoy, description: 'Report bugs and get support once your project is live.' },
    ],
  },
]
