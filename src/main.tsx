// Dev-only: ?forceframes shims rAF onto timers so the map pipeline runs in
// hidden/headless tabs (agent + CI screenshot verification). No-op in prod builds.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('forceframes')) {
  window.requestAnimationFrame = (cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(performance.now()), 33)
  window.cancelAnimationFrame = (id: number) => clearTimeout(id)
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource/geist-mono'
import './app.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
