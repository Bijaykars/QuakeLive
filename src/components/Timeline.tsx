// Canvas timeline strip (plan §10.5, v1: ticks + hover + click-select; replay clock
// arrives with the wavefront phase).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { useVisibleEvents } from '../hooks/useVisibleEvents'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { flyToEvent } from '../map/camera'
import { ageColorHex, fmtDepth, fmtMag, relTime } from '../lib/format'
import type { CanonicalEvent } from '../types'

const PAD_L = 10
const PAD_R = 52
const BASE = 16 // px above bottom edge
const HIT_PX = 6
const H = 3_600_000

const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short' })

interface Hover {
  x: number
  e: CanonicalEvent
}

export function Timeline() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hitsRef = useRef<Array<{ x: number; e: CanonicalEvent }>>([])
  const visible = useVisibleEvents()
  const selectedId = useStore((s) => s.selectedId)
  const tick = useStore((s) => s.tick)
  const select = useStore((s) => s.select)
  const windowHours = useStore((s) => s.windowHours)
  const windowMs = windowHours * H
  const reduced = useReducedMotion()
  const [hover, setHover] = useState<Hover | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ w: width, h: height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Drawing — pure canvas, redraws only on data/selection/hover/size changes.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.w === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.w * dpr)
    canvas.height = Math.round(size.h * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, size.w, size.h)

    const now = Date.now()
    const t0 = now - windowMs
    const x = (t: number) => PAD_L + ((t - t0) / windowMs) * (size.w - PAD_L - PAD_R)
    const baseY = size.h - BASE

    // time grid: hourly lines / 6 h labels at 24 h, 6 h lines / daily labels at 7 d
    ctx.textBaseline = 'top'
    ctx.font = '9px "Geist Mono", monospace'
    const stepMs = windowHours === 24 ? H : 6 * H
    const first = Math.ceil(t0 / stepMs) * stepMs
    for (let t = first; t <= now; t += stepMs) {
      const d = new Date(t)
      const isMajor = windowHours === 24
        ? d.getUTCHours() % 6 === 0
        : d.getUTCHours() === 0
      ctx.strokeStyle = isMajor ? '#1A1F29' : '#101318'
      ctx.beginPath()
      ctx.moveTo(x(t) + 0.5, 8)
      ctx.lineTo(x(t) + 0.5, baseY)
      ctx.stroke()
      if (isMajor) {
        ctx.fillStyle = '#3A4048'
        ctx.fillText(
          windowHours === 24
            ? `${String(d.getUTCHours()).padStart(2, '0')}:00`
            : dayFmt.format(d),
          x(t) + 3,
          baseY + 3,
        )
      }
    }

    // baseline
    ctx.strokeStyle = '#1C1F26'
    ctx.beginPath()
    ctx.moveTo(PAD_L, baseY + 0.5)
    ctx.lineTo(size.w - PAD_R + 26, baseY + 0.5)
    ctx.stroke()

    // event ticks (oldest first so fresh ones draw on top)
    const hits: Array<{ x: number; e: CanonicalEvent }> = []
    for (let i = visible.length - 1; i >= 0; i--) {
      const e = visible[i]
      const ex = x(e.time)
      if (ex < PAD_L) continue
      const h = e.mag == null ? 6 : Math.min(44, Math.max(6, 8 + 4 * e.mag))
      const color = ageColorHex(now - e.time)
      const isSel = e.id === selectedId
      if (isSel) {
        ctx.strokeStyle = 'rgba(125,211,252,0.5)'
        ctx.lineWidth = 5
        ctx.beginPath()
        ctx.moveTo(ex, baseY)
        ctx.lineTo(ex, baseY - h)
        ctx.stroke()
      }
      ctx.save()
      if (e.mag != null && e.mag >= 6) {
        ctx.shadowColor = color
        ctx.shadowBlur = 6
      }
      ctx.strokeStyle = color
      ctx.globalAlpha = 0.9
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(ex, baseY)
      ctx.lineTo(ex, baseY - h)
      ctx.stroke()
      ctx.restore()
      hits.push({ x: ex, e })
    }
    hitsRef.current = hits

    // hover crosshair
    if (hover) {
      ctx.strokeStyle = '#565D69'
      ctx.setLineDash([2, 3])
      ctx.beginPath()
      ctx.moveTo(hover.x + 0.5, 4)
      ctx.lineTo(hover.x + 0.5, baseY)
      ctx.stroke()
      ctx.setLineDash([])
    }

    // LIVE edge
    const liveX = x(now)
    ctx.strokeStyle = 'rgba(74,222,128,0.6)'
    ctx.beginPath()
    ctx.moveTo(liveX + 0.5, 6)
    ctx.lineTo(liveX + 0.5, baseY)
    ctx.stroke()
    ctx.fillStyle = '#4ADE80'
    ctx.fillText('LIVE', liveX + 5, 6)
  }, [visible, tick, selectedId, hover, size, windowHours, windowMs])

  const nearest = (clientX: number): Hover | null => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return null
    const px = clientX - rect.left
    let best: { x: number; e: CanonicalEvent } | null = null
    let bestD = HIT_PX + 1
    for (const h of hitsRef.current) {
      const d = Math.abs(h.x - px)
      if (d < bestD) {
        bestD = d
        best = h
      }
    }
    return best
  }

  const tooltip = useMemo(() => {
    if (!hover) return null
    const left = Math.min(Math.max(hover.x, 90), size.w - 90)
    return { left, e: hover.e }
  }, [hover, size.w])

  return (
    <div ref={wrapRef} className="timeline panel">
      <div className="timeline__label">
        <span className="eyebrow">{windowHours === 24 ? '24-hour' : '7-day'} timeline <b>UTC</b></span>
        <span>Select a spike to explore</span>
      </div>
      <canvas
        ref={canvasRef}
        className="h-full w-full cursor-crosshair"
        style={{ width: size.w, height: size.h }}
        aria-hidden="true"
        onPointerMove={(ev) => setHover(nearest(ev.clientX))}
        onPointerLeave={() => setHover(null)}
        onClick={(ev) => {
          const hit = nearest(ev.clientX)
          if (hit) {
            select(hit.e.id)
            flyToEvent(hit.e, reduced)
          }
        }}
      />
      {tooltip && (
        <div
          className="timeline__tooltip panel"
          style={{ left: tooltip.left }}
        >
          <span className="font-data text-[11px] text-ink-hi">{fmtMag(tooltip.e.mag)}</span>
          <span className="font-data text-[11px] text-ink-mid"> · {tooltip.e.place}</span>
          <br />
          <span className="font-data text-[10px] text-ink-low">
            {relTime(tooltip.e.time, Date.now())} · {fmtDepth(tooltip.e.depthKm)}
          </span>
        </div>
      )}
    </div>
  )
}
