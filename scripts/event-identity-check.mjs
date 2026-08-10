import assert from 'node:assert/strict'
import { createServer } from 'vite'

const storage = new Map()
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  },
  configurable: true,
})

const server = await createServer({
  root: process.cwd(),
  appType: 'custom',
  server: { middlewareMode: true },
})

try {
  const { useStore } = await server.ssrLoadModule('/src/state/store.ts')
  const time = Date.now() - 25_000
  const emscId = 'emsc:test-preliminary'
  const usgsId = 'us-test-canonical'
  const preliminary = {
    id: emscId,
    sources: { emsc: 'test-preliminary' },
    time,
    updated: time,
    firstSeenAt: time + 5_000,
    lat: 37.25,
    lon: 142.1,
    depthKm: 18,
    mag: 5.2,
    magType: 'mw',
    place: 'Off the east coast of Honshu, Japan',
    status: 'automatic',
    feltCount: null,
    cdi: null,
    mmi: null,
    alert: null,
    tsunamiFlag: false,
    sig: null,
    nst: null,
    gap: null,
    rms: null,
    dmin: null,
    eventType: 'earthquake',
    detailUrl: null,
    usgsUrl: null,
    revisions: [],
  }

  useStore.setState({
    events: new Map([[emscId, preliminary]]),
    order: [emscId],
    missCounts: new Map(),
    selectedId: emscId,
    hoveredId: emscId,
    feed: { status: 'stale', lastGeneratedAt: 0, lastFetchAt: 0 },
    toasts: [{
      id: 1,
      title: 'EMSC preliminary · M 5.2',
      sub: '25 seconds ago',
      eventId: emscId,
      magHex: '#F87171',
    }],
  })

  useStore.getState().ingestUsgs({
    type: 'FeatureCollection',
    metadata: { generated: time + 20_000, url: '', title: 'test', count: 1 },
    features: [{
      type: 'Feature',
      id: usgsId,
      properties: {
        mag: 5.2,
        place: 'Off the east coast of Honshu, Japan',
        time,
        updated: time + 18_000,
        url: `https://earthquake.usgs.gov/earthquakes/eventpage/${usgsId}`,
        detail: '',
        felt: null,
        cdi: null,
        mmi: null,
        alert: null,
        status: 'automatic',
        tsunami: 0,
        sig: 416,
        net: 'us',
        code: 'test-canonical',
        ids: `,${usgsId},`,
        sources: ',us,',
        types: ',origin,phase-data,',
        nst: null,
        dmin: null,
        rms: null,
        gap: null,
        magType: 'mw',
        type: 'earthquake',
        title: 'M 5.2 - Off the east coast of Honshu, Japan',
      },
      geometry: { type: 'Point', coordinates: [142.1, 37.25, 18] },
    }],
  })

  const state = useStore.getState()
  assert.equal(state.events.has(emscId), false, 'the preliminary record should be absorbed')
  assert.equal(state.events.has(usgsId), true, 'the USGS canonical record should remain')
  assert.equal(state.events.get(usgsId)?.sources.emsc, 'test-preliminary')
  assert.equal(state.selectedId, usgsId, 'the open detail should follow the canonical ID')
  assert.equal(state.hoveredId, usgsId, 'the map hover should follow the canonical ID')
  assert.equal(state.toasts[0]?.eventId, usgsId, 'the notification link should follow the canonical ID')
  assert.equal(state.toasts.some((toast) => toast.title === 'Event removed'), false)

  console.log(JSON.stringify({
    preliminaryId: emscId,
    canonicalId: usgsId,
    selectedId: state.selectedId,
    toastEventId: state.toasts[0]?.eventId,
    sources: state.events.get(usgsId)?.sources,
  }, null, 2))
} finally {
  await server.close()
}
