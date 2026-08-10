import type { CanonicalEvent } from '../types'

type CurveKey = 'MMI' | 'PGA' | 'PGV' | 'SA(0.3)' | 'SA(1.0)' | 'SA(3.0)'

interface CurveSeries {
  mean?: number[]
  stddev?: number[]
}

interface AttenuationCurves {
  gmpe?: { soil?: Partial<Record<CurveKey, CurveSeries>> }
  distances?: { rjb?: number[]; rrup?: number[] }
}

interface ShakemapProduct {
  preferredWeight?: number
  source?: string
  properties?: {
    'map-status'?: string
    'review-status'?: string
    'version'?: string
    'shakemap-code-version'?: string
  }
  contents?: Record<string, { url?: string }>
}

interface UsgsDetail {
  properties?: { products?: { shakemap?: ShakemapProduct[] } }
}

export interface GroundMotionMetric {
  key: CurveKey
  label: string
  median: number
  lower68: number
  upper68: number
  unit: 'MMI' | '%g' | 'cm/s'
  mu: number
  sigma: number
  logarithmic: boolean
}

export interface GroundMotionAnalysis {
  metrics: GroundMotionMetric[]
  rjbKm: number
  rrupKm: number | null
  mapStatus: string
  productVersion: string | null
  codeVersion: string | null
  source: string | null
}

const METRICS: Array<{ key: CurveKey; label: string; unit: GroundMotionMetric['unit'] }> = [
  { key: 'PGA', label: 'PGA', unit: '%g' },
  { key: 'PGV', label: 'PGV', unit: 'cm/s' },
  { key: 'SA(0.3)', label: 'SA 0.3 s', unit: '%g' },
  { key: 'SA(1.0)', label: 'SA 1.0 s', unit: '%g' },
  { key: 'SA(3.0)', label: 'SA 3.0 s', unit: '%g' },
  { key: 'MMI', label: 'MMI', unit: 'MMI' },
]

function trustedUsgsUrl(raw: string): URL | null {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && url.hostname.endsWith('usgs.gov') ? url : null
  } catch {
    return null
  }
}

function nearestEpicentralIndex(distances: number[]): number {
  let nearest = 0
  for (let index = 1; index < distances.length; index += 1) {
    if (Math.abs(distances[index]) < Math.abs(distances[nearest])) nearest = index
  }
  return nearest
}

function calculateMetric(
  definition: (typeof METRICS)[number],
  curve: CurveSeries | undefined,
  index: number,
): GroundMotionMetric | null {
  const mu = curve?.mean?.[index]
  const sigma = curve?.stddev?.[index]
  if (!Number.isFinite(mu) || !Number.isFinite(sigma) || sigma == null || mu == null) return null

  if (definition.key === 'MMI') {
    return {
      ...definition,
      median: mu,
      lower68: Math.max(1, mu - sigma),
      upper68: Math.min(10, mu + sigma),
      mu,
      sigma,
      logarithmic: false,
    }
  }

  const scale = definition.unit === '%g' ? 100 : 1
  return {
    ...definition,
    median: Math.exp(mu) * scale,
    lower68: Math.exp(mu - sigma) * scale,
    upper68: Math.exp(mu + sigma) * scale,
    mu,
    sigma,
    logarithmic: true,
  }
}

export async function fetchGroundMotionAnalysis(
  event: CanonicalEvent,
  signal: AbortSignal,
): Promise<GroundMotionAnalysis | null> {
  if (!event.detailUrl || !event.sources.usgs) return null
  const detailUrl = trustedUsgsUrl(event.detailUrl)
  if (!detailUrl) return null

  const detailResponse = await fetch(detailUrl, { signal })
  if (!detailResponse.ok) throw new Error(`USGS detail HTTP ${detailResponse.status}`)
  const detail = await detailResponse.json() as UsgsDetail
  const products = detail.properties?.products?.shakemap
  if (!products?.length) return null

  const product = [...products].sort(
    (a, b) => (b.preferredWeight ?? 0) - (a.preferredWeight ?? 0),
  )[0]
  const curveContent = product?.contents?.['download/attenuation_curves.json']
  if (!curveContent?.url) return null
  const curveUrl = trustedUsgsUrl(curveContent.url)
  if (!curveUrl) return null

  const curveResponse = await fetch(curveUrl, { signal })
  if (!curveResponse.ok) throw new Error(`USGS attenuation curves HTTP ${curveResponse.status}`)
  const curves = await curveResponse.json() as AttenuationCurves
  const rjb = curves.distances?.rjb
  if (!rjb?.length || !curves.gmpe?.soil) return null

  const index = nearestEpicentralIndex(rjb)
  const metrics = METRICS
    .map((definition) => calculateMetric(definition, curves.gmpe?.soil?.[definition.key], index))
    .filter((metric): metric is GroundMotionMetric => metric != null)
  if (!metrics.length) return null

  return {
    metrics,
    rjbKm: rjb[index],
    rrupKm: curves.distances?.rrup?.[index] ?? null,
    mapStatus: product.properties?.['review-status']
      ?? product.properties?.['map-status']
      ?? 'unknown',
    productVersion: product.properties?.version ?? null,
    codeVersion: product.properties?.['shakemap-code-version'] ?? null,
    source: product.source ?? null,
  }
}
