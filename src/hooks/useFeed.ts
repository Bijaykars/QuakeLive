// USGS polling loop per plan §5.1: 60 s cadence, refetch on tab-visible, stale/error states.
import { useEffect } from 'react'
import { FEED_ALL_DAY, FEED_ALL_WEEK, fetchFeed } from '../lib/usgs'
import { useStore } from '../state/store'

const POLL_MS = 60_000
const STALE_AFTER_MS = 3 * 60_000

export function useFeed(): void {
  const windowHours = useStore((s) => s.windowHours)

  useEffect(() => {
    let cancelled = false
    const url = windowHours === 168 ? FEED_ALL_WEEK : FEED_ALL_DAY

    const poll = async () => {
      try {
        const feed = await fetchFeed(url)
        if (!cancelled) useStore.getState().ingestUsgs(feed)
      } catch {
        if (!cancelled) {
          const s = useStore.getState()
          s.setFeedStatus(Date.now() - s.feed.lastFetchAt > STALE_AFTER_MS ? 'error' : 'stale')
        }
      }
    }

    void poll()
    const interval = setInterval(poll, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)

    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
    }
  }, [windowHours])
}
