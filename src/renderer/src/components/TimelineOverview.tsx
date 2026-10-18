import { useMemo, useRef } from 'react'
import { clamp } from '../../../shared/guards'
import { capturePointer } from '../pointer'
import { fullView, type View } from '../timelineView'
import { WaveCanvas } from './WaveCanvas'

interface Props {
  bins: Uint8Array | null
  revision: number
  ceiling: number
  duration: number
  view: View
  /** Playhead position, seconds. */
  t: number
  onPan(start: number): void
}

/** The whole track in miniature with the visible stretch outlined; drag the outline (or click) to scroll a zoomed timeline. */
export function TimelineOverview({ bins, revision, ceiling, duration, view, t, onPan }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; grab: number } | null>(null)
  const whole = useMemo(() => fullView(duration), [duration])

  const timeAt = (clientX: number): number => {
    const r = ref.current?.getBoundingClientRect()
    return r && r.width > 0 ? clamp((clientX - r.left) / r.width, 0, 1) * duration : 0
  }
  const down = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || drag.current) return
    const at = timeAt(e.clientX)
    // Grabbing the outline keeps the spot under the pointer; clicking elsewhere centres the outline there.
    const inside = at >= view.start && at <= view.start + view.span
    const grab = inside ? at - view.start : view.span / 2
    drag.current = { pointerId: e.pointerId, grab }
    capturePointer(e.currentTarget, e.pointerId)
    if (!inside) onPan(at - grab)
  }
  const move = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointerId === e.pointerId) onPan(timeAt(e.clientX) - drag.current.grab)
  }
  const end = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointerId === e.pointerId) drag.current = null
  }
  const pct = (x: number): string => `${(duration > 0 ? x / duration : 0) * 100}%`

  return (
    <div
      ref={ref}
      className="overview"
      role="scrollbar"
      aria-controls="timeline"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration - view.span)}
      aria-valuenow={Math.round(view.start)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    >
      <WaveCanvas bins={bins} revision={revision} view={whole} ceiling={ceiling} tone="idle" />
      <div className="overview-window" style={{ left: pct(view.start), width: pct(view.span) }} />
      <div className="overview-playhead" style={{ left: pct(t) }} />
    </div>
  )
}
