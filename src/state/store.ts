import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CanonicalEvent, EmscMessage, UsgsFeed } from '../types'
import {
  canonicalFromEmsc,
  canonicalFromUsgs,
  diffRevisions,
  isSameEvent,
} from '../lib/merge'

export type FeedStatus = 'live' | 'stale' | 'error'
export type WsStatus = 'connected' | 'reconnecting' | 'off'
export type ColorMode = 'age' | 'depth'
export type WindowHours = 24 | 168
export type ShakemapStatus = 'idle' | 'loading' | 'official' | 'unavailable' | 'error'

export interface Toast {
  id: number
  title: string
  sub: string
  eventId: string | null
  magHex: string
}

interface Store {
  events: Map<string, CanonicalEvent>
  order: string[] // time-desc canonical ids
  missCounts: Map<string, number>
  selectedId: string | null
  hoveredId: string | null
  feed: { status: FeedStatus; lastGeneratedAt: number; lastFetchAt: number }
  ws: { status: WsStatus }
  shakingOverlay: {
    eventId: string | null
    status: ShakemapStatus
    maxRadiusKm: number | null
  }
  rupture: 'area' | 'trace' | null
  filters: { minMag: number | null }
  colorMode: ColorMode
  windowHours: WindowHours
  tick: number // bumped every 30 s → age colors / relative times refresh
  toasts: Toast[]

  ingestUsgs(feed: UsgsFeed): void
  ingestEmsc(msg: EmscMessage): { isNew: boolean; event: CanonicalEvent } | null
  select(id: string | null): void
  hover(id: string | null): void
  setMinMag(m: number | null): void
  setColorMode(m: ColorMode): void
  setWindowHours(h: WindowHours): void
  setFeedStatus(s: FeedStatus): void
  setWsStatus(s: WsStatus): void
  setShakingOverlay(
    eventId: string | null,
    status: ShakemapStatus,
    maxRadiusKm?: number | null,
  ): void
  setRupture(kind: 'area' | 'trace' | null): void
  bumpTick(): void
  pushToast(t: Omit<Toast, 'id'>): void
  dismissToast(id: number): void
}

const EMSC_ONLY_MAX_AGE = 26 * 3_600_000
let toastSeq = 1

function sortIds(events: Map<string, CanonicalEvent>): string[] {
  return [...events.values()].sort((a, b) => b.time - a.time).map((e) => e.id)
}

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      events: new Map(),
      order: [],
      missCounts: new Map(),
      selectedId: null,
      hoveredId: null,
      feed: { status: 'stale', lastGeneratedAt: 0, lastFetchAt: 0 },
      ws: { status: 'off' },
      shakingOverlay: { eventId: null, status: 'idle', maxRadiusKm: null },
      rupture: null,
      filters: { minMag: null },
      colorMode: 'age',
      windowHours: 24,
      tick: 0,
      toasts: [],

      ingestUsgs(feed) {
        const now = Date.now()
        // Upstream regenerates each minute; identical generated stamp → nothing to do.
        if (feed.metadata.generated === get().feed.lastGeneratedAt) {
          set({ feed: { ...get().feed, status: 'live', lastFetchAt: now } })
          return
        }
        const prevEvents = get().events
        const next = new Map<string, CanonicalEvent>()
        const miss = new Map(get().missCounts)
        // EMSC preliminaries can later be replaced by USGS canonical records.
        // Keep the old->new identity long enough to migrate every open UI reference.
        const absorbed = new Map<string, string>()

        for (const f of feed.features) {
          if (!f?.id || f.properties?.status === 'deleted') continue
          const c = canonicalFromUsgs(f, now)
          const prev = prevEvents.get(c.id)
          if (prev) {
            c.firstSeenAt = prev.firstSeenAt
            c.sources = { ...c.sources, emsc: prev.sources.emsc }
            c.revisions = [...prev.revisions, ...diffRevisions(prev, c, now)]
          } else {
            // Absorb a matching EMSC-only preliminary event (plan §5.5).
            for (const e of prevEvents.values()) {
              if (!e.sources.usgs && isSameEvent(e, c)) {
                c.firstSeenAt = Math.min(e.firstSeenAt, now)
                c.sources = { ...c.sources, emsc: e.sources.emsc }
                absorbed.set(e.id, c.id)
                break
              }
            }
          }
          miss.delete(c.id)
          next.set(c.id, c)
        }

        // Carry-over rules: EMSC-only events persist (trimmed by age);
        // USGS events missing from the feed get 2 polls of grace, then drop.
        for (const [id, e] of prevEvents) {
          if (next.has(id) || absorbed.has(id)) continue
          if (!e.sources.usgs) {
            if (now - e.time < EMSC_ONLY_MAX_AGE) next.set(id, e)
            continue
          }
          const m = (miss.get(id) ?? 0) + 1
          if (m < 2) {
            miss.set(id, m)
            next.set(id, e)
          } else {
            miss.delete(id)
          }
        }

        const patch: Partial<Store> = {
          events: next,
          missCounts: miss,
          order: sortIds(next),
          feed: { status: 'live', lastGeneratedAt: feed.metadata.generated, lastFetchAt: now },
        }

        if (absorbed.size > 0) {
          patch.toasts = get().toasts.map((toast) => {
            const canonicalId = toast.eventId ? absorbed.get(toast.eventId) : null
            return canonicalId ? { ...toast, eventId: canonicalId } : toast
          })
          const hovered = get().hoveredId
          if (hovered && absorbed.has(hovered)) patch.hoveredId = absorbed.get(hovered)
        }

        const sel = get().selectedId
        if (sel && absorbed.has(sel)) {
          patch.selectedId = absorbed.get(sel)
        } else if (sel && !next.has(sel)) {
          patch.selectedId = null
          patch.toasts = [
            ...(patch.toasts ?? get().toasts),
            {
              id: toastSeq++,
            title: 'Event removed',
            sub: 'Removed or merged by the source network.',
            eventId: null,
            magHex: '#565D69',
            },
          ]
        }
        set(patch)
      },

      ingestEmsc(msg) {
        const now = Date.now()
        const c = canonicalFromEmsc(msg, now)
        if (!c) return null
        const events = new Map(get().events)

        // Already known to USGS? Just enrich the record.
        for (const e of events.values()) {
          if (e.sources.usgs && isSameEvent(e, c)) {
            const upd: CanonicalEvent = {
              ...e,
              firstSeenAt: Math.min(e.firstSeenAt, now),
              sources: { ...e.sources, emsc: c.sources.emsc },
            }
            events.set(upd.id, upd)
            set({ events, order: get().order })
            return { isNew: false, event: upd }
          }
        }

        const prev = events.get(c.id)
        if (prev) {
          c.firstSeenAt = prev.firstSeenAt
          c.revisions = [...prev.revisions, ...diffRevisions(prev, c, now)]
        }
        events.set(c.id, c)
        set({ events, order: sortIds(events) })
        return { isNew: !prev, event: c }
      },

      select: (id) => set({ selectedId: id }),
      hover: (id) => set({ hoveredId: id }),
      setMinMag: (m) => set({ filters: { minMag: m } }),
      setColorMode: (m) => set({ colorMode: m }),
      setWindowHours: (h) => set({ windowHours: h }),
      setFeedStatus: (s) => set({ feed: { ...get().feed, status: s } }),
      setWsStatus: (s) => set({ ws: { status: s } }),
      setShakingOverlay: (eventId, status, maxRadiusKm = null) => set({
        shakingOverlay: { eventId, status, maxRadiusKm },
      }),
      setRupture: (kind) => set({ rupture: kind }),
      bumpTick: () => set({ tick: get().tick + 1 }),
      pushToast: (t) => set({ toasts: [...get().toasts, { ...t, id: toastSeq++ }] }),
      dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
    }),
    {
      name: 'ql.prefs',
      partialize: (s) => ({ filters: s.filters, colorMode: s.colorMode, windowHours: s.windowHours }),
    },
  ),
)

// Shared visibility rule: min-mag filter + time window + earthquakes only by default.
export function visibleEvents(
  events: Map<string, CanonicalEvent>,
  order: string[],
  minMag: number | null,
  now: number,
  windowHours: number = 24,
): CanonicalEvent[] {
  const out: CanonicalEvent[] = []
  for (const id of order) {
    const e = events.get(id)
    if (!e) continue
    if (now - e.time > windowHours * 3_600_000) continue
    if (minMag != null && (e.mag == null || e.mag < minMag)) continue
    out.push(e)
  }
  return out
}
