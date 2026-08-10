import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const targetUrl = process.env.QA_URL ?? 'http://127.0.0.1:4173'
const outputDir = process.env.QA_OUTPUT ?? join(tmpdir(), 'quakelive-qa')
const requestedEventId = process.env.QA_EVENT_ID ?? null
const expectShakemap = process.env.QA_EXPECT_SHAKEMAP === '1'
const expectTechnical = process.env.QA_EXPECT_TECHNICAL === '1'
const capturePulse = process.env.QA_CAPTURE_PULSE === '1'
const [viewportWidth, viewportHeight] = (process.env.QA_VIEWPORT ?? '1440x900')
  .split('x')
  .map(Number)
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)
const chromePath = chromeCandidates.find((candidate) => existsSync(candidate))

if (!chromePath) throw new Error('Chrome or Edge was not found')

mkdirSync(outputDir, { recursive: true })
const profileDir = mkdtempSync(join(tmpdir(), 'quakelive-cdp-'))
const port = 9300 + Math.floor(Math.random() * 400)
const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`,
  'about:blank',
], { stdio: 'ignore', windowsHide: true })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function pageTarget() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
      const page = targets.find((target) => target.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch {
      // Chrome is still starting.
    }
    await sleep(100)
  }
  throw new Error('Chrome DevTools endpoint did not become ready')
}

class Cdp {
  constructor(url) {
    this.url = url
    this.sequence = 0
    this.pending = new Map()
    this.consoleErrors = []
  }

  async connect() {
    this.socket = new WebSocket(this.url)
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id) {
        const waiter = this.pending.get(message.id)
        if (!waiter) return
        this.pending.delete(message.id)
        if (message.error) waiter.reject(new Error(message.error.message))
        else waiter.resolve(message.result)
        return
      }
      if (message.method === 'Runtime.exceptionThrown') {
        this.consoleErrors.push(message.params.exceptionDetails?.text ?? 'Runtime exception')
      }
      if (message.method === 'Log.entryAdded' && message.params.entry?.level === 'error') {
        this.consoleErrors.push(message.params.entry.text)
      }
    })
  }

  command(method, params = {}) {
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    this.socket?.close()
  }
}

async function run() {
  const target = await pageTarget()
  const cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.connect()
  await Promise.all([
    cdp.command('Page.enable'),
    cdp.command('Runtime.enable'),
    cdp.command('Log.enable'),
  ])
  await cdp.command('Emulation.setDeviceMetricsOverride', {
    width: viewportWidth,
    height: viewportHeight,
    deviceScaleFactor: 1,
    mobile: viewportWidth < 768,
  })
  await cdp.command('Page.navigate', { url: targetUrl })

  const evaluate = async (expression) => {
    const result = await cdp.command('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result?.value
  }

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const ready = await evaluate(`Boolean(document.querySelector('.events-button') && document.querySelector('.maplibregl-canvas') && document.querySelector('.event-row'))`)
    if (ready) break
    await sleep(150)
  }

  const click = async (selector) => {
    const targetInfo = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)})
      if (!element) return null
      element.scrollIntoView({ block: 'center', inline: 'nearest' })
      const rect = element.getBoundingClientRect()
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      const hit = document.elementFromPoint(x, y)
      return {
        x,
        y,
        width: rect.width,
        height: rect.height,
        hitTag: hit?.tagName ?? null,
        hitClass: typeof hit?.className === 'string' ? hit.className : null,
        hitText: hit?.textContent?.trim()?.slice(0, 100) ?? null,
      }
    })()`)
    if (!targetInfo || targetInfo.width <= 0 || targetInfo.height <= 0) {
      throw new Error(`Cannot click ${selector}: element is missing or has no size`)
    }
    await cdp.command('Input.dispatchMouseEvent', { type: 'mousePressed', x: targetInfo.x, y: targetInfo.y, button: 'left', clickCount: 1 })
    await cdp.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: targetInfo.x, y: targetInfo.y, button: 'left', clickCount: 1 })
    return targetInfo
  }

  const dragMap = async () => {
    if (viewportWidth < 768) return { skipped: true, moved: false, hitTag: null, hitClass: null }
    const start = await evaluate(`(() => {
      const candidates = [
        [innerWidth * 0.35, innerHeight * 0.48],
        [innerWidth * 0.27, innerHeight * 0.34],
        [innerWidth * 0.42, innerHeight * 0.66],
      ]
      for (const [x, y] of candidates) {
        const hit = document.elementFromPoint(x, y)
        if (hit?.classList?.contains('maplibregl-canvas')) {
          return { x, y, hitTag: hit.tagName, hitClass: hit.className }
        }
      }
      return null
    })()`)
    if (!start) return { skipped: false, moved: false, hitTag: null, hitClass: null }
    const hashBeforeDrag = await evaluate('location.hash')
    await cdp.command('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1 })
    for (let step = 1; step <= 5; step += 1) {
      await cdp.command('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: start.x + step * 16,
        y: start.y + step * 3,
        button: 'left',
        buttons: 1,
      })
    }
    await cdp.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: start.x + 80, y: start.y + 15, button: 'left', buttons: 0, clickCount: 1 })
    await sleep(700)
    const hashAfterDrag = await evaluate('location.hash')
    return {
      skipped: false,
      moved: hashAfterDrag !== hashBeforeDrag,
      hitTag: start.hitTag,
      hitClass: start.hitClass,
      hashBefore: hashBeforeDrag,
      hashAfter: hashAfterDrag,
    }
  }

  const screenshot = async (name) => {
    const { data } = await cdp.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    const path = join(outputDir, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, Buffer.from(data, 'base64'))
    return path
  }

  const eventsButtonHit = await click('.events-button')
  await sleep(350)
  const listState = await evaluate(`(() => {
    const rail = document.querySelector('.event-rail')
    const row = document.querySelector('.event-row')
    return {
      count: document.querySelector('.events-button strong')?.textContent?.trim() ?? null,
      display: rail ? getComputedStyle(rail).display : null,
      rowCount: document.querySelectorAll('.event-row').length,
      firstRowText: row?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
    }
  })()`)
  const listScreenshot = await screenshot(`${viewportWidth}-events-open.png`)
  const hashBefore = await evaluate('location.hash')
  const eventSelector = requestedEventId
    ? `[data-event-id="${requestedEventId.replaceAll('"', '\\"')}"]`
    : '.event-row:not([data-event-id^="emsc:"])'
  const eventRowHit = await click(eventSelector)
  await sleep(1800)
  const detailState = await evaluate(`(() => ({
    drawer: Boolean(document.querySelector('.event-drawer')),
    title: document.querySelector('#event-detail-title')?.textContent?.trim() ?? null,
    eventId: new URLSearchParams(location.search).get('event'),
    hash: location.hash,
    railDisplay: getComputedStyle(document.querySelector('.event-rail')).display,
    officialContours: document.body.textContent.includes('USGS MMI contours'),
    shakingCopy: [...document.querySelectorAll('.shaking-reach')].map((element) => element.textContent?.replace(/\\s+/g, ' ').trim()).join(' '),
  }))()`)
  const detailScreenshot = await screenshot(`${viewportWidth}-event-detail.png`)

  const selectedDetail = detailState.eventId && !detailState.eventId.startsWith('emsc:')
    ? await fetch(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/${detailState.eventId}.geojson`).then((response) => response.json())
    : null
  const projectToViewport = (lon, lat, hash) => {
    const [zoom, centerLat, centerLon] = hash.slice(1).split('/').map(Number)
    const worldSize = 512 * 2 ** zoom
    const mercatorX = (longitude) => (longitude + 180) / 360
    const mercatorY = (latitude) => {
      const radians = Math.max(-85.051129, Math.min(85.051129, latitude)) * Math.PI / 180
      return (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2
    }
    let dx = (mercatorX(lon) - mercatorX(centerLon)) * worldSize
    if (dx > worldSize / 2) dx -= worldSize
    if (dx < -worldSize / 2) dx += worldSize
    return {
      x: viewportWidth / 2 + dx,
      y: viewportHeight / 2 + (mercatorY(lat) - mercatorY(centerLat)) * worldSize,
      zoom,
    }
  }
  const selectedCoordinates = selectedDetail?.geometry?.coordinates
  const markerPoint = selectedCoordinates
    ? projectToViewport(selectedCoordinates[0], selectedCoordinates[1], detailState.hash)
    : null
  const drawerRect = await evaluate(`(() => {
    const rect = document.querySelector('.event-drawer')?.getBoundingClientRect()
    return rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null
  })()`)
  const markerInsideDrawer = Boolean(markerPoint && drawerRect
    && markerPoint.x >= drawerRect.left && markerPoint.x <= drawerRect.right
    && markerPoint.y >= drawerRect.top && markerPoint.y <= drawerRect.bottom)
  const focusState = {
    markerPoint,
    drawerRect,
    markerInsideDrawer,
    markerVisible: Boolean(markerPoint
      && markerPoint.x >= 0 && markerPoint.x <= viewportWidth
      && markerPoint.y >= 72 && markerPoint.y <= viewportHeight
      && !markerInsideDrawer),
  }

  const technicalTabHit = await click('.drawer-tabs button[aria-selected="false"]')
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const settled = await evaluate(`(() => {
      const text = document.querySelector('.ground-motion-analysis')?.textContent ?? ''
      return text.includes('68% range')
        || text.includes('No ShakeMap ground-motion model is published')
        || text.includes('could not be loaded')
    })()`)
    if (settled) break
    await sleep(100)
  }
  const technicalState = await evaluate(`(() => {
    const section = document.querySelector('.ground-motion-analysis')
    const text = section?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
    return {
      present: Boolean(section),
      hasPga: text.includes('PGA'),
      hasPgv: text.includes('PGV'),
      hasSa: text.includes('SA 0.3 s') && text.includes('SA 1.0 s') && text.includes('SA 3.0 s'),
      hasMmi: text.includes('MMI'),
      hasUncertainty: text.includes('68% range'),
      hasFormula: text.includes('exp(μ)') && text.includes('exp(μ − σ)'),
      unavailable: text.includes('No ShakeMap ground-motion model is published'),
      error: text.includes('could not be loaded'),
    }
  })()`)
  const technicalScreenshot = await screenshot(`${viewportWidth}-technical.png`)
  const pulseScreenshots = []
  if (capturePulse) {
    for (let frame = 1; frame <= 3; frame += 1) {
      await sleep(1100)
      pulseScreenshots.push(await screenshot(`${viewportWidth}-pulse-${frame}.png`))
    }
  }
  const closeHit = await click('.drawer-close')
  await sleep(350)
  const closeState = await evaluate(`({
    drawer: Boolean(document.querySelector('.event-drawer')),
    eventId: new URLSearchParams(location.search).get('event'),
  })`)

  await click('.events-button')
  await sleep(150)
  await click('.event-row')
  await sleep(250)
  const mapDrag = await dragMap()
  const mapInteractionState = await evaluate(`({
    drawer: Boolean(document.querySelector('.event-drawer')),
    eventId: new URLSearchParams(location.search).get('event'),
  })`)
  if (mapInteractionState.drawer) {
    await click('.drawer-close')
    await sleep(200)
  }

  await click('.events-button')
  await sleep(150)
  await click('.event-row')
  await sleep(250)
  await cdp.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await cdp.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await sleep(250)
  const escapeState = await evaluate(`({
    drawer: Boolean(document.querySelector('.event-drawer')),
    eventId: new URLSearchParams(location.search).get('event'),
  })`)

  const summary = {
    targetUrl,
    viewport: `${viewportWidth}x${viewportHeight}`,
    eventsButtonHit,
    listState,
    eventRowHit,
    detailState: { ...detailState, mapMoved: detailState.hash !== hashBefore },
    focusState,
    technicalTabHit,
    technicalState,
    closeHit,
    closeState,
    mapDrag,
    mapInteractionState,
    escapeState,
    consoleErrors: cdp.consoleErrors,
    screenshots: [listScreenshot, detailScreenshot, technicalScreenshot, ...pulseScreenshots],
  }
  console.log(JSON.stringify(summary, null, 2))

  const ok = listState.display !== 'none'
    && listState.rowCount > 0
    && detailState.drawer
    && Boolean(detailState.eventId)
    && detailState.hash !== hashBefore
    && focusState.markerVisible
    && (!expectShakemap || detailState.officialContours)
    && technicalState.present
    && (technicalState.unavailable || technicalState.error || technicalState.hasPga)
    && (!expectTechnical || (
      technicalState.hasPga
      && technicalState.hasPgv
      && technicalState.hasSa
      && technicalState.hasMmi
      && technicalState.hasUncertainty
      && technicalState.hasFormula
    ))
    && !closeState.drawer
    && closeState.eventId == null
    && (viewportWidth < 768 || (mapDrag.hitTag === 'CANVAS' && mapDrag.moved))
    && !escapeState.drawer
    && escapeState.eventId == null
    && cdp.consoleErrors.length === 0

  cdp.close()
  if (process.env.STRICT === '1' && !ok) process.exitCode = 1
}

try {
  await run()
} finally {
  chrome.kill()
  await Promise.race([
    new Promise((resolve) => chrome.once('exit', resolve)),
    sleep(1500),
  ])
  try {
    rmSync(profileDir, { recursive: true, force: true })
  } catch {
    // Windows may hold Crashpad's metrics file briefly after Chrome exits.
  }
}
