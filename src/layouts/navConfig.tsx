import {
  Activity, Bell, Briefcase, FileText, FolderKanban, FolderOpen, Inbox, KeyRound, LayoutDashboard,
  LifeBuoy, MessageSquare, Newspaper, ShieldCheck, Terminal, UserCog, Users, CheckSquare, ClipboardList,
  ScrollText,
} from 'lucide-react'
import type { NavGroup } from './WorkspaceLayout'

export const WORKER_NAV: NavGroup[] = [
  { items: [{ label: 'Overview', path: '/worker', icon: LayoutDashboard, description: 'Your projects, tasks and what needs attention today.' }] },
  {
    label: 'Work',
    items: [
      { label: 'Projects', path: '/worker/projects', icon: FolderKanban, description: 'Every project you can access, with status and due dates.' },
      { label: 'Tasks', path: '/worker/tasks', icon: CheckSquare, description: 'Drag tasks between columns to update their status.' },
      { label: 'Clients', path: '/worker/clients', icon: Briefcase, description: 'Client companies and the projects linked to them.' },
      { label: 'Leads', path: '/worker/leads', icon: Inbox, description: 'Enquiries that came in through the public site.' },
      { label: 'Chat', path: '/worker/chat', icon: MessageSquare, description: 'Team channels, voice and video calls.' },
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
  { items: [{ label: 'Overview', path: '/admin', icon: LayoutDashboard, description: 'Company-wide activity at a glance.' }] },
  {
    label: 'People',
    items: [
      { label: 'Workers', path: '/admin/workers', icon: Users, description: 'Worker accounts, status and access.' },
      { label: 'Roles', path: '/admin/roles', icon: KeyRound, superadminOnly: true, description: 'Grant or revoke permissions per role.' },
      { label: 'Clients', path: '/admin/clients', icon: Briefcase, description: 'Client accounts and their access to projects.' },
      { label: 'Applications', path: '/admin/applications', icon: UserCog, description: 'Job applications from the careers page.' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Projects', path: '/admin/projects', icon: FolderKanban, description: 'All projects across the company.' },
      { label: 'Tasks', path: '/admin/tasks', icon: CheckSquare, description: 'Every task across every project.' },
      { label: 'Leads', path: '/admin/leads', icon: Inbox, description: 'Enquiries that came in through the public site.' },
      { label: 'Chat', path: '/admin/chat', icon: MessageSquare, description: 'Team channels, voice and video calls.' },
      { label: 'Content', path: '/admin/content', icon: FileText, description: 'Blog posts and public content.' },
      { label: 'Case studies', path: '/admin/content/case-studies', icon: FileText, description: 'Write and publish case studies.' },
      { label: 'Team', path: '/admin/content/team', icon: Users, description: 'Public team profiles.' },
      { label: 'Careers', path: '/admin/content/careers', icon: ClipboardList, description: 'Open roles shown on the careers page.' },
      { label: 'Resources', path: '/admin/resources', icon: FolderOpen, description: 'Shared internal files and documents.' },
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
