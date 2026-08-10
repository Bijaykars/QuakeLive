import { useState } from 'react'
import { useStore } from '../state/store'
import { useVisibleEvents } from '../hooks/useVisibleEvents'
import { flyToEvent } from '../map/camera'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { fmtMag, titleCase } from '../lib/format'
import { MagnitudeGuide } from './MagnitudeGuide'

// USGS magnitude classes, plain-language labels.
const CLASSES = [
  { label: 'Micro', range: '< 3', min: -Infinity, max: 3, color: '#FFE8A3' },
  { label: 'Minor', range: '3–3.9', min: 3, max: 4, color: '#FFC96B' },
  { label: 'Light', range: '4–4.9', min: 4, max: 5, color: '#F5A623' },
  { label: 'Moderate', range: '5–5.9', min: 5, max: 6, color: '#FF7B4D' },
  { label: 'Strong', range: '6–6.9', min: 6, max: 7, color: '#FB7185' },
  { label: 'Major', range: '7+', min: 7, max: Infinity, color: '#F43F5E' },
] as const

export function StatsBreakdown() {
  const visible = useVisibleEvents()
  const select = useStore((s) => s.select)
  const reduced = useReducedMotion()
  const [guideOpen, setGuideOpen] = useState(false)

  const counts = CLASSES.map(
    (c) => visible.filter((e) => e.mag != null && e.mag >= c.min && e.mag < c.max).length,
  )
  const maxCount = Math.max(1, ...counts)
  const unknown = visible.filter((e) => e.mag == null).length
  const strongest = visible.reduce<typeof visible[number] | null>(
    (best, e) => (e.mag != null && (best?.mag == null || e.mag > best.mag) ? e : best),
    null,
  )
  const feltTotal = visible.reduce((sum, e) => sum + (e.feltCount ?? 0), 0)
  const shallow = visible.filter((e) => e.depthKm != null && e.depthKm < 70).length
  const withDepth = visible.filter((e) => e.depthKm != null).length
  const tsunamiFlags = visible.filter((e) => e.tsunamiFlag).length

  return (
    <div className="stats-breakdown">
      <div className="stats-breakdown__bars" role="list" aria-label="Earthquakes by magnitude class">
        {CLASSES.map((c, i) => (
          <div key={c.label} role="listitem" className="stats-breakdown__row">
            <span className="stats-breakdown__label">{c.label}<small>{c.range}</small></span>
            <span className="stats-breakdown__track">
              <i style={{ width: `${(counts[i] / maxCount) * 100}%`, background: c.color }} />
            </span>
            <span className="stats-breakdown__count">{counts[i]}</span>
          </div>
        ))}
      </div>
      {unknown > 0 && <p className="stats-breakdown__note">{unknown} more awaiting a magnitude estimate</p>}
      <div className="stats-breakdown__facts">
        {strongest && (
          <button
            type="button"
            className="stats-breakdown__strongest"
            onClick={() => {
              select(strongest.id)
              flyToEvent(strongest, reduced)
            }}
          >
            <span>Strongest</span>
            <strong>{fmtMag(strongest.mag)}</strong>
            <small>{titleCase(strongest.place)}</small>
          </button>
        )}
        <div>
          <span>Felt reports</span>
          <strong>{feltTotal.toLocaleString()}</strong>
        </div>
        <div>
          <span>Shallow (&lt;70 km)</span>
          <strong>{withDepth === 0 ? '—' : `${Math.round((shallow / withDepth) * 100)}%`}</strong>
        </div>
        {tsunamiFlags > 0 && (
          <div className="is-warning">
            <span>Tsunami flags</span>
            <strong>{tsunamiFlags}</strong>
          </div>
        )}
      </div>
      <button type="button" className="stats-breakdown__guide" onClick={() => setGuideOpen(true)}>
        Know your magnitudes <span aria-hidden="true">→</span>
      </button>
      {guideOpen && <MagnitudeGuide onClose={() => setGuideOpen(false)} />}
    </div>
  )
}

export function StatsPanel() {
  const [open, setOpen] = useState(true)
  const windowHours = useStore((s) => s.windowHours)
  const visible = useVisibleEvents()

  return (
    <div className={`stats-panel panel ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="stats-panel__toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="eyebrow">Summary · {windowHours === 168 ? '7 days' : '24 h'}</span>
        <strong>{visible.length} events</strong>
        <i aria-hidden="true">{open ? '−' : '+'}</i>
      </button>
      {open && <StatsBreakdown />}
    </div>
  )
}
