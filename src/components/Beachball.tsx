import { useEffect, useRef, useState } from 'react'
import { ProvenanceChip } from './ProvenanceChip'
import {
  fetchMechanism,
  faultStyle,
  fmtMoment,
  radiation,
  type Axis,
  type MechanismData,
} from '../lib/momentTensor'
import type { CanonicalEvent } from '../types'

const COMPRESSION = [255, 123, 98, 255] // shaded quadrants (first motion up)
const TENSION = [7, 11, 17, 255]
const SQRT2 = Math.SQRT2

// Lower-hemisphere equal-area (Schmidt) projection of an axis given azimuth/plunge.
function projectAxis(axisValue: Axis, radius: number): { x: number; y: number } {
  const az = (axisValue.azimuth * Math.PI) / 180
  const takeoff = ((90 - axisValue.plunge) * Math.PI) / 180
  const r = radius * SQRT2 * Math.sin(takeoff / 2)
  return { x: r * Math.sin(az), y: -r * Math.cos(az) }
}

function drawBeachball(canvas: HTMLCanvasElement, mech: MechanismData) {
  const cssSize = canvas.clientWidth
  if (cssSize === 0) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const size = Math.round(cssSize * dpr)
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const R = size / 2 - 2 * dpr
  const cx = size / 2
  const cy = size / 2
  const image = ctx.createImageData(size, size)
  const data = image.data

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const dx = px - cx
      const dy = py - cy
      const r = Math.hypot(dx, dy)
      if (r > R) continue
      // Invert the equal-area projection back to a lower-hemisphere ray.
      const takeoff = 2 * Math.asin(Math.min(1, r / (R * SQRT2)))
      const az = Math.atan2(dx, -dy) // screen up = north, azimuth clockwise
      const value = radiation(mech.mNED, az, takeoff)
      const color = value > 0 ? COMPRESSION : TENSION
      const o = (py * size + px) * 4
      data[o] = color[0]
      data[o + 1] = color[1]
      data[o + 2] = color[2]
      data[o + 3] = color[3]
    }
  }
  ctx.putImageData(image, 0, 0)

  // outline
  ctx.strokeStyle = 'rgba(167, 179, 194, 0.6)'
  ctx.lineWidth = dpr
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.stroke()

  // P / T axis markers from the reported product values
  ctx.font = `600 ${10 * dpr}px "Geist Mono", monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const mark = (axisValue: Axis | null, label: string, fill: string, stroke: string) => {
    if (!axisValue) return
    const { x, y } = projectAxis(axisValue, R)
    ctx.fillStyle = fill
    ctx.strokeStyle = stroke
    ctx.lineWidth = dpr
    ctx.beginPath()
    ctx.arc(cx + x, cy + y, 7 * dpr, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#f2f6fb'
    ctx.fillText(label, cx + x, cy + y + dpr * 0.5)
  }
  mark(mech.tAxis, 'T', 'rgba(12, 18, 26, 0.85)', 'rgba(119, 213, 255, 0.7)')
  mark(mech.pAxis, 'P', 'rgba(12, 18, 26, 0.85)', 'rgba(255, 173, 87, 0.7)')
}

const deg = (v: number): string => `${Math.round(v)}°`

export function BeachballSection({ event }: { event: CanonicalEvent }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<{
    status: 'loading' | 'ready' | 'unavailable' | 'error'
    mech: MechanismData | null
  }>({ status: 'loading', mech: null })

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading', mech: null })
    void fetchMechanism(event, controller.signal)
      .then((mech) => {
        if (controller.signal.aborted) return
        setState(mech ? { status: 'ready', mech } : { status: 'unavailable', mech: null })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error', mech: null })
      })
    return () => controller.abort()
  }, [event.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state.status === 'ready' && state.mech && canvasRef.current) {
      drawBeachball(canvasRef.current, state.mech)
    }
  }, [state])

  const mech = state.mech
  const style = faultStyle(mech?.np1 ?? null)

  return (
    <section className="drawer-section">
      <div className="section-heading">
        <div><span className="eyebrow">Fault motion</span><h3>Focal mechanism</h3></div>
        <ProvenanceChip
          kind="reported"
          source={mech?.source ? `USGS · ${mech.source.toUpperCase()}` : 'USGS'}
        />
      </div>

      {state.status === 'loading' && (
        <p className="section-empty">Checking for a published moment tensor…</p>
      )}
      {state.status === 'error' && (
        <p className="section-empty">The moment-tensor product could not be loaded.</p>
      )}
      {state.status === 'unavailable' && (
        <p className="section-empty">
          No moment tensor or focal mechanism is published for this event. Networks usually
          compute them only for roughly magnitude 4.5 and larger.
        </p>
      )}

      {state.status === 'ready' && mech && (
        <div className="beachball-layout">
          <div className="beachball-figure">
            <canvas
              ref={canvasRef}
              className="beachball-canvas"
              aria-label="Focal mechanism beachball diagram showing the pattern of compressional and dilatational first motions"
            />
            <small>Lower-hemisphere equal-area projection, computed from the published tensor. Shaded = first motion up (compression); T and P mark the tension and pressure axes.</small>
          </div>
          <div className="beachball-facts">
            {style && (
              <div className="beachball-style">
                <strong>{style.label}</strong>
                <p>{style.detail}</p>
              </div>
            )}
            <dl>
              {mech.mw != null && (
                <div><dt>Derived magnitude</dt><dd>{mech.magType ?? 'Mw'} {mech.mw.toFixed(1)}</dd></div>
              )}
              {mech.scalarMomentNm != null && (
                <div><dt>Scalar moment</dt><dd>{fmtMoment(mech.scalarMomentNm)}</dd></div>
              )}
              {mech.percentDC != null && (
                <div><dt>Double couple</dt><dd>{Math.round(mech.percentDC)}%</dd></div>
              )}
              {mech.derivedDepthKm != null && (
                <div><dt>Derived depth</dt><dd>{mech.derivedDepthKm.toFixed(1)} km</dd></div>
              )}
              {mech.np1 && (
                <div><dt>Nodal plane 1</dt><dd>strike {deg(mech.np1.strike)} · dip {deg(mech.np1.dip)} · rake {deg(mech.np1.rake)}</dd></div>
              )}
              {mech.np2 && (
                <div><dt>Nodal plane 2</dt><dd>strike {deg(mech.np2.strike)} · dip {deg(mech.np2.dip)} · rake {deg(mech.np2.rake)}</dd></div>
              )}
            </dl>
            <p className="section-note">
              One of the two nodal planes is the fault; seismology alone cannot say which.
              {mech.kind === 'focal-mechanism' && ' Rendered from the reported nodal planes (no full tensor was published).'}
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
