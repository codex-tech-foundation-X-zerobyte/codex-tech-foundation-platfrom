import { describe, expect, it } from 'vitest'
import { csvCell, linesCsv, presetRange, rangeProblem, share, summaryCsv, sumBy, toCsv, type FinanceReport, type ReportLine } from '../../src/lib/financeReports'

describe('report periods', () => {
  it('daily is today; weekly runs from Monday; monthly and yearly from their first day', () => {
    expect(presetRange('today', '2026-10-25')).toEqual({ from: '2026-10-25', to: '2026-10-25' })
    expect(presetRange('week', '2026-10-25')).toEqual({ from: '2026-10-19', to: '2026-10-25' })   // a Sunday: the week began on Monday the 19th
    expect(presetRange('week', '2026-10-26')).toEqual({ from: '2026-10-26', to: '2026-10-26' })   // a Monday
    expect(presetRange('week', '2026-10-28')).toEqual({ from: '2026-10-26', to: '2026-10-28' })
    expect(presetRange('month', '2026-10-25')).toEqual({ from: '2026-10-01', to: '2026-10-25' })
    expect(presetRange('year', '2026-10-25')).toEqual({ from: '2026-01-01', to: '2026-10-25' })
  })
  it('last month is the whole previous month, across a year end and in a leap year', () => {
    expect(presetRange('last_month', '2026-10-25')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(presetRange('last_month', '2026-01-10')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(presetRange('last_month', '2028-03-05')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
  })
  it('refuses a bad range with a plain reason', () => {
    expect(rangeProblem('2026-10-01', '2026-10-25')).toBeNull()
    expect(rangeProblem('2026-10-25', '2026-10-25')).toBeNull()
    expect(rangeProblem('2026-10-26', '2026-10-25')).toMatch(/cannot be after/)
    expect(rangeProblem('', '2026-10-25')).toMatch(/both dates/)
    expect(rangeProblem('2024-01-01', '2026-10-25')).toMatch(/two years/)
  })
})

describe('CSV', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('Hosting, annual')).toBe('"Hosting, annual"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell('plain')).toBe('plain')
  })
  it('neutralises anything a spreadsheet would run as a formula (CSV injection)', () => {
    for (const evil of ['=HYPERLINK("http://evil","x")', '+1+1', '-2+3', '@SUM(A1)', '\t=1', '\r=1']) {
      const out = csvCell(evil)
      expect(out.replace(/^"/, '').startsWith("'")).toBe(true)
    }
    expect(csvCell('=1+1')).toBe("'=1+1")
  })
  it('keeps real numbers as numbers (including negatives) and handles empty values', () => {
    expect(csvCell(250000)).toBe('250000'); expect(csvCell(-60000)).toBe('-60000'); expect(csvCell(12.5)).toBe('12.5')
    expect(csvCell(null)).toBe(''); expect(csvCell(undefined)).toBe(''); expect(csvCell(NaN)).toBe('')
    expect(csvCell(true)).toBe('yes'); expect(csvCell(false)).toBe('no')
  })
  it('joins rows with CRLF and ends with one', () => {
    expect(toCsv(['a', 'b'], [[1, 'x,y']])).toBe('a,b\r\n1,"x,y"\r\n')
  })
  it('builds the detail CSV with a hostile vendor name made safe', () => {
    const line: ReportLine = { ref: 'FR-1', title: 'Domain', department: 'Frontend', category: 'domain', vendor: '=cmd|\' /C calc\'!A0', project: null, requester: 'Maya', status: 'paid', amount: 100, amount_paid: 90, refunded: 5, currency: 'NGN', submitted_on: '2026-10-01', paid_on: '2026-10-02', payment_reference: 'TRX-1', has_receipt: false, discrepancy: true }
    const csv = linesCsv([line])
    const [head, row] = csv.trim().split('\r\n')
    expect(head.split(',')[4]).toBe('Vendor')
    expect(row).toContain("'=cmd")
    expect(row.endsWith(',no,yes')).toBe(true)
    expect(row).toContain(',90,5,')
  })
})

const report: FinanceReport = {
  meta: { from: '2026-10-01', to: '2026-10-25', currency: 'NGN', department_id: null, scope: 'company', generated_at: '2026-10-25T10:00:00Z', generated_by: 'Ada Okafor', basis: ['Income is only money Codex itself earned.'] },
  submitted: { requested: 650000, approved: 550000 }, moved: { paid: 300000, refunded: 40000, net_spend: 260000, income: 650000, net_position: 390000 },
  income_by_source: [{ source: 'client_work_fee', amount: 450000 }],
  pending_approvals: { count: 1, amount: 100000 }, approved_unpaid: { count: 1, amount: 200000 }, discrepancies: { count: 1, amount: 50000 }, missing_receipts: { count: 3, amount: 700000 },
  renewals: { due_within_30_days: 2, amount_due_within_30_days: 335000, overdue: 0 },
  by_department: [{ key: 'd1', label: 'Frontend, Web', requested: 600000, approved: 500000, paid: 250000, refunded: 40000, net: 210000 }], by_category: [], by_vendor: [], by_project: [],
  by_month: [{ month: '2026-10', paid: 300000, refunded: 40000, income: 650000 }],
}
describe('summary CSV', () => {
  it('carries the period, scope, who made it and how figures are counted, so it stands alone', () => {
    const csv = summaryCsv(report)
    expect(csv).toContain('Period,2026-10-01 to 2026-10-25'); expect(csv).toContain('Scope,Company-wide'); expect(csv).toContain('Generated by,Ada Okafor')
    expect(csv).toContain('Net position,390000'); expect(csv).toContain('"Frontend, Web",600000,500000,250000,40000,210000')
    expect(csv).toContain('2026-10,300000,40000,650000'); expect(csv).toContain('Income is only money Codex itself earned.')
  })
  it('leaves company income blank in a department report instead of showing zero', () => {
    const csv = summaryCsv({ ...report, meta: { ...report.meta, scope: 'department' }, moved: { ...report.moved, income: null, net_position: null }, by_month: [{ month: '2026-10', paid: 1, refunded: 0, income: null }] })
    expect(csv).toContain('Scope,Department'); expect(csv).toMatch(/Income \(Codex.s own\),\r\n/); expect(csv).toContain('2026-10,1,0,\r\n')
  })
})

describe('shares and totals', () => {
  it('never goes over 100 or under 0, and copes with nothing to share', () => {
    expect(share(25, 100)).toBe(25); expect(share(150, 100)).toBe(100); expect(share(-5, 100)).toBe(0); expect(share(5, 0)).toBe(0)
  })
  it('adds a column', () => {
    expect(sumBy([{ key: 'a', label: 'a', requested: 1, approved: 2, paid: 3, refunded: 4, net: 5 }, { key: 'b', label: 'b', requested: 10, approved: 20, paid: 30, refunded: 40, net: 50 }], 'paid')).toBe(33)
  })
})
