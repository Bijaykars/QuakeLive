import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// Energy per Gutenberg–Richter: E = 10^(1.5·M + 4.8) J. One whole magnitude step
// is 10^1.5 ≈ 31.6× the energy (and 10× the recorded ground motion).
const LADDER = [
  { m: 3, tnt: '≈ 0.5 t TNT', like: 'a large lightning bolt', perYear: '~130,000 / year' },
  { m: 4, tnt: '≈ 15 t TNT', like: 'a large conventional bomb', perYear: '~13,000 / year' },
  { m: 5, tnt: '≈ 480 t TNT', like: 'a city-block-scale explosion', perYear: '~1,300 / year' },
  { m: 6, tnt: '≈ 15 kt TNT', like: 'the Hiroshima bomb', perYear: '~130 / year' },
  { m: 7, tnt: '≈ 480 kt TNT', like: '32 Hiroshima bombs', perYear: '~15 / year' },
  { m: 8, tnt: '≈ 15 Mt TNT', like: 'the largest hydrogen-bomb tests', perYear: '~1 / year' },
  { m: 9, tnt: '≈ 480 Mt TNT', like: '2011 Japan · 2004 Sumatra', perYear: 'once in 10–20 years' },
]

const PICKS = Array.from({ length: 15 }, (_, i) => (2 + i * 0.5).toFixed(1))

function fmtTimes(x: number): string {
  if (x >= 1_000_000) return `${(x / 1_000_000).toPrecision(3)} million×`
  if (x >= 1000) return `${Math.round(x).toLocaleString()}×`
  if (x >= 10) return `${Math.round(x)}×`
  return `${x.toFixed(1)}×`
}

function Comparator() {
  const [a, setA] = useState('5.0')
  const [b, setB] = useState('7.0')
  const low = Math.min(Number(a), Number(b))
  const high = Math.max(Number(a), Number(b))
  const delta = high - low
  const energyRatio = 10 ** (1.5 * delta)
  const shakingRatio = 10 ** delta

  // Circle radii as spheres of TNT (∝ energy^⅓) — an honest, physical comparison.
  const bigR = 64
  const smallR = Math.max(2.5, bigR / 10 ** (0.5 * delta))

  return (
    <div className="mag-compare">
      <div className="mag-compare__controls">
        <label>
          Compare
          <select value={a} onChange={(e) => setA(e.target.value)}>
            {PICKS.map((p) => <option key={p} value={p}>M {p}</option>)}
          </select>
        </label>
        <span>with</span>
        <label>
          <span className="sr-only">Second magnitude</span>
          <select value={b} onChange={(e) => setB(e.target.value)}>
            {PICKS.map((p) => <option key={p} value={p}>M {p}</option>)}
          </select>
        </label>
      </div>

      <div className="mag-compare__figure" aria-hidden="true">
        <span style={{ width: smallR * 2, height: smallR * 2 }} />
        <span style={{ width: bigR * 2, height: bigR * 2 }} />
      </div>
      <p className="mag-compare__figure-note">
        Drawn as spheres of TNT — volume is proportional to released energy.
      </p>

      <p className="mag-compare__result">
        {delta === 0 ? (
          <>Same magnitude — same energy.</>
        ) : (
          <>
            A magnitude <strong>{high.toFixed(1)}</strong> releases{' '}
            <strong>{fmtTimes(energyRatio)}</strong> the energy of a magnitude{' '}
            <strong>{low.toFixed(1)}</strong>, with <strong>{fmtTimes(shakingRatio)}</strong> the
            recorded ground motion.
          </>
        )}
      </p>
      <p className="mag-compare__math">
        energy ratio = 10<sup>1.5 × ({high.toFixed(1)} − {low.toFixed(1)})</sup> = {fmtTimes(energyRatio)}
        {' · '}from E = 10<sup>1.5·M + 4.8</sup> J
      </p>
    </div>
  )
}

export function MagnitudesNavButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="export-button mag-nav-button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        Magnitudes
      </button>
      {open && <MagnitudeGuide onClose={() => setOpen(false)} />}
    </>
  )
}

export function MagnitudeGuide({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Portal: ancestor panels use backdrop-filter, which would trap position:fixed.
  return createPortal(
    <div className="mag-guide-overlay" onClick={onClose}>
      <div
        className="mag-guide panel"
        role="dialog"
        aria-modal="true"
        aria-label="Know your magnitudes"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mag-guide__header">
          <div>
            <span className="eyebrow">Know your magnitudes</span>
            <h2>One step up = ×32 the energy</h2>
            <p>
              Magnitude is logarithmic: each whole step multiplies released energy by
              10<sup>1.5</sup> ≈ 32 and recorded ground motion by 10. A magnitude 7 is not
              “a bit bigger” than a 5 — it is roughly 1,000 times more energetic.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close magnitude guide">×</button>
        </header>

        <Comparator />

        <div className="mag-ladder" role="list">
          {LADDER.map((row, i) => (
            <div key={row.m} role="listitem" className="mag-ladder__row">
              {i > 0 && <span className="mag-ladder__step" aria-hidden="true">×32 energy ↓</span>}
              <div className="mag-ladder__card">
                <strong>M {row.m}</strong>
                <div>
                  <span>{row.tnt} — about {row.like}</span>
                  <small>{row.perYear} worldwide</small>
                </div>
              </div>
            </div>
          ))}
        </div>

        <p className="mag-guide__foot">
          Energy from the Gutenberg–Richter relation E = 10<sup>1.5·M + 4.8</sup> joules
          (the same formula behind the energy estimates in event details). Frequencies are
          long-term global averages from the USGS catalogue. TNT comparisons describe seismic
          energy release, not destructive effect at the surface.
        </p>
      </div>
    </div>,
    document.body,
  )
}
