import { useEffect, useRef, useState } from 'react'
import { MapView } from './map/MapView'
import { TopBar } from './components/TopBar'
import { EventList } from './components/EventList'
import { EventDrawer } from './components/EventDrawer'
import { Timeline } from './components/Timeline'
import { Toasts } from './components/Toast'
import { MapLegend } from './components/MapLegend'
import { StatsPanel } from './components/StatsPanel'
import { useFeed } from './hooks/useFeed'
import { useEmsc } from './hooks/useEmsc'
import { useReducedMotion } from './hooks/useReducedMotion'
import { useStore } from './state/store'
import { flyToEvent } from './map/camera'
import { ageColorHex, fmtDepth, fmtMag, relTime, titleCase } from './lib/format'
import type { CanonicalEvent } from './types'

export function App() {
  const reduced = useReducedMotion()
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced
  const lastInteraction = useRef(Date.now())
  const lastAnnounce = useRef(0)
  const [announcement, setAnnouncement] = useState('')
  const [eventListOpen, setEventListOpen] = useState(false)

  useFeed()

  // The live moment (plan §10.2): toast + announce + camera, never mid-interaction.
  useEmsc((e: CanonicalEvent) => {
    const s = useStore.getState()
    const now = Date.now()
    // EMSC re-publishes old records; only genuinely recent origins get the live moment.
    if (now - e.time > 2 * 3_600_000) return
    const originAge = relTime(e.time, now)
    s.pushToast({
      title: `EMSC preliminary · ${fmtMag(e.mag)}`,
      sub: `${titleCase(e.place)} · ${originAge} · ${fmtDepth(e.depthKm)}`,
      eventId: e.id,
      magHex: e.mag != null && e.mag >= 6 ? '#F87171' : ageColorHex(0),
    })

    if (e.mag != null && (e.mag >= 5.5 || now - lastAnnounce.current > 20_000)) {
      lastAnnounce.current = now
      setAnnouncement(
        `EMSC preliminary report: magnitude ${e.mag.toFixed(1)} earthquake, ${titleCase(e.place)}, ${originAge}`,
      )
    }

    const idle = now - lastInteraction.current > 10_000
    if (
      e.mag != null &&
      e.mag >= 4.5 &&
      idle &&
      !reducedRef.current &&
      document.visibilityState === 'visible'
    ) {
      flyToEvent(e, false)
    }
  })

  // Idle tracking for the auto-fly rule.
  useEffect(() => {
    const touch = () => (lastInteraction.current = Date.now())
    const opts = { passive: true } as const
    window.addEventListener('pointerdown', touch, opts)
    window.addEventListener('wheel', touch, opts)
    window.addEventListener('keydown', touch)
    window.addEventListener('touchstart', touch, opts)
    return () => {
      window.removeEventListener('pointerdown', touch)
      window.removeEventListener('wheel', touch)
      window.removeEventListener('keydown', touch)
      window.removeEventListener('touchstart', touch)
    }
  }, [])

  // 30 s tick: age colors + relative times refresh.
  useEffect(() => {
    const i = setInterval(() => useStore.getState().bumpTick(), 30_000)
    return () => clearInterval(i)
  }, [])

  // Esc closes the drawer.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && useStore.getState().selectedId) {
        useStore.getState().select(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Deep link in: ?event=<id> selects once data arrives. If the 24 h feed lacks the id,
  // widen to the 7-day feed once; if that lacks it too, give up.
  useEffect(() => {
    const wanted = new URLSearchParams(location.search).get('event')
    if (!wanted) return
    let widenedAt: number | null = null // feed.lastFetchAt when we asked for the week feed
    const tryApply = (s = useStore.getState()) => {
      const e = s.events.get(wanted)
      if (e) {
        // Lower the min-mag filter to the loosest preset that still shows the event.
        const min = s.filters.minMag
        if (min != null && (e.mag == null || e.mag < min)) {
          s.setMinMag(e.mag != null && e.mag >= 2.5 ? 2.5 : null)
        }
        s.select(wanted)
        flyToEvent(e, true)
        return true
      }
      if (s.feed.lastFetchAt === 0) return false // first poll not done yet
      if (widenedAt == null) {
        if (s.windowHours === 168) return true // already the widest feed
        widenedAt = s.feed.lastFetchAt
        s.setWindowHours(168) // useFeed refetches immediately on windowHours change
        return false
      }
      return s.feed.lastFetchAt > widenedAt // week data landed and still no id
    }
    if (tryApply()) return
    const unsub = useStore.subscribe((s) => {
      if (tryApply(s)) unsub()
    })
    return unsub
  }, [])

  // Deep link out: keep ?event= in the URL (camera lives in the #hash via maplibre).
  const selectedId = useStore((s) => s.selectedId)
  useEffect(() => {
    if (selectedId) setEventListOpen(false)
  }, [selectedId])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (selectedId) params.set('event', selectedId)
    else params.delete('event')
    const q = params.toString()
    history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash}`)
  }, [selectedId])

  return (
    <div className="app-shell relative h-full w-full overflow-hidden">
      <MapView />
      <div className="map-vignette pointer-events-none absolute inset-0" aria-hidden="true" />
      <TopBar
        eventsOpen={eventListOpen}
        onToggleEvents={() => setEventListOpen((open) => !open)}
      />
      <EventList open={eventListOpen} onClose={() => setEventListOpen(false)} />
      <EventDrawer />
      <MapLegend />
      <StatsPanel />
      <Timeline />
      <Toasts />
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  )
}
