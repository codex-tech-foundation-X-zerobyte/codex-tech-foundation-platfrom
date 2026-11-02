import { Headset, Landmark } from 'lucide-react'
import type { DepartmentDef, SectionDef } from './definitions.ts'

/*
  The two operational departments: Finance and Customer Service. They ship with the product like the original eight craft departments,
  but they are kept in their own list because the craft departments carry sprint boards, records and integrations, while these two are
  built around dedicated workflows (fund requests and support tickets) that live in their own tables with their own rules.

  Same rule as everywhere: no sample data. Every card and metric is a count of real rows the viewer may see.
*/

const overview: SectionDef = { id: 'overview', label: 'Overview', kind: 'overview' }
const team: SectionDef = { id: 'team', label: 'Team', kind: 'team' }
const channels: SectionDef = { id: 'channels', label: 'Channels', kind: 'channels' }

export const OPERATIONS_DEPARTMENTS: DepartmentDef[] = [
  {
    slug: 'finance',
    name: 'Finance',
    shortName: 'Finance',
    dashboardTitle: 'Finance Office',
    tagline: 'Fund requests, approvals, payments and the company\u2019s spending record.',
    icon: Landmark,
    accent: '#18c29c',
    roles: ['Finance Manager', 'Finance Officer'],
    cards: [
      { label: 'Awaiting Finance review', description: 'Requests waiting for a Finance Manager.', source: { type: 'funds', filter: 'awaiting_finance' }, tool: 'requests' },
      { label: 'With department admins', description: 'Reviewed by Finance, waiting on the requesting department.', source: { type: 'funds', filter: 'awaiting_department' }, tool: 'requests' },
      { label: 'Awaiting the Main Admin', description: 'Both reviews done; waiting for the final decision.', source: { type: 'funds', filter: 'awaiting_super_admin' }, tool: 'requests' },
      { label: 'Approved, not yet paid', description: 'Approved requests that still need a recorded payment.', source: { type: 'funds', filter: 'approved_unpaid' }, tool: 'requests' },
      { label: 'Needs reconciliation', description: 'Paid requests not yet reconciled, or paid differently from the approval.', source: { type: 'funds', filter: 'needs_reconciliation' }, tool: 'requests' },
    ],
    sections: [overview, { id: 'tools', label: 'Finance tools', kind: 'tools' }, channels, team],
    boards: [],
    recordKinds: [],
    tools: [
      { id: 'requests', name: 'Fund requests', description: 'Submit a request, review the queue, record payments and reconcile.', builtin: 'funds' },
      { id: 'office', name: 'Finance office', description: 'Budgets, recurring renewals, vendors and missing receipts.', builtin: 'finance' },
      { id: 'spending', name: 'Company spending', description: 'What the company has approved and spent. Visible to every active team member.', builtin: 'funds?tab=spending' },
    ],
    channels: [{ name: '#general', description: 'Finance team conversation.' }, { name: '#requests', description: 'Fund requests that need a second pair of eyes.' }, { name: '#reconciliation', description: 'Payments and reconciliation questions.' }],
    metrics: [
      { label: 'Awaiting Finance review', source: { type: 'funds', filter: 'awaiting_finance' } },
      { label: 'Approved, not yet paid', source: { type: 'funds', filter: 'approved_unpaid' } },
      { label: 'Needs reconciliation', source: { type: 'funds', filter: 'needs_reconciliation' } },
    ],
    onboarding: [
      { key: 'dept.finance.requests', label: 'Open the fund request centre', description: 'See how a request moves from employee to Finance, the department, then the Main Admin.', link: 'tool:requests' },
      { key: 'dept.finance.spending', label: 'Read the company spending record', description: 'Approved and paid requests, with no private details.', link: 'tool:spending' },
    ],
  },
  {
    slug: 'customer-service',
    name: 'Customer Service',
    shortName: 'Customer Service',
    dashboardTitle: 'Support Desk',
    tagline: 'One inbox for every customer report, from every connected project.',
    icon: Headset,
    accent: '#f5a524',
    roles: ['Customer Care Representative', 'Support Lead'],
    cards: [
      { label: 'Open tickets', description: 'Tickets that are not resolved yet.', source: { type: 'tickets', filter: 'open' }, tool: 'inbox' },
      { label: 'Unassigned', description: 'Nobody owns these yet.', source: { type: 'tickets', filter: 'unassigned' }, tool: 'inbox' },
      { label: 'Past their first-response target', description: 'Overdue and still unanswered.', source: { type: 'tickets', filter: 'overdue' }, tool: 'inbox' },
      { label: 'Escalated', description: 'With a technical department.', source: { type: 'tickets', filter: 'escalated' }, tool: 'inbox' },
    ],
    sections: [overview, { id: 'tools', label: 'Support tools', kind: 'tools' }, channels, team],
    boards: [],
    recordKinds: [],
    tools: [
      { id: 'inbox', name: 'Ticket inbox', description: 'Every ticket, with replies, internal notes, assignment and escalation.', builtin: 'support' },
      { id: 'projects', name: 'Connected projects', description: 'Which projects send tickets here, and their keys.', builtin: 'support?tab=projects' },
    ],
    channels: [{ name: '#general', description: 'Customer Service team conversation.' }, { name: '#escalations', description: 'Tickets that need engineering.' }, { name: '#quality', description: 'Quality, tone and customer feedback.' }],
    metrics: [
      { label: 'Open tickets', source: { type: 'tickets', filter: 'open' } },
      { label: 'Past their first-response target', source: { type: 'tickets', filter: 'overdue' } },
      { label: 'Escalated', source: { type: 'tickets', filter: 'escalated' } },
    ],
    onboarding: [
      { key: 'dept.customer-service.inbox', label: 'Open the ticket inbox', description: 'Where every customer report lands.', link: 'tool:inbox' },
      { key: 'dept.customer-service.notes', label: 'Learn replies vs internal notes', description: 'Only public replies reach the customer; internal notes never do.', link: 'tool:inbox' },
    ],
  },
]
