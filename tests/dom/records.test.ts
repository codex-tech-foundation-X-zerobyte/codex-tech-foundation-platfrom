import { describe, expect, it } from 'vitest'
import { DEPARTMENTS, recordKindOf, type DepartmentDef } from '../../src/workspaces/definitions'
import { cleanFields, daysUntil, expiryLabel, matchesWhere, recordProblem, toFormValues, visibleFields } from '../../src/workspaces/records'

const content = DEPARTMENTS.find((d) => d.slug === 'content') as DepartmentDef
const item = recordKindOf(content, 'content_item')!
const domain = recordKindOf(DEPARTMENTS.find((d) => d.slug === 'devops')!, 'domain')!
const bug = recordKindOf(DEPARTMENTS[0], 'bug')!
const analytics = recordKindOf(DEPARTMENTS.find((d) => d.slug === 'marketing')!, 'analytics_entry')!

describe('record forms', () => {
  it('show script fields only for scripts, article fields only for articles', () => {
    const keys = (v: Record<string, string>) => visibleFields(item, v).map((f) => f.key)
    expect(keys({})).toEqual(['content_type', 'channel', 'publish_on'])
    expect(keys({ content_type: 'Script' })).toEqual(expect.arrayContaining(['hook', 'introduction', 'main_point', 'supporting_points', 'cta', 'caption', 'hashtags']))
    expect(keys({ content_type: 'Script' })).not.toContain('body')
    expect(keys({ content_type: 'Article' })).toContain('body')
    expect(keys({ content_type: 'Article' })).not.toContain('hook')
    expect(keys({ content_type: 'Caption' })).toEqual(expect.arrayContaining(['caption', 'hashtags']))
  })

  it('a hidden field never leaks into what is saved, even if it was typed before switching type', () => {
    const saved = cleanFields(item, { content_type: 'Article', body: 'Long text', hook: 'typed while it was a script', hashtags: '#x' })
    expect(saved).toEqual({ content_type: 'Article', body: 'Long text' })
  })

  it('drops empty and whitespace-only values and trims the rest', () => {
    expect(cleanFields(bug, { severity: 'High', area: '   ', steps: ' click it ' })).toEqual({ severity: 'High', steps: 'click it' })
  })

  it('stores numbers as numbers and skips ones that are not', () => {
    expect(cleanFields(analytics, { period: 'W1', source: 'LinkedIn', followers: '1500', reach: 'lots' })).toEqual({ period: 'W1', source: 'LinkedIn', followers: 1500 })
  })

  it('asks for a title first, then required fields, in plain words', () => {
    expect(recordProblem(bug, '  ', {})).toMatch(/title/i)
    expect(recordProblem(bug, 'Broken', {})).toBe('Severity is required.')
    expect(recordProblem(bug, 'Broken', { severity: 'High' })).toBeNull()
    expect(recordProblem(bug, 'x'.repeat(201), { severity: 'High' })).toMatch(/200/)
  })

  it('only requires fields that are currently visible', () => {
    expect(recordProblem(item, 'Launch', { content_type: 'Caption' })).toBeNull()
    expect(recordProblem(item, 'Launch', {})).toBe('Type is required.')
  })

  it('rejects non-https links, unknown choices and non-numbers, so nothing odd can be saved', () => {
    const review = recordKindOf(DEPARTMENTS.find((d) => d.slug === 'ui-ux-design')!, 'design_review')!
    expect(recordProblem(review, 'Home', { figma_url: 'javascript:alert(1)' })).toMatch(/https/)
    expect(recordProblem(review, 'Home', { figma_url: 'http://x.example' })).toMatch(/https/)
    expect(recordProblem(review, 'Home', { figma_url: 'https://www.figma.com/file/1' })).toBeNull()
    expect(recordProblem(bug, 'Broken', { severity: 'Apocalyptic' })).toMatch(/unknown value/)
    expect(recordProblem(analytics, 'x', { period: 'p', source: 's', followers: 'abc' })).toMatch(/number/)
  })

  it('round-trips a saved record into form values', () => {
    expect(toFormValues({ severity: 'High', score: 80, empty: null })).toEqual({ severity: 'High', score: '80', empty: '' })
  })

  it('matchesWhere filters by field value and treats no filter as everything', () => {
    expect(matchesWhere({ kind: 'x', stage: 's', fields: { content_type: 'Script' } }, { content_type: 'Script' })).toBe(true)
    expect(matchesWhere({ kind: 'x', stage: 's', fields: { content_type: 'Caption' } }, { content_type: 'Script' })).toBe(false)
    expect(matchesWhere({ kind: 'x', stage: 's', fields: {} }, undefined)).toBe(true)
  })
})

describe('expiry warnings (domain and SSL watch list)', () => {
  const today = new Date(2026, 9, 15) // 15 October 2026, local time
  it('counts whole days between calendar dates, independent of the time of day', () => {
    expect(daysUntil('2026-10-15', today)).toBe(0)
    expect(daysUntil('2026-10-16', today)).toBe(1)
    expect(daysUntil('2026-10-01', today)).toBe(-14)
    expect(daysUntil('2027-01-01', new Date(2026, 9, 15, 23, 59))).toBe(78)
  })
  it('flags expired, today, within 30 days, and far-off differently', () => {
    expect(expiryLabel('2026-10-10', today)).toEqual({ text: 'Expired 5 days ago', tone: 'danger' })
    expect(expiryLabel('2026-10-14', today)).toEqual({ text: 'Expired 1 day ago', tone: 'danger' })
    expect(expiryLabel('2026-10-15', today)).toEqual({ text: 'Expires today', tone: 'danger' })
    expect(expiryLabel('2026-10-16', today)).toEqual({ text: 'Expires in 1 day', tone: 'warning' })
    expect(expiryLabel('2026-11-14', today)).toEqual({ text: 'Expires in 30 days', tone: 'warning' })
    expect(expiryLabel('2026-11-15', today)).toEqual({ text: 'Expires in 31 days', tone: 'neutral' })
    expect(expiryLabel(undefined, today)).toBeNull()
  })
  it('the domain kind exposes both its expiry dates to the calendar', () => {
    expect(domain.calendar?.map((c) => c.field)).toEqual(['expires_on', 'ssl_expires_on'])
  })
})
