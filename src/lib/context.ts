// Plain-language context calculations shown in the event drawer.
import { isMwType } from './energy'

// USGS long-term global averages per year (M5+ observed since 1900; M3–4 estimated).
const FREQUENCY_BANDS: Array<{ min: number; perYear: number; band: string }> = [
  { min: 8, perYear: 1, band: 'magnitude 8 or higher' },
  { min: 7, perYear: 15, band: 'magnitude 7 range' },
  { min: 6, perYear: 134, band: 'magnitude 6 range' },
  { min: 5, perYear: 1319, band: 'magnitude 5 range' },
  { min: 4, perYear: 13_000, band: 'magnitude 4 range' },
  { min: 3, perYear: 130_000, band: 'magnitude 3 range' },
]

export interface Rarity {
  headline: string
  detail: string
}

function intervalPhrase(perYear: number): string {
  const days = 365.25 / perYear
  if (days >= 300) return 'about once a year'
  if (days >= 1.5) return `roughly one every ${Math.round(days)} days`
  const hours = days * 24
  if (hours >= 1.5) return `roughly one every ${Math.round(hours)} hours`
  return `roughly one every ${Math.max(1, Math.round(hours * 60))} minutes`
}

export function globalRarity(mag: number | null): Rarity | null {
  if (mag == null) return null
  if (mag < 3) {
    return {
      headline: 'Millions per year worldwide',
      detail: 'Earthquakes this small happen constantly around the globe. Almost none are felt by people — they are detected only by instruments.',
    }
  }
  const band = FREQUENCY_BANDS.find((b) => mag >= b.min)
  if (!band) return null
  return {
    headline: band.perYear === 1
      ? 'About once a year worldwide'
      : `About ${band.perYear.toLocaleString()} per year worldwide`,
    detail: `On long-term global averages, earthquakes in the ${band.band} occur ${intervalPhrase(band.perYear)} somewhere on Earth.`,
  }
}

// Wells & Coppersmith (1994), all slip types: log10(rupture length km) = -3.22 + 0.69 Mw.
// The regression is built from M ~4.8–8.1 surface ruptures and moment magnitudes only.
export function ruptureLengthKm(mag: number | null, magType: string | null): number | null {
  if (mag == null || mag < 4.8 || !isMwType(magType)) return null
  return 10 ** (-3.22 + 0.69 * mag)
}

export function fmtRuptureLength(km: number): string {
  return km < 10 ? `≈ ${km.toFixed(1)} km` : `≈ ${Math.round(km)} km`
}
