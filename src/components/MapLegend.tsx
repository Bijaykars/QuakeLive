import { useStore } from '../state/store'

export function MapLegend() {
  const colorMode = useStore((s) => s.colorMode)
  const selectedId = useStore((s) => s.selectedId)
  const shakingOverlay = useStore((s) => s.shakingOverlay)
  const rupture = useStore((s) => s.rupture)

  return (
    <div className="map-legend panel" aria-label="Map legend">
      <div className="map-legend__header">
        <span className="eyebrow">Map key</span>
        <span className="map-legend__hint">Satellite · size = magnitude</span>
      </div>
      <div className="map-legend__tectonics">
        <i aria-hidden="true" />
        <span>Ring of Fire</span>
        <small>subduction arcs</small>
      </div>
      {selectedId && (
        <div className="map-legend__shaking">
          <div><i className="map-legend__pulse" aria-hidden="true" /><span>Animated pulse</span><small>visual guide</small></div>
          {shakingOverlay.eventId === selectedId && shakingOverlay.status === 'loading' && (
            <div><i className="map-legend__contour is-loading" aria-hidden="true" /><span>USGS ShakeMap</span><small>checking…</small></div>
          )}
          {shakingOverlay.eventId === selectedId && shakingOverlay.status === 'official' && (
            <div><i className="map-legend__contour" aria-hidden="true" /><span>USGS MMI contours</span><small>official</small></div>
          )}
          {rupture && (
            <div>
              <i className={`map-legend__rupture ${rupture === 'trace' ? 'is-trace' : ''}`} aria-hidden="true" />
              <span>{rupture === 'trace' ? 'Fault trace' : 'Rupture extent'}</span>
              <small>official</small>
            </div>
          )}
        </div>
      )}
      {colorMode === 'age' ? (
        <div className="map-legend__scale">
          <span><i style={{ background: '#FFE8A3' }} />Now</span>
          <span><i style={{ background: '#FFC96B' }} />1 h</span>
          <span><i style={{ background: '#E08E45' }} />6 h</span>
          <span><i style={{ background: '#8A6B4E' }} />24 h</span>
        </div>
      ) : (
        <div className="map-legend__scale">
          <span><i style={{ background: '#F5D90A' }} />0–10 km</span>
          <span><i style={{ background: '#E0812E' }} />10–35</span>
          <span><i style={{ background: '#B84A9C' }} />35–70</span>
          <span><i style={{ background: '#7B3FD1' }} />70+ km</span>
        </div>
      )}
    </div>
  )
}
