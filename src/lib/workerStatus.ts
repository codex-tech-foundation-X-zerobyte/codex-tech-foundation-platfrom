/* How a worker's lifecycle status is shown and what can be done to it directly. The suspension flow (Approvals) owns the middle states. */

export type WorkerLifecycle = 'invited' | 'active' | 'suspension_pending' | 'suspended' | 'review' | 'offboarded' | 'banned' | 'inactive'

export interface StatusInfo { label: string; tone: 'success' | 'neutral' | 'warning' | 'danger'; action: 'suspend' | 'reactivate' | null; managedByCase: boolean }

export function workerStatusInfo(status: string): StatusInfo {
  switch (status) {
    case 'active': return { label: 'Active', tone: 'success', action: 'suspend', managedByCase: false }
    case 'invited': return { label: 'Invited', tone: 'neutral', action: 'suspend', managedByCase: false }
    case 'suspension_pending': return { label: 'Suspension pending', tone: 'warning', action: null, managedByCase: true }
    case 'review': return { label: 'Under review', tone: 'warning', action: null, managedByCase: true }
    case 'offboarded': return { label: 'Offboarded', tone: 'neutral', action: null, managedByCase: false }
    case 'suspended': return { label: 'Suspended', tone: 'danger', action: 'reactivate', managedByCase: false }
    case 'banned': case 'inactive': return { label: status === 'banned' ? 'Banned' : 'Inactive', tone: 'danger', action: 'reactivate', managedByCase: false }
    default: return { label: status.replace(/_/g, ' '), tone: 'neutral', action: null, managedByCase: false }
  }
}
