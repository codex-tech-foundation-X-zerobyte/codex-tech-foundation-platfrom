import './Skeleton.css'

export function Skeleton({ width = '100%', height = '16px', radius = 'var(--radius-sm)' }: { width?: string; height?: string; radius?: string }) {
  return <span className="ctf-skeleton" style={{ width, height, borderRadius: radius }} />
}

/** A few skeleton rows for a list/table while data loads. */
export function SkeletonRows({ rows = 4, height = '52px' }: { rows?: number; height?: string }) {
  return (
    <div className="ctf-skeleton-stack">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height={height} radius="var(--radius-md)" />
      ))}
    </div>
  )
}
