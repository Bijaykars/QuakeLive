// Data contracts per plan §5 (live_earthquake_explorer_plan_2026-08-06.md)

export interface UsgsFeatureProps {
  mag: number | null
  place: string | null
  time: number
  updated: number
  url: string
  detail: string
  felt: number | null
  cdi: number | null
  mmi: number | null
  alert: 'green' | 'yellow' | 'orange' | 'red' | null
  status: 'automatic' | 'reviewed' | 'deleted'
  tsunami: 0 | 1
  sig: number | null
  net: string
  code: string
  ids: string
  sources: string
  types: string
  nst: number | null
  dmin: number | null
  rms: number | null
  gap: number | null
  magType: string | null
  type: string
  title: string
}

export interface UsgsFeature {
  type: 'Feature'
  id: string
  properties: UsgsFeatureProps
  geometry: { type: 'Point'; coordinates: [number, number, number | null] }
}

export interface UsgsFeed {
  type: 'FeatureCollection'
  metadata: { generated: number; url: string; title: string; count: number }
  features: UsgsFeature[]
}

export interface EmscProps {
  unid: string
  time: string
  lastupdate: string
  lat: number
  lon: number
  depth: number // km, positive down — use this, not geometry z (sign convention differs)
  mag: number
  magtype: string
  evtype: string
  flynn_region: string
  auth: string
  source_id: string
  source_catalog: string
}

export interface EmscMessage {
  action: 'create' | 'update'
  data: {
    type: 'Feature'
    id: string
    geometry: { type: 'Point'; coordinates: number[] }
    properties: EmscProps
  }
}

export interface Revision {
  at: number
  field: 'mag' | 'location' | 'depth' | 'status'
  from: string
  to: string
}

export interface CanonicalEvent {
  id: string // usgs id, or "emsc:{unid}" until matched
  sources: { usgs?: string; emsc?: string }
  time: number
  updated: number
  firstSeenAt: number // when THIS app first learned of the event
  lat: number
  lon: number
  depthKm: number | null
  mag: number | null
  magType: string | null
  place: string
  status: 'automatic' | 'reviewed'
  feltCount: number | null
  cdi: number | null
  mmi: number | null
  alert: 'green' | 'yellow' | 'orange' | 'red' | null
  tsunamiFlag: boolean
  sig: number | null
  nst: number | null
  gap: number | null
  rms: number | null
  dmin: number | null
  eventType: string // 'earthquake' | 'quarry blast' | ...
  detailUrl: string | null
  usgsUrl: string | null
  revisions: Revision[]
}
