import { useMemo } from 'react'
import { useStore, visibleEvents } from '../state/store'
import type { CanonicalEvent } from '../types'

// One shared visibility rule for list, timeline, and counters (map computes its
// own copy inside its rAF loop with the same helper).
export function useVisibleEvents(): CanonicalEvent[] {
  const events = useStore((s) => s.events)
  const order = useStore((s) => s.order)
  const minMag = useStore((s) => s.filters.minMag)
  const windowHours = useStore((s) => s.windowHours)
  const tick = useStore((s) => s.tick)
  return useMemo(
    () => visibleEvents(events, order, minMag, Date.now(), windowHours),
    [events, order, minMag, windowHours, tick],
  )
}
