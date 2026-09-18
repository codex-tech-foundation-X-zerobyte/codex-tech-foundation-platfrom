import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { PublicLayout } from '../../layouts/PublicLayout'
import { ErrorState, SkeletonRows } from '../../components/ui'
import { getBlogPost } from '../../lib/services'
import type { BlogPost } from '../../lib/types'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import './Blog.css'

export function BlogDetail() {
  const { slug } = useParams()
  const [post, setPost] = useState<BlogPost | null | undefined>(undefined)
  const [error, setError] = useState(false)
  useDocumentTitle(post ? post.title : undefined)

  useEffect(() => {
    if (!slug) return
    setError(false)
    setPost(undefined)
    void getBlogPost(slug).then(({ data, error: err }) => (err ? setError(true) : setPost(data)))
  }, [slug])

  return (
    <PublicLayout>
      <main className="container ctf-blog-detail">
        {error && <ErrorState />}
        {!error && post === undefined && <SkeletonRows rows={3} height="90px" />}
        {!error && post === null && <ErrorState title="Article not found" description="This article isn't published, or the link has changed." />}
        {post && (
          <article>
            <span className="eyebrow">Blog</span>
            <h1>{post.title}</h1>
            <p className="ctf-blog-meta">{post.published_at && new Date(post.published_at).toLocaleDateString()}</p>
            <div className="ctf-blog-body">
              {post.body.split('\n\n').map((para, i) => <p key={i}>{para}</p>)}
            </div>
          </article>
        )}
      </main>
    </PublicLayout>
  )
}
