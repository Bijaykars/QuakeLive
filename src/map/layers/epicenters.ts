import type { CircleLayerSpecification, GeoJSONSourceSpecification } from 'maplibre-gl'
import type { FeatureCollection, Point } from 'geojson'
import type { CanonicalEvent } from '../../types'
import { ageColorHex, depthColorHex, magRadiusPx } from '../../lib/format'
import type { ColorMode } from '../../state/store'

export const QUAKE_SOURCE = 'quakes'
export const LAYER_HALO = 'quakes-halo'
export const LAYER_WAVE_OUTER = 'quakes-wave-outer'
export const LAYER_WAVE_MID = 'quakes-wave-mid'
export const LAYER_WAVE_INNER = 'quakes-wave-inner'
export const LAYER_CORE = 'quakes-core'
export const LAYER_SELECTED = 'quakes-selected'
export const LAYER_SELECTED_ENVELOPE = 'quakes-selected-envelope'
export const LAYER_SELECTED_PULSE_OUTER = 'quakes-selected-pulse-outer'
export const LAYER_SELECTED_PULSE_MID = 'quakes-selected-pulse-mid'
export const LAYER_SELECTED_PULSE_INNER = 'quakes-selected-pulse-inner'

interface QuakeProps {
  id: string
  radiusPx: number
  color: string
  alpha: number
  fresh: 0 | 1
  ripple: 0 | 1
  ringAlpha: number
}

export function buildQuakeGeoJSON(
  events: CanonicalEvent[],
  colorMode: ColorMode,
  now: number,
): FeatureCollection<Point, QuakeProps> {
  return {
    type: 'FeatureCollection',
    features: events.map((event) => {
      const age = now - event.time
      const significant = event.mag != null && event.mag >= 6
      const color =
        event.eventType !== 'earthquake'
          ? '#6e7683'
          : colorMode === 'depth'
            ? depthColorHex(event.depthKm)
            : significant
              ? '#ff7b62'
              : ageColorHex(age)
      const alpha = colorMode === 'depth'
        ? 0.94
        : (255 - Math.min(1, age / 86_400_000) * 100) / 255
      const ripple = event.eventType === 'earthquake' && (
        (age < 3 * 3_600_000 && (event.mag ?? 0) >= 2) ||
        (age < 8 * 3_600_000 && (event.mag ?? 0) >= 3) ||
        (event.mag ?? 0) >= 4.5
      ) ? 1 : 0
      const freshness = Math.max(0.12, 1 - age / (8 * 3_600_000))
      const ringAlpha = significant ? Math.max(0.42, freshness) : freshness

      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [event.lon, event.lat] },
        properties: {
          id: event.id,
          radiusPx: magRadiusPx(event.mag),
          color,
          alpha,
          fresh: age < 3_600_000 ? 1 : 0,
          ripple,
          ringAlpha,
        },
      }
    }),
  }
}

export const quakeSourceSpec: GeoJSONSourceSpecification = {
  type: 'geojson',
  data: { type: 'FeatureCollection', features: [] },
  promoteId: 'id',
}

export const haloLayerSpec: CircleLayerSpecification = {
  id: LAYER_HALO,
  type: 'circle',
  source: QUAKE_SOURCE,
  filter: ['==', ['get', 'ripple'], 1],
  paint: {
    'circle-radius': ['*', ['get', 'radiusPx'], 2.8],
    'circle-color': ['get', 'color'],
    'circle-opacity': ['*', ['get', 'ringAlpha'], 0.22],
    'circle-blur': 0.78,
  },
}

function waveLayer(
  id: string,
  radiusMultiplier: number,
  opacityMultiplier: number,
  width: number,
): CircleLayerSpecification {
  return {
    id,
    type: 'circle',
    source: QUAKE_SOURCE,
    filter: ['==', ['get', 'ripple'], 1],
    paint: {
      'circle-radius': ['*', ['get', 'radiusPx'], radiusMultiplier],
      'circle-color': 'rgba(0,0,0,0)',
      'circle-opacity': 0,
      'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': width,
      'circle-stroke-opacity': ['*', ['get', 'ringAlpha'], opacityMultiplier],
    },
  }
}

export const waveOuterLayerSpec = waveLayer(LAYER_WAVE_OUTER, 6.1, 0.26, 0.9)
export const waveMidLayerSpec = waveLayer(LAYER_WAVE_MID, 4.5, 0.36, 1)
export const waveInnerLayerSpec = waveLayer(LAYER_WAVE_INNER, 3.1, 0.44, 1.1)

export const coreLayerSpec: CircleLayerSpecification = {
  id: LAYER_CORE,
  type: 'circle',
  source: QUAKE_SOURCE,
  paint: {
    'circle-radius': ['get', 'radiusPx'],
    'circle-color': ['get', 'color'],
    'circle-opacity': ['get', 'alpha'],
    'circle-blur': 0.08,
    'circle-stroke-color': '#fff2d1',
    'circle-stroke-width': 0.65,
    'circle-stroke-opacity': 0.72,
  },
}

export const selectedLayerSpec: CircleLayerSpecification = {
  id: LAYER_SELECTED,
  type: 'circle',
  source: QUAKE_SOURCE,
  filter: ['==', ['get', 'id'], '__none__'],
  paint: {
    'circle-radius': ['+', ['get', 'radiusPx'], 8],
    'circle-color': 'rgba(0,0,0,0)',
    'circle-stroke-color': '#77d5ff',
    'circle-stroke-width': 1.4,
    'circle-stroke-opacity': 0.95,
  },
}

export const selectedEnvelopeLayerSpec: CircleLayerSpecification = {
  id: LAYER_SELECTED_ENVELOPE,
  type: 'circle',
  source: QUAKE_SOURCE,
  filter: ['==', ['get', 'id'], '__none__'],
  paint: {
    'circle-radius': 64,
    'circle-color': '#ffad66',
    'circle-opacity': 0.07,
    'circle-blur': 0.82,
  },
}

function selectedPulseLayer(id: string): CircleLayerSpecification {
  return {
    id,
    type: 'circle',
    source: QUAKE_SOURCE,
    filter: ['==', ['get', 'id'], '__none__'],
    paint: {
      'circle-radius': 24,
      'circle-color': 'rgba(0,0,0,0)',
      'circle-opacity': 0,
      'circle-stroke-color': '#ff9d57',
      'circle-stroke-width': 1.8,
      'circle-stroke-opacity': 0,
      'circle-blur': 0.08,
    },
  }
}

export const selectedPulseOuterLayerSpec = selectedPulseLayer(LAYER_SELECTED_PULSE_OUTER)
export const selectedPulseMidLayerSpec = selectedPulseLayer(LAYER_SELECTED_PULSE_MID)
export const selectedPulseInnerLayerSpec = selectedPulseLayer(LAYER_SELECTED_PULSE_INNER)
