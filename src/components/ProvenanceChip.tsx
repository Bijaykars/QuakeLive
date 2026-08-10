// The four provenance labels (plan hard rule 2). Every data block carries one.
const VARIANTS = {
  reported: { label: 'Reported', cls: 'text-ink-mid border-hairline' },
  official: { label: 'Official product', cls: 'text-accent border-accent/25 bg-accent/10' },
  calculated: { label: 'Calculated by this app', cls: 'text-ink-mid border-hairline bg-white/5' },
  estimate: { label: 'Educational estimate', cls: 'text-warn border-warn/25 bg-warn/10' },
} as const

export type ProvenanceKind = keyof typeof VARIANTS

export function ProvenanceChip({ kind, source }: { kind: ProvenanceKind; source?: string }) {
  const v = VARIANTS[kind]
  return (
    <span
      className={`font-data inline-block rounded border px-1.5 py-0.5 text-[9.5px] tracking-wider uppercase ${v.cls}`}
    >
      {v.label}
      {source ? ` · ${source}` : ''}
    </span>
  )
}
