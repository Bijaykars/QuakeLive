// Multi-agency moment tensors from EMSC's mtws service — the only browser-reachable
// route to the Global CMT catalogue, alongside NEIC, GFZ, GEOSCOPE and others.
import { haversineKm } from './geo'
import type { MechanismData, NodalPlane } from './momentTensor'
import type { CanonicalEvent } from '../types'

const MTWS_URL = 'https://www.seismicportal.eu/mtws/api/search'
const MATCH_WINDOW_S = 90
const MATCH_RADIUS_KM = 400

interface MtwsRow {
  mt_source_catalog?: string
  mt_preferred?: boolean
  mt_mw?: number
  mt_depth?: number
  mt_per_dc?: number
  mt_m0?: number
  mt_m0_exp?: number
  mt_tensor_exp?: number
  mt_mrr?: number
  mt_mtt?: number
  mt_mpp?: number
  mt_mrt?: number
  mt_mrp?: number
  mt_mtp?: number
  mt_strike_1?: number
  mt_dip_1?: number
  mt_rake_1?: number
  mt_strike_2?: number
  mt_dip_2?: number
  mt_rake_2?: number
  mt_taz?: number
  mt_tplung?: number
  mt_paz?: number
  mt_pplung?: number
  ev_event_time?: string
  ev_latitude?: number
  ev_longitude?: number
  ev_region?: string
}

export interface AgencySolution {
  agency: string
  isGcmt: boolean
  preferred: boolean
  mw: number | null
  depthKm: number | null
  percentDC: number | null
  scalarMomentNm: number | null
  np1: NodalPlane | null
  mechanism: MechanismData | null
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19)
}

// mtws reports the tensor in spherical (r, t, p) components → NED, matching momentTensor.
function tensorToNed(row: MtwsRow): MechanismData['mNED'] | null {
  const { mt_mrr, mt_mtt, mt_mpp, mt_mrt, mt_mrp, mt_mtp } = row
  if ([mt_mrr, mt_mtt, mt_mpp, mt_mrt, mt_mrp, mt_mtp].some((v) => v == null)) return null
  return [mt_mtt!, mt_mpp!, mt_mrr!, -mt_mtp!, mt_mrt!, -mt_mrp!]
}

function plane(s?: number, d?: number, r?: number): NodalPlane | null {
  return s != null && d != null && r != null ? { strike: s, dip: d, rake: r } : null
}

export async function fetchAgencySolutions(
  event: CanonicalEvent,
  signal: AbortSignal,
): Promise<AgencySolution[] | null> {
  const params = new URLSearchParams({
    format: 'json',
    starttime: iso(event.time - MATCH_WINDOW_S * 1000),
    endtime: iso(event.time + MATCH_WINDOW_S * 1000),
  })
  const response = await fetch(`${MTWS_URL}?${params}`, { signal })
  if (!response.ok) throw new Error(`mtws HTTP ${response.status}`)
  const payload = await response.json() as Record<string, MtwsRow>
  // The service returns an object keyed "0", "1", … rather than a JSON array.
  const rows = Object.values(payload ?? {}).filter((r) => r && typeof r === 'object')

  const solutions: AgencySolution[] = []
  for (const row of rows) {
    if (row.ev_latitude == null || row.ev_longitude == null) continue
    // The window can span unrelated quakes, so require spatial proximity too.
    const km = haversineKm(event, { lat: row.ev_latitude, lon: row.ev_longitude })
    if (km > MATCH_RADIUS_KM) continue

    const agency = (row.mt_source_catalog ?? '').toUpperCase()
    if (!agency) continue
    const mNED = tensorToNed(row)
    const np1 = plane(row.mt_strike_1, row.mt_dip_1, row.mt_rake_1)
    const exp = row.mt_m0_exp
    solutions.push({
      agency,
      isGcmt: agency === 'GCMT',
      preferred: row.mt_preferred === true,
      mw: row.mt_mw ?? null,
      depthKm: row.mt_depth ?? null,
      percentDC: row.mt_per_dc ?? null,
      scalarMomentNm: row.mt_m0 != null && exp != null ? row.mt_m0 * 10 ** exp : null,
      np1,
      mechanism: mNED
        ? {
            kind: 'moment-tensor',
            mNED,
            mw: row.mt_mw ?? null,
            magType: 'Mw',
            scalarMomentNm: null,
            percentDC: row.mt_per_dc ?? null,
            derivedDepthKm: row.mt_depth ?? null,
            np1,
            np2: plane(row.mt_strike_2, row.mt_dip_2, row.mt_rake_2),
            tAxis: row.mt_taz != null && row.mt_tplung != null
              ? { azimuth: row.mt_taz, plunge: row.mt_tplung }
              : null,
            pAxis: row.mt_paz != null && row.mt_pplung != null
              ? { azimuth: row.mt_paz, plunge: row.mt_pplung }
              : null,
            source: agency,
            reviewed: false,
          }
        : null,
    })
  }

  if (solutions.length < 2) return null // nothing to compare against
  // Deduplicate agencies, keeping the preferred/GCMT entry, then GCMT first.
  const byAgency = new Map<string, AgencySolution>()
  for (const s of solutions) {
    const seen = byAgency.get(s.agency)
    if (!seen || (s.preferred && !seen.preferred)) byAgency.set(s.agency, s)
  }
  return [...byAgency.values()].sort(
    (a, b) => Number(b.isGcmt) - Number(a.isGcmt) || a.agency.localeCompare(b.agency),
  )
}

// Spread across agencies is the honest measure of how settled a solution is.
export function magnitudeSpread(solutions: AgencySolution[]): { min: number; max: number } | null {
  const mags = solutions.map((s) => s.mw).filter((m): m is number => m != null)
  return mags.length > 1 ? { min: Math.min(...mags), max: Math.max(...mags) } : null
}
