import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import {
  Briefcase, ClipboardList, FolderKanban, FolderOpen, Inbox,
  Newspaper, ShieldCheck, Users,
} from 'lucide-react'
import { AuthProvider, useAuth } from './lib/auth'
import { ToastProvider } from './components/ui'
import { ProtectedRoute } from './components/ProtectedRoute'
import { WorkspaceLayout } from './layouts/WorkspaceLayout'
import { WORKER_NAV, ADMIN_NAV, MANAGER_NAV, CLIENT_NAV } from './layouts/navConfig'
import { ScaffoldPage } from './pages/ScaffoldPage'
import { NotificationsPage } from './pages/NotificationsPage'
import { ResourcesManager } from './pages/ResourcesManager'
import { ChatPage } from './pages/ChatPage'
import { IncomingCallListener } from './components/IncomingCallListener'
import { BlogAdminList } from './pages/cms/BlogAdminList'
import { BlogEditor } from './pages/cms/BlogEditor'
import { CaseStudyAdminList } from './pages/cms/CaseStudyAdminList'
import { CaseStudyEditor } from './pages/cms/CaseStudyEditor'
import { TeamAdminList } from './pages/cms/TeamAdminList'
import { TeamProfileEditor } from './pages/cms/TeamProfileEditor'
import { CareersAdminList } from './pages/cms/CareersAdminList'
import { CareerEditor } from './pages/cms/CareerEditor'
import { AdminAudit } from './pages/admin/AdminAudit'
import { AdminApplications } from './pages/admin/AdminApplications'
import { AdminClients } from './pages/admin/AdminClients'
import { AdminProjects } from './pages/admin/AdminProjects'
import { AccountSettings } from './pages/AccountSettings'
import { LeadsPage } from './pages/LeadsPage'
import { DevToolsPage } from './pages/DevToolsPage'

import { Landing } from './pages/public/Landing'
import { ProjectsList } from './pages/public/ProjectsList'
import { ProjectDetail } from './pages/public/ProjectDetail'
import { CaseStudiesList } from './pages/public/CaseStudiesList'
import { CaseStudyDetail } from './pages/public/CaseStudyDetail'
import { BlogList } from './pages/public/BlogList'
import { BlogDetail } from './pages/public/BlogDetail'
import { CareersList } from './pages/public/CareersList'
import { CareerDetail } from './pages/public/CareerDetail'
import { CareerApply } from './pages/public/CareerApply'
import { About } from './pages/public/About'
import { Team } from './pages/public/Team'
import { Contact } from './pages/public/Contact'
import { StartProject } from './pages/public/StartProject'
import { Privacy, Terms } from './pages/public/Legal'
import { NotFound } from './pages/public/NotFound'
import { ContentPage } from './pages/public/ContentPage'

import { Login } from './pages/auth/Login'
import { WorkerDashboard } from './pages/worker/WorkerDashboard'
import { WorkerProjects } from './pages/worker/WorkerProjects'
import { WorkerTasks } from './pages/worker/WorkerTasks'
import { AdminDashboard } from './pages/admin/AdminDashboard'
import { AdminWorkers } from './pages/admin/AdminWorkers'
import { AdminRoles } from './pages/admin/AdminRoles'
import { ClientDashboard } from './pages/client/ClientDashboard'
import { ClientProjectDetail } from './pages/client/ClientProjectDetail'

function WhatWeBuild() {
  return (
    <ContentPage eyebrow="What we build" title="Software for work that matters." lead="Four capability areas, one engineering discipline.">
      <section><h2>Digital Products</h2><p>Web platforms, customer-facing products, internal systems, and custom applications.</p></section>
      <section><h2>Business Systems</h2><p>Operations, workflow, inventory, CRM, and management platforms.</p></section>
      <section><h2>Developer Infrastructure</h2><p>APIs, developer portals, tools, automation, and technical platforms.</p></section>
      <section><h2>Intelligent Systems</h2><p>AI-assisted workflows, automation, agents, and intelligent interfaces.</p></section>
    </ContentPage>
  )
}

function WorkerWorkspace() {
  const { profile, loading } = useAuth()
  return (
    <ProtectedRoute allowedRoles={['worker', 'superadmin']} activeRole={profile?.role ?? null} loading={loading}>
      <WorkspaceLayout navGroups={WORKER_NAV} settingsPath="/worker/settings">
        <Routes>
          <Route index element={<WorkerDashboard />} />
          <Route path="projects" element={<WorkerProjects />} />
          <Route path="projects/:id" element={<ScaffoldPage icon={FolderKanban} title="Project workspace" description="The full project workspace (tabs for milestones, files, and activity) lands in the next build phase." />} />
          <Route path="tasks" element={<WorkerTasks />} />
          <Route path="clients" element={<ScaffoldPage icon={Briefcase} title="No clients assigned" description="Clients you work with will appear here." table="clients" countLabel="clients on file" />} />
          <Route path="leads" element={<LeadsPage />} />
          <Route path="content/case-studies" element={<CaseStudyAdminList basePath="/worker/content/case-studies" />} />
          <Route path="content/case-studies/:id" element={<CaseStudyEditor basePath="/worker/content/case-studies" />} />
          <Route path="content/blog" element={<BlogAdminList basePath="/worker/content/blog" />} />
          <Route path="content/blog/:id" element={<BlogEditor basePath="/worker/content/blog" />} />
          <Route path="content/team" element={<TeamAdminList basePath="/worker/content/team" />} />
          <Route path="content/team/:id" element={<TeamProfileEditor basePath="/worker/content/team" />} />
          <Route path="content/careers" element={<CareersAdminList basePath="/worker/content/careers" />} />
          <Route path="content/careers/:id" element={<CareerEditor basePath="/worker/content/careers" />} />
          <Route path="resources" element={<ResourcesManager />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="devtools" element={<DevToolsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="settings" element={<AccountSettings />} />
        </Routes>
      </WorkspaceLayout>
    </ProtectedRoute>
  )
}

function SuperAdminOnly({ children }: { children: ReactNode }) {
  const { profile, loading } = useAuth()
  return (
    <ProtectedRoute allowedRoles={['superadmin']} activeRole={profile?.role ?? null} loading={loading}>
      {children}
    </ProtectedRoute>
  )
}

function AdminWorkspace() {
  const { profile, loading } = useAuth()
  // Manager shares this workspace shell with Super Admin — the routes below
  // that are superadmin-only (roles, security, settings) are wrapped in a
  // nested SuperAdminOnly guard rather than living in a separate component,
  // so there is exactly one implementation of each page, per /docs/RBAC.md.
  return (
    <ProtectedRoute allowedRoles={['manager', 'superadmin']} activeRole={profile?.role ?? null} loading={loading}>
      <WorkspaceLayout navGroups={profile?.role === 'manager' ? MANAGER_NAV : ADMIN_NAV} settingsPath="/admin/settings">
        <Routes>
          <Route index element={<AdminDashboard />} />
          <Route path="workers" element={<AdminWorkers />} />
          <Route path="workers/:id" element={<ScaffoldPage icon={Users} title="Worker profile" description="The detailed worker profile (permissions, projects, activity) is planned for the next phase." />} />
          <Route path="roles" element={<SuperAdminOnly><AdminRoles /></SuperAdminOnly>} />
          <Route path="clients" element={<AdminClients />} />
          <Route path="applications" element={<AdminApplications />} />
          <Route path="projects" element={<AdminProjects />} />
          <Route path="projects/:id" element={<ScaffoldPage icon={FolderKanban} title="Project workspace" description="The full project workspace (tabs for milestones, files, and activity) lands in the next build phase. The project itself is real — this is only the detail view." />} />
          <Route path="tasks" element={<ScaffoldPage icon={ClipboardList} title="Cross-project task view coming next" description="An org-wide task view is planned next." table="tasks" countLabel="tasks" />} />
          <Route path="leads" element={<LeadsPage />} />
          <Route path="content" element={<Navigate to="/admin/content/blog" replace />} />
          <Route path="content/blog" element={<BlogAdminList basePath="/admin/content/blog" />} />
          <Route path="content/blog/:id" element={<BlogEditor basePath="/admin/content/blog" />} />
          <Route path="content/case-studies" element={<CaseStudyAdminList basePath="/admin/content/case-studies" />} />
          <Route path="content/case-studies/:id" element={<CaseStudyEditor basePath="/admin/content/case-studies" />} />
          <Route path="content/team" element={<TeamAdminList basePath="/admin/content/team" />} />
          <Route path="content/team/:id" element={<TeamProfileEditor basePath="/admin/content/team" />} />
          <Route path="content/careers" element={<CareersAdminList basePath="/admin/content/careers" />} />
          <Route path="content/careers/:id" element={<CareerEditor basePath="/admin/content/careers" />} />
          <Route path="resources" element={<ResourcesManager />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="devtools" element={<DevToolsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="audit" element={<SuperAdminOnly><AdminAudit /></SuperAdminOnly>} />
          <Route path="security" element={<SuperAdminOnly><ScaffoldPage icon={ShieldCheck} title="Security overview coming next" description="An RLS/security posture summary is planned next." /></SuperAdminOnly>} />
          <Route path="settings" element={<AccountSettings />} />
        </Routes>
      </WorkspaceLayout>
    </ProtectedRoute>
  )
}

function ClientWorkspace() {
  const { profile, loading } = useAuth()
  return (
    <ProtectedRoute allowedRoles={['client']} activeRole={profile?.role ?? null} loading={loading}>
      <WorkspaceLayout navGroups={CLIENT_NAV} settingsPath="/client/settings">
        <Routes>
          <Route index element={<ClientDashboard />} />
          <Route path="projects" element={<ClientDashboard />} />
          <Route path="projects/:id" element={<ClientProjectDetail />} />
          <Route path="updates" element={<ScaffoldPage icon={Newspaper} title="No updates yet" description="Updates shared by the team will appear here." />} />
          <Route path="files" element={<ScaffoldPage icon={FolderOpen} title="No files yet" description="Files shared with you will appear here." />} />
          <Route path="requests" element={<ClientRequestsRoute />} />
          <Route path="maintenance" element={<ScaffoldPage icon={ShieldCheck} title="No maintenance activity" description="Support requests and maintenance updates will appear here once your project enters maintenance." />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="settings" element={<AccountSettings />} />
        </Routes>
      </WorkspaceLayout>
    </ProtectedRoute>
  )
}

function ClientRequestsRoute() {
  // A client may have multiple projects; keep this simple and scope to the first for now.
  const { profile } = useAuth()
  if (!profile) return null
  return <ScaffoldPage icon={Inbox} title="Select a project to see requests" description="Open a project from Projects to view and submit requests for it." />
}

function Shell() {
  return (
    <BrowserRouter>
      <IncomingCallListener />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/what-we-build" element={<WhatWeBuild />} />
        <Route path="/projects" element={<ProjectsList />} />
        <Route path="/projects/:slug" element={<ProjectDetail />} />
        <Route path="/case-studies" element={<CaseStudiesList />} />
        <Route path="/case-studies/:slug" element={<CaseStudyDetail />} />
        <Route path="/about" element={<About />} />
        <Route path="/team" element={<Team />} />
        <Route path="/blog" element={<BlogList />} />
        <Route path="/blog/:slug" element={<BlogDetail />} />
        <Route path="/careers" element={<CareersList />} />
        <Route path="/careers/:slug" element={<CareerDetail />} />
        <Route path="/careers/:slug/apply" element={<CareerApply />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/start-project" element={<StartProject />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/login" element={<Login />} />

        <Route path="/worker/*" element={<WorkerWorkspace />} />
        <Route path="/admin/*" element={<AdminWorkspace />} />
        <Route path="/client/*" element={<ClientWorkspace />} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </AuthProvider>
  )
}
