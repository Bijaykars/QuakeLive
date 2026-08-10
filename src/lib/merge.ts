// Dedup + canonicalization per plan §5.5. Pure functions — the store applies them.
import type { CanonicalEvent, EmscMessage, Revision, UsgsFeature } from '../types'
import { haversineKm } from './geo'
import { titleCase } from './format'

export const MATCH_SECONDS = 120
export const MATCH_KM = 100

export function parseIdList(s: string | null | undefined): string[] {
  if (!s) return []
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
}

export function canonicalFromUsgs(f: UsgsFeature, now: number): CanonicalEvent {
  const p = f.properties
  const [lon, lat, depth] = f.geometry.coordinates
  return {
    id: f.id,
    sources: { usgs: f.id },
    time: p.time,
    updated: p.updated,
    firstSeenAt: now,
    lat,
    lon,
    depthKm: depth == null || Number.isNaN(depth) ? null : depth,
    mag: p.mag,
    magType: p.magType,
    place: p.place ?? p.title ?? 'Unknown location',
    status: p.status === 'reviewed' ? 'reviewed' : 'automatic',
    feltCount: p.felt,
    cdi: p.cdi,
    mmi: p.mmi,
    alert: p.alert,
    tsunamiFlag: p.tsunami === 1,
    sig: p.sig,
    nst: p.nst,
    gap: p.gap,
    rms: p.rms,
    dmin: p.dmin,
    eventType: p.type ?? 'earthquake',
    detailUrl: p.detail ?? null,
    usgsUrl: p.url ?? null,
    revisions: [],
  }
}

export function canonicalFromEmsc(m: EmscMessage, now: number): CanonicalEvent | null {
  const p = m?.data?.properties
  if (!p?.unid) return null
  const time = Date.parse(p.time)
  const { lat, lon } = p
  if (!Number.isFinite(time) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
  // Use properties.depth (km, positive down) — geometry z sign convention differs (plan §16.3).
  const depth = Number.isFinite(p.depth) ? Math.abs(p.depth) : null
  return {
    id: `emsc:${p.unid}`,
    sources: { emsc: p.unid },
    time,
    updated: Date.parse(p.lastupdate) || now,
    firstSeenAt: now,
    lat,
    lon,
    depthKm: depth,
    mag: Number.isFinite(p.mag) ? p.mag : null,
    magType: p.magtype ?? null,
    place: p.flynn_region ? titleCase(p.flynn_region) : 'Unknown region',
    status: 'automatic',
    feltCount: null,
    cdi: null,
    mmi: null,
    alert: null,
    tsunamiFlag: false,
    sig: null,
    nst: null,
    gap: null,
    rms: null,
    dmin: null,
    eventType: 'earthquake',
    detailUrl: null,
    usgsUrl: null,
    revisions: [],
  }
}

export function isSameEvent(
  a: { time: number; lat: number; lon: number },
  b: { time: number; lat: number; lon: number },
): boolean {
  return (
    Math.abs(a.time - b.time) <= MATCH_SECONDS * 1000 && haversineKm(a, b) <= MATCH_KM
  )
}

// Revisions worth surfacing: mag ≥0.05, location >5 km, depth >10 km, status change.
export function diffRevisions(
  prev: CanonicalEvent,
  next: CanonicalEvent,
  at: number,
): Revision[] {
  const out: Revision[] = []
  if (prev.mag != null && next.mag != null && Math.abs(prev.mag - next.mag) >= 0.05) {
    out.push({ at, field: 'mag', from: prev.mag.toFixed(1), to: next.mag.toFixed(1) })
  }
  if (haversineKm(prev, next) > 5) {
    out.push({
      at,
      field: 'location',
      from: `${prev.lat.toFixed(2)}, ${prev.lon.toFixed(2)}`,
      to: `${next.lat.toFixed(2)}, ${next.lon.toFixed(2)}`,
    })
  }
  if (
    prev.depthKm != null &&
    next.depthKm != null &&
    Math.abs(prev.depthKm - next.depthKm) > 10
  ) {
    out.push({
      at,
      field: 'depth',
      from: `${prev.depthKm.toFixed(0)} km`,
      to: `${next.depthKm.toFixed(0)} km`,
    })
  }
  if (prev.status !== next.status) {
    out.push({ at, field: 'status', from: prev.status, to: next.status })
  }
  return out
}
