import { useMemo, useRef, useState } from 'react'
import { BarChart3, FileSpreadsheet, Upload } from 'lucide-react'
import {
  MAX_COLS, MAX_ROWS, chartPoints, columnStats, defaultChart, formatNumber, numericColumns, toDashboardData,
  type ChartConfig, type ChartType, type DashboardData,
} from '../../../lib/presentation'
import { Chart } from './Charts'
import type { StageProps } from './types'

const isData = (v: unknown): v is DashboardData => !!v && typeof v === 'object' && Array.isArray((v as DashboardData).columns) && Array.isArray((v as DashboardData).rows)
const TYPES: { id: ChartType; label: string }[] = [{ id: 'bar', label: 'Bars' }, { id: 'line', label: 'Line' }, { id: 'pie', label: 'Pie' }]

/**
 * A presentable analysis built from the presenter's own data: paste or upload a CSV and get KPI cards, a chart and a table, all
 * computed from those rows. Nothing is sample data; with no data there is an empty state. The data itself is what is synced.
 */
export function DashboardStage({ state, isPresenter, commit }: StageProps) {
  const data = isData(state.data) ? state.data : null
  const title = typeof state.title === 'string' ? state.title : ''
  const chart = useMemo<ChartConfig | null>(() => {
    if (!data) return null
    const c = state.chart as Partial<ChartConfig> | undefined
    const d = defaultChart(data)
    const ok = (n: unknown) => typeof n === 'number' && n >= 0 && n < data.columns.length
    return { type: c?.type && TYPES.some((t) => t.id === c.type) ? c.type : d.type, x: ok(c?.x) ? c!.x as number : d.x, y: ok(c?.y) ? c!.y as number : d.y }
  }, [data, state.chart])
  const [csv, setCsv] = useState('')
  const [error, setError] = useState('')
  const file = useRef<HTMLInputElement>(null)

  const load = (text: string) => {
    const parsed = toDashboardData(text)
    if ('error' in parsed) { setError(parsed.error); return }
    setError('')
    commit({ ...state, data: parsed, chart: defaultChart(parsed), title: title || '' }, { immediate: true })
    setCsv('')
  }
  const onFile = async (f: File | undefined) => {
    if (!f) return
    if (f.size > 2 * 1024 * 1024) { setError('That file is over 2 MB. Present a summary table instead.'); return }
    load(await f.text())
  }

  if (!data || !chart) {
    return (
      <div className="ctf-stage ctf-stage--dashboard">
        {isPresenter ? (
          <div className="ctf-dash-load">
            <BarChart3 size={28} aria-hidden="true" />
            <h3>Bring your data</h3>
            <p>Paste a CSV (first row = column names) or upload a file. Up to {MAX_ROWS} rows and {MAX_COLS} columns. Numbers like 1,200, ₦5,000 and 45% are understood.</p>
            <textarea aria-label="CSV data" value={csv} onChange={(e) => setCsv(e.target.value)} rows={8} spellCheck={false} placeholder={'Channel,Spend,Leads\nEmail,120000,48\nSocial,310000,95\nSearch,205000,71'} />
            {error && <p className="ctf-stage__error" role="alert">{error}</p>}
            <div className="ctf-slides-edit__actions">
              <input ref={file} type="file" accept=".csv,text/csv,text/plain,.tsv" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }} />
              <button type="button" className="ctf-btn-ghost" onClick={() => file.current?.click()}><Upload size={14} /> Upload CSV</button>
              <button type="button" className="ctf-btn-solid" disabled={!csv.trim()} onClick={() => load(csv)}>Build dashboard</button>
            </div>
          </div>
        ) : <div className="ctf-stage__empty"><FileSpreadsheet size={30} aria-hidden="true" /><strong>Nothing on stage yet</strong><span>The presenter has not loaded any data.</span></div>}
      </div>
    )
  }

  const nums = numericColumns(data)
  const kpis = nums.slice(0, 4).map((c) => ({ c, s: columnStats(data, c)! })).filter((k) => k.s)
  const points = chartPoints(data, chart)
  const set = (patch: Partial<ChartConfig>) => commit({ ...state, chart: { ...chart, ...patch } }, { immediate: true })
  return (
    <div className="ctf-stage ctf-stage--dashboard">
      <div className="ctf-dash">
        <header className="ctf-dash__head">
          {isPresenter
            ? <input className="ctf-dash__title" aria-label="Dashboard title" value={title} placeholder="Title this analysis" maxLength={80} onChange={(e) => commit({ ...state, title: e.target.value })} />
            : <h3>{title || 'Analysis'}</h3>}
          <span className="ctf-dash__meta">{data.rows.length} rows{data.truncated ? ` (first ${MAX_ROWS} shown)` : ''}</span>
          {isPresenter && <button type="button" className="ctf-btn-ghost" onClick={() => commit({ ...state, data: null, chart: null }, { immediate: true })}>Replace data</button>}
        </header>
        {kpis.length > 0 && (
          <div className="ctf-dash__kpis">
            {kpis.map(({ c, s }) => (
              <div key={c} className="ctf-kpi">
                <span>{data.columns[c]}</span>
                <strong>{formatNumber(s.sum)}</strong>
                <small>total · avg {formatNumber(s.avg)} · max {formatNumber(s.max)} · {s.count} values</small>
              </div>
            ))}
          </div>
        )}
        <section className="ctf-dash__chart" aria-label="Chart">
          {isPresenter && (
            <div className="ctf-dash__controls">
              <label>Show <select value={chart.y} onChange={(e) => set({ y: Number(e.target.value) })}>{data.columns.map((c, i) => <option key={i} value={i}>{c}</option>)}</select></label>
              <label>by <select value={chart.x} onChange={(e) => set({ x: Number(e.target.value) })}>{data.columns.map((c, i) => <option key={i} value={i}>{c}</option>)}</select></label>
              <div role="group" aria-label="Chart type">{TYPES.map((t) => <button key={t.id} type="button" className={chart.type === t.id ? 'is-on' : ''} aria-pressed={chart.type === t.id} onClick={() => set({ type: t.id })}>{t.label}</button>)}</div>
            </div>
          )}
          <p className="ctf-dash__caption">{data.columns[chart.y]} by {data.columns[chart.x]}</p>
          <Chart type={chart.type} points={points} title={`${data.columns[chart.y]} by ${data.columns[chart.x]}`} />
        </section>
        <div className="ctf-dash__tablewrap">
          <table className="ctf-dash__table">
            <thead><tr>{data.columns.map((c, i) => <th key={i} scope="col">{c}</th>)}</tr></thead>
            <tbody>{data.rows.slice(0, 60).map((r, ri) => <tr key={ri}>{r.map((v, ci) => <td key={ci}>{v}</td>)}</tr>)}</tbody>
          </table>
          {data.rows.length > 60 && <p className="ctf-dash__more">Showing 60 of {data.rows.length} rows. Totals and charts use all of them.</p>}
        </div>
      </div>
    </div>
  )
}
