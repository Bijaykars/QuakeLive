import { useEffect, useRef, useState } from 'react'
import { ProvenanceChip } from './ProvenanceChip'
import { drawBeachball } from './Beachball'
import {
  fetchAgencySolutions,
  magnitudeSpread,
  type AgencySolution,
} from '../lib/agencyTensors'
import type { CanonicalEvent } from '../types'

const AGENCY_NAMES: Record<string, string> = {
  GCMT: 'Global CMT (Harvard)',
  NEIC: 'USGS NEIC',
  GFZ: 'GFZ Potsdam',
  SC4: 'EMSC SeisComP',
  AUST: 'Geoscience Australia',
  OCA: 'Géoazur / OCA',
  CPPT: 'CEA Tahiti',
  IPGP: 'IPGP GEOSCOPE',
  MED_RCMT: 'INGV Med-RCMT',
}

function MiniBeachball({ solution }: { solution: AgencySolution }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (ref.current && solution.mechanism) {
      drawBeachball(ref.current, solution.mechanism, { axes: false })
    }
  }, [solution])
  if (!solution.mechanism) return <span className="agency-row__nobb" aria-hidden="true" />
  return <canvas ref={ref} className="agency-row__bb" aria-hidden="true" />
}

const deg = (v: number | null | undefined): string => (v == null ? '—' : `${Math.round(v)}°`)

export function AgencyComparisonSection({ event }: { event: CanonicalEvent }) {
  const [solutions, setSolutions] = useState<AgencySolution[] | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setSolutions(null)
    void fetchAgencySolutions(event, controller.signal)
      .then((s) => { if (!controller.signal.aborted) setSolutions(s) })
      .catch(() => {})
    return () => controller.abort()
  }, [event.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!solutions?.length) return null
  const spread = magnitudeSpread(solutions)

  return (
    <section className="drawer-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Independent solutions</span>
          <h3>How agencies compare</h3>
        </div>
        <ProvenanceChip kind="reported" source="EMSC mtws" />
      </div>

      {spread && spread.max - spread.min >= 0.05 && (
        <p className="agency-spread">
          {solutions.length} agencies published a solution, ranging{' '}
          <strong>Mw {spread.min.toFixed(1)}–{spread.max.toFixed(1)}</strong>. Independent
          analyses of the same earthquake rarely agree exactly.
        </p>
      )}

      <div className="agency-list" role="list">
        {solutions.map((s) => (
          <div key={s.agency} role="listitem" className={`agency-row ${s.isGcmt ? 'is-gcmt' : ''}`}>
            <MiniBeachball solution={s} />
            <div className="agency-row__body">
              <strong>
                {AGENCY_NAMES[s.agency] ?? s.agency}
                {s.isGcmt && <i>reference catalogue</i>}
              </strong>
              <span>
                {s.np1
                  ? `strike ${deg(s.np1.strike)} · dip ${deg(s.np1.dip)} · rake ${deg(s.np1.rake)}`
                  : 'nodal planes not published'}
              </span>
            </div>
            <div className="agency-row__nums">
              <strong>{s.mw != null ? `Mw ${s.mw.toFixed(1)}` : '—'}</strong>
              <span>
                {s.depthKm != null ? `${Math.round(s.depthKm)} km` : '— km'}
                {s.percentDC != null ? ` · ${Math.round(s.percentDC)}% DC` : ''}
              </span>
            </div>
          </div>
        ))}
      </div>

      <small className="section-note">
        Each beachball is drawn from that agency&#39;s own published tensor. Differences come
        from the station networks, velocity models and inversion methods each group uses —
        not from any of them being wrong.
      </small>
    </section>
  )
}
