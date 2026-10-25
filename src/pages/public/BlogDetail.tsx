import { useParams } from 'react-router'
import { PublicLayout } from '../../layouts/PublicLayout'
import { ErrorState, SkeletonRows } from '../../components/ui'
import { Markdown } from '../../components/Markdown'
import { getBlogPost } from '../../lib/services'
import { useAsyncData } from '../../hooks/useAsyncData'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import './Blog.css'

export function BlogDetail() {
  const { slug } = useParams()
  const { data: post, error, loading } = useAsyncData(slug ?? '', () => getBlogPost(slug ?? ''))
  useDocumentTitle(post ? post.title : undefined)

  return (
    <PublicLayout>
      <main className="container ctf-blog-detail">
        {error && <ErrorState />}
        {!error && loading && <SkeletonRows rows={3} height="90px" />}
        {!error && !loading && post === null && <ErrorState title="Article not found" description="This article isn't published, or the link has changed." />}
        {post && (
          <article>
            <span className="eyebrow">Blog</span>
            <h1>{post.title}</h1>
            <p className="ctf-blog-meta">{post.published_at && new Date(post.published_at).toLocaleDateString()}</p>
            <Markdown source={post.body} className="ctf-blog-body" />
          </article>
        )}
      </main>
    </PublicLayout>
  )
}
