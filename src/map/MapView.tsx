import { useEffect, useRef, useState } from 'react'
import { Map as MlMap, NavigationControl, type MapMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { instrumentDark } from './style/instrumentDark'
import {
  buildQuakeGeoJSON,
  coreLayerSpec,
  haloLayerSpec,
  LAYER_CORE,
  LAYER_HALO,
  LAYER_SELECTED,
  LAYER_SELECTED_ENVELOPE,
  LAYER_SELECTED_PULSE_INNER,
  LAYER_SELECTED_PULSE_MID,
  LAYER_SELECTED_PULSE_OUTER,
  LAYER_WAVE_INNER,
  LAYER_WAVE_MID,
  LAYER_WAVE_OUTER,
  QUAKE_SOURCE,
  quakeSourceSpec,
  selectedLayerSpec,
  selectedEnvelopeLayerSpec,
  selectedPulseInnerLayerSpec,
  selectedPulseMidLayerSpec,
  selectedPulseOuterLayerSpec,
  waveInnerLayerSpec,
  waveMidLayerSpec,
  waveOuterLayerSpec,
} from './layers/epicenters'
import { setMapInstance, flyToEvent } from './camera'
import { useStore, visibleEvents } from '../state/store'
import { fmtDepth, fmtMag, hexToRgb, relTime } from '../lib/format'
import { haversineKm } from '../lib/geo'
import { fetchDetail, fetchRupture } from '../lib/usgsDetail'
import { useReducedMotion } from '../hooks/useReducedMotion'
import type { ExpressionSpecification, GeoJSONSource } from 'maplibre-gl'
import type { CanonicalEvent } from '../types'

const SHAKEMAP_SOURCE = 'shakemap-contours'
const SHAKEMAP_GLOW = 'shakemap-contours-glow'
const SHAKEMAP_LINES = 'shakemap-contours-lines'
const RUPTURE_SOURCE = 'shakemap-rupture'
const RUPTURE_FILL = 'shakemap-rupture-fill'
const RUPTURE_LINE = 'shakemap-rupture-line'
const EMPTY_LINES: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

const SHAKEMAP_COLORS = [
  'interpolate', ['linear'], ['to-number', ['get', 'value']],
  1.5, '#c7dcff',
  3, '#70d2ef',
  4, '#f1d36a',
  5, '#ffad57',
  6, '#ff725d',
  7, '#ff4d72',
] as ExpressionSpecification

interface Hover {
  x: number
  y: number
  id: string
}

function lerpHex(from: string, to: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(from)
  const [r2, g2, b2] = hexToRgb(to)
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t)
  return `rgb(${mix(r1, r2)},${mix(g1, g2)},${mix(b1, b2)})`
}

// Layered sines → organic ember flicker, no randomness needed.
function fireFlicker(t: number): number {
  const v = 0.5 + 0.3 * Math.sin(t / 340) + 0.14 * Math.sin(t / 97 + 1.7) + 0.06 * Math.sin(t / 43 + 0.6)
  return Math.min(1, Math.max(0, v))
}

function markRingOfFire(
  collection: GeoJSON.FeatureCollection<GeoJSON.LineString>,
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    ...collection,
    features: collection.features.map((feature) => {
      const coordinates = feature.geometry.coordinates
      const midpoint = coordinates[Math.floor(coordinates.length / 2)]
      const [lon, lat] = midpoint ?? [0, 0]
      const onPacificRim = lat >= -60 && lat <= 70 && (
        (lon >= 95 && lon <= 180) || (lon >= -180 && lon <= -75)
      )
      return {
        ...feature,
        properties: {
          ...feature.properties,
          ringOfFire: feature.properties?.Type === 'subduction' && onPacificRim,
        },
      }
    }),
  }
}

interface ShakemapProduct {
  preferredWeight?: number
  contents?: Record<string, { url?: string }>
}

interface UsgsDetail {
  properties?: { products?: { shakemap?: ShakemapProduct[] } }
}

function visitPositions(value: unknown, visit: (lon: number, lat: number) => void): void {
  if (!Array.isArray(value)) return
  if (
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  ) {
    visit(value[0], value[1])
    return
  }
  for (const child of value) visitPositions(child, visit)
}

function contourRadiusKm(contours: GeoJSON.FeatureCollection, event: CanonicalEvent): number | null {
  let maximum = 0
  for (const feature of contours.features) {
    const geometry = feature.geometry
    if (!geometry || !('coordinates' in geometry)) continue
    visitPositions(geometry.coordinates, (lon, lat) => {
      maximum = Math.max(maximum, haversineKm(event, { lon, lat }))
    })
  }
  return maximum > 0 ? Math.round(maximum) : null
}

async function fetchShakemap(
  event: CanonicalEvent,
  signal: AbortSignal,
): Promise<{ contours: GeoJSON.FeatureCollection; maxRadiusKm: number | null } | null> {
  if (!event.detailUrl || !event.sources.usgs) return null
  const detailUrl = new URL(event.detailUrl)
  if (detailUrl.protocol !== 'https:' || !detailUrl.hostname.endsWith('usgs.gov')) return null

  const detailResponse = await fetch(detailUrl, { signal })
  if (!detailResponse.ok) throw new Error(`USGS detail HTTP ${detailResponse.status}`)
  const detail = await detailResponse.json() as UsgsDetail
  const products = detail.properties?.products?.shakemap
  if (!products?.length) return null
  const product = [...products].sort(
    (a, b) => (b.preferredWeight ?? 0) - (a.preferredWeight ?? 0),
  )[0]
  const content = product?.contents?.['download/cont_mmi.json']
    ?? product?.contents?.['download/cont_mi.json']
  if (!content?.url) return null

  const contourUrl = new URL(content.url)
  if (contourUrl.protocol !== 'https:' || !contourUrl.hostname.endsWith('usgs.gov')) return null
  const contourResponse = await fetch(contourUrl, { signal })
  if (!contourResponse.ok) throw new Error(`USGS contours HTTP ${contourResponse.status}`)
  const contours = await contourResponse.json() as GeoJSON.FeatureCollection
  if (contours.type !== 'FeatureCollection') return null
  return { contours, maxRadiusKm: contourRadiusKm(contours, event) }
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced
  const [hover, setHover] = useState<Hover | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const map = new MlMap({
      container,
      style: instrumentDark,
      center: [155, 8],
      zoom: 1.28,
      minZoom: 0.7,
      maxZoom: 15,
      renderWorldCopies: true,
      hash: true,
      attributionControl: { compact: true },
    })
    setMapInstance(map)
    if (import.meta.env.DEV) {
      const w = window as unknown as { __map?: unknown; __maps?: unknown[] }
      w.__map = map
      ;(w.__maps ??= []).push(map)
    }

    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')
    map.on('error', (e: { error?: Error }) => console.warn('[map]', e?.error?.message ?? e))
    map.on('webglcontextlost', () => {
      useStore.getState().pushToast({
        title: 'Graphics context lost',
        sub: 'Reload the page to restore the map.',
        eventId: null,
        magHex: '#F87171',
      })
    })

    let disposed = false
    let unsubData: (() => void) | null = null
    let shakemapAbort: AbortController | null = null
    let raf = 0

    map.once('style.load', () => {
      if (disposed) return
      map.addSource(SHAKEMAP_SOURCE, { type: 'geojson', data: EMPTY_LINES })
      map.addSource(RUPTURE_SOURCE, { type: 'geojson', data: EMPTY_LINES })
      // The fault plane that actually broke, where USGS publishes a finite rupture.
      map.addLayer({
        id: RUPTURE_FILL,
        type: 'fill',
        source: RUPTURE_SOURCE,
        paint: { 'fill-color': '#ff4d72', 'fill-opacity': 0.16 },
      })
      map.addLayer({
        id: RUPTURE_LINE,
        type: 'line',
        source: RUPTURE_SOURCE,
        paint: {
          // A vertical fault arrives as a bare trace, so give it a heavier stroke.
          'line-color': '#ff8098',
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            2, ['case', ['==', ['get', 'ruptureKind'], 'trace'], 2, 1.2],
            9, ['case', ['==', ['get', 'ruptureKind'], 'trace'], 4.5, 2.6],
          ],
          'line-opacity': 0.92,
        },
      })
      map.addLayer({
        id: SHAKEMAP_GLOW,
        type: 'line',
        source: SHAKEMAP_SOURCE,
        paint: {
          'line-color': SHAKEMAP_COLORS,
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, 4, 8, 8],
          'line-blur': ['interpolate', ['linear'], ['zoom'], 1, 2, 8, 4],
          'line-opacity': 0.2,
        },
      })
      map.addLayer({
        id: SHAKEMAP_LINES,
        type: 'line',
        source: SHAKEMAP_SOURCE,
        paint: {
          'line-color': SHAKEMAP_COLORS,
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1, 8, 2.2],
          'line-opacity': 0.86,
        },
      })
      map.addSource(QUAKE_SOURCE, quakeSourceSpec)
      map.addLayer(selectedEnvelopeLayerSpec)
      map.addLayer(selectedPulseOuterLayerSpec)
      map.addLayer(selectedPulseMidLayerSpec)
      map.addLayer(selectedPulseInnerLayerSpec)
      map.addLayer(haloLayerSpec)
      map.addLayer(waveOuterLayerSpec)
      map.addLayer(waveMidLayerSpec)
      map.addLayer(waveInnerLayerSpec)
      map.addLayer(coreLayerSpec)
      map.addLayer(selectedLayerSpec)

      // Plate boundaries: runtime fetch with inline data — optional, never blocks.
      fetch('/data/plates.geojson')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((geojson: GeoJSON.FeatureCollection<GeoJSON.LineString>) => {
          if (disposed || map.getSource('plates')) return
          map.addSource('plates', { type: 'geojson', data: markRingOfFire(geojson) })
          map.addLayer(
            {
              id: 'plate-boundaries',
              type: 'line',
              source: 'plates',
              paint: {
                'line-color': '#9ab4c5',
                'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.45, 7, 1.15],
                'line-dasharray': [2, 2.5],
                'line-opacity': 0.42,
              },
            },
            'boundary-admin0',
          )
          map.addLayer(
            {
              id: 'ring-of-fire-glow',
              type: 'line',
              source: 'plates',
              filter: ['==', ['get', 'ringOfFire'], true],
              paint: {
                'line-color': '#c1160a',
                'line-width': ['interpolate', ['linear'], ['zoom'], 0, 4.5, 7, 10],
                'line-blur': ['interpolate', ['linear'], ['zoom'], 0, 3, 7, 6],
                'line-opacity': 0.3,
              },
            },
            'boundary-admin0',
          )
          map.addLayer(
            {
              id: 'ring-of-fire',
              type: 'line',
              source: 'plates',
              filter: ['==', ['get', 'ringOfFire'], true],
              paint: {
                'line-color': '#e8420f',
                'line-width': ['interpolate', ['linear'], ['zoom'], 0, 1.2, 7, 2.4],
                'line-opacity': 0.92,
              },
            },
            'boundary-admin0',
          )
        })
        .catch((e: Error) => console.warn('[map] plates unavailable:', e.message))
      const src = map.getSource(QUAKE_SOURCE) as GeoJSONSource
      const contourSource = map.getSource(SHAKEMAP_SOURCE) as GeoJSONSource
      const ruptureSource = map.getSource(RUPTURE_SOURCE) as GeoJSONSource

      // Data flows on store change (not per-frame): events / filter / palette / tick.
      let lastKey: unknown[] = []
      const pushData = () => {
        const s = useStore.getState()
        const key = [s.events, s.filters.minMag, s.colorMode, s.windowHours, s.tick]
        if (key.every((k, i) => k === lastKey[i])) return
        lastKey = key
        const now = Date.now()
        src.setData(buildQuakeGeoJSON(visibleEvents(s.events, s.order, s.filters.minMag, now, s.windowHours), s.colorMode, now))
      }
      pushData()
      unsubData = useStore.subscribe(pushData)

      const loadSelectedShakemap = (selectedId: string | null) => {
        shakemapAbort?.abort()
        contourSource.setData(EMPTY_LINES)
        ruptureSource.setData(EMPTY_LINES)
        useStore.getState().setRupture(null)
        if (!selectedId) {
          useStore.getState().setShakingOverlay(null, 'idle')
          return
        }
        const event = useStore.getState().events.get(selectedId)
        if (!event?.detailUrl || !event.sources.usgs) {
          useStore.getState().setShakingOverlay(selectedId, 'unavailable')
          return
        }

        const controller = new AbortController()
        shakemapAbort = controller

        void fetchDetail(event)
          .then((detail) => fetchRupture(detail, controller.signal))
          .then((rupture) => {
            if (disposed || controller.signal.aborted || !rupture) return
            if (useStore.getState().selectedId !== selectedId) return
            ruptureSource.setData(rupture)
            const kinds = rupture.features.map((f) => f.properties?.ruptureKind)
            useStore.getState().setRupture(kinds.includes('area') ? 'area' : 'trace')
          })
          .catch(() => {})

        useStore.getState().setShakingOverlay(selectedId, 'loading')
        void fetchShakemap(event, controller.signal)
          .then((result) => {
            if (disposed || controller.signal.aborted) return
            if (useStore.getState().selectedId !== selectedId) return
            if (!result) {
              useStore.getState().setShakingOverlay(selectedId, 'unavailable')
              return
            }
            contourSource.setData(result.contours)
            useStore.getState().setShakingOverlay(
              selectedId,
              'official',
              result.maxRadiusKm,
            )
          })
          .catch((error: Error) => {
            if (controller.signal.aborted) return
            console.warn('[map] ShakeMap unavailable:', error.message)
            if (useStore.getState().selectedId === selectedId) {
              useStore.getState().setShakingOverlay(selectedId, 'error')
            }
          })
      }

      // Every selected-event visual follows the same canonical id.
      const applySelected = () => {
        const selectedId = useStore.getState().selectedId
        const filterId = selectedId ?? '__none__'
        for (const layerId of [
          LAYER_SELECTED,
          LAYER_SELECTED_ENVELOPE,
          LAYER_SELECTED_PULSE_OUTER,
          LAYER_SELECTED_PULSE_MID,
          LAYER_SELECTED_PULSE_INNER,
        ]) {
          map.setFilter(layerId, ['==', ['get', 'id'], filterId])
        }
        loadSelectedShakemap(selectedId)
      }
      applySelected()
      const unsubSel = useStore.subscribe((s, prev) => {
        if (s.selectedId !== prev.selectedId) applySelected()
      })
      const prevUnsub = unsubData
      unsubData = () => {
        prevUnsub()
        unsubSel()
      }

      // One shared animation clock drives every ring; there is no per-marker DOM work.
      let previousFrame = 0
      const pulse = (t: number) => {
        if (t - previousFrame > 42) {
          previousFrame = t
          if (!reducedRef.current) {
            const cycle = (t % 3200) / 3200
            const updateWave = (id: string, offset: number) => {
              const phase = (cycle + offset) % 1
              map.setPaintProperty(id, 'circle-radius', [
                '*',
                ['get', 'radiusPx'],
                2.8 + phase * 4.6,
              ])
              map.setPaintProperty(id, 'circle-stroke-opacity', [
                '*',
                ['get', 'ringAlpha'],
                0.56 * (1 - phase),
              ])
            }
            updateWave(LAYER_WAVE_OUTER, 0)
            updateWave(LAYER_WAVE_MID, 0.33)
            updateWave(LAYER_WAVE_INNER, 0.66)
            map.setPaintProperty(LAYER_HALO, 'circle-opacity', [
              '*',
              ['get', 'ringAlpha'],
              0.16 + 0.07 * (1 + Math.sin(t / 520)),
            ])

            // Ring of Fire: deep-red ember flicker along the subduction arcs.
            if (map.getLayer('ring-of-fire')) {
              const flick = fireFlicker(t)
              map.setPaintProperty('ring-of-fire', 'line-color', lerpHex('#c1160a', '#ff9b3d', flick))
              map.setPaintProperty('ring-of-fire', 'line-opacity', 0.78 + 0.2 * flick)
              map.setPaintProperty('ring-of-fire-glow', 'line-color', lerpHex('#7f1d1d', '#ff3d00', flick))
              map.setPaintProperty('ring-of-fire-glow', 'line-opacity', 0.18 + 0.26 * flick)
            }
          }

          const state = useStore.getState()
          const selected = state.selectedId ? state.events.get(state.selectedId) : null
          if (selected) {
            const magnitudeScale = 76 + Math.max(0, Math.min(8, selected.mag ?? 2)) * 22
            const viewportLimit = Math.max(
              90,
              Math.min(map.getCanvas().clientWidth, map.getCanvas().clientHeight) * 0.43,
            )
            const maximumRadius = Math.min(magnitudeScale, viewportLimit)

            const selectedCycle = reducedRef.current ? 0.2 : (t % 5200) / 5200
            const updateSelectedPulse = (id: string, offset: number) => {
              const phase = (selectedCycle + offset) % 1
              map.setPaintProperty(id, 'circle-radius', maximumRadius * (0.1 + 0.9 * phase))
              map.setPaintProperty(id, 'circle-stroke-width', 2.2 - phase * 0.8)
              map.setPaintProperty(
                id,
                'circle-stroke-opacity',
                reducedRef.current ? 0.42 : 0.88 * (1 - phase) ** 0.85,
              )
            }
            updateSelectedPulse(LAYER_SELECTED_PULSE_OUTER, 0)
            updateSelectedPulse(LAYER_SELECTED_PULSE_MID, 0.34)
            updateSelectedPulse(LAYER_SELECTED_PULSE_INNER, 0.68)
            map.setPaintProperty(LAYER_SELECTED_ENVELOPE, 'circle-radius', maximumRadius)
            map.setPaintProperty(
              LAYER_SELECTED_ENVELOPE,
              'circle-opacity',
              reducedRef.current ? 0.07 : 0.06 + 0.024 * (1 + Math.sin(t / 700)),
            )
          }
        }
        raf = requestAnimationFrame(pulse)
      }
      raf = requestAnimationFrame(pulse)
    })

    // Picking + hover on the core layer.
    const canvas = map.getCanvas()
    const onClickCore = (
      e: MapMouseEvent & { features?: Array<{ properties: { id?: string } }> },
    ) => {
      const id = e.features?.[0]?.properties?.id
      const ev = id ? useStore.getState().events.get(id) : undefined
      if (ev) {
        useStore.getState().select(ev.id)
        flyToEvent(ev, reducedRef.current)
      }
    }
    const onClickAnywhere = (e: MapMouseEvent) => {
      const hits = map.queryRenderedFeatures(e.point, { layers: [LAYER_CORE] })
      if (hits.length === 0) useStore.getState().select(null)
    }
    const onMove = (
      e: MapMouseEvent & { features?: Array<{ properties: { id?: string } }> },
    ) => {
      const id = e.features?.[0]?.properties?.id
      if (!id) return
      canvas.style.cursor = 'pointer'
      if (useStore.getState().hoveredId !== id) useStore.getState().hover(id)
      setHover({ x: e.point.x, y: e.point.y, id })
    }
    const onLeave = () => {
      canvas.style.cursor = ''
      useStore.getState().hover(null)
      setHover(null)
    }
    map.on('click', LAYER_CORE, onClickCore)
    map.on('click', onClickAnywhere)
    map.on('mousemove', LAYER_CORE, onMove)
    map.on('mouseleave', LAYER_CORE, onLeave)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      shakemapAbort?.abort()
      unsubData?.()
      setMapInstance(null)
      map.remove()
    }
  }, [])

  const hoverEvent = hover ? useStore.getState().events.get(hover.id) : undefined

  // Wrapper owns positioning: maplibre's own .maplibregl-map CSS forces
  // `position: relative` and would override an `absolute` class on the container.
  return (
    <div className="map-stage absolute inset-0" aria-hidden="true">
      <div ref={containerRef} className="h-full w-full" />
      {hover && hoverEvent && (
        <div
          className="panel pointer-events-none absolute z-20 px-2.5 py-1.5 whitespace-nowrap"
          style={{ left: hover.x + 12, top: hover.y + 12 }}
        >
          <span className="font-data text-[11px] text-ink-hi">{fmtMag(hoverEvent.mag)}</span>
          <span className="font-data text-[11px] text-ink-mid"> · {hoverEvent.place}</span>
          <br />
          <span className="font-data text-[10px] text-ink-low">
            {relTime(hoverEvent.time, Date.now())} · {fmtDepth(hoverEvent.depthKm)}
          </span>
        </div>
      )}
    </div>
  )
}
