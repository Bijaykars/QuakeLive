import { useRef } from 'react'
import { useStore } from '../state/store'
import { useVisibleEvents } from '../hooks/useVisibleEvents'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { flyToEvent } from '../map/camera'
import { ageColorHex, fmtDepth, fmtMagBare, relTime } from '../lib/format'
import { StatsBreakdown } from './StatsPanel'

const ROW_CAP = 200

interface EventListProps {
  open: boolean
  onClose: () => void
}

export function EventList({ open, onClose }: EventListProps) {
  const visible = useVisibleEvents()
  const selectedId = useStore((s) => s.selectedId)
  const hoveredId = useStore((s) => s.hoveredId)
  const feedStatus = useStore((s) => s.feed.status)
  const minMag = useStore((s) => s.filters.minMag)
  const colorMode = useStore((s) => s.colorMode)
  const select = useStore((s) => s.select)
  const hover = useStore((s) => s.hover)
  const setMinMag = useStore((s) => s.setMinMag)
  const setColorMode = useStore((s) => s.setColorMode)
  const windowHours = useStore((s) => s.windowHours)
  const setWindowHours = useStore((s) => s.setWindowHours)
  const reduced = useReducedMotion()
  const listRef = useRef<HTMLDivElement>(null)
  const now = Date.now()

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(ev.key)) return
    ev.preventDefault()
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-row]') ?? [])]
    if (!buttons.length) return
    const current = buttons.findIndex((button) => button === document.activeElement)
    const next =
      ev.key === 'Home' ? 0
      : ev.key === 'End' ? buttons.length - 1
      : ev.key === 'ArrowDown' ? Math.min(buttons.length - 1, current + 1)
      : Math.max(0, current < 0 ? 0 : current - 1)
    buttons[next]?.focus()
  }

  return (
    <>
      {open && (
        <button
          type="button"
          className="mobile-scrim"
          aria-label="Close event list"
          onClick={onClose}
        />
      )}
      <nav
        id="event-rail"
        className={`event-rail panel ${open ? 'is-open' : ''}`}
        aria-label="Recent earthquakes"
      >
        <header className="event-rail__header">
          <div>
            <span className="eyebrow">Latest events</span>
            <h2>{windowHours === 168 ? 'Past 7 days' : 'Past 24 hours'}</h2>
          </div>
          <div className="event-rail__summary">
            <span>{visible.length} shown</span>
            <button type="button" onClick={onClose} aria-label="Close event list">Close</button>
          </div>
        </header>

        <div className="event-rail__mobile-filters">
          <div>
            <span>Time window</span>
            <div role="group" aria-label="Time window">
              <button type="button" className={windowHours === 24 ? 'is-active' : ''} onClick={() => setWindowHours(24)}>24 h</button>
              <button type="button" className={windowHours === 168 ? 'is-active' : ''} onClick={() => setWindowHours(168)}>7 d</button>
            </div>
          </div>
          <div>
            <span>Minimum magnitude</span>
            <div role="group" aria-label="Minimum magnitude">
              <button type="button" className={minMag == null ? 'is-active' : ''} onClick={() => setMinMag(null)}>All</button>
              <button type="button" className={minMag === 2.5 ? 'is-active' : ''} onClick={() => setMinMag(2.5)}>2.5+</button>
              <button type="button" className={minMag === 4.5 ? 'is-active' : ''} onClick={() => setMinMag(4.5)}>4.5+</button>
            </div>
          </div>
          <div>
            <span>Map colour</span>
            <div role="group" aria-label="Map colour mode">
              <button type="button" className={colorMode === 'age' ? 'is-active' : ''} onClick={() => setColorMode('age')}>Age</button>
              <button type="button" className={colorMode === 'depth' ? 'is-active' : ''} onClick={() => setColorMode('depth')}>Depth</button>
            </div>
          </div>
        </div>

        <div className="event-rail__stats">
          <StatsBreakdown />
        </div>

        <div
          ref={listRef}
          className="event-rail__list"
          onKeyDown={onKeyDown}
          onMouseLeave={() => hover(null)}
        >
          {visible.length === 0 && (
            <div className="event-rail__empty">
              <span className={feedStatus === 'live' ? '' : 'animate-breathe'} aria-hidden="true" />
              <strong>{feedStatus === 'live' ? 'No matching events' : 'Connecting to live feeds'}</strong>
              <p>{feedStatus === 'live' ? 'Try lowering the magnitude filter.' : 'The latest events will appear here shortly.'}</p>
            </div>
          )}
          {visible.slice(0, ROW_CAP).map((event) => {
            const significant = event.mag != null && event.mag >= 6
            const active = event.id === selectedId
            return (
              <button
                key={event.id}
                data-row
                data-event-id={event.id}
                type="button"
                aria-pressed={active}
                aria-label={`View magnitude ${fmtMagBare(event.mag)} earthquake, ${event.place}`}
                onClick={() => {
                  select(event.id)
                  flyToEvent(event, reduced)
                  onClose()
                }}
                onMouseEnter={() => hover(event.id)}
                className={`event-row ${active ? 'is-active' : ''} ${event.id === hoveredId ? 'is-hovered' : ''}`}
              >
                <span
                  className={`event-row__magnitude ${significant ? 'is-significant' : ''}`}
                  style={{ '--event-color': significant ? '#fb7185' : ageColorHex(now - event.time) } as React.CSSProperties}
                >
                  <small>M</small>{fmtMagBare(event.mag)}
                </span>
                <span className="event-row__body">
                  <strong>{event.place}</strong>
                  <span>{fmtDepth(event.depthKm)} <i aria-hidden="true" /> {event.sources.usgs ? 'USGS' : 'EMSC preliminary'}</span>
                </span>
                <span className="event-row__time">{relTime(event.time, now).replace(' ago', '')}</span>
              </button>
            )
          })}
        </div>

        <footer className="event-rail__footer">
          <span>Newest first</span>
          <span className="event-rail__keys">Arrow keys to explore</span>
        </footer>
      </nav>
    </>
  )
}
