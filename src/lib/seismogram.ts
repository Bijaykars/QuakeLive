// Nearest-station seismogram via EarthScope/IRIS FDSN web services (CORS-enabled).
// USGS distributes wave-derived products; raw waveforms live in this archive —
// it is the same place the USGS event pages link for "Waveforms".
import { haversineKm } from './geo'
import type { CanonicalEvent } from '../types'

// service.iris.edu (legacy host) no longer sends CORS headers — use the EarthScope host.
// fedcatalog (not fdsnws-station) because it lists only channels whose waveforms the
// timeseries service can actually serve — regional networks archive elsewhere.
const STATION_URL = 'https://service.earthscope.org/irisws/fedcatalog/1/query'
const TIMESERIES_URL = 'https://service.earthscope.org/irisws/timeseries/1/query'
const TRAVELTIME_URL = 'https://service.earthscope.org/irisws/traveltime/1/query'

export const PRE_SECONDS = 60
export const DURATION_SECONDS = 600
// Broadband first: BHZ (~20–40 sps) keeps the payload small; HHZ (100 sps) is the fallback.
const CHANNEL_PRIORITY = ['BHZ', 'HHZ', 'EHZ', 'SHZ']
const KM_PER_DEG = 111.195

export interface SeismogramData {
  network: string
  station: string
  channel: string
  distanceKm: number
  distanceDeg: number
  sampleRate: number
  startTimeMs: number
  samples: number[] // raw digitizer counts, demeaned
  pArrivalS: number | null // seconds after origin (iasp91 prediction)
  sArrivalS: number | null
  peakAbs: number
  peakAtS: number // seconds after origin when |amplitude| peaks
}

function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

// The timeseries service rejects a trailing 'Z'; it expects bare ISO.
function isoNoZ(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, '')
}

// Temporary-deployment networks (codes starting 0-9, X, Y, Z) rarely have open waveforms.
function isTemporaryNetwork(net: string): boolean {
  return /^[0-9XYZ]/.test(net)
}

interface StationRow {
  net: string
  sta: string
  loc: string
  cha: string
  distanceKm: number
}

async function nearestStations(
  event: CanonicalEvent,
  signal: AbortSignal,
): Promise<StationRow[]> {
  const params = new URLSearchParams({
    latitude: event.lat.toFixed(4),
    longitude: event.lon.toFixed(4),
    maxradius: '30',
    channel: 'BHZ,HHZ',
    level: 'channel',
    format: 'text',
    targetservice: 'timeseries',
    starttime: iso(event.time),
    endtime: iso(event.time + DURATION_SECONDS * 1000),
  })
  const response = await fetch(`${STATION_URL}?${params}`, { signal })
  if (response.status === 404 || response.status === 204) return []
  if (!response.ok) throw new Error(`station HTTP ${response.status}`)
  const text = await response.text()

  const rows: StationRow[] = []
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const f = line.split('|')
    const lat = Number(f[4])
    const lon = Number(f[5])
    if (f.length < 6 || !Number.isFinite(lat) || !Number.isFinite(lon)) continue
    rows.push({
      net: f[0],
      sta: f[1],
      loc: f[2],
      cha: f[3],
      distanceKm: haversineKm(event, { lat, lon }),
    })
  }
  rows.sort(
    (a, b) =>
      a.distanceKm - b.distanceKm ||
      CHANNEL_PRIORITY.indexOf(a.cha) - CHANNEL_PRIORITY.indexOf(b.cha),
  )
  return rows
}

interface Trace {
  samples: number[]
  sampleRate: number
  startTimeMs: number
}

async function fetchTrace(
  row: StationRow,
  event: CanonicalEvent,
  signal: AbortSignal,
): Promise<Trace | null> {
  const params = new URLSearchParams({
    net: row.net,
    sta: row.sta,
    loc: row.loc || '--',
    cha: row.cha,
    starttime: isoNoZ(event.time - PRE_SECONDS * 1000),
    duration: String(PRE_SECONDS + DURATION_SECONDS),
    demean: 'true',
    format: 'geocsv',
  })
  const response = await fetch(`${TIMESERIES_URL}?${params}`, { signal })
  if (response.status === 404 || response.status === 204 || response.status === 400) return null
  if (!response.ok) throw new Error(`timeseries HTTP ${response.status}`)
  const text = await response.text()

  let sampleRate = 0
  let startTimeMs = 0
  const samples: number[] = []
  for (const line of text.split('\n')) {
    if (!line) continue
    if (line.startsWith('#')) {
      const rate = line.match(/sample_rate_hz[^:]*:\s*([\d.]+)/i)
      if (rate) sampleRate = Number(rate[1])
      continue
    }
    const comma = line.indexOf(',')
    if (comma < 0) continue
    const value = Number(line.slice(comma + 1))
    if (!Number.isFinite(value)) continue // skips the "Time, Sample" header row
    if (samples.length === 0) {
      const t = Date.parse(line.slice(0, comma))
      if (!Number.isFinite(t)) continue
      startTimeMs = t
    }
    samples.push(value)
  }
  if (samples.length < 50 || !startTimeMs) return null
  if (!sampleRate) sampleRate = samples.length / (PRE_SECONDS + DURATION_SECONDS)
  return { samples, sampleRate, startTimeMs }
}

async function fetchArrivals(
  distanceDeg: number,
  depthKm: number,
  signal: AbortSignal,
): Promise<{ p: number | null; s: number | null }> {
  const params = new URLSearchParams({
    distdeg: distanceDeg.toFixed(3),
    evdepth: Math.max(0, depthKm).toFixed(1),
    phases: 'p,P,s,S',
    noheader: 'true',
  })
  const response = await fetch(`${TRAVELTIME_URL}?${params}`, { signal })
  if (!response.ok) return { p: null, s: null }
  const text = await response.text()
  let p: number | null = null
  let s: number | null = null
  for (const line of text.split('\n')) {
    const f = line.trim().split(/\s+/)
    if (f.length < 4) continue
    const phase = f[2]
    const t = Number(f[3])
    if (!Number.isFinite(t)) continue
    if (p == null && phase.toLowerCase().startsWith('p')) p = t
    if (s == null && phase.toLowerCase().startsWith('s')) s = t
  }
  return { p, s }
}

// Research CSV: '#' metadata lines (pandas: read_csv(..., comment='#')), then samples.
export function seismogramToCsv(data: SeismogramData, event: CanonicalEvent): string {
  const lines = [
    `# QuakeLive seismogram export`,
    `# event_id: ${event.id}`,
    `# event_place: ${event.place}`,
    `# event_origin_utc: ${new Date(event.time).toISOString()}`,
    `# event_magnitude: ${event.mag ?? 'unknown'}`,
    `# station: ${data.network} ${data.station} ${data.channel}`,
    `# station_distance_km: ${data.distanceKm.toFixed(1)}`,
    `# sample_rate_hz: ${data.sampleRate}`,
    `# units: raw digitizer counts, demeaned (instrument response not removed)`,
    `# predicted_p_arrival_s_after_origin: ${data.pArrivalS?.toFixed(2) ?? 'unavailable'}`,
    `# predicted_s_arrival_s_after_origin: ${data.sArrivalS?.toFixed(2) ?? 'unavailable'}`,
    `# source: EarthScope/IRIS FDSN irisws-timeseries`,
    'time_utc,seconds_after_origin,amplitude_counts',
  ]
  const startS = (data.startTimeMs - event.time) / 1000
  for (let i = 0; i < data.samples.length; i++) {
    const t = startS + i / data.sampleRate
    lines.push(
      `${new Date(data.startTimeMs + (i / data.sampleRate) * 1000).toISOString()},${t.toFixed(3)},${data.samples[i]}`,
    )
  }
  return lines.join('\n') + '\n'
}

export async function fetchSeismogram(
  event: CanonicalEvent,
  signal: AbortSignal,
): Promise<SeismogramData | null> {
  const stations = await nearestStations(event, signal)

  const seen = new Set<string>()
  const candidates: StationRow[] = []
  for (const row of stations) {
    if (isTemporaryNetwork(row.net)) continue
    const key = `${row.net}.${row.sta}` // one attempt per station
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push(row)
    if (candidates.length >= 12) break
  }

  // The archive holds no data for many listed stations (regional networks archive
  // elsewhere), so probe in parallel waves of 4 and keep the nearest hit.
  let winner: { row: StationRow; trace: Trace } | null = null
  for (let wave = 0; wave < candidates.length && !winner; wave += 4) {
    const results = await Promise.all(
      candidates.slice(wave, wave + 4).map(async (row) => ({
        row,
        trace: await fetchTrace(row, event, signal).catch(() => null),
      })),
    )
    winner = results.find((r): r is { row: StationRow; trace: Trace } => r.trace != null) ?? null
  }

  if (winner) {
    const { row, trace } = winner

    const distanceDeg = row.distanceKm / KM_PER_DEG
    const arrivals = await fetchArrivals(distanceDeg, event.depthKm ?? 10, signal)
      .catch(() => ({ p: null, s: null }))

    let peakAbs = 0
    let peakIndex = 0
    for (let i = 0; i < trace.samples.length; i++) {
      const a = Math.abs(trace.samples[i])
      if (a > peakAbs) {
        peakAbs = a
        peakIndex = i
      }
    }

    return {
      network: row.net,
      station: row.sta,
      channel: row.cha,
      distanceKm: row.distanceKm,
      distanceDeg,
      sampleRate: trace.sampleRate,
      startTimeMs: trace.startTimeMs,
      samples: trace.samples,
      pArrivalS: arrivals.p,
      sArrivalS: arrivals.s,
      peakAbs,
      peakAtS: (trace.startTimeMs - event.time) / 1000 + peakIndex / trace.sampleRate,
    }
  }
  return null
}
