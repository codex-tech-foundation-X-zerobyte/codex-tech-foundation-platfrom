import {
  Bell, Briefcase, FileText, FolderKanban, Inbox, LayoutDashboard,
  Newspaper, ShieldCheck, Users, CheckSquare, FolderOpen,
  UserCog, ClipboardList, KeyRound, MessageSquare, Terminal,
} from 'lucide-react'
import type { NavGroup } from './WorkspaceLayout'

export const WORKER_NAV: NavGroup[] = [
  { items: [{ label: 'Overview', path: '/worker', icon: LayoutDashboard }] },
  {
    label: 'Work',
    items: [
      { label: 'Projects', path: '/worker/projects', icon: FolderKanban },
      { label: 'Tasks', path: '/worker/tasks', icon: CheckSquare },
      { label: 'Clients', path: '/worker/clients', icon: Briefcase },
      { label: 'Leads', path: '/worker/leads', icon: Inbox },
    ],
  },
  {
    label: 'Content',
    items: [
      { label: 'Case studies', path: '/worker/content/case-studies', icon: FileText },
      { label: 'Blog', path: '/worker/content/blog', icon: Newspaper },
      { label: 'Team', path: '/worker/content/team', icon: Users },
      { label: 'Careers', path: '/worker/content/careers', icon: ClipboardList },
    ],
  },
  {
    label: 'Resources',
    items: [
      { label: 'Files', path: '/worker/resources', icon: FolderOpen },
      { label: 'Chat', path: '/worker/chat', icon: MessageSquare },
      { label: 'Dev Tools', path: '/worker/devtools', icon: Terminal },
    ],
  },
  {
    label: 'System',
    items: [{ label: 'Notifications', path: '/worker/notifications', icon: Bell }],
  },
]

export const ADMIN_NAV: NavGroup[] = [
  { items: [{ label: 'Overview', path: '/admin', icon: LayoutDashboard }] },
  {
    label: 'People',
    items: [
      { label: 'Workers', path: '/admin/workers', icon: Users },
      { label: 'Roles', path: '/admin/roles', icon: KeyRound },
      { label: 'Clients', path: '/admin/clients', icon: Briefcase },
      { label: 'Applications', path: '/admin/applications', icon: UserCog },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Projects', path: '/admin/projects', icon: FolderKanban },
      { label: 'Tasks', path: '/admin/tasks', icon: CheckSquare },
      { label: 'Leads', path: '/admin/leads', icon: Inbox },
      { label: 'Case studies', path: '/admin/content/case-studies', icon: FileText },
      { label: 'Blog', path: '/admin/content/blog', icon: Newspaper },
      { label: 'Team', path: '/admin/content/team', icon: Users },
      { label: 'Careers', path: '/admin/content/careers', icon: ClipboardList },
      { label: 'Resources', path: '/admin/resources', icon: FolderOpen },
      { label: 'Chat', path: '/admin/chat', icon: MessageSquare },
      { label: 'Dev Tools', path: '/admin/devtools', icon: Terminal },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'Notifications', path: '/admin/notifications', icon: Bell },
      { label: 'Audit log', path: '/admin/audit', icon: ShieldCheck },
      { label: 'Security', path: '/admin/security', icon: ShieldCheck },
    ],
  },
]

// Manager sees the same operational surfaces as Admin, minus the
// superadmin-only sections (Roles, Audit log, Security, Settings). This is
// a UI convenience only — the actual boundary is enforced by RLS via
// has_permission()/current_role(), not by which nav items render. See
// /docs/RBAC.md.
export const MANAGER_NAV: NavGroup[] = [
  { items: [{ label: 'Overview', path: '/admin', icon: LayoutDashboard }] },
  {
    label: 'People',
    items: [
      { label: 'Workers', path: '/admin/workers', icon: Users },
      { label: 'Clients', path: '/admin/clients', icon: Briefcase },
      { label: 'Applications', path: '/admin/applications', icon: UserCog },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Projects', path: '/admin/projects', icon: FolderKanban },
      { label: 'Tasks', path: '/admin/tasks', icon: CheckSquare },
      { label: 'Leads', path: '/admin/leads', icon: Inbox },
      { label: 'Case studies', path: '/admin/content/case-studies', icon: FileText },
      { label: 'Blog', path: '/admin/content/blog', icon: Newspaper },
      { label: 'Team', path: '/admin/content/team', icon: Users },
      { label: 'Careers', path: '/admin/content/careers', icon: ClipboardList },
      { label: 'Resources', path: '/admin/resources', icon: FolderOpen },
      { label: 'Chat', path: '/admin/chat', icon: MessageSquare },
      { label: 'Dev Tools', path: '/admin/devtools', icon: Terminal },
    ],
  },
  {
    label: 'System',
    items: [{ label: 'Notifications', path: '/admin/notifications', icon: Bell }],
  },
]

export const CLIENT_NAV: NavGroup[] = [
  { items: [{ label: 'Overview', path: '/client', icon: LayoutDashboard }] },
  {
    items: [
      { label: 'Projects', path: '/client/projects', icon: FolderKanban },
      { label: 'Updates', path: '/client/updates', icon: Newspaper },
      { label: 'Files', path: '/client/files', icon: FolderOpen },
      { label: 'Requests', path: '/client/requests', icon: Inbox },
      { label: 'Maintenance', path: '/client/maintenance', icon: ShieldCheck },
    ],
  },
]
