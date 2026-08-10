// Focal mechanism ("beachball") from the USGS moment-tensor / focal-mechanism products.
//
// Rendering approach: rather than approximating quadrants with circle geometry, the
// P-wave radiation sign u = γᵀ·M·γ is evaluated exactly for every pixel's ray in the
// lower-hemisphere equal-area projection. This is correct for any tensor, including
// non-double-couple components, and the nodal lines emerge exactly where u = 0.
import type { CanonicalEvent } from '../types'

export interface NodalPlane {
  strike: number
  dip: number
  rake: number
}

export interface Axis {
  azimuth: number
  plunge: number
}

export interface MechanismData {
  kind: 'moment-tensor' | 'focal-mechanism'
  mNED: [number, number, number, number, number, number] // Mnn, Mee, Mdd, Mne, Mnd, Med
  mw: number | null
  magType: string | null
  scalarMomentNm: number | null
  percentDC: number | null
  derivedDepthKm: number | null
  np1: NodalPlane | null
  np2: NodalPlane | null
  tAxis: Axis | null
  pAxis: Axis | null
  source: string | null
  reviewed: boolean
}

interface UsgsProduct {
  preferredWeight?: number
  source?: string
  status?: string
  properties?: Record<string, string>
}

interface UsgsDetail {
  properties?: {
    products?: Record<string, UsgsProduct[] | undefined>
  }
}

const num = (props: Record<string, string>, key: string): number | null => {
  const v = Number(props[key])
  return Number.isFinite(v) ? v : null
}

function plane(props: Record<string, string>, n: 1 | 2): NodalPlane | null {
  const strike = num(props, `nodal-plane-${n}-strike`)
  const dip = num(props, `nodal-plane-${n}-dip`)
  const rake = num(props, `nodal-plane-${n}-rake`) ?? num(props, `nodal-plane-${n}-slip`)
  return strike != null && dip != null && rake != null ? { strike, dip, rake } : null
}

function axis(props: Record<string, string>, name: 't' | 'p'): Axis | null {
  const azimuth = num(props, `${name}-axis-azimuth`)
  const plunge = num(props, `${name}-axis-plunge`)
  return azimuth != null && plunge != null ? { azimuth, plunge } : null
}

// Harvard/GCMT spherical components (r = up, t = south, p = east) → NED.
function tensorFromRtp(props: Record<string, string>): MechanismData['mNED'] | null {
  const mrr = num(props, 'tensor-mrr')
  const mtt = num(props, 'tensor-mtt')
  const mpp = num(props, 'tensor-mpp')
  const mrt = num(props, 'tensor-mrt')
  const mrp = num(props, 'tensor-mrp')
  const mtp = num(props, 'tensor-mtp')
  if (mrr == null || mtt == null || mpp == null || mrt == null || mrp == null || mtp == null) {
    return null
  }
  return [mtt, mpp, mrr, -mtp, mrt, -mrp]
}

// Pure double-couple tensor from strike/dip/rake (Aki & Richards, NED axes, unit moment).
export function tensorFromPlane({ strike, dip, rake }: NodalPlane): MechanismData['mNED'] {
  const d = Math.PI / 180
  const f = strike * d
  const dl = dip * d
  const l = rake * d
  const mnn = -(Math.sin(dl) * Math.cos(l) * Math.sin(2 * f) + Math.sin(2 * dl) * Math.sin(l) * Math.sin(f) ** 2)
  const mee = Math.sin(dl) * Math.cos(l) * Math.sin(2 * f) - Math.sin(2 * dl) * Math.sin(l) * Math.cos(f) ** 2
  const mdd = Math.sin(2 * dl) * Math.sin(l)
  const mne = Math.sin(dl) * Math.cos(l) * Math.cos(2 * f) + 0.5 * Math.sin(2 * dl) * Math.sin(l) * Math.sin(2 * f)
  const mnd = -(Math.cos(dl) * Math.cos(l) * Math.cos(f) + Math.cos(2 * dl) * Math.sin(l) * Math.sin(f))
  const med = -(Math.cos(dl) * Math.cos(l) * Math.sin(f) - Math.cos(2 * dl) * Math.sin(l) * Math.cos(f))
  return [mnn, mee, mdd, mne, mnd, med]
}

// P-wave first-motion amplitude for a ray leaving with the given takeoff/azimuth.
// takeoff measured from vertical-down, azimuth clockwise from north; both radians.
export function radiation(m: MechanismData['mNED'], azimuth: number, takeoff: number): number {
  const [mnn, mee, mdd, mne, mnd, med] = m
  const gn = Math.sin(takeoff) * Math.cos(azimuth)
  const ge = Math.sin(takeoff) * Math.sin(azimuth)
  const gd = Math.cos(takeoff)
  return (
    gn * gn * mnn + ge * ge * mee + gd * gd * mdd +
    2 * (gn * ge * mne + gn * gd * mnd + ge * gd * med)
  )
}

function parseProduct(product: UsgsProduct, kind: MechanismData['kind']): MechanismData | null {
  const props = product.properties ?? {}
  const np1 = plane(props, 1)
  let mNED = tensorFromRtp(props)
  if (!mNED) {
    if (!np1) return null
    mNED = tensorFromPlane(np1) // focal-mechanism products carry planes only
  }
  let percentDC = num(props, 'percent-double-couple')
  if (percentDC != null && percentDC <= 1) percentDC *= 100
  return {
    kind,
    mNED,
    mw: num(props, 'derived-magnitude'),
    magType: props['derived-magnitude-type'] ?? null,
    scalarMomentNm: num(props, 'scalar-moment'),
    percentDC,
    derivedDepthKm: num(props, 'derived-depth'),
    np1,
    np2: plane(props, 2),
    tAxis: axis(props, 't'),
    pAxis: axis(props, 'p'),
    source: product.source ?? null,
    reviewed: props['review-status']?.toLowerCase() === 'reviewed',
  }
}

export async function fetchMechanism(
  event: CanonicalEvent,
  signal: AbortSignal,
): Promise<MechanismData | null> {
  if (!event.detailUrl || !event.sources.usgs) return null
  const url = new URL(event.detailUrl)
  if (url.protocol !== 'https:' || !url.hostname.endsWith('usgs.gov')) return null
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`USGS detail HTTP ${response.status}`)
  const detail = await response.json() as UsgsDetail
  const products = detail.properties?.products

  for (const kind of ['moment-tensor', 'focal-mechanism'] as const) {
    const list = products?.[kind]
    if (!list?.length) continue
    const preferred = [...list].sort(
      (a, b) => (b.preferredWeight ?? 0) - (a.preferredWeight ?? 0),
    )
    for (const product of preferred) {
      const parsed = parseProduct(product, kind)
      if (parsed) return parsed
    }
  }
  return null
}

export function faultStyle(np: NodalPlane | null): { label: string; detail: string } | null {
  if (!np) return null
  const rake = np.rake
  if (rake >= 60 && rake <= 120) {
    return {
      label: 'Reverse (thrust) faulting',
      detail: 'One block was pushed up and over the other — the compressional style typical of subduction zones and colliding plates.',
    }
  }
  if (rake <= -60 && rake >= -120) {
    return {
      label: 'Normal faulting',
      detail: 'The crust was stretched and one block dropped down relative to the other — typical where plates pull apart.',
    }
  }
  if (Math.abs(rake) <= 30 || Math.abs(rake) >= 150) {
    return {
      label: 'Strike-slip faulting',
      detail: 'Two blocks slid horizontally past each other, like the motion of the San Andreas fault.',
    }
  }
  return {
    label: 'Oblique faulting',
    detail: 'The slip combined horizontal sliding with vertical motion — a mix of faulting styles.',
  }
}

export function fmtMoment(nm: number): string {
  const exp = Math.floor(Math.log10(nm))
  const mant = (nm / 10 ** exp).toFixed(2)
  return `${mant}×10^${exp} N·m`
}
