import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { useVisibleEvents } from '../hooks/useVisibleEvents'
import { getMapInstance } from '../map/camera'
import {
  API_ROW_LIMIT,
  countHistorical,
  downloadCsv,
  eventsToCsv,
  fetchHistoricalCsv,
  type HistoricalQuery,
} from '../lib/exportCsv'

const DAY_MS = 86_400_000

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

type Phase =
  | { step: 'idle' }
  | { step: 'working'; label: string }
  | { step: 'done'; label: string }
  | { step: 'error'; label: string }

export function ExportMenu() {
  const [open, setOpen] = useState(false)
  const [start, setStart] = useState(() => isoDate(Date.now() - 30 * DAY_MS))
  const [end, setEnd] = useState(() => isoDate(Date.now()))
  const [minMag, setMinMag] = useState('4.5')
  const [viewOnly, setViewOnly] = useState(false)
  const [phase, setPhase] = useState<Phase>({ step: 'idle' })
  const ref = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const visible = useVisibleEvents()
  const windowHours = useStore((s) => s.windowHours)

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

  useEffect(() => () => abortRef.current?.abort(), [])

  const exportCurrent = () => {
    downloadCsv(
      `quakelive_live_${windowHours === 168 ? '7d' : '24h'}_${isoDate(Date.now())}.csv`,
      eventsToCsv(visible),
    )
    setPhase({ step: 'done', label: `Saved ${visible.length.toLocaleString()} events` })
  }

  const exportHistorical = async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const bounds = (() => {
      if (!viewOnly) return null
      const b = getMapInstance()?.getBounds()
      return b
        ? { minLat: b.getSouth(), maxLat: b.getNorth(), minLon: b.getWest(), maxLon: b.getEast() }
        : null
    })()
    const query: HistoricalQuery = {
      startIso: start,
      endIso: end,
      minMag: minMag === '' ? null : Number(minMag),
      bounds,
    }
    try {
      setPhase({ step: 'working', label: 'Counting matching events…' })
      const count = await countHistorical(query, controller.signal)
      if (count === 0) {
        setPhase({ step: 'error', label: 'No events match this query.' })
        return
      }
      if (count > API_ROW_LIMIT) {
        setPhase({
          step: 'error',
          label: `${count.toLocaleString()} events match — the archive serves at most ${API_ROW_LIMIT.toLocaleString()} per request. Narrow the dates, raise the magnitude, or tick “current map view”.`,
        })
        return
      }
      setPhase({ step: 'working', label: `Downloading ${count.toLocaleString()} events…` })
      const csv = await fetchHistoricalCsv(query, controller.signal)
      downloadCsv(`usgs_catalog_${start}_${end}${minMag ? `_M${minMag}+` : ''}.csv`, csv)
      setPhase({ step: 'done', label: `Saved ${count.toLocaleString()} events to CSV` })
    } catch (error) {
      if (controller.signal.aborted) return
      setPhase({ step: 'error', label: `The archive request failed (${(error as Error).message}).` })
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={`export-button ${open ? 'is-active' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Data <span aria-hidden="true">↓</span>
      </button>
      {open && (
        <div className="export-panel panel animate-fade-in">
          <p className="eyebrow">Research export · CSV</p>

          <button type="button" className="export-panel__quick" onClick={exportCurrent}>
            <strong>Export what&#39;s on screen</strong>
            <span>{visible.length.toLocaleString()} live events · past {windowHours === 168 ? '7 days' : '24 hours'}</span>
          </button>

          <div className="export-panel__divider"><span>or query the full USGS archive</span></div>

          <div className="export-panel__grid">
            <label>
              From
              <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label>
              To
              <input type="date" value={end} min={start} max={isoDate(Date.now())} onChange={(e) => setEnd(e.target.value)} />
            </label>
            <label>
              Min magnitude
              <select value={minMag} onChange={(e) => setMinMag(e.target.value)}>
                <option value="">All</option>
                <option value="2.5">2.5+</option>
                <option value="4.5">4.5+</option>
                <option value="5.5">5.5+</option>
                <option value="6.5">6.5+</option>
              </select>
            </label>
            <label className="export-panel__check">
              <input type="checkbox" checked={viewOnly} onChange={(e) => setViewOnly(e.target.checked)} />
              Current map view only
            </label>
          </div>

          <button
            type="button"
            className="export-panel__download"
            disabled={phase.step === 'working'}
            onClick={() => void exportHistorical()}
          >
            {phase.step === 'working' ? 'Working…' : 'Download archive CSV'}
          </button>

          {phase.step !== 'idle' && (
            <p className={`export-panel__status is-${phase.step}`} role="status">{phase.label}</p>
          )}
          <p className="export-panel__foot">
            Source: USGS earthquake catalogue (ComCat). Columns include time, coordinates,
            depth, magnitude and type, felt reports, PAGER alert, and significance.
          </p>
        </div>
      )}
    </div>
  )
}
