// Research CSV export. Historical data comes from the official USGS archive API
// (fdsnws-event), which serves the complete catalogue back to 1900 — no scraping.
import type { CanonicalEvent, UsgsFeature } from '../types'

const EVENT_API = 'https://earthquake.usgs.gov/fdsnws/event/1'
export const API_ROW_LIMIT = 20_000

export const CSV_COLUMNS = [
  'id', 'time_utc', 'latitude', 'longitude', 'depth_km', 'magnitude', 'mag_type',
  'place', 'event_type', 'status', 'felt_reports', 'cdi', 'mmi', 'pager_alert',
  'tsunami_flag', 'significance', 'network', 'url',
] as const

type CsvRow = Record<(typeof CSV_COLUMNS)[number], string | number | null>

function csvField(value: string | number | null): string {
  if (value == null) return ''
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

function toCsv(rows: CsvRow[]): string {
  const lines = [CSV_COLUMNS.join(',')]
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((c) => csvField(row[c])).join(','))
  }
  return lines.join('\n') + '\n'
}

function rowFromFeature(f: UsgsFeature): CsvRow {
  const p = f.properties
  const [lon, lat, depth] = f.geometry.coordinates
  return {
    id: f.id,
    time_utc: new Date(p.time).toISOString(),
    latitude: lat,
    longitude: lon,
    depth_km: depth,
    magnitude: p.mag,
    mag_type: p.magType,
    place: p.place,
    event_type: p.type,
    status: p.status,
    felt_reports: p.felt,
    cdi: p.cdi,
    mmi: p.mmi,
    pager_alert: p.alert,
    tsunami_flag: p.tsunami,
    significance: p.sig,
    network: p.net,
    url: p.url,
  }
}

function rowFromEvent(e: CanonicalEvent): CsvRow {
  return {
    id: e.id,
    time_utc: new Date(e.time).toISOString(),
    latitude: e.lat,
    longitude: e.lon,
    depth_km: e.depthKm,
    magnitude: e.mag,
    mag_type: e.magType,
    place: e.place,
    event_type: e.eventType,
    status: e.status,
    felt_reports: e.feltCount,
    cdi: e.cdi,
    mmi: e.mmi,
    pager_alert: e.alert,
    tsunami_flag: e.tsunamiFlag ? 1 : 0,
    significance: e.sig,
    network: e.sources.usgs ? e.id.slice(0, 2) : 'emsc',
    url: e.usgsUrl,
  }
}

export function eventsToCsv(events: CanonicalEvent[]): string {
  return toCsv(events.map(rowFromEvent))
}

export interface HistoricalQuery {
  startIso: string // YYYY-MM-DD
  endIso: string
  minMag: number | null
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number } | null
}

function queryParams(q: HistoricalQuery): URLSearchParams {
  const params = new URLSearchParams({
    starttime: q.startIso,
    endtime: `${q.endIso}T23:59:59`,
    orderby: 'time',
  })
  if (q.minMag != null) params.set('minmagnitude', String(q.minMag))
  if (q.bounds) {
    params.set('minlatitude', q.bounds.minLat.toFixed(3))
    params.set('maxlatitude', q.bounds.maxLat.toFixed(3))
    // The API accepts -360…360, so map-view longitudes across the dateline pass through.
    params.set('minlongitude', q.bounds.minLon.toFixed(3))
    params.set('maxlongitude', q.bounds.maxLon.toFixed(3))
  }
  return params
}

export async function countHistorical(q: HistoricalQuery, signal: AbortSignal): Promise<number> {
  const response = await fetch(`${EVENT_API}/count?${queryParams(q)}`, { signal })
  if (!response.ok) throw new Error(`USGS count HTTP ${response.status}`)
  const count = Number((await response.text()).trim())
  if (!Number.isFinite(count)) throw new Error('Unreadable count response')
  return count
}

export async function fetchHistoricalCsv(q: HistoricalQuery, signal: AbortSignal): Promise<string> {
  const params = queryParams(q)
  params.set('format', 'geojson')
  params.set('limit', String(API_ROW_LIMIT))
  const response = await fetch(`${EVENT_API}/query?${params}`, { signal })
  if (!response.ok) throw new Error(`USGS query HTTP ${response.status}`)
  const feed = await response.json() as { features: UsgsFeature[] }
  return toCsv(feed.features.map(rowFromFeature))
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
