import { BulkBar, BulkDelete } from '../../components/BulkActions'
import { useSelection } from '../../hooks/useSelection'
import { DeleteButton } from '../../components/DeleteButton'
import { useNavigate } from 'react-router'
import { Newspaper, Plus } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, SectionHeading, SkeletonRows, Table, useToast } from '../../components/ui'
import { archiveBlogPost, deleteBlogPost, listAllBlogPosts, setBlogPostPublished } from '../../lib/services'
import type { BlogPost } from '../../lib/types'
import { useAsyncData } from '../../hooks/useAsyncData'

function statusOf(post: BlogPost): { label: string; tone: 'neutral' | 'success' | 'danger' } {
  if (post.archived_at) return { label: 'archived', tone: 'neutral' }
  if (post.published_at) return { label: 'published', tone: 'success' }
  return { label: 'draft', tone: 'neutral' }
}

export function BlogAdminList({ basePath }: { basePath: string }) {
  const { data: posts, error, loading, reload } = useAsyncData('once', listAllBlogPosts)
  const sel = useSelection(posts, (p) => p.id)
  const navigate = useNavigate()
  const { push } = useToast()

  const togglePublish = async (post: BlogPost) => {
    const { error: err } = await setBlogPostPublished(post.id, !post.published_at)
    push(err ? 'Could not update publish status.' : post.published_at ? 'Unpublished' : 'Published', err ? 'error' : 'success')
    reload()
  }

  const archive = async (post: BlogPost) => {
    const { error: err } = await archiveBlogPost(post.id)
    push(err ? 'Could not archive that post.' : 'Post archived', err ? 'error' : 'success')
    reload()
  }

  if (error) return <ErrorState onRetry={reload} />

  return (
    <div>
      <SectionHeading
        eyebrow="Content"
        title="Blog"
        action={<Button variant="primary" icon={<Plus size={15} />} onClick={() => navigate(`${basePath}/new`)}>New post</Button>}
      />
      {loading && <SkeletonRows rows={4} />}
      {!loading && posts !== null && (
        <>
        <Table
          rows={posts}
          rowKey={(p) => p.id}
          selection={{ selected: sel.selected, onChange: sel.onChange, label: (p) => p.title }}
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
                <div className="ctf-row-actions" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="sm" onClick={() => void togglePublish(p)}>{p.published_at ? 'Unpublish' : 'Publish'}</Button>
                  {!p.archived_at && <Button variant="ghost" size="sm" onClick={() => void archive(p)}>Archive</Button>}
                  <DeleteButton what="post" name={p.title} onDelete={() => deleteBlogPost(p.id)} undo={{ table: 'blog_posts', id: p.id }} onDeleted={reload}>
                    {p.published_at && !p.archived_at && <p>It is live on the website right now and will disappear from it.</p>}
                  </DeleteButton>
                </div>
              ),
            },
          ]}
        />
        <BulkBar count={sel.count} onClear={sel.clear}>
          <BulkDelete table="blog_posts" ids={sel.ids} what="post" onDone={() => { sel.clear(); reload() }} />
        </BulkBar>
        </>
      )}
    </div>
  )
}
