import type { StyleSpecification } from 'maplibre-gl'

// A high-resolution GIS base: Esri World Imagery for geographic context,
// combined with open vector boundaries from OpenFreeMap. Place labels are
// intentionally omitted so the earthquake pattern remains the visual focus.
const style = {
  version: 8,
  name: 'quakelive-gis-satellite',
  projection: { type: 'mercator' },
  sky: {
    'sky-color': '#02070d',
    'horizon-color': '#123b55',
    'fog-color': '#07111b',
    'sky-horizon-blend': 0.65,
    'horizon-fog-blend': 0.72,
    'fog-ground-blend': 0.84,
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.78, 5, 0.12, 7, 0],
  },
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    imagery: {
      type: 'raster',
      tileSize: 256,
      maxzoom: 23,
      attribution: 'Imagery: Esri, Vantor, Earthstar Geographics, and the GIS User Community',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
    },
    ofm: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
  },
  layers: [
    { id: 'space', type: 'background', paint: { 'background-color': '#02070d' } },
    {
      id: 'satellite-imagery',
      type: 'raster',
      source: 'imagery',
      minzoom: 0,
      maxzoom: 23,
      paint: {
        'raster-opacity': 1,
        'raster-contrast': 0.06,
        'raster-saturation': -0.04,
        'raster-brightness-min': 0.02,
        'raster-brightness-max': 0.98,
        'raster-fade-duration': 180,
      },
    },
    {
      id: 'boundary-admin0-casing',
      type: 'line',
      source: 'ofm',
      'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['==', ['get', 'maritime'], 0]],
      paint: {
        'line-color': '#06101a',
        'line-width': ['interpolate', ['linear'], ['zoom'], 0, 1.5, 8, 3.2],
        'line-opacity': 0.8,
      },
    },
    {
      id: 'boundary-admin0',
      type: 'line',
      source: 'ofm',
      'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['==', ['get', 'maritime'], 0]],
      paint: {
        'line-color': '#b9d8eb',
        'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.35, 8, 1.15],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.52, 5, 0.8],
      },
    },
    {
      id: 'boundary-admin1',
      type: 'line',
      source: 'ofm',
      'source-layer': 'boundary',
      minzoom: 4,
      filter: ['all', ['==', ['get', 'admin_level'], 4], ['==', ['get', 'maritime'], 0]],
      paint: { 'line-color': '#9eb8c8', 'line-width': 0.55, 'line-opacity': 0.46 },
    },
    {
      id: 'roads-major-casing',
      type: 'line',
      source: 'ofm',
      'source-layer': 'transportation',
      minzoom: 6,
      filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]],
      paint: {
        'line-color': '#07111b',
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.2, 14, 4.5],
        'line-opacity': 0.72,
      },
    },
    {
      id: 'roads-major',
      type: 'line',
      source: 'ofm',
      'source-layer': 'transportation',
      minzoom: 6,
      filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]],
      paint: {
        'line-color': '#d9e6ed',
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.35, 14, 1.65],
        'line-opacity': 0.65,
      },
    },
  ],
}

export const instrumentDark = style as unknown as StyleSpecification
