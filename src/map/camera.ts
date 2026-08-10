// Camera singleton (plan §10.3). One map per app; a module ref beats prop-drilling.
import type { Map as MlMap } from 'maplibre-gl'

let mapRef: MlMap | null = null

export function setMapInstance(m: MlMap | null): void {
  mapRef = m
}

export function getMapInstance(): MlMap | null {
  return mapRef
}

function targetZoom(mag: number | null): number {
  if (mag == null || mag < 4) return 7.2
  if (mag < 6) return 6.8
  return 6.3
}

function detailPanelOffset(): [number, number] {
  if (typeof window === 'undefined') return [0, 0]
  if (window.innerWidth < 768) {
    // The mobile detail sheet occupies the lower part of the viewport. Keep the
    // epicentre in the exposed map area instead of underneath the sheet.
    return [0, -Math.min(220, Math.round(window.innerHeight * 0.25))]
  }
  if (window.innerWidth < 1120) return [-180, 0]
  return [-225, 0]
}

export function flyToEvent(
  e: { lon: number; lat: number; mag: number | null },
  reduced: boolean,
): void {
  if (!mapRef) return
  mapRef.stop()
  const offset = detailPanelOffset()
  if (reduced) {
    mapRef.easeTo({ center: [e.lon, e.lat], zoom: targetZoom(e.mag), offset, duration: 0 })
  } else {
    mapRef.flyTo({
      center: [e.lon, e.lat],
      zoom: targetZoom(e.mag),
      offset,
      duration: 1250,
      curve: 1.25,
      // This animation was explicitly requested by the user. Reduced-motion
      // users take the jumpTo branch above.
      essential: true,
    })
  }
}
