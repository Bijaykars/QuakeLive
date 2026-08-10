import { useEffect } from 'react'
import { useStore, type Toast } from '../state/store'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { flyToEvent } from '../map/camera'

function ToastItem({ t }: { t: Toast }) {
  const dismiss = useStore((s) => s.dismissToast)
  const select = useStore((s) => s.select)
  const events = useStore((s) => s.events)
  const reduced = useReducedMotion()
  const event = t.eventId ? events.get(t.eventId) : undefined

  useEffect(() => {
    const timer = setTimeout(() => dismiss(t.id), 6000)
    return () => clearTimeout(timer)
  }, [t.id, dismiss])

  return (
    <div
      className="panel animate-slide-in pointer-events-auto border-l-2 p-3"
      style={{ borderLeftColor: t.magHex }}
      role="status"
    >
      <p className="font-data text-[12.5px] text-ink-hi">{t.title}</p>
      <p className="mt-0.5 text-[11px] text-ink-low">{t.sub}</p>
      <div className="mt-1.5 flex gap-3">
        {event && (
          <button
            type="button"
            className="font-data text-[11px] text-accent hover:underline"
            onClick={() => {
              select(event.id)
              flyToEvent(event, reduced)
              dismiss(t.id)
            }}
          >
            View event
          </button>
        )}
        {t.eventId && !event && (
          <span className="font-data text-[10px] text-ink-low">Source revised this event</span>
        )}
        <button
          type="button"
          className="font-data text-[11px] text-ink-low hover:text-ink-mid"
          onClick={() => dismiss(t.id)}
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} />
      ))}
    </div>
  )
}
