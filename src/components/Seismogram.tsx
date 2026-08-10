import { useEffect, useRef, useState } from 'react'
import { ProvenanceChip } from './ProvenanceChip'
import {
  fetchSeismogram,
  seismogramToCsv,
  PRE_SECONDS,
  DURATION_SECONDS,
  type SeismogramData,
} from '../lib/seismogram'
import { downloadCsv } from '../lib/exportCsv'
import type { CanonicalEvent } from '../types'

const P_COLOR = '#77d5ff'
const S_COLOR = '#ffad57'

type Status = 'loading' | 'ready' | 'unavailable' | 'error'

function drawTrace(canvas: HTMLCanvasElement, data: SeismogramData, originMs: number) {
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (w === 0) return
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, w, h)

  const t0 = -PRE_SECONDS
  const t1 = DURATION_SECONDS
  const xFor = (s: number) => ((s - t0) / (t1 - t0)) * w
  const mid = h / 2

  // minute grid
  ctx.font = '8.5px "Geist Mono", monospace'
  ctx.textBaseline = 'top'
  for (let s = 0; s <= t1; s += 60) {
    ctx.strokeStyle = s % 120 === 0 ? '#1A1F29' : '#12151c'
    ctx.beginPath()
    ctx.moveTo(xFor(s) + 0.5, 0)
    ctx.lineTo(xFor(s) + 0.5, h - 11)
    ctx.stroke()
    if (s % 120 === 0 && s > 0) {
      ctx.fillStyle = '#3A4048'
      ctx.fillText(`+${s / 60} min`, xFor(s) + 3, h - 10)
    }
  }

  // origin marker
  ctx.strokeStyle = 'rgba(74,222,128,0.55)'
  ctx.beginPath()
  ctx.moveTo(xFor(0) + 0.5, 0)
  ctx.lineTo(xFor(0) + 0.5, h - 11)
  ctx.stroke()
  ctx.fillStyle = '#4ADE80'
  ctx.fillText('origin', xFor(0) + 3, 1)

  // predicted arrivals
  const marker = (s: number, label: string, color: string) => {
    ctx.strokeStyle = color
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(xFor(s) + 0.5, 0)
    ctx.lineTo(xFor(s) + 0.5, h - 11)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = color
    ctx.fillText(label, xFor(s) + 3, 10)
  }
  if (data.pArrivalS != null && data.pArrivalS < t1) marker(data.pArrivalS, 'P', P_COLOR)
  if (data.sArrivalS != null && data.sArrivalS < t1) marker(data.sArrivalS, 'S', S_COLOR)

  // waveform: min/max envelope per pixel column
  const startS = (data.startTimeMs - originMs) / 1000
  const scale = data.peakAbs > 0 ? (mid - 14) / data.peakAbs : 1
  ctx.strokeStyle = '#FFE8A3'
  ctx.globalAlpha = 0.92
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let px = 0; px < w; px++) {
    const sA = t0 + (px / w) * (t1 - t0)
    const sB = t0 + ((px + 1) / w) * (t1 - t0)
    const iA = Math.max(0, Math.floor((sA - startS) * data.sampleRate))
    const iB = Math.min(data.samples.length, Math.ceil((sB - startS) * data.sampleRate))
    if (iB <= iA) continue
    let lo = Infinity
    let hi = -Infinity
    for (let i = iA; i < iB; i++) {
      const v = data.samples[i]
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    ctx.moveTo(px + 0.5, mid - hi * scale)
    ctx.lineTo(px + 0.5, mid - lo * scale + 0.7)
  }
  ctx.stroke()
  ctx.globalAlpha = 1
}

export function SeismogramSection({ event }: { event: CanonicalEvent }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<{ status: Status; data: SeismogramData | null }>({
    status: 'loading',
    data: null,
  })

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading', data: null })
    void fetchSeismogram(event, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return
        setState(data ? { status: 'ready', data } : { status: 'unavailable', data: null })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error', data: null })
      })
    return () => controller.abort()
  }, [event.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state.status === 'ready' && state.data && canvasRef.current) {
      drawTrace(canvasRef.current, state.data, event.time)
    }
  }, [state, event.time])

  const data = state.data
  const spS = data?.pArrivalS != null && data.sArrivalS != null
    ? data.sArrivalS - data.pArrivalS
    : null

  return (
    <section className="drawer-section">
      <div className="section-heading">
        <div><span className="eyebrow">Recorded wave</span><h3>Nearest-station seismogram</h3></div>
        <ProvenanceChip kind="reported" source="EarthScope FDSN" />
      </div>

      {state.status === 'loading' && (
        <p className="section-empty">Finding the nearest seismic station and loading its waveform…</p>
      )}
      {state.status === 'error' && (
        <p className="section-empty">The waveform archive could not be reached. Event data above is unaffected.</p>
      )}
      {state.status === 'unavailable' && (
        <div className="shaking-reach">
          <strong>No open waveform is available for this event yet.</strong>
          <p>Stations within 30° may not have archived this window yet — recent events can take several minutes to appear. Very small events may simply not be visible above background noise.</p>
        </div>
      )}

      {state.status === 'ready' && data && (
        <>
          <p className="seismogram-meta">
            <strong>{data.network} {data.station} · {data.channel}</strong>
            {' '}· {Math.round(data.distanceKm).toLocaleString()} km from epicentre
            ({data.distanceDeg.toFixed(1)}°) · {data.sampleRate.toFixed(0)} samples/s
          </p>
          <canvas ref={canvasRef} className="seismogram-canvas" aria-label="Seismogram of the vertical ground motion recorded at the nearest station" />
          <div className="technical-grid seismogram-facts">
            <div className="fact-card">
              <span>Predicted P arrival</span>
              <strong>{data.pArrivalS == null ? '—' : `+${data.pArrivalS.toFixed(1)} s`}</strong>
              <small>iasp91 travel-time model</small>
            </div>
            <div className="fact-card">
              <span>Predicted S arrival</span>
              <strong>{data.sArrivalS == null ? '—' : `+${data.sArrivalS.toFixed(1)} s`}</strong>
              <small>after origin time</small>
            </div>
            <div className="fact-card">
              <span>Peak amplitude</span>
              <strong>{`+${data.peakAtS.toFixed(1)} s`}</strong>
              <small>time of largest recorded swing</small>
            </div>
            <div className="fact-card">
              <span>S − P interval</span>
              <strong>{spS == null ? '—' : `${spS.toFixed(1)} s`}</strong>
              {spS != null && <small>× 8 km/s ≈ {Math.round(spS * 8).toLocaleString()} km — the classic single-station distance check</small>}
            </div>
          </div>
          <p className="technical-caveat">Vertical-component amplitudes are raw digitizer counts — instrument response is not removed, so compare timing, not absolute size. P/S markers are model predictions, not picks.</p>
          <div className="seismogram-actions">
            <button
              type="button"
              onClick={() => downloadCsv(
                `seismogram_${event.id}_${data.network}_${data.station}_${data.channel}.csv`,
                seismogramToCsv(data, event),
              )}
            >
              Download data (CSV)
            </button>
            <button
              type="button"
              onClick={() => {
                canvasRef.current?.toBlob((blob) => {
                  if (!blob) return
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `seismogram_${event.id}_${data.network}_${data.station}.png`
                  a.click()
                  URL.revokeObjectURL(url)
                })
              }}
            >
              Download image (PNG)
            </button>
            <span>{data.samples.length.toLocaleString()} samples · {Math.round((PRE_SECONDS + DURATION_SECONDS) / 60)} min window</span>
          </div>
        </>
      )}
    </section>
  )
}
