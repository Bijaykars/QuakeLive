import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { ProvenanceChip } from './ProvenanceChip'
import { SeismogramSection } from './Seismogram'
import { BeachballSection } from './Beachball'
import { fmtCoords, fmtDepth, fmtLocal, fmtMagBare, fmtUtc, relTime } from '../lib/format'
import { fmtEnergy, fmtHiroshima, fmtTnt, radiatedEnergyJ } from '../lib/energy'
import { fmtRuptureLength, globalRarity, ruptureLengthKm } from '../lib/context'
import {
  fetchGroundMotionAnalysis,
  type GroundMotionAnalysis,
  type GroundMotionMetric,
} from '../lib/shakemapGroundMotion'
import type { CanonicalEvent } from '../types'

const MAGTYPE_INFO: Record<string, string> = {
  mww: 'Moment magnitude calculated from W-phase data.',
  mwc: 'Moment magnitude calculated from a centroid solution.',
  mwb: 'Moment magnitude calculated from body waves.',
  mwr: 'Regional moment magnitude.',
  mw: 'Moment magnitude, suited to comparing large earthquakes.',
  mb: 'Short-period body-wave magnitude.',
  ml: 'Local magnitude, commonly called Richter magnitude.',
  md: 'Magnitude calculated from signal duration.',
  ms: 'Magnitude calculated from surface waves.',
}

const PAGER_COLORS: Record<string, string> = {
  green: '#4ade80',
  yellow: '#facc15',
  orange: '#fb923c',
  red: '#fb7185',
}

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="fact-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  )
}

function mmiDescription(mmi: number | null): string {
  if (mmi == null) return 'Not reported'
  if (mmi < 2) return 'Not felt'
  if (mmi < 3) return 'Weak'
  if (mmi < 4) return 'Light'
  if (mmi < 5) return 'Moderate'
  if (mmi < 6) return 'Strong'
  if (mmi < 7) return 'Very strong'
  if (mmi < 8) return 'Severe'
  if (mmi < 9) return 'Violent'
  return 'Extreme'
}

function eventSummary(event: CanonicalEvent): string {
  const magnitude = event.mag
  const depth = event.depthKm
  const scale = magnitude == null
    ? 'An earthquake with an unconfirmed magnitude'
    : magnitude < 3 ? 'A small earthquake'
    : magnitude < 5 ? 'A light to moderate earthquake'
    : magnitude < 6 ? 'A strong earthquake'
    : magnitude < 7 ? 'A major earthquake'
    : 'A very large earthquake'
  const depthNote = depth == null
    ? ''
    : depth < 35 ? ' Its shallow depth can make shaking feel stronger near the epicentre.'
    : depth > 300 ? ' Its great depth usually spreads weaker shaking across a wider area.'
    : depth > 70 ? ' Its intermediate depth can allow shaking to be noticed over a broad area.'
    : ''
  return `${scale} occurred ${event.place}.${depthNote}`
}

const num = (value: number | null, digits = 0, unit = ''): string =>
  value == null ? 'Not available' : `${value.toFixed(digits)}${unit}`

function fmtGroundMotion(value: number, unit: GroundMotionMetric['unit']): string {
  const digits = unit === 'MMI' ? 1 : value < 0.01 ? 4 : value < 1 ? 3 : value < 10 ? 2 : 1
  return `${value.toFixed(digits)}${unit === 'MMI' ? '' : ` ${unit}`}`
}

export function EventDrawer() {
  const selectedId = useStore((s) => s.selectedId)
  const events = useStore((s) => s.events)
  const shakingOverlay = useStore((s) => s.shakingOverlay)
  const select = useStore((s) => s.select)
  const event = selectedId ? events.get(selectedId) : undefined
  const headingRef = useRef<HTMLHeadingElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const [groundMotion, setGroundMotion] = useState<{
    status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
    data: GroundMotionAnalysis | null
  }>({ status: 'idle', data: null })

  useEffect(() => {
    if (!event) return
    const previous = document.activeElement as HTMLElement | null
    setCopied(false)
    contentRef.current?.scrollTo({ top: 0 })
    headingRef.current?.focus()
    return () => previous?.focus?.()
  }, [event?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!event) return
    const controller = new AbortController()
    setGroundMotion({ status: 'loading', data: null })
    void fetchGroundMotionAnalysis(event, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return
        setGroundMotion(data
          ? { status: 'ready', data }
          : { status: 'unavailable', data: null })
      })
      .catch(() => {
        if (!controller.signal.aborted) setGroundMotion({ status: 'error', data: null })
      })
    return () => controller.abort()
  }, [event?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!event) return null

  const now = Date.now()
  const significant = event.mag != null && event.mag >= 6
  const energy = radiatedEnergyJ(event.mag, event.magType)
  const rarity = globalRarity(event.mag)
  const rupture = ruptureLengthKm(event.mag, event.magType)
  const hiroshima = energy != null ? fmtHiroshima(energy) : null
  const magnitudeInfo = MAGTYPE_INFO[event.magType?.toLowerCase() ?? '']
  const latencySeconds = Math.max(0, Math.round((event.firstSeenAt - event.time) / 1000))
  const sourceLabel = event.sources.usgs ? 'USGS' : 'EMSC preliminary'
  const shakingStatus = shakingOverlay.eventId === event.id ? shakingOverlay.status : 'idle'
  const officialUrl = event.usgsUrl ?? (event.sources.emsc
    ? `https://www.seismicportal.eu/eventdetails.html?unid=${event.sources.emsc}`
    : null)

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <aside
      role="dialog"
      aria-labelledby="event-detail-title"
      className="event-drawer panel animate-slide-in"
    >
      <header className="event-drawer__hero">
        <button type="button" aria-label="Close earthquake details" onClick={() => select(null)} className="drawer-close">
          <span>Close</span><i aria-hidden="true">×</i>
        </button>
        <span className="eyebrow">Earthquake detail</span>
        <div className="event-drawer__title-row">
          <div className={`drawer-magnitude ${significant ? 'is-significant' : ''}`}>
            <small>Magnitude</small>
            <strong>{fmtMagBare(event.mag)}</strong>
          </div>
          <div>
            <h2 ref={headingRef} tabIndex={-1} id="event-detail-title">{event.place}</h2>
            <p>{relTime(event.time, now)} <span aria-hidden="true">•</span> {fmtUtc(event.time)}</p>
          </div>
        </div>
        <div className="event-drawer__badges">
          <span className={`source-badge ${event.status === 'reviewed' ? 'is-reviewed' : ''}`}>{event.status}</span>
          <span className="source-badge">{sourceLabel}</span>
          {event.alert && (
            <span className="source-badge" style={{ color: PAGER_COLORS[event.alert], borderColor: `${PAGER_COLORS[event.alert]}55` }}>
              PAGER {event.alert}
            </span>
          )}
          {event.tsunamiFlag && <span className="source-badge is-warning">Tsunami flag</span>}
        </div>
      </header>

      {event.tsunamiFlag && (
        <a className="tsunami-notice" href="https://www.tsunami.gov" target="_blank" rel="noopener noreferrer">
          Check official tsunami information <span aria-hidden="true">↗</span>
        </a>
      )}

      <div className="event-drawer__content select-text" ref={contentRef}>
          <div className="drawer-sections">
            <section className="metric-grid" aria-label="Key earthquake facts">
              <Fact label="Depth" value={fmtDepth(event.depthKm)} note={event.depthKm != null && event.depthKm < 35 ? 'Shallow' : undefined} />
              <Fact label="Max shaking" value={event.mmi == null ? '—' : `MMI ${event.mmi.toFixed(1)}`} note={mmiDescription(event.mmi)} />
              <Fact label="Felt reports" value={event.feltCount == null ? '—' : event.feltCount.toLocaleString()} note={event.feltCount == null ? 'Not reported' : 'Submitted to USGS'} />
              <Fact label="PAGER impact" value={event.alert ? event.alert[0].toUpperCase() + event.alert.slice(1) : '—'} note={event.alert ? 'Official estimate' : 'Not issued'} />
            </section>

            <section className="insight-card">
              <div className="section-heading">
                <div><span className="eyebrow">In plain language</span><h3>What this event means</h3></div>
                <ProvenanceChip kind="calculated" />
              </div>
              <p>{eventSummary(event)}</p>
              <small>This explanation is a guide, not a damage assessment. Local geology and buildings strongly affect shaking.</small>
            </section>

            {rarity && (
              <section className="drawer-section">
                <div className="section-heading">
                  <div><span className="eyebrow">Global context</span><h3>How common is this size?</h3></div>
                  <ProvenanceChip kind="calculated" />
                </div>
                <p className="rarity-headline">{rarity.headline}</p>
                <p className="rarity-detail">{rarity.detail}</p>
                <small className="section-note">Long-term global averages from the USGS earthquake catalogue. Frequency in any one region differs greatly.</small>
              </section>
            )}

            <section className="drawer-section">
              <div className="section-heading">
                <div><span className="eyebrow">Map interpretation</span><h3>Shaking reach</h3></div>
                <ProvenanceChip
                  kind={shakingStatus === 'official' ? 'official' : 'estimate'}
                  source={shakingStatus === 'official' ? 'USGS ShakeMap' : undefined}
                />
              </div>
              {shakingStatus === 'official' ? (
                <div className="shaking-reach">
                  <strong>Official intensity contours are shown on the map.</strong>
                  <p>The coloured lines are USGS Modified Mercalli Intensity contours. They are the geographic shaking product; the larger animated pulse is a separate visual effect.</p>
                  <small>ShakeMap estimates shaking, not damage. Conditions can vary sharply with geology, buildings, and distance.</small>
                </div>
              ) : shakingStatus === 'loading' ? (
                <div className="shaking-reach">
                  <strong>Checking for an official ShakeMap…</strong>
                  <p>The animated rings appear immediately while the source product is checked.</p>
                </div>
              ) : (
                <div className="shaking-reach">
                  <strong>No geographic shaking extent is published for this event.</strong>
                  <p>The expanding rings are a magnitude-scaled visual animation only—not an affected-area, felt-distance, or damage estimate.</p>
                </div>
              )}
            </section>

            <section className="drawer-section">
              <div className="section-heading">
                <div><span className="eyebrow">Calculated context</span><h3>Estimated radiated energy</h3></div>
                <ProvenanceChip kind="estimate" />
              </div>
              {energy != null ? (
                <div className="energy-readout">
                  <strong>{fmtEnergy(energy)}</strong>
                  <span>{fmtTnt(energy)}{hiroshima ? ` · ${hiroshima}` : ''}</span>
                  {rupture != null && (
                    <span className="rupture-note">
                      Fault rupture length {fmtRuptureLength(rupture)} (Wells–Coppersmith average)
                    </span>
                  )}
                  <p>Estimated from magnitude using a Gutenberg–Richter relation. Actual radiated energy varies by rupture.</p>
                </div>
              ) : (
                <p className="section-empty">Not estimated because this event does not use a moment-magnitude type.</p>
              )}
            </section>

            <section className="drawer-section">
              <div className="section-heading">
                <div><span className="eyebrow">Data journey</span><h3>How quickly it appeared</h3></div>
                <ProvenanceChip kind="calculated" />
              </div>
              <p className="latency-readout">
                <strong>{latencySeconds < 90 ? `${latencySeconds} seconds` : relTime(event.time, event.firstSeenAt).replace(' ago', '')}</strong>
                after the reported origin time
              </p>
              {event.sources.emsc && event.sources.usgs && <small className="section-note">First pushed by EMSC, then enriched with USGS data.</small>}
            </section>

            <div className="drawer-divider"><span>Technical detail</span></div>

            <section className="drawer-section">
              <div className="section-heading">
                <div><span className="eyebrow">Reported values</span><h3>Source facts</h3></div>
                <ProvenanceChip kind="reported" source={sourceLabel} />
              </div>
              <div className="technical-grid">
                <Fact label="Coordinates" value={fmtCoords(event.lat, event.lon)} />
                <Fact label="Local time" value={fmtLocal(event.time)} />
                <Fact label="Magnitude type" value={event.magType ?? 'Not available'} />
                <Fact label="Significance" value={num(event.sig)} />
                <Fact label="Stations" value={num(event.nst)} />
                <Fact label="Azimuthal gap" value={num(event.gap, 0, '°')} />
                <Fact label="RMS residual" value={num(event.rms, 2, ' s')} />
                <Fact label="Nearest station" value={num(event.dmin, 2, '°')} />
              </div>
              {magnitudeInfo && <p className="definition"><strong>{event.magType}</strong> — {magnitudeInfo}</p>}
              {event.eventType !== 'earthquake' && <p className="event-type-note">Source event type: {event.eventType}</p>}
            </section>

            <BeachballSection key={`bb-${event.id}`} event={event} />
            <SeismogramSection key={event.id} event={event} />

            <section className="drawer-section ground-motion-analysis">
              <div className="section-heading">
                <div><span className="eyebrow">Engineering detail</span><h3>Ground-motion calculation</h3></div>
                <ProvenanceChip kind="calculated" source="USGS inputs" />
              </div>

              {(groundMotion.status === 'idle' || groundMotion.status === 'loading') && (
                <p className="section-empty">Loading the preferred USGS ShakeMap model curves…</p>
              )}

              {groundMotion.status === 'error' && (
                <p className="section-empty">The ShakeMap calculation file could not be loaded. The basic event feed is still available above.</p>
              )}

              {groundMotion.status === 'unavailable' && (
                <div className="shaking-reach">
                  <strong>No ShakeMap ground-motion model is published for this event.</strong>
                  <p>PGA, PGV and spectral acceleration cannot be responsibly derived from magnitude, depth and epicentre alone without choosing a ground-motion model, rupture geometry and site condition.</p>
                </div>
              )}

              {groundMotion.status === 'ready' && groundMotion.data && (
                <>
                  <p className="ground-motion-basis">
                    Evaluated at the nearest published soil-curve point to the epicentre:
                    {' '}<strong>Rjb {groundMotion.data.rjbKm.toFixed(2)} km</strong>
                    {groundMotion.data.rrupKm != null && <> · <strong>Rrup {groundMotion.data.rrupKm.toFixed(2)} km</strong></>}.
                  </p>
                  <div className="technical-grid ground-motion-grid">
                    {groundMotion.data.metrics.map((metric) => (
                      <Fact
                        key={metric.key}
                        label={metric.label}
                        value={metric.unit === 'MMI'
                          ? `MMI ${fmtGroundMotion(metric.median, metric.unit)}`
                          : fmtGroundMotion(metric.median, metric.unit)}
                        note={`68% range ${fmtGroundMotion(metric.lower68, metric.unit)}–${fmtGroundMotion(metric.upper68, metric.unit)} · μ ${metric.mu.toFixed(3)}, σ ${metric.sigma.toFixed(3)}`}
                      />
                    ))}
                  </div>

                  <div className="calculation-trail">
                    <strong>Calculation trail</strong>
                    <ol>
                      <li>The preferred USGS ShakeMap product supplies soil attenuation curves and distance measures.</li>
                      <li><code>Rjb</code> is the shortest horizontal distance to the rupture projection; <code>Rrup</code> is the shortest three-dimensional rupture distance.</li>
                      <li>For PGA, PGV and 5%-damped SA, ShakeMap publishes μ and σ in natural-log units.</li>
                      <li>The app calculates the median as <code>exp(μ)</code> and the one-standard-deviation interval as <code>exp(μ − σ)</code> to <code>exp(μ + σ)</code>—approximately 68% under the model assumptions.</li>
                      <li>Acceleration is converted from g to %g using <code>100 × g</code>. MMI uses <code>μ ± σ</code> directly and is clipped to the I–X scale.</li>
                    </ol>
                  </div>

                  <p className="ground-motion-meta">
                    ShakeMap {groundMotion.data.productVersion ? `v${groundMotion.data.productVersion}` : 'product'}
                    {' · '}{groundMotion.data.mapStatus}
                    {groundMotion.data.codeVersion ? ` · engine ${groundMotion.data.codeVersion}` : ''}
                    {groundMotion.data.source ? ` · source ${groundMotion.data.source.toUpperCase()}` : ''}
                  </p>
                  <p className="technical-caveat">The displayed uncertainty is ground-motion model spread at this distance, not hypocentre-location uncertainty or a site-specific confidence limit. Screening information only—not a code design spectrum or a substitute for geotechnical and structural analysis.</p>
                </>
              )}
            </section>

            <section className="drawer-section">
              <div className="section-heading">
                <div><span className="eyebrow">While watching</span><h3>Observed revisions</h3></div>
                <ProvenanceChip kind="reported" />
              </div>
              {event.revisions.length === 0 ? (
                <p className="section-empty">No changes have been observed during this session.</p>
              ) : (
                <ol className="revision-list">
                  {event.revisions.map((revision, index) => (
                    <li key={`${revision.at}-${index}`}>
                      <time>{fmtUtc(revision.at).slice(12)}</time>
                      <span><strong>{revision.field}</strong> changed from {revision.from} to {revision.to}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
      </div>

      <footer className="event-drawer__footer">
        <button type="button" onClick={copyLink}>{copied ? 'Link copied' : 'Copy link'}</button>
        {officialUrl && (
          <a href={officialUrl} target="_blank" rel="noopener noreferrer">
            View official event <span aria-hidden="true">↗</span>
          </a>
        )}
      </footer>
    </aside>
  )
}
