import { useCallback, useState } from 'react'

/**
 * Which rows of a list are ticked. Ids that stop existing (after a delete or a reload) drop out by themselves, so a bulk
 * action can never be applied to a row the person can no longer see.
 */
export function useSelection<T>(rows: readonly T[] | null | undefined, getKey: (row: T) => string) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())

  const present = new Set((rows ?? []).map(getKey))
  const selected = new Set([...picked].filter((id) => present.has(id)))

  const onChange = useCallback((next: Set<string>) => setPicked(next), [])
  const clear = useCallback(() => setPicked(new Set()), [])
  return { selected, ids: [...selected], count: selected.size, onChange, clear }
}
