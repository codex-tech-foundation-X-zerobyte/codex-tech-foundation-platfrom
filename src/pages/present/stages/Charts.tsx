import { formatNumber, type ChartType } from '../../../lib/presentation'

interface Point { label: string; value: number }
const PALETTE = ['#1565ff', '#00b8ff', '#7c5cff', '#18c29c', '#f5a524', '#ef5da8', '#ff6b5b', '#8b93a7']
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Hand-drawn SVG charts (no chart library: one less dependency to ship). Values come from the data and nothing else. */
export function Chart({ type, points, title }: { type: ChartType; points: Point[]; title: string }) {
  if (points.length === 0) return <p className="ctf-chart__none">No numeric values in this column to plot.</p>
  if (type === 'pie') return <Pie points={points} title={title} />
  return <Cartesian type={type} points={points} title={title} />
}

function Cartesian({ type, points, title }: { type: 'bar' | 'line'; points: Point[]; title: string }) {
  const W = 640, H = 300, L = 48, R = 12, T = 12, B = 54
  const max = Math.max(0, ...points.map((p) => p.value)), min = Math.min(0, ...points.map((p) => p.value))
  const span = max - min || 1
  const y = (v: number) => T + (1 - (v - min) / span) * (H - T - B)
  const step = (W - L - R) / points.length
  const x = (i: number) => L + step * i + step / 2
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => min + span * t)
  const every = Math.ceil(points.length / 12)
  return (
    <svg className="ctf-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
      {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="ctf-chart__grid" /><text x={L - 6} y={y(t) + 4} textAnchor="end" className="ctf-chart__tick">{formatNumber(t)}</text></g>)}
      {type === 'bar'
        ? points.map((p, i) => <rect key={i} x={x(i) - Math.min(28, step * 0.36)} width={Math.min(56, step * 0.72)} y={Math.min(y(p.value), y(0))} height={Math.max(1, Math.abs(y(p.value) - y(0)))} rx={3} fill={PALETTE[0]}><title>{`${p.label}: ${formatNumber(p.value)}`}</title></rect>)
        : <>
            <polyline points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')} fill="none" stroke={PALETTE[0]} strokeWidth={2.5} strokeLinejoin="round" />
            {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.value)} r={3.5} fill={PALETTE[1]}><title>{`${p.label}: ${formatNumber(p.value)}`}</title></circle>)}
          </>}
      {points.map((p, i) => (i % every === 0 ? <text key={i} x={x(i)} y={H - B + 16} textAnchor="end" transform={`rotate(-30 ${x(i)} ${H - B + 16})`} className="ctf-chart__tick">{clip(p.label, 14)}</text> : null))}
    </svg>
  )
}

function Pie({ points, title }: { points: Point[]; title: string }) {
  const positive = points.filter((p) => p.value > 0).slice(0, 8)
  const total = positive.reduce((a, p) => a + p.value, 0)
  if (positive.length === 0 || total === 0) return <p className="ctf-chart__none">A pie chart needs positive values.</p>
  const R = 110, C = 130
  const pt = (a: number) => `${C + R * Math.cos(a)} ${C + R * Math.sin(a)}`
  const slices = positive.map((p, i) => {
    const before = positive.slice(0, i).reduce((a, q) => a + q.value, 0)
    const a0 = -Math.PI / 2 + (before / total) * Math.PI * 2
    const frac = p.value / total
    const a1 = a0 + frac * Math.PI * 2
    return { p, i, frac, d: frac === 1 ? `M ${C} ${C - R} A ${R} ${R} 0 1 1 ${C - 0.01} ${C - R} Z` : `M ${C} ${C} L ${pt(a0)} A ${R} ${R} 0 ${frac > 0.5 ? 1 : 0} 1 ${pt(a1)} Z` }
  })
  return (
    <div className="ctf-chart ctf-chart--pie">
      <svg viewBox="0 0 260 260" role="img" aria-label={title}>{slices.map((s) => <path key={s.i} d={s.d} fill={PALETTE[s.i % PALETTE.length]} stroke="#0b0f17" strokeWidth={1.5}><title>{`${s.p.label}: ${formatNumber(s.p.value)} (${(s.frac * 100).toFixed(1)}%)`}</title></path>)}</svg>
      <ul className="ctf-chart__legend">{slices.map((s) => <li key={s.i}><i style={{ background: PALETTE[s.i % PALETTE.length] }} />{clip(s.p.label, 22)} <b>{(s.frac * 100).toFixed(1)}%</b></li>)}</ul>
    </div>
  )
}
