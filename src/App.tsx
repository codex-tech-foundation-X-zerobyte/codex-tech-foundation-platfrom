import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router'
import { Compass } from 'lucide-react'
import { AuthProvider, useAuth } from './lib/auth'
import { ButtonLink, EmptyState, SkeletonRows, ToastProvider } from './components/ui'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ProtectedRoute } from './components/ProtectedRoute'
import { WorkspaceLayout } from './layouts/WorkspaceLayout'
import { WORKER_NAV, ADMIN_NAV, CLIENT_NAV } from './layouts/navConfig'
import { ChangePasswordGate } from './components/ChangePasswordGate'
import { CallProvider } from './components/CallProvider'
import { CallUI } from './components/CallUI'
import { GroupCallProvider } from './components/GroupCallProvider'
import { GroupCallUI } from './components/GroupCallUI'
import { Landing } from './pages/public/Landing'
import { ContentPage } from './pages/public/ContentPage'

/*
  Every route below the landing page is code-split. Previously the whole app (all three workspaces, the CMS, the call
  stack and every public page) shipped as one ~434 kB script, so a visitor to the marketing site downloaded the admin
  console too. Now each route loads on demand; the dev tools are split again per tool (see pages/tools/DevTools.tsx).
*/
// Public
const ProjectsList = lazy(() => import('./pages/public/ProjectsList').then((m) => ({ default: m.ProjectsList })))
const ProjectDetail = lazy(() => import('./pages/public/ProjectDetail').then((m) => ({ default: m.ProjectDetail })))
const CaseStudiesList = lazy(() => import('./pages/public/CaseStudiesList').then((m) => ({ default: m.CaseStudiesList })))
const CaseStudyDetail = lazy(() => import('./pages/public/CaseStudyDetail').then((m) => ({ default: m.CaseStudyDetail })))
const BlogList = lazy(() => import('./pages/public/BlogList').then((m) => ({ default: m.BlogList })))
const BlogDetail = lazy(() => import('./pages/public/BlogDetail').then((m) => ({ default: m.BlogDetail })))
const CareersList = lazy(() => import('./pages/public/CareersList').then((m) => ({ default: m.CareersList })))
const CareerDetail = lazy(() => import('./pages/public/CareerDetail').then((m) => ({ default: m.CareerDetail })))
const CareerApply = lazy(() => import('./pages/public/CareerApply').then((m) => ({ default: m.CareerApply })))
const About = lazy(() => import('./pages/public/About').then((m) => ({ default: m.About })))
const Team = lazy(() => import('./pages/public/Team').then((m) => ({ default: m.Team })))
const Contact = lazy(() => import('./pages/public/Contact').then((m) => ({ default: m.Contact })))
const StartProject = lazy(() => import('./pages/public/StartProject').then((m) => ({ default: m.StartProject })))
const Privacy = lazy(() => import('./pages/public/Legal').then((m) => ({ default: m.Privacy })))
const Terms = lazy(() => import('./pages/public/Legal').then((m) => ({ default: m.Terms })))
const NotFound = lazy(() => import('./pages/public/NotFound').then((m) => ({ default: m.NotFound })))
const Login = lazy(() => import('./pages/auth/Login').then((m) => ({ default: m.Login })))

// Shared workspace pages
const NotificationsPage = lazy(() => import('./pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage })))
const ResourcesManager = lazy(() => import('./pages/ResourcesManager').then((m) => ({ default: m.ResourcesManager })))
const TeamChat = lazy(() => import('./pages/TeamChat').then((m) => ({ default: m.TeamChat })))
const AccountSettings = lazy(() => import('./pages/AccountSettings').then((m) => ({ default: m.AccountSettings })))
const ProjectWorkspace = lazy(() => import('./pages/project/ProjectWorkspace').then((m) => ({ default: m.ProjectWorkspace })))
const DevTools = lazy(() => import('./pages/tools/DevTools').then((m) => ({ default: m.DevTools })))
const SystemStatus = lazy(() => import('./pages/tools/SystemStatus').then((m) => ({ default: m.SystemStatus })))

// Worker
const WorkerDashboard = lazy(() => import('./pages/worker/WorkerDashboard').then((m) => ({ default: m.WorkerDashboard })))
const WorkerProjects = lazy(() => import('./pages/worker/WorkerProjects').then((m) => ({ default: m.WorkerProjects })))
const WorkerTasks = lazy(() => import('./pages/worker/WorkerTasks').then((m) => ({ default: m.WorkerTasks })))
const WorkerClients = lazy(() => import('./pages/worker/WorkerClients').then((m) => ({ default: m.WorkerClients })))

// Admin
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard').then((m) => ({ default: m.AdminDashboard })))
const AdminWorkers = lazy(() => import('./pages/admin/AdminWorkers').then((m) => ({ default: m.AdminWorkers })))
const AdminWorkerProfile = lazy(() => import('./pages/admin/AdminWorkerProfile').then((m) => ({ default: m.AdminWorkerProfile })))
const AdminRoles = lazy(() => import('./pages/admin/AdminRoles').then((m) => ({ default: m.AdminRoles })))
const AdminClients = lazy(() => import('./pages/admin/AdminClients').then((m) => ({ default: m.AdminClients })))
const AdminApplications = lazy(() => import('./pages/admin/AdminApplications').then((m) => ({ default: m.AdminApplications })))
const AdminProjects = lazy(() => import('./pages/admin/AdminProjects').then((m) => ({ default: m.AdminProjects })))
const AdminTasks = lazy(() => import('./pages/admin/AdminTasks').then((m) => ({ default: m.AdminTasks })))
const AdminLeads = lazy(() => import('./pages/admin/AdminLeads').then((m) => ({ default: m.AdminLeads })))
const AdminAuditLog = lazy(() => import('./pages/admin/AdminAuditLog').then((m) => ({ default: m.AdminAuditLog })))
const AdminSecurity = lazy(() => import('./pages/admin/AdminSecurity').then((m) => ({ default: m.AdminSecurity })))

// CMS
const BlogAdminList = lazy(() => import('./pages/cms/BlogAdminList').then((m) => ({ default: m.BlogAdminList })))
const BlogEditor = lazy(() => import('./pages/cms/BlogEditor').then((m) => ({ default: m.BlogEditor })))
const CaseStudyAdminList = lazy(() => import('./pages/cms/CaseStudyAdminList').then((m) => ({ default: m.CaseStudyAdminList })))
const CaseStudyEditor = lazy(() => import('./pages/cms/CaseStudyEditor').then((m) => ({ default: m.CaseStudyEditor })))
const TeamAdminList = lazy(() => import('./pages/cms/TeamAdminList').then((m) => ({ default: m.TeamAdminList })))
const CareersAdminList = lazy(() => import('./pages/cms/CareersAdminList').then((m) => ({ default: m.CareersAdminList })))
const CareerEditor = lazy(() => import('./pages/cms/CareerEditor').then((m) => ({ default: m.CareerEditor })))

// Client
const ClientDashboard = lazy(() => import('./pages/client/ClientDashboard').then((m) => ({ default: m.ClientDashboard })))
const ClientProjectDetail = lazy(() => import('./pages/client/ClientProjectDetail').then((m) => ({ default: m.ClientProjectDetail })))
const ClientUpdates = lazy(() => import('./pages/client/ClientUpdates').then((m) => ({ default: m.ClientUpdates })))
const ClientFiles = lazy(() => import('./pages/client/ClientFiles').then((m) => ({ default: m.ClientFiles })))
const ClientRequests = lazy(() => import('./pages/client/ClientRequests').then((m) => ({ default: m.ClientRequests })))

function PageFallback({ fullscreen = false }: { fullscreen?: boolean }) {
  return (
    <div style={fullscreen ? { minHeight: '100vh', display: 'grid', placeItems: 'center' } : undefined}>
      <div style={{ width: fullscreen ? 320 : '100%' }}><SkeletonRows rows={3} height="56px" /></div>
    </div>
  )
}

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

/** Catch-all inside a workspace. Without it an unknown /worker/whatever rendered a completely blank content area. */
function WorkspaceNotFound({ home }: { home: string }) {
  const { pathname } = useLocation()
  return (
    <EmptyState
      icon={Compass}
      title="That page doesn't exist"
      description={`There's nothing at ${pathname}. It may have moved, or the link may be mistyped.`}
      action={<ButtonLink to={home} variant="secondary">Back to overview</ButtonLink>}
    />
  )
}

function Workspace({ roles, nav, settingsPath, home, children }: { roles: ('worker' | 'superadmin' | 'manager' | 'client')[]; nav: typeof WORKER_NAV; settingsPath: string; home: string; children: ReactNode }) {
  const { profile, loading } = useAuth()
  return (
    <ProtectedRoute allowedRoles={roles} activeRole={profile?.role ?? null} loading={loading}>
      <ChangePasswordGate>
        <WorkspaceLayout navGroups={nav} settingsPath={settingsPath}>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              {children}
              <Route path="*" element={<WorkspaceNotFound home={home} />} />
            </Routes>
          </Suspense>
        </WorkspaceLayout>
      </ChangePasswordGate>
    </ProtectedRoute>
  )
}

const workerRoutes = (
  <>
    <Route index element={<WorkerDashboard />} />
    <Route path="projects" element={<WorkerProjects />} />
    <Route path="projects/:id" element={<ProjectWorkspace />} />
    <Route path="tasks" element={<WorkerTasks />} />
    <Route path="clients" element={<WorkerClients />} />
    <Route path="leads" element={<AdminLeads />} />
    <Route path="chat" element={<TeamChat />} />
    <Route path="content/case-studies" element={<CaseStudyAdminList basePath="/worker/content/case-studies" />} />
    <Route path="content/case-studies/:id" element={<CaseStudyEditor basePath="/worker/content/case-studies" />} />
    <Route path="content/blog" element={<BlogAdminList basePath="/worker/content/blog" />} />
    <Route path="content/blog/:id" element={<BlogEditor basePath="/worker/content/blog" />} />
    <Route path="content/team" element={<TeamAdminList />} />
    <Route path="content/careers" element={<CareersAdminList basePath="/worker/content/careers" />} />
    <Route path="content/careers/:id" element={<CareerEditor basePath="/worker/content/careers" />} />
    <Route path="resources" element={<ResourcesManager />} />
    <Route path="tools" element={<DevTools />} />
    <Route path="tools/:toolId" element={<DevTools />} />
    <Route path="status" element={<SystemStatus />} />
    <Route path="notifications" element={<NotificationsPage />} />
    <Route path="settings" element={<AccountSettings />} />
  </>
)

const adminRoutes = (
  <>
    <Route index element={<AdminDashboard />} />
    <Route path="workers" element={<AdminWorkers />} />
    <Route path="workers/:id" element={<AdminWorkerProfile />} />
    <Route path="roles" element={<AdminRoles />} />
    <Route path="clients" element={<AdminClients />} />
    <Route path="applications" element={<AdminApplications />} />
    <Route path="projects" element={<AdminProjects />} />
    <Route path="projects/:id" element={<ProjectWorkspace />} />
    <Route path="tasks" element={<AdminTasks />} />
    <Route path="leads" element={<AdminLeads />} />
    <Route path="chat" element={<TeamChat />} />
    <Route path="content" element={<BlogAdminList basePath="/admin/content/blog" />} />
    <Route path="content/blog/:id" element={<BlogEditor basePath="/admin/content" />} />
    <Route path="content/case-studies" element={<CaseStudyAdminList basePath="/admin/content/case-studies" />} />
    <Route path="content/case-studies/:id" element={<CaseStudyEditor basePath="/admin/content/case-studies" />} />
    <Route path="content/team" element={<TeamAdminList />} />
    <Route path="content/careers" element={<CareersAdminList basePath="/admin/content/careers" />} />
    <Route path="content/careers/:id" element={<CareerEditor basePath="/admin/content/careers" />} />
    <Route path="resources" element={<ResourcesManager />} />
    <Route path="tools" element={<DevTools />} />
    <Route path="tools/:toolId" element={<DevTools />} />
    <Route path="status" element={<SystemStatus />} />
    <Route path="notifications" element={<NotificationsPage />} />
    <Route path="audit" element={<AdminAuditLog />} />
    <Route path="security" element={<AdminSecurity />} />
    <Route path="settings" element={<AccountSettings />} />
  </>
)

const clientRoutes = (
  <>
    <Route index element={<ClientDashboard />} />
    <Route path="projects" element={<ClientDashboard />} />
    <Route path="projects/:id" element={<ClientProjectDetail />} />
    <Route path="updates" element={<ClientUpdates />} />
    <Route path="files" element={<ClientFiles />} />
    <Route path="requests" element={<ClientRequests mode="requests" />} />
    <Route path="maintenance" element={<ClientRequests mode="maintenance" />} />
    <Route path="settings" element={<AccountSettings />} />
  </>
)

function Shell() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageFallback fullscreen />}>
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

          <Route path="/worker/*" element={<Workspace roles={['worker', 'superadmin']} nav={WORKER_NAV} settingsPath="/worker/settings" home="/worker">{workerRoutes}</Workspace>} />
          <Route path="/admin/*" element={<Workspace roles={['superadmin', 'manager']} nav={ADMIN_NAV} settingsPath="/admin/settings" home="/admin">{adminRoutes}</Workspace>} />
          <Route path="/client/*" element={<Workspace roles={['client']} nav={CLIENT_NAV} settingsPath="/client/settings" home="/client">{clientRoutes}</Workspace>} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default function App() {
  return (
    <ErrorBoundary scope="page">
      <AuthProvider>
        <ToastProvider>
          <CallProvider>
            <GroupCallProvider>
              <Shell />
              <CallUI />
              <GroupCallUI />
            </GroupCallProvider>
          </CallProvider>
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}
