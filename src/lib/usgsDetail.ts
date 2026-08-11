// Shared access to the USGS ComCat event-detail document and its products.
// The detail JSON is fetched once per event and cached: the map (ShakeMap contours),
// the moment tensor, the ground-motion curves and every panel below all read from it.
import type { CanonicalEvent } from '../types'

export interface UsgsProduct {
  preferredWeight?: number
  source?: string
  properties?: Record<string, string>
  contents?: Record<string, { url?: string; bytes?: string; length?: number }>
}

export interface UsgsDetail {
  properties?: {
    products?: Record<string, UsgsProduct[] | undefined>
  }
}

export function trustedUsgsUrl(raw: string | undefined): URL | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && url.hostname.endsWith('usgs.gov') ? url : null
  } catch {
    return null
  }
}

const cache = new Map<string, Promise<UsgsDetail | null>>()
const CACHE_MAX = 24

// The promise is shared, so it deliberately ignores per-caller abort signals; each
// caller checks its own signal after awaiting. A cancelled panel still warms the cache.
export function fetchDetail(
  event: Pick<CanonicalEvent, 'detailUrl' | 'sources'>,
): Promise<UsgsDetail | null> {
  const url = event.sources.usgs ? trustedUsgsUrl(event.detailUrl ?? undefined) : null
  if (!url) return Promise.resolve(null)
  const key = url.toString()

  const hit = cache.get(key)
  if (hit) return hit

  const pending = fetch(key)
    .then((r) => (r.ok ? (r.json() as Promise<UsgsDetail>) : null))
    .catch(() => {
      cache.delete(key) // transient failures should not be cached
      return null
    })

  cache.set(key, pending)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
  return pending
}

export function preferredProduct(
  detail: UsgsDetail | null,
  type: string,
): UsgsProduct | null {
  const list = detail?.properties?.products?.[type]
  if (!list?.length) return null
  return [...list].sort((a, b) => (b.preferredWeight ?? 0) - (a.preferredWeight ?? 0))[0] ?? null
}

export async function fetchProductJson<T>(
  product: UsgsProduct | null,
  contentNames: string[],
  signal: AbortSignal,
): Promise<T | null> {
  for (const name of contentNames) {
    const url = trustedUsgsUrl(product?.contents?.[name]?.url)
    if (!url) continue
    const response = await fetch(url, { signal })
    if (!response.ok) continue
    return (await response.json()) as T
  }
  return null
}

const num = (v: string | undefined): number | null => {
  const n = Number(v)
  return v != null && Number.isFinite(n) ? n : null
}

// --- inline text products (no extra request: the payload ships inside the detail JSON) ---

export interface TextBlock {
  kind: 'heading' | 'paragraph' | 'bullet'
  text: string
}

// USGS ships these as HTML. Parsed inertly via DOMParser and read as text only —
// no markup is ever injected into the page.
function parseInlineHtml(html: string): TextBlock[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const blocks: TextBlock[] = []
  for (const el of doc.body.querySelectorAll('h1, h2, h3, h4, p, li')) {
    const text = el.textContent?.replace(/\s+/g, ' ').trim()
    if (!text) continue
    const tag = el.tagName.toLowerCase()
    blocks.push({
      kind: tag === 'li' ? 'bullet' : tag === 'p' ? 'paragraph' : 'heading',
      text,
    })
  }
  if (blocks.length === 0) {
    const flat = doc.body.textContent?.replace(/\s+/g, ' ').trim()
    if (flat) blocks.push({ kind: 'paragraph', text: flat })
  }
  return blocks
}

function inlineText(detail: UsgsDetail | null, type: string): TextBlock[] | null {
  const bytes = preferredProduct(detail, type)?.contents?.['']?.bytes
  if (!bytes) return null
  const blocks = parseInlineHtml(bytes)
  return blocks.length ? blocks : null
}

export interface GroundFailureAlert {
  kind: 'Landslide' | 'Liquefaction'
  level: string
  populationLevel: string | null
  maxProbability: number | null
}

export interface EventContext {
  tectonicSummary: TextBlock[] | null
  impactText: TextBlock[] | null
  groundFailure: GroundFailureAlert[]
  dyfiResponses: number | null
  pagerAlert: string | null
  pagerMaxMmi: number | null
  hasAftershockForecast: boolean
  hasDyfi: boolean
  hasPager: boolean
}

// Everything here comes free with the detail document already fetched elsewhere.
export function readEventContext(detail: UsgsDetail | null): EventContext {
  const groundFailureProduct = preferredProduct(detail, 'ground-failure')
  const gfProps = groundFailureProduct?.properties ?? {}
  const groundFailure: GroundFailureAlert[] = []
  for (const [key, kind] of [
    ['landslide', 'Landslide'],
    ['liquefaction', 'Liquefaction'],
  ] as const) {
    const level = gfProps[`${key}-alert`]
    if (!level) continue
    groundFailure.push({
      kind,
      level,
      populationLevel: gfProps[`${key}-population-alert-value`] ?? null,
      maxProbability: num(gfProps[`${key}-hazard-alert-value`]),
    })
  }

  const dyfi = preferredProduct(detail, 'dyfi')
  const pager = preferredProduct(detail, 'losspager')

  return {
    tectonicSummary: inlineText(detail, 'general-text'),
    impactText: inlineText(detail, 'impact-text'),
    groundFailure,
    dyfiResponses: num(dyfi?.properties?.['num-responses'] ?? dyfi?.properties?.numResp),
    pagerAlert: pager?.properties?.alertlevel ?? null,
    pagerMaxMmi: num(pager?.properties?.maxmmi),
    hasAftershockForecast: preferredProduct(detail, 'oaf') != null,
    hasDyfi: dyfi != null,
    hasPager: pager != null,
  }
}

// --- aftershock forecast (oaf/forecast.json) ---

interface OafBin {
  magnitude: number
  probability: number
  p95minimum: number
  p95maximum: number
}
interface OafWindow {
  timeStart?: number
  timeEnd?: number
  label?: string
  bins?: OafBin[]
}
interface OafForecast {
  forecast?: OafWindow[]
  model?: { parameters?: Record<string, number> }
  advisoryTimeFrame?: string
}

export interface AftershockWindow {
  label: string
  rows: Array<{ magnitude: number; probability: number; p95max: number }>
}

export async function fetchAftershockForecast(
  detail: UsgsDetail | null,
  signal: AbortSignal,
): Promise<AftershockWindow[] | null> {
  const data = await fetchProductJson<OafForecast>(
    preferredProduct(detail, 'oaf'),
    ['forecast.json'],
    signal,
  )
  if (!data?.forecast?.length) return null

  const windows: AftershockWindow[] = []
  for (const w of data.forecast) {
    const rows = (w.bins ?? [])
      .filter((b) => b.magnitude >= 3 && b.magnitude <= 7)
      .map((b) => ({
        magnitude: b.magnitude,
        probability: b.probability,
        p95max: b.p95maximum,
      }))
    if (!rows.length) continue
    const label = w.label
      ?? (w.timeStart != null && w.timeEnd != null
        ? `${Math.round((w.timeEnd - w.timeStart) / 86_400_000)} days`
        : 'Window')
    windows.push({ label, rows })
  }
  return windows.length ? windows : null
}

// --- "Did You Feel It?" intensity vs distance ---

interface DyfiPlotSeries {
  legend?: string
  class?: string
  data?: Array<{ x: number; y: number }>
}
interface DyfiPlot {
  datasets?: DyfiPlotSeries[]
}

export interface FeltCurve {
  reports: Array<{ distanceKm: number; intensity: number }>
  binned: Array<{ distanceKm: number; intensity: number }>
}

export async function fetchFeltCurve(
  detail: UsgsDetail | null,
  signal: AbortSignal,
): Promise<FeltCurve | null> {
  const data = await fetchProductJson<DyfiPlot>(
    preferredProduct(detail, 'dyfi'),
    ['dyfi_plot_atten.json'],
    signal,
  )
  if (!data?.datasets?.length) return null

  // Series are identified by `class`: scatterplot1 = individual reports,
  // median / binned = the aggregated trend line.
  const pick = (match: RegExp): Array<{ distanceKm: number; intensity: number }> =>
    (data.datasets ?? [])
      .filter((d) => match.test(d.class ?? d.legend ?? ''))
      .flatMap((d) => d.data ?? [])
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x > 0)
      .map((p) => ({ distanceKm: p.x, intensity: p.y }))

  const binned = pick(/^median$/i)
  const reports = pick(/^scatterplot/i)
  const all = reports.length ? reports : pick(/./)
  if (!all.length && !binned.length) return null
  return { reports: all, binned: binned.sort((a, b) => a.distanceKm - b.distanceKm) }
}

// --- PAGER loss estimates ---

interface PagerAlertBin {
  color?: string
  // USGS serialises these bounds as strings ("0", "1", "10", …).
  bins?: Array<{ min?: string | number; max?: string | number | null; probability?: number }>
  type?: string
  level?: string
}
interface PagerAlerts {
  economic?: PagerAlertBin
  fatality?: PagerAlertBin
}

export interface LossOutlook {
  kind: 'Fatalities' | 'Economic losses'
  level: string | null
  bins: Array<{ label: string; probability: number }>
}

function rangeLabel(
  rawMin: string | number | undefined,
  rawMax: string | number | null | undefined,
  money: boolean,
): string {
  const toNum = (v: string | number | null | undefined): number | null => {
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  // PAGER publishes economic bins in millions of USD ("units":"USD", bin 100–1000
  // is the $100M–$1B band behind an orange alert).
  const fmt = (v: number) => {
    if (money) {
      if (v >= 1e6) return `$${(v / 1e6).toLocaleString()}T`
      if (v >= 1000) return `$${(v / 1000).toLocaleString()}B`
      if (v >= 1) return `$${v.toLocaleString()}M`
      return `$${Math.round(v * 1000).toLocaleString()}k`
    }
    return v.toLocaleString()
  }
  const min = toNum(rawMin)
  const max = toNum(rawMax)
  if (min == null) return '—'
  if (max == null) return `${fmt(min)}+`
  return `${fmt(min)}–${fmt(max)}`
}

export async function fetchLossOutlook(
  detail: UsgsDetail | null,
  signal: AbortSignal,
): Promise<LossOutlook[] | null> {
  const data = await fetchProductJson<PagerAlerts>(
    preferredProduct(detail, 'losspager'),
    ['json/alerts.json', 'alerts.json'],
    signal,
  )
  if (!data) return null

  const out: LossOutlook[] = []
  for (const [key, kind, money] of [
    ['fatality', 'Fatalities', false],
    ['economic', 'Economic losses', true],
  ] as const) {
    const group = data[key]
    const bins = (group?.bins ?? [])
      .map((b) => ({
        label: rangeLabel(b.min, b.max, money),
        probability: Math.round((b.probability ?? 0) * 100),
      }))
      .filter((b) => b.probability > 0)
    if (!bins.length) continue
    out.push({ kind, level: group?.level ?? null, bins })
  }
  return out.length ? out : null
}

// --- observed phase picks (phase-data/quakeml.xml) ---

export interface PhasePick {
  network: string
  station: string
  channel: string
  phase: string
  timeMs: number
  secondsAfterOrigin: number
  residual: number | null
  distanceDeg: number | null
  azimuth: number | null
  manual: boolean
}

// QuakeML joins <arrival> (phase, residual, geometry) to <pick> (station, absolute
// time) through pickID. Parsed with DOMParser — text extraction only, no markup use.
export async function fetchPhasePicks(
  detail: UsgsDetail | null,
  originMs: number,
  signal: AbortSignal,
): Promise<PhasePick[] | null> {
  const url = trustedUsgsUrl(
    preferredProduct(detail, 'phase-data')?.contents?.['quakeml.xml']?.url,
  )
  if (!url) return null
  const response = await fetch(url, { signal })
  if (!response.ok) return null
  const doc = new DOMParser().parseFromString(await response.text(), 'application/xml')
  if (doc.querySelector('parsererror')) return null

  const text = (parent: Element, selector: string): string | null =>
    parent.querySelector(selector)?.textContent?.trim() ?? null

  const picks = new Map<string, { net: string; sta: string; cha: string; timeMs: number; manual: boolean }>()
  for (const pick of doc.querySelectorAll('pick')) {
    // A <pick> carries its identity in the publicID attribute; <arrival> refers to it
    // through a <pickID> child element.
    const id = pick.getAttribute('publicID')
    const iso = pick.querySelector('time > value')?.textContent?.trim()
    const wf = pick.querySelector('waveformID')
    if (!id || !iso || !wf) continue
    const timeMs = Date.parse(iso)
    if (!Number.isFinite(timeMs)) continue
    picks.set(id, {
      net: wf.getAttribute('networkCode') ?? '',
      sta: wf.getAttribute('stationCode') ?? '',
      cha: wf.getAttribute('channelCode') ?? '',
      timeMs,
      manual: text(pick, 'evaluationMode') === 'manual',
    })
  }

  const num2 = (v: string | null): number | null => {
    if (v == null) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  const out: PhasePick[] = []
  for (const arrival of doc.querySelectorAll('arrival')) {
    const id = text(arrival, 'pickID')
    const pick = id ? picks.get(id) : undefined
    const phase = text(arrival, 'phase')
    if (!pick || !phase) continue
    out.push({
      network: pick.net,
      station: pick.sta,
      channel: pick.cha,
      phase,
      timeMs: pick.timeMs,
      secondsAfterOrigin: (pick.timeMs - originMs) / 1000,
      residual: num2(text(arrival, 'timeResidual')),
      distanceDeg: num2(text(arrival, 'distance')),
      azimuth: num2(text(arrival, 'azimuth')),
      manual: pick.manual,
    })
  }
  return out.length ? out : null
}

// --- ShakeMap finite rupture polygon ---

type Ring = GeoJSON.Position[]

function ringArea(ring: Ring): number {
  let sum = 0
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  }
  return Math.abs(sum / 2)
}

// USGS rupture files describe 3-D fault planes, with each disjoint segment as its own
// ring. Two things follow:
//   1. Those extra rings are "holes" under GeoJSON, so the raw geometry is invalid —
//      each ring has to become its own polygon.
//   2. A near-vertical fault (strike-slip: Ridgecrest, Türkiye) projects to zero map
//      area, so no fill can ever show it. Those are emitted as lines — the fault trace —
//      while dipping ruptures (subduction: Kamchatka) keep their real footprint.
function normalizeRupture(collection: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []

  for (const feature of collection.features) {
    const geometry = feature.geometry
    if (!geometry) continue
    const rings: Ring[] =
      geometry.type === 'MultiPolygon' ? geometry.coordinates.flat()
      : geometry.type === 'Polygon' ? geometry.coordinates
      : []
    if (!rings.length) continue

    const solid = rings.filter((r) => ringArea(r) > 1e-9)
    const flat = rings.filter((r) => ringArea(r) <= 1e-9)

    if (solid.length) {
      features.push({
        type: 'Feature',
        properties: { ...feature.properties, ruptureKind: 'area' },
        geometry: { type: 'MultiPolygon', coordinates: solid.map((r) => [r]) },
      })
    }
    if (flat.length) {
      features.push({
        type: 'Feature',
        properties: { ...feature.properties, ruptureKind: 'trace' },
        geometry: { type: 'MultiLineString', coordinates: flat },
      })
    }
  }

  return { type: 'FeatureCollection', features }
}

export async function fetchRupture(
  detail: UsgsDetail | null,
  signal: AbortSignal,
): Promise<GeoJSON.FeatureCollection | null> {
  const data = await fetchProductJson<GeoJSON.FeatureCollection>(
    preferredProduct(detail, 'shakemap'),
    ['download/rupture.json'],
    signal,
  )
  if (!data || data.type !== 'FeatureCollection' || !data.features?.length) return null
  // Point-only rupture files are just the epicentre restated — nothing to draw.
  const normalized = normalizeRupture(data)
  return normalized.features.length ? normalized : null
}
