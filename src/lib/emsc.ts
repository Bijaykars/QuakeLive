// EMSC standing-order WebSocket client per plan §5.4.
import type { EmscMessage } from '../types'

export const EMSC_WS_URL = 'wss://www.seismicportal.eu/standing_order/websocket'

export type WsStatus = 'connected' | 'reconnecting' | 'off'

export class EmscClient {
  private ws: WebSocket | null = null
  private attempts = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private stableTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false

  constructor(
    private onMessage: (msg: EmscMessage) => void,
    private onStatus: (s: WsStatus) => void,
  ) {}

  connect(): void {
    if (this.closed) return
    this.clearTimers()
    try {
      this.ws = new WebSocket(EMSC_WS_URL)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws.onopen = () => {
      this.onStatus('connected')
      // Reset backoff only after 60 s of stable connection (plan §5.4).
      this.stableTimer = setTimeout(() => (this.attempts = 0), 60_000)
    }
    this.ws.onmessage = (ev) => {
      try {
        this.onMessage(JSON.parse(ev.data as string) as EmscMessage)
      } catch {
        // malformed frame — ignore
      }
    }
    this.ws.onclose = () => {
      if (!this.closed) this.scheduleReconnect()
    }
    this.ws.onerror = () => {
      this.ws?.close()
    }
  }

  forceReconnect(): void {
    if (this.closed) return
    this.attempts = 0
    this.ws?.close()
    this.clearTimers()
    this.connect()
  }

  close(): void {
    this.closed = true
    this.clearTimers()
    this.ws?.close()
    this.onStatus('off')
  }

  private scheduleReconnect(): void {
    this.onStatus('reconnecting')
    const base = Math.min(60_000, 1000 * 2 ** this.attempts)
    const jitter = base * 0.3 * (Math.random() * 2 - 1)
    this.attempts += 1
    this.timer = setTimeout(() => this.connect(), Math.max(500, base + jitter))
  }

  private clearTimers(): void {
    if (this.timer) clearTimeout(this.timer)
    if (this.stableTimer) clearTimeout(this.stableTimer)
    this.timer = this.stableTimer = null
  }
}
