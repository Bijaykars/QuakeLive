import { useEffect, useRef, useState } from 'react'
import NumberFlow from '@number-flow/react'
import { useStore } from '../state/store'
import { useVisibleEvents } from '../hooks/useVisibleEvents'
import { ExportMenu } from './ExportPanel'
import { MagnitudesNavButton } from './MagnitudeGuide'

export const DISCLAIMER =
  'Informational only — not an earthquake warning, detection, or prediction service. Data may be incomplete or revised. Always follow official civil-protection guidance.'

function StatusPill() {
  const ws = useStore((s) => s.ws.status)
  const feed = useStore((s) => s.feed.status)
  const [label, sublabel, dot] =
    ws === 'connected'
      ? ['Live', 'USGS + EMSC', 'bg-live']
      : feed === 'live'
        ? ['Updating', 'USGS every minute', 'bg-warn']
        : feed === 'error'
          ? ['Offline', 'Showing cached data', 'bg-danger']
          : ['Connecting', 'Starting live feed', 'bg-ink-low']

  return (
    <div className="status-pill" aria-label={`${label}. ${sublabel}`}>
      <span className={`status-pill__dot ${dot} ${label === 'Live' ? 'animate-breathe' : ''}`} />
      <span>
        <strong>{label}</strong>
        <small>{sublabel}</small>
      </span>
    </div>
  )
}

function SegBtn({
  active,
  onClick,
  children,
  label,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  label?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      onClick={onClick}
      className={`segmented__button ${active ? 'is-active' : ''}`}
    >
      {children}
    </button>
  )
}

function InfoPopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-expanded={open}
        aria-label="About QuakeLive and its data"
        onClick={() => setOpen(!open)}
        className="icon-button"
      >
        <span aria-hidden="true">i</span>
      </button>
      {open && (
        <div className="info-popover panel animate-fade-in">
          <div className="mb-3 flex items-center gap-2">
            <span className="brand-mark brand-mark--small" aria-hidden="true"><i /><b /></span>
            <div>
              <p className="text-[13px] font-semibold text-ink-hi">About QuakeLive</p>
              <p className="text-[10px] text-ink-low">An open earthquake explorer</p>
            </div>
          </div>
          <p className="info-popover__warning">{DISCLAIMER}</p>
          <p className="eyebrow mt-4 mb-1.5">Data and attribution</p>
          <p>
            <a href="https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php" target="_blank" rel="noopener noreferrer">USGS feeds</a>
            {' '}·{' '}
            <a href="https://www.seismicportal.eu/" target="_blank" rel="noopener noreferrer">EMSC SeismicPortal</a>
            {' '}· Satellite imagery: Esri, Vantor, Earthstar Geographics and the GIS community · Map detail: OpenFreeMap / OpenStreetMap contributors · Plate boundaries: Bird (2003).
          </p>
          <p className="mt-3 text-[11px] text-ink-low">
            Earthquake values can change as seismic networks review new observations. QuakeLive preserves revisions seen while the app is open.
          </p>
          <p className="mt-2 text-[11px] text-ink-low">
            A live alert appears only when EMSC publishes a new preliminary source record. Its displayed age is the reported earthquake origin time, not the moment QuakeLive received it.
          </p>
        </div>
      )}
    </div>
  )
}

export function TopBar({
  eventsOpen,
  onToggleEvents,
}: {
  eventsOpen: boolean
  onToggleEvents: () => void
}) {
  const visible = useVisibleEvents()
  const minMag = useStore((s) => s.filters.minMag)
  const setMinMag = useStore((s) => s.setMinMag)
  const colorMode = useStore((s) => s.colorMode)
  const setColorMode = useStore((s) => s.setColorMode)
  const windowHours = useStore((s) => s.windowHours)
  const setWindowHours = useStore((s) => s.setWindowHours)

  const maxMag = visible.reduce<number | null>(
    (m, e) => (e.mag != null && (m == null || e.mag > m) ? e.mag : m),
    null,
  )

  return (
    <header className="topbar panel">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true"><i /><b /></span>
        <span>
          <strong>QuakeLive</strong>
          <small>Earth in motion</small>
        </span>
      </div>

      <StatusPill />

      <div className="topbar__stats">
        <div>
          <span>{windowHours === 168 ? 'Past 7 days' : 'Past 24 hours'}</span>
          <strong><NumberFlow value={visible.length} /></strong>
        </div>
        <div>
          <span>Largest</span>
          <strong>
            {maxMag == null ? 'M —' : (
              <>M <NumberFlow value={maxMag} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} /></>
            )}
          </strong>
        </div>
      </div>

      <div className="topbar__controls">
        <div className="control-cluster">
          <span className="control-cluster__label">Window</span>
          <div className="segmented" role="group" aria-label="Time window">
            <SegBtn active={windowHours === 24} onClick={() => setWindowHours(24)}>24 h</SegBtn>
            <SegBtn active={windowHours === 168} onClick={() => setWindowHours(168)}>7 d</SegBtn>
          </div>
        </div>
        <div className="control-cluster">
          <span className="control-cluster__label">Magnitude</span>
          <div className="segmented" role="group" aria-label="Minimum magnitude">
            <SegBtn active={minMag == null} onClick={() => setMinMag(null)}>All</SegBtn>
            <SegBtn active={minMag === 2.5} onClick={() => setMinMag(2.5)}>2.5+</SegBtn>
            <SegBtn active={minMag === 4.5} onClick={() => setMinMag(4.5)}>4.5+</SegBtn>
          </div>
        </div>
        <div className="control-cluster">
          <span className="control-cluster__label">Colour by</span>
          <div className="segmented" role="group" aria-label="Colour events by">
            <SegBtn active={colorMode === 'age'} onClick={() => setColorMode('age')}>Age</SegBtn>
            <SegBtn active={colorMode === 'depth'} onClick={() => setColorMode('depth')}>Depth</SegBtn>
          </div>
        </div>
      </div>

      <button
        type="button"
        className={`events-button ${eventsOpen ? 'is-active' : ''}`}
        aria-controls="event-rail"
        aria-expanded={eventsOpen}
        onClick={onToggleEvents}
      >
        <span className="events-button__pulse" aria-hidden="true" />
        <span>Events</span>
        <strong><NumberFlow value={visible.length} /></strong>
      </button>
      <MagnitudesNavButton />
      <ExportMenu />
      <InfoPopover />
    </header>
  )
}
