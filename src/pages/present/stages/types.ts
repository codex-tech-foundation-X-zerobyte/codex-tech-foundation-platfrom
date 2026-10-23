import type { StageState } from '../../../lib/services'

/** What every stage receives. `state` is what is on stage; only the presenter gets to change it. */
export interface StageProps {
  state: StageState
  isPresenter: boolean
  commit: (state: StageState, opts?: { immediate?: boolean }) => void
  sessionId: string
  /** serverNow - localNow (ms), for syncing time-based stages. */
  serverOffset: number
}
