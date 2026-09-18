import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Newspaper } from 'lucide-react'
import { PublicLayout } from '../../layouts/PublicLayout'
import { EmptyState, ErrorState, SectionHeading, SkeletonRows } from '../../components/ui'
import { listBlogPosts } from '../../lib/services'
import type { BlogPost } from '../../lib/types'
import './Blog.css'

function readingTime(body: string) {
  const words = body.trim().split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / 200))
}

export function BlogList() {
  const [posts, setPosts] = useState<BlogPost[] | null>(null)
  const [error, setError] = useState(false)

  const load = () => {
    setError(false)
    setPosts(null)
    void listBlogPosts().then(({ data, error: err }) => (err ? setError(true) : setPosts(data)))
  }
  useEffect(load, [])

  const [featured, ...rest] = posts ?? []

  return (
    <PublicLayout>
      <main className="container ctf-blog">
        <SectionHeading eyebrow="Insights" title="Ideas, engineering, and building in public." />
        {error && <ErrorState onRetry={load} />}
        {!error && posts === null && <SkeletonRows rows={3} height="110px" />}
        {!error && posts !== null && posts.length === 0 && (
          <EmptyState icon={Newspaper} title="No articles published yet" description="New writing from the team will appear here first." />
        )}

        {featured && (
          <Link to={`/blog/${featured.slug}`} className="ctf-blog-featured">
            <span className="eyebrow muted">Featured</span>
            <h2>{featured.title}</h2>
            <p>{featured.excerpt}</p>
            <span className="ctf-blog-meta">{new Date(featured.published_at ?? featured.slug).toLocaleDateString()} · {readingTime(featured.body)} min read</span>
          </Link>
        )}

        {rest.length > 0 && (
          <div className="ctf-blog-grid">
            {rest.map((post) => (
              <Link to={`/blog/${post.slug}`} className="ctf-blog-card" key={post.id}>
                <h3>{post.title}</h3>
                <p>{post.excerpt}</p>
                <span className="ctf-blog-meta">{post.published_at && new Date(post.published_at).toLocaleDateString()} · {readingTime(post.body)} min read</span>
              </Link>
            ))}
          </div>
        )}
      </main>
    </PublicLayout>
  )
}
