import { describe, expect, it } from 'vitest'
import {
  appendConsole, chartPoints, clampIndex, columnStats, defaultChart, expectedPosition, formatBody, formatNumber, isStale, needsSeek, normalizeStageUrl,
  numericColumns, parseCsv, parseHttpLine, recommendedStages, slideBlocks, splitOutput, splitSlides, stagesFor, toDashboardData, toEmbedUrl, toNumber,
  validatePresentationFile, MAX_CONSOLE_LINES, MAX_ROWS, MAX_COLS,
} from '../../src/lib/presentation'

describe('stages per department', () => {
  it("leads with each department's own craft", () => {
    expect(recommendedStages('frontend-development')[0]).toBe('browser')
    expect(recommendedStages('backend-development')[0]).toBe('console')
    expect(recommendedStages('marketing')[0]).toBe('dashboard')
    expect(recommendedStages('content')[0]).toBe('cinema')
  })
  it('never locks a stage away: every department can reach every stage, recommended ones first', () => {
    const all = stagesFor('marketing')
    expect(new Set(all).size).toBe(5)
    expect(all.slice(0, 3)).toEqual(recommendedStages('marketing'))
  })
  it('gives company-wide and unknown departments slides first', () => {
    expect(stagesFor(null)[0]).toBe('slides')
    expect(stagesFor('nope')[0]).toBe('slides')
  })
})

describe('normalizeStageUrl (what may go into the in-app browser)', () => {
  it('accepts https and adds it to bare domains', () => {
    expect(normalizeStageUrl('https://example.com/app?x=1')).toBe('https://example.com/app?x=1')
    expect(normalizeStageUrl('example.com')).toBe('https://example.com/')
    expect(normalizeStageUrl('  my-app.vercel.app/dashboard ')).toBe('https://my-app.vercel.app/dashboard')
  })
  it('allows http only for localhost (browsers treat it as secure)', () => {
    expect(normalizeStageUrl('http://localhost:5173')).toBe('http://localhost:5173/')
    expect(normalizeStageUrl('localhost:3000')).toBe('https://localhost:3000/')
    expect(normalizeStageUrl('http://example.com')).toBeNull()
  })
  it.each(['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'blob:https://x', 'ftp://example.com', 'vbscript:x', 'JAVASCRIPT:alert(1)'])('refuses %s', (bad) => {
    expect(normalizeStageUrl(bad)).toBeNull()
  })
  it('refuses credentials in the URL (the whole audience would see them), whitespace, empties and dotless hosts', () => {
    expect(normalizeStageUrl('https://user:pass@example.com')).toBeNull()
    expect(normalizeStageUrl('https://exa mple.com')).toBeNull()
    expect(normalizeStageUrl('')).toBeNull()
    expect(normalizeStageUrl('https://abc')).toBeNull()
    expect(normalizeStageUrl(`https://example.com/${'a'.repeat(2100)}`)).toBeNull()
  })
})

describe('toEmbedUrl', () => {
  it('embeds YouTube (privacy-enhanced domain) and Vimeo', () => {
    expect(toEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(toEmbedUrl('https://youtu.be/dQw4w9WgXcQ')?.kind).toBe('youtube')
    expect(toEmbedUrl('https://vimeo.com/76979871')?.src).toBe('https://player.vimeo.com/video/76979871')
  })
  it('does not embed anything it does not recognise, or lookalike hosts', () => {
    expect(toEmbedUrl('https://evil.com/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(toEmbedUrl('https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(toEmbedUrl('https://youtube.com/watch?v="><script>')).toBeNull()
    expect(toEmbedUrl('not a url')).toBeNull()
  })
})

describe('slides', () => {
  it('splits on --- lines, drops empties and always yields a slide', () => {
    expect(splitSlides('# One\n\n---\n\n# Two\n---\n\n---\nThree')).toEqual(['# One', '# Two', 'Three'])
    expect(splitSlides('')).toEqual([''])
    expect(splitSlides('a\r\n---\r\nb')).toEqual(['a', 'b'])
  })
  it('does not split on a dash inside text or a table', () => {
    expect(splitSlides('a --- b')).toEqual(['a --- b'])
  })
  it('clamps the current slide into range', () => {
    expect(clampIndex(5, 3)).toBe(2); expect(clampIndex(-1, 3)).toBe(0); expect(clampIndex(Number.NaN, 3)).toBe(0); expect(clampIndex(1.9, 3)).toBe(1); expect(clampIndex(4, 0)).toBe(0)
  })
  it('separates images from text', () => {
    expect(slideBlocks('# Hi\n\n![logo](https://x.com/a.png)\nafter')).toEqual([{ t: 'md', text: '# Hi' }, { t: 'img', alt: 'logo', src: 'https://x.com/a.png' }, { t: 'md', text: 'after' }])
  })
})

describe('console', () => {
  it('appends lines, ignores empties and keeps only the most recent', () => {
    let lines = appendConsole([], [{ k: 'cmd', text: 'ls' }, { k: 'out', text: '' }])
    expect(lines.map((l) => l.text)).toEqual(['ls'])
    lines = appendConsole(lines, Array.from({ length: 400 }, (_, i) => ({ k: 'out' as const, text: `line ${i}` })))
    expect(lines).toHaveLength(MAX_CONSOLE_LINES)
    expect(lines.at(-1)?.text).toBe('line 399')
    expect(new Set(lines.map((l) => l.id)).size).toBe(lines.length)
  })
  it('cuts absurdly long lines', () => {
    expect(appendConsole([], [{ k: 'out', text: 'x'.repeat(10000) }])[0].text.length).toBeLessThan(4100)
  })
  it('splits pasted output into rows and drops trailing newlines', () => {
    expect(splitOutput('a\r\nb\n\n')).toEqual(['a', 'b'])
  })
  it('parses an HTTP line, defaulting to GET and refusing unsafe targets', () => {
    expect(parseHttpLine('GET https://api.example.com/health')).toEqual({ method: 'GET', url: 'https://api.example.com/health' })
    expect(parseHttpLine('post api.example.com/x')).toEqual({ method: 'POST', url: 'https://api.example.com/x' })
    expect(parseHttpLine('https://api.example.com')).toMatchObject({ method: 'GET' })
    expect(parseHttpLine('GET javascript:alert(1)')).toBeNull()
    expect(parseHttpLine('hello world')).toBeNull()
  })
  it('pretty-prints JSON and cuts huge bodies, saying so', () => {
    expect(formatBody('{"a":1}')).toBe('{\n  "a": 1\n}')
    expect(formatBody('plain text')).toBe('plain text')
    expect(formatBody('x'.repeat(100), 10)).toContain('90 more characters not shown')
  })
})

describe('CSV and the dashboard', () => {
  it('parses quoted fields, escaped quotes and embedded commas/newlines', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n"multi\nline",2')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['multi\nline', '2']])
  })
  it('detects semicolon and tab separators and strips a BOM', () => {
    expect(parseCsv('\uFEFFa;b\n1;2')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']])
  })
  it('ignores blank lines', () => {
    expect(parseCsv('a,b\n\n1,2\n\n')).toEqual([['a', 'b'], ['1', '2']])
  })
  it('reads numbers the way people write them', () => {
    expect(toNumber('1,234.50')).toBe(1234.5); expect(toNumber('₦12,000')).toBe(12000); expect(toNumber('45%')).toBe(45)
    expect(toNumber('(300)')).toBe(-300); expect(toNumber('-7')).toBe(-7); expect(toNumber('1e3')).toBe(1000)
    expect(toNumber('')).toBeNull(); expect(toNumber('n/a')).toBeNull(); expect(toNumber('12abc')).toBeNull(); expect(toNumber('1.2.3')).toBeNull()
  })
  const sample = 'Channel,Spend,Leads,Note\nEmail,"1,000",40,ok\nSocial,2500,55,ok\nSearch,1800,n/a,check'
  it('builds dashboard data with a header, padding ragged rows and capping size', () => {
    const d = toDashboardData(sample)
    if ('error' in d) throw new Error(d.error)
    expect(d.columns).toEqual(['Channel', 'Spend', 'Leads', 'Note'])
    expect(d.rows).toHaveLength(3)
    const wide = toDashboardData(`${Array.from({ length: 20 }, (_, i) => `c${i}`).join(',')}\n${Array.from({ length: 20 }, (_, i) => i).join(',')}`)
    if ('error' in wide) throw new Error(wide.error)
    expect(wide.columns).toHaveLength(MAX_COLS)
    const tall = toDashboardData(`a,b\n${Array.from({ length: MAX_ROWS + 50 }, (_, i) => `${i},${i}`).join('\n')}`)
    if ('error' in tall) throw new Error(tall.error)
    expect(tall.rows).toHaveLength(MAX_ROWS); expect(tall.truncated).toBe(true)
  })
  it('asks for data instead of showing an empty dashboard', () => {
    expect(toDashboardData('only,a,header')).toEqual({ error: 'Add a header row and at least one row of data.' })
    expect(toDashboardData('')).toHaveProperty('error')
  })
  it('finds numeric columns and computes real statistics, skipping non-numbers instead of inventing values', () => {
    const d = toDashboardData(sample) as Exclude<ReturnType<typeof toDashboardData>, { error: string }>
    expect(numericColumns(d)).toEqual([1, 2])
    expect(columnStats(d, 1)).toEqual({ count: 3, sum: 5300, avg: 5300 / 3, min: 1000, max: 2500 })
    expect(columnStats(d, 2)).toMatchObject({ count: 2, sum: 95 })
    expect(columnStats(d, 3)).toBeNull()
  })
  it('chooses a sensible default chart and plots only real values', () => {
    const d = toDashboardData(sample) as Exclude<ReturnType<typeof toDashboardData>, { error: string }>
    const cfg = defaultChart(d)
    expect(cfg).toEqual({ type: 'bar', x: 0, y: 1 })
    expect(chartPoints(d, { ...cfg, y: 2 })).toEqual([{ label: 'Email', value: 40 }, { label: 'Social', value: 55 }])
  })
  it('formats big numbers compactly', () => {
    expect(formatNumber(1234)).toBe('1,234'); expect(formatNumber(15200)).toBe('15.2K'); expect(formatNumber(2500000)).toBe('2.5M'); expect(formatNumber(3.14159)).toBe('3.14')
  })
})

describe('cinema sync', () => {
  it('stays put while paused', () => {
    expect(expectedPosition({ playing: false, position: 42, at: 1000 }, 999999, 0)).toBe(42)
  })
  it('advances with the server clock while playing, whatever the viewer\'s own clock says', () => {
    // presenter pressed play at server time 10_000 at 30s. Viewer's clock is 5s behind the server (offset +5000).
    expect(expectedPosition({ playing: true, position: 30, at: 10_000 }, 12_000, 5_000)).toBeCloseTo(37, 5)
  })
  it('respects the playback rate and never goes negative or backwards in time', () => {
    expect(expectedPosition({ playing: true, position: 10, at: 0, rate: 2 }, 5_000, 0)).toBeCloseTo(20, 5)
    expect(expectedPosition({ playing: true, position: 10, at: 9_000 }, 1_000, 0)).toBe(10)
    expect(expectedPosition({ position: -5 }, 0, 0)).toBe(0)
  })
  it('only re-seeks past the drift tolerance, so viewers do not stutter', () => {
    expect(needsSeek(10, 10.8)).toBe(false); expect(needsSeek(10, 12)).toBe(true); expect(needsSeek(12, 10)).toBe(true)
  })
})

describe('uploads and liveness', () => {
  it('accepts presentation media and refuses the rest, with a clear reason', () => {
    expect(validatePresentationFile({ name: 'a.mp4', type: 'video/mp4', size: 1000 })).toBeNull()
    expect(validatePresentationFile({ name: 'a.png', type: 'image/png', size: 1000 })).toBeNull()
    expect(validatePresentationFile({ name: 'a.exe', type: 'application/x-msdownload', size: 1000 })).toMatch(/MP4/)
    expect(validatePresentationFile({ name: 'a.svg', type: 'image/svg+xml', size: 10 })).toMatch(/PNG/)
    expect(validatePresentationFile({ name: 'big.mp4', type: 'video/mp4', size: 80 * 1024 * 1024 })).toMatch(/50 MB/)
  })
  it('treats a presenter who went quiet as paused', () => {
    const now = Date.parse('2026-10-22T12:00:00Z')
    expect(isStale('2026-10-22T11:59:00Z', now)).toBe(false)
    expect(isStale('2026-10-22T11:50:00Z', now)).toBe(true)
  })
})
