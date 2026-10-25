import { describe, expect, it } from 'vitest'
import { BUDGET_STATE_LABEL, budgetState, canRecordRefund, daysUntil, dueText, nextPeriodStart, parseRemindDays, percentUsed, periodLabel, periodStart, receiptMissing, refundableLeft, renewalUrgency, scopeLabel } from '../../src/lib/financeRules'

describe('budget periods', () => {
  it('finds the first day of the period a date falls in (the database only accepts these days)', () => {
    expect(periodStart('month', '2026-10-25')).toBe('2026-10-01')
    expect(periodStart('quarter', '2026-10-25')).toBe('2026-10-01')
    expect(periodStart('quarter', '2026-05-31')).toBe('2026-04-01')
    expect(periodStart('quarter', '2026-03-01')).toBe('2026-01-01')
    expect(periodStart('year', '2026-10-25')).toBe('2026-01-01')
  })
  it('moves to the next period, across a year end', () => {
    expect(nextPeriodStart('month', '2026-12-01')).toBe('2027-01-01')
    expect(nextPeriodStart('month', '2026-02-01')).toBe('2026-03-01')
    expect(nextPeriodStart('quarter', '2026-10-01')).toBe('2027-01-01')
    expect(nextPeriodStart('year', '2026-01-01')).toBe('2027-01-01')
  })
  it('labels periods for people', () => {
    expect(periodLabel('month', '2026-10-01')).toBe('October 2026')
    expect(periodLabel('quarter', '2026-04-01')).toBe('Q2 2026')
    expect(periodLabel('year', '2026-01-01')).toBe('2026')
  })
})

describe('budget state', () => {
  it('is ok under 80%, near from 80% to the limit, over above it', () => {
    expect(budgetState(1000, 500)).toBe('ok')
    expect(budgetState(1000, 799)).toBe('ok')
    expect(budgetState(1000, 800)).toBe('near')
    expect(budgetState(1000, 1000)).toBe('near')
    expect(budgetState(1000, 1001)).toBe('over')
    expect(budgetState(0, 5)).toBe('none')
    expect(BUDGET_STATE_LABEL.over).toBe('Over budget')
  })
  it('shows a percentage that never goes negative (refunds can exceed spend in a period)', () => {
    expect(percentUsed(1000, 250)).toBe(25)
    expect(percentUsed(1000, -50)).toBe(0)
    expect(percentUsed(0, 50)).toBe(0)
  })
  it('names the scope of a budget', () => {
    expect(scopeLabel('Frontend', 'Domain')).toBe('Frontend · Domain')
    expect(scopeLabel('Frontend', null)).toBe('Frontend · all categories')
    expect(scopeLabel(null, 'Hosting')).toBe('Company · Hosting')
    expect(scopeLabel(null, null)).toBe('Company-wide')
  })
})

describe('renewal dates', () => {
  it('counts whole days, across month and year ends', () => {
    expect(daysUntil('2026-11-01', '2026-10-25')).toBe(7)
    expect(daysUntil('2027-01-01', '2026-12-31')).toBe(1)
    expect(daysUntil('2026-10-25', '2026-10-25')).toBe(0)
    expect(daysUntil('2026-10-20', '2026-10-25')).toBe(-5)
    expect(daysUntil('2028-03-01', '2028-02-28')).toBe(2)
  })
  it('classifies urgency, and quiet when not active', () => {
    expect(renewalUrgency(-1, 'active')).toBe('overdue')
    expect(renewalUrgency(0, 'active')).toBe('soon')
    expect(renewalUrgency(14, 'active')).toBe('soon')
    expect(renewalUrgency(15, 'active')).toBe('upcoming')
    expect(renewalUrgency(-30, 'paused')).toBe('inactive')
  })
  it('words the due date', () => {
    expect(dueText(-3)).toBe('3 days overdue'); expect(dueText(-1)).toBe('1 day overdue'); expect(dueText(0)).toBe('Due today'); expect(dueText(1)).toBe('Due tomorrow'); expect(dueText(9)).toBe('Due in 9 days')
  })
  it('parses reminder days: sorted, unique, 0 to 365, at most eight', () => {
    expect(parseRemindDays('1, 30, 7, 14')).toEqual([30, 14, 7, 1])
    expect(parseRemindDays('7 7 7')).toEqual([7])
    expect(parseRemindDays('0')).toEqual([0])
    expect(parseRemindDays('')).toBeNull()
    expect(parseRemindDays('400')).toBeNull()
    expect(parseRemindDays('-1')).toBeNull()
    expect(parseRemindDays('seven')).toBeNull()
    expect(parseRemindDays('1,2,3,4,5,6,7,8,9')).toBeNull()
  })
})

describe('receipts and refunds', () => {
  it('flags a paid request with no document after the 3-day grace period only', () => {
    expect(receiptMissing('paid', '2026-10-20', 0, '2026-10-25')).toBe(true)
    expect(receiptMissing('paid', '2026-10-23', 0, '2026-10-25')).toBe(false)
    expect(receiptMissing('paid', '2026-10-22', 0, '2026-10-25')).toBe(true)
    expect(receiptMissing('paid', '2026-10-20', 1, '2026-10-25')).toBe(false)
    expect(receiptMissing('approved', null, 0, '2026-10-25')).toBe(false)
    expect(receiptMissing('reconciled', '2026-01-01', 0, '2026-10-25')).toBe(true)
  })
  it('never offers to refund more than was paid', () => {
    expect(refundableLeft(250000, 40000)).toBe(210000)
    expect(refundableLeft(100, 100)).toBe(0)
    expect(refundableLeft(100, 150)).toBe(0)
    expect(refundableLeft(0.3, 0.1)).toBe(0.2)
  })
  it('lets only the Finance Manager or Main Admin record one, and only on a paid request', () => {
    const fm = { isFinanceManager: true, isMainAdmin: false }, ma = { isFinanceManager: false, isMainAdmin: true }, no = { isFinanceManager: false, isMainAdmin: false }
    expect(canRecordRefund('paid', fm)).toBe(true); expect(canRecordRefund('reconciled', ma)).toBe(true); expect(canRecordRefund('paid', no)).toBe(false)
    expect(canRecordRefund('approved', fm)).toBe(false); expect(canRecordRefund('draft', ma)).toBe(false)
  })
})

import { addCycle } from '../../src/lib/financeRules'
describe('next renewal date', () => {
  it('adds one cycle and clamps to the end of a shorter month', () => {
    expect(addCycle('2026-10-25', 'monthly')).toBe('2026-11-25')
    expect(addCycle('2026-12-15', 'monthly')).toBe('2027-01-15')
    expect(addCycle('2026-01-31', 'monthly')).toBe('2026-02-28')
    expect(addCycle('2028-01-31', 'monthly')).toBe('2028-02-29')
    expect(addCycle('2026-11-30', 'quarterly')).toBe('2027-02-28')
    expect(addCycle('2028-02-29', 'yearly')).toBe('2029-02-28')
    expect(addCycle('2026-03-10', 'yearly')).toBe('2027-03-10')
  })
})
