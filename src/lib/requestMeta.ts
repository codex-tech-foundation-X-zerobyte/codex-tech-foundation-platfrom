import type { RequestKind } from './types'

export const KIND_LABEL: Record<RequestKind, string> = {
  request: 'New work',
  change: 'Change',
  bug: 'Bug',
  maintenance: 'Maintenance',
}
