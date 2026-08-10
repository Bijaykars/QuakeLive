// EMSC WebSocket lifecycle → store. Fires onNew for genuinely new events so the
// app shell can run the live-moment choreography (plan §10.2).
import { useEffect, useRef } from 'react'
import { EmscClient } from '../lib/emsc'
import { useStore } from '../state/store'
import type { CanonicalEvent } from '../types'

export function useEmsc(onNew: (e: CanonicalEvent) => void): void {
  const cbRef = useRef(onNew)
  cbRef.current = onNew

  useEffect(() => {
    const client = new EmscClient(
      (msg) => {
        const res = useStore.getState().ingestEmsc(msg)
        if (res?.isNew) cbRef.current(res.event)
      },
      (s) => useStore.getState().setWsStatus(s),
    )
    client.connect()

    const reconnectIfDown = () => {
      if (document.visibilityState !== 'visible') return
      if (useStore.getState().ws.status !== 'connected') client.forceReconnect()
    }
    document.addEventListener('visibilitychange', reconnectIfDown)
    window.addEventListener('online', reconnectIfDown)

    return () => {
      document.removeEventListener('visibilitychange', reconnectIfDown)
      window.removeEventListener('online', reconnectIfDown)
      client.close()
    }
  }, [])
}
