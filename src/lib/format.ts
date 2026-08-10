// Formatting + encoding rules per plan §8.4 and §9.6.

export function fmtMag(m: number | null): string {
  return m == null ? 'M —' : `M ${m.toFixed(1)}`
}

export function fmtMagBare(m: number | null): string {
  return m == null ? '—' : m.toFixed(1)
}

export function fmtDepth(d: number | null): string {
  return d == null ? 'depth —' : `${d.toFixed(1)} km`
}

export function fmtCoords(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lon >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(3)}°${ns} ${Math.abs(lon).toFixed(3)}°${ew}`
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export function relTime(t: number, now: number): string {
  const s = Math.round((t - now) / 1000)
  const abs = Math.abs(s)
  if (abs < 60) return rtf.format(s, 'second')
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  return rtf.format(Math.round(s / 86400), 'day')
}

const utcFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  hour12: false,
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})
const localFmt = new Intl.DateTimeFormat(undefined, {
  hour12: false,
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
})

export function fmtUtc(t: number): string {
  return `${utcFmt.format(t)} UTC`
}

export function fmtLocal(t: number): string {
  return localFmt.format(t)
}

export function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s(,-])\p{L}/gu, (c) => c.toUpperCase())
}

// --- visual encodings ---

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const H = 3_600_000
const AGE_STOPS: Array<[number, string]> = [
  [0.25 * H, '#FFE8A3'],
  [1 * H, '#FFC96B'],
  [6 * H, '#E08E45'],
  [24 * H, '#8A6B4E'],
  [Infinity, '#5C6470'],
]

export function ageColorHex(ageMs: number): string {
  for (const [max, hex] of AGE_STOPS) if (ageMs < max) return hex
  return '#5C6470'
}

export function ageColorRgba(ageMs: number): [number, number, number, number] {
  const [r, g, b] = hexToRgb(ageColorHex(ageMs))
  const a = Math.round(255 - Math.min(1, Math.max(0, ageMs / (24 * H))) * 115)
  return [r, g, b, a]
}

const DEPTH_STOPS: Array<[number, string]> = [
  [10, '#F5D90A'],
  [35, '#E0812E'],
  [70, '#B84A9C'],
  [300, '#7B3FD1'],
  [Infinity, '#3D2E8C'],
]

export function depthColorHex(km: number | null): string {
  if (km == null) return '#565D69'
  for (const [max, hex] of DEPTH_STOPS) if (km < max) return hex
  return '#3D2E8C'
}

export function depthColorRgba(km: number | null): [number, number, number, number] {
  const [r, g, b] = hexToRgb(depthColorHex(km))
  return [r, g, b, 235]
}

// Size = magnitude (plan §8.4): area reads as an energy proxy.
export function magRadiusPx(m: number | null): number {
  if (m == null) return 3
  return Math.min(46, Math.max(2, 2 + 2.2 * Math.pow(1.55, m - 3)))
}
