import { useEffect, useRef, useState } from 'react'
import { ProvenanceChip } from './ProvenanceChip'
import {
  fetchAftershockForecast,
  fetchDetail,
  fetchFeltCurve,
  fetchLossOutlook,
  readEventContext,
  type AftershockWindow,
  type EventContext,
  type FeltCurve,
  type LossOutlook,
  type TextBlock,
} from '../lib/usgsDetail'
import type { CanonicalEvent } from '../types'

const ALERT_COLORS: Record<string, string> = {
  green: '#4ade80',
  yellow: '#facc15',
  orange: '#fb923c',
  red: '#fb7185',
}

function Prose({ blocks, limit }: { blocks: TextBlock[]; limit?: number }) {
  const [expanded, setExpanded] = useState(false)
  const shown = limit != null && !expanded ? blocks.slice(0, limit) : blocks
  return (
    <div className="usgs-prose">
      {shown.map((b, i) => (
        b.kind === 'heading' ? <h4 key={i}>{b.text}</h4>
        : b.kind === 'bullet' ? <p key={i} className="is-bullet">{b.text}</p>
        : <p key={i}>{b.text}</p>
      ))}
      {limit != null && blocks.length > limit && (
        <button type="button" className="usgs-prose__more" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : `Read the full summary (${blocks.length - limit} more)`}
        </button>
      )}
    </div>
  )
}

/** Tectonic summary, impact narrative and ground-failure alerts — all already in the
 *  detail document, so these cost no additional request. */
export function ContextSections({ context }: { context: EventContext }) {
  const { tectonicSummary, impactText, groundFailure } = context
  if (!tectonicSummary && !impactText && groundFailure.length === 0) return null

  return (
    <>
      {impactText && (
        <section className="drawer-section">
          <div className="section-heading">
            <div><span className="eyebrow">Reported impact</span><h3>What was reported</h3></div>
            <ProvenanceChip kind="reported" source="USGS" />
          </div>
          <Prose blocks={impactText} />
        </section>
      )}

      {groundFailure.length > 0 && (
        <section className="drawer-section">
          <div className="section-heading">
            <div><span className="eyebrow">Secondary hazards</span><h3>Landslides and liquefaction</h3></div>
            <ProvenanceChip kind="official" source="USGS ground failure" />
          </div>
          <div className="hazard-row">
            {groundFailure.map((g) => (
              <div key={g.kind} className="hazard-card">
                <span>{g.kind}</span>
                <strong style={{ color: ALERT_COLORS[g.level.toLowerCase()] ?? undefined }}>
                  {g.level[0].toUpperCase() + g.level.slice(1)}
                </strong>
                {g.populationLevel && <small>Population exposure: {g.populationLevel}</small>}
              </div>
            ))}
          </div>
          <small className="section-note">
            USGS statistical models estimate the chance that shaking triggered landslides or
            soil liquefaction. They describe likelihood over a region, not specific sites.
          </small>
        </section>
      )}

      {tectonicSummary && (
        <section className="drawer-section">
          <div className="section-heading">
            <div><span className="eyebrow">Why here</span><h3>Tectonic setting</h3></div>
            <ProvenanceChip kind="reported" source="USGS" />
          </div>
          <Prose blocks={tectonicSummary} limit={3} />
        </section>
      )}
    </>
  )
}

/** Official USGS aftershock forecast (oaf/forecast.json). */
export function AftershockSection({ event }: { event: CanonicalEvent }) {
  const [windows, setWindows] = useState<AftershockWindow[] | null>(null)
  const [active, setActive] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setWindows(null)
    setActive(0)
    void fetchDetail(event)
      .then((detail) => fetchAftershockForecast(detail, controller.signal))
      .then((w) => { if (!controller.signal.aborted) setWindows(w) })
      .catch(() => {})
    return () => controller.abort()
  }, [event.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!windows?.length) return null
  const win = windows[Math.min(active, windows.length - 1)]

  return (
    <section className="drawer-section">
      <div className="section-heading">
        <div><span className="eyebrow">What happens next</span><h3>Aftershock forecast</h3></div>
        <ProvenanceChip kind="official" source="USGS" />
      </div>
      <div className="segmented forecast-tabs" role="group" aria-label="Forecast window">
        {windows.map((w, i) => (
          <button
            key={w.label}
            type="button"
            aria-pressed={i === active}
            className={`segmented__button ${i === active ? 'is-active' : ''}`}
            onClick={() => setActive(i)}
          >
            {w.label}
          </button>
        ))}
      </div>
      <table className="forecast-table">
        <thead>
          <tr><th>Magnitude</th><th>Chance of one or more</th><th>Likely count</th></tr>
        </thead>
        <tbody>
          {win.rows.map((r) => (
            <tr key={r.magnitude}>
              <td>M {r.magnitude}+</td>
              <td>
                <span className="forecast-bar" aria-hidden="true">
                  <i style={{ width: `${Math.max(1, r.probability * 100)}%` }} />
                </span>
                {r.probability >= 0.995 ? '>99%'
                  : r.probability < 0.01 ? '<1%'
                  : `${Math.round(r.probability * 100)}%`}
              </td>
              <td>{r.p95max === 0 ? '0' : `up to ${r.p95max.toLocaleString()}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <small className="section-note">
        Official USGS forecast for the {win.label.toLowerCase()} ahead, updated as the sequence
        evolves. Counts are 95th-percentile upper bounds, not predictions of specific earthquakes.
      </small>
    </section>
  )
}

/** "Did You Feel It?" — real human reports, intensity against distance. */
export function FeltReportsSection({ event, context }: { event: CanonicalEvent; context: EventContext }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [curve, setCurve] = useState<FeltCurve | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setCurve(null)
    void fetchDetail(event)
      .then((detail) => fetchFeltCurve(detail, controller.signal))
      .then((c) => { if (!controller.signal.aborted) setCurve(c) })
      .catch(() => {})
    return () => controller.abort()
  }, [event.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !curve) return
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (!w) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = w * dpr
    canvas.height = h * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)

    const pts = [...curve.reports, ...curve.binned]
    const maxDist = Math.max(...pts.map((p) => p.distanceKm), 10)
    const maxInt = Math.max(6, Math.ceil(Math.max(...pts.map((p) => p.intensity))))
    const padL = 26
    const padB = 18
    // Distance is log-scaled: felt reports span ~1 km to ~1000 km.
    const minDist = 1
    const x = (d: number) =>
      padL + (Math.log10(Math.max(minDist, d)) / Math.log10(maxDist)) * (w - padL - 6)
    const y = (i: number) => h - padB - (i / maxInt) * (h - padB - 8)

    ctx.font = '8px "Geist Mono", monospace'
    ctx.fillStyle = '#3A4048'
    ctx.strokeStyle = '#161b23'
    for (const gd of [1, 10, 100, 1000].filter((d) => d <= maxDist)) {
      ctx.beginPath()
      ctx.moveTo(x(gd), 6)
      ctx.lineTo(x(gd), h - padB)
      ctx.stroke()
      ctx.fillText(`${gd} km`, x(gd) + 2, h - padB + 9)
    }
    for (let i = 2; i <= maxInt; i += 2) {
      ctx.beginPath()
      ctx.moveTo(padL, y(i))
      ctx.lineTo(w - 6, y(i))
      ctx.stroke()
      ctx.fillText(`${i}`, 6, y(i) + 3)
    }

    ctx.fillStyle = 'rgba(119, 213, 255, 0.4)'
    for (const p of curve.reports) {
      ctx.beginPath()
      ctx.arc(x(p.distanceKm), y(p.intensity), 1.6, 0, Math.PI * 2)
      ctx.fill()
    }
    if (curve.binned.length > 1) {
      ctx.strokeStyle = '#FFC96B'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      curve.binned.forEach((p, i) => {
        const px = x(p.distanceKm)
        const py = y(p.intensity)
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
      })
      ctx.stroke()
    }
  }, [curve])

  if (context.dyfiResponses == null && !curve) return null

  return (
    <section className="drawer-section">
      <div className="section-heading">
        <div><span className="eyebrow">Did you feel it?</span><h3>What people reported</h3></div>
        <ProvenanceChip kind="reported" source="USGS DYFI" />
      </div>
      {context.dyfiResponses != null && (
        <p className="felt-headline">
          <strong>{context.dyfiResponses.toLocaleString()}</strong> people submitted a felt report
        </p>
      )}
      {curve && (
        <>
          <canvas
            ref={canvasRef}
            className="felt-canvas"
            aria-label="Reported shaking intensity plotted against distance from the epicentre"
          />
          <p className="felt-legend">
            <span className="felt-legend__dot" aria-hidden="true" /> individual reports
            <span className="felt-legend__line" aria-hidden="true" /> median intensity
          </p>
        </>
      )}
      <small className="section-note">
        Crowd-sourced intensity from the public, not instrument recordings. Shaking normally
        weakens with distance, but soft ground can carry it much further.
      </small>
    </section>
  )
}

/** PAGER fatality and economic-loss probability bins. */
export function LossOutlookSection({ event }: { event: CanonicalEvent }) {
  const [outlook, setOutlook] = useState<LossOutlook[] | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setOutlook(null)
    void fetchDetail(event)
      .then((detail) => fetchLossOutlook(detail, controller.signal))
      .then((o) => { if (!controller.signal.aborted) setOutlook(o) })
      .catch(() => {})
    return () => controller.abort()
  }, [event.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!outlook?.length) return null

  return (
    <section className="drawer-section">
      <div className="section-heading">
        <div><span className="eyebrow">Estimated impact</span><h3>Loss outlook</h3></div>
        <ProvenanceChip kind="official" source="USGS PAGER" />
      </div>
      <div className="loss-grid">
        {outlook.map((group) => (
          <div key={group.kind}>
            <span className="loss-grid__title">
              {group.kind}
              {group.level && (
                <i style={{ background: ALERT_COLORS[group.level.toLowerCase()] ?? '#565D69' }} />
              )}
            </span>
            {group.bins.map((b) => (
              <div key={b.label} className="loss-row">
                <span>{b.label}</span>
                <span className="loss-bar" aria-hidden="true"><i style={{ width: `${b.probability}%` }} /></span>
                <strong>{b.probability}%</strong>
              </div>
            ))}
          </div>
        ))}
      </div>
      <small className="section-note">
        Modelled estimates published by USGS PAGER from shaking, population and building
        vulnerability — issued before ground truth is available, and often revised.
      </small>
    </section>
  )
}

// Accepts undefined so the drawer can call it before its own "no selection" guard.
export function useEventContext(event: CanonicalEvent | undefined): EventContext | null {
  const [context, setContext] = useState<EventContext | null>(null)
  useEffect(() => {
    if (!event) return
    let live = true
    setContext(null)
    void fetchDetail(event)
      .then((detail) => { if (live) setContext(readEventContext(detail)) })
      .catch(() => {})
    return () => { live = false }
  }, [event?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return context
}
