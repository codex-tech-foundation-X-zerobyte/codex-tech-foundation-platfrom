// Types mirror the actual Supabase schema (see supabase/migrations). Keep in sync when the schema changes.

export type Role = 'worker' | 'manager' | 'superadmin' | 'client'
export type PublicationStatus = 'draft' | 'review' | 'published' | 'unpublished' | 'archived'
export type ProjectStatus = 'planning' | 'active' | 'review' | 'complete'
export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done'
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent'
export type RequestStatus = 'open' | 'in_review' | 'approved' | 'declined' | 'complete'
export type LeadStatus = 'new' | 'qualified' | 'contacted' | 'converted' | 'closed'
export type ApplicationStatus = 'received' | 'reviewing' | 'interview' | 'declined' | 'hired'
export type ClientStatus = 'prospect' | 'active' | 'paused' | 'archived'
export type WorkerStatus = 'active' | 'suspended' | 'banned' | 'inactive'

export interface Profile {
  id: string
  display_name: string
  role: Role
  organization: string | null
  avatar_path: string | null
}

export interface Project {
  id: string
  name: string
  description: string
  status: ProjectStatus
  slug: string | null
  publication_status: PublicationStatus
  published_at: string | null
  public_visibility: boolean
  client_id: string | null
  client_account_id: string | null
  owner_id: string | null
  due_date: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface Task {
  id: string
  project_id: string
  assignee_id: string | null
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  due_date: string | null
  created_at: string
  completed_at: string | null
}

export interface ProjectMilestone {
  id: string
  project_id: string
  title: string
  description: string
  status: string
  percentage: number
  target_date: string | null
  completed_date: string | null
  is_public: boolean
}

export interface ProjectUpdate {
  id: string
  project_id: string
  author_id: string | null
  title: string
  body: string
  published_at: string | null
  created_at: string
}

export interface ProjectRequest {
  id: string
  project_id: string
  requester_id: string | null
  title: string
  body: string
  status: RequestStatus
  created_at: string
  updated_at: string
}

export interface ProjectFile {
  id: string
  project_id: string
  uploaded_by: string | null
  name: string
  storage_path: string
  mime_type: string | null
  size_bytes: number | null
  created_at: string
}

export interface Client {
  id: string
  organization: string
  contact_name: string | null
  contact_email: string | null
  client_code: string | null
  status: ClientStatus
  owner_id: string | null
  created_at: string
}

export type ChannelKind = 'team' | 'project' | 'dm'

export interface Channel {
  id: string
  kind: ChannelKind
  name: string | null
  project_id: string | null
  created_by: string | null
  created_at: string
  archived_at: string | null
}

export interface Message {
  id: string
  channel_id: string
  author_id: string | null
  body: string
  attachment_path: string | null
  attachment_name: string | null
  attachment_size: number | null
  created_at: string
  edited_at: string | null
  deleted_at: string | null
}

export type CallKind = 'voice' | 'video'
export type CallStatus = 'active' | 'ended'

export interface Call {
  id: string
  channel_id: string
  kind: CallKind
  status: CallStatus
  created_by: string | null
  started_at: string
  ended_at: string | null
}

export interface CallParticipant {
  call_id: string
  user_id: string
  status: 'joined' | 'left'
  joined_at: string
  left_at: string | null
}

export interface WorkerProfile {
  user_id: string
  worker_id: string
  department_id: string | null
  position: string
  phone: string | null
  bio: string
  skills: string[]
  status: WorkerStatus
  join_date: string | null
  avatar_path: string | null
  must_change_password: boolean
}

export interface Notification {
  id: string
  user_id: string
  title: string
  body: string
  read_at: string | null
  created_at: string
}

export interface BlogPost {
  id: string
  slug: string
  title: string
  excerpt: string
  body: string
  author_id: string | null
  cover_path: string | null
  published_at: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface CaseStudy {
  id: string
  slug: string
  title: string
  summary: string
  client_id: string | null
  project_id: string | null
  problem: string
  goals: string
  approach: string
  challenges: string
  solution: string
  results: string
  metrics: unknown[]
  technologies: string[]
  cover_path: string | null
  gallery: unknown[]
  publication_status: PublicationStatus
  featured: boolean
  seo_title: string | null
  seo_description: string | null
  published_at: string | null
}

export interface Career {
  id: string
  slug: string
  title: string
  team: string
  location: string
  employment_type: string
  description: string
  requirements: string
  published_at: string | null
  archived_at: string | null
}

export interface JobApplication {
  id: string
  career_id: string
  name: string
  email: string
  resume_path: string | null
  cover_note: string
  status: ApplicationStatus
  created_at: string
}

export interface TeamProfile {
  id: string
  worker_user_id: string | null
  display_name: string
  public_title: string
  bio: string
  photo_path: string | null
  skills: string[]
  social_links: Record<string, string>
  display_order: number
  featured: boolean
  is_public: boolean
}

export interface Lead {
  id?: string
  name: string
  email: string
  company?: string
  message: string
  source?: string
  status?: LeadStatus
<<<<<<< HEAD
  notes?: string
  assigned_to?: string | null
=======
<<<<<<< HEAD
=======
  notes?: string
  assigned_to?: string | null
>>>>>>> ac4f45b (Codex Tech Foundation platform — through Pass 8)
>>>>>>> 061b8d9550595bf4603704f9a719614dc376af1a
  created_at?: string
}

export interface Resource {
  id: string
  title: string
  description: string
  category: string
  url: string | null
  storage_path: string | null
  owner_id: string | null
  parent_id: string | null
  is_folder: boolean
  size_bytes: number | null
  mime_type: string | null
  download_count: number
  current_version: number
  created_at: string
  archived_at?: string | null
  deleted_at: string | null
}

export interface ResourceVersion {
  id: string
  resource_id: string
  version: number
  storage_path: string
  size_bytes: number | null
  uploaded_by: string | null
  created_at: string
}

export interface AuditLogEntry {
  id: string
  actor_user_id: string | null
  action: string
  resource_type: string
  resource_id: string | null
  severity: string
  success: boolean
  created_at: string
}

export interface StartProjectRequest {
  name: string
  company?: string
  email: string
  phone?: string
  project_type: string
  problem: string
  desired_outcome: string
  budget?: string
  timeline?: string
  existing_system?: string
  additional_info?: string
}
