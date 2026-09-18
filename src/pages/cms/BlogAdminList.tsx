import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Newspaper, Plus } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, SectionHeading, SkeletonRows, Table, useToast } from '../../components/ui'
import { archiveBlogPost, listAllBlogPosts, setBlogPostPublished } from '../../lib/services'
import type { BlogPost } from '../../lib/types'

function statusOf(post: BlogPost): { label: string; tone: 'neutral' | 'success' | 'danger' } {
  if (post.archived_at) return { label: 'archived', tone: 'neutral' }
  if (post.published_at) return { label: 'published', tone: 'success' }
  return { label: 'draft', tone: 'neutral' }
}

export function BlogAdminList({ basePath }: { basePath: string }) {
  const [posts, setPosts] = useState<BlogPost[] | null>(null)
  const [error, setError] = useState(false)
  const navigate = useNavigate()
  const { push } = useToast()

  const load = () => {
    setError(false)
    void listAllBlogPosts().then(({ data, error: err }) => (err ? setError(true) : setPosts(data)))
  }
  useEffect(load, [])

  const togglePublish = async (post: BlogPost) => {
    const { error: err } = await setBlogPostPublished(post.id, !post.published_at)
    push(err ? 'Could not update publish status.' : post.published_at ? 'Unpublished' : 'Published', err ? 'error' : 'success')
    load()
  }

  const archive = async (post: BlogPost) => {
    const { error: err } = await archiveBlogPost(post.id)
    push(err ? 'Could not archive that post.' : 'Post archived', err ? 'error' : 'success')
    load()
  }

  if (error) return <ErrorState onRetry={load} />

  return (
    <div>
      <SectionHeading
        eyebrow="Content"
        title="Blog"
        action={<Button variant="primary" icon={<Plus size={15} />} onClick={() => navigate(`${basePath}/new`)}>New post</Button>}
      />
      {posts === null && <SkeletonRows rows={4} />}
      {posts !== null && (
        <Table
          rows={posts}
          rowKey={(p) => p.id}
          emptyState={<EmptyState icon={Newspaper} title="No posts yet" description="Create your first post to get started." />}
          onRowClick={(p) => navigate(`${basePath}/${p.id}`)}
          columns={[
            { key: 'title', header: 'Title', render: (p) => <strong>{p.title}</strong> },
            { key: 'status', header: 'Status', render: (p) => { const s = statusOf(p); return <Badge tone={s.tone}>{s.label}</Badge> } },
            { key: 'updated', header: 'Updated', render: (p) => new Date(p.updated_at).toLocaleDateString() },
            {
              key: 'actions',
              header: 'Actions',
              render: (p) => (
                <div style={{ display: 'flex', gap: 8 }} onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="sm" onClick={() => void togglePublish(p)}>{p.published_at ? 'Unpublish' : 'Publish'}</Button>
                  <Button variant="ghost" size="sm" onClick={() => void archive(p)}>Archive</Button>
                </div>
              ),
            },
          ]}
        />
      )}
    </div>
  )
}
