// Radiated-energy estimate per plan §7.3. Only for moment-magnitude types.
const MW_TYPES = new Set(['mw', 'mww', 'mwc', 'mwb', 'mwr'])

export function isMwType(magType: string | null): boolean {
  return magType != null && MW_TYPES.has(magType.toLowerCase())
}

export function radiatedEnergyJ(mag: number | null, magType: string | null): number | null {
  if (mag == null || !isMwType(magType)) return null
  return 10 ** (1.5 * mag + 4.8) // Gutenberg–Richter relation as presented by USGS
}

const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻',
}

export function fmtEnergy(j: number): string {
  const exp = Math.floor(Math.log10(j))
  const mant = (j / 10 ** exp).toFixed(1)
  const supExp = String(exp).split('').map((c) => SUP[c] ?? c).join('')
  return `≈ ${mant}×10${supExp} J`
}

// Hiroshima bomb ≈ 15 kt TNT ≈ 6.3e13 J. Shown only when the comparison is meaningful.
export function fmtHiroshima(j: number): string | null {
  const bombs = j / 6.276e13
  if (bombs < 0.05) return null
  if (bombs < 10) return `≈ ${bombs.toFixed(1)}× the Hiroshima bomb`
  return `≈ ${Math.round(bombs).toLocaleString()}× the Hiroshima bomb`
}

export function fmtTnt(j: number): string {
  const tons = j / 4.184e9
  if (tons < 1_000) return `≈ ${tons.toPrecision(2)} t TNT`
  if (tons < 1_000_000) return `≈ ${(tons / 1_000).toPrecision(2)} kt TNT`
  return `≈ ${(tons / 1_000_000).toPrecision(2)} Mt TNT`
}
