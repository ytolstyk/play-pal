import { useRef, useState } from 'react'
import { capturePointer } from '../pointer'

type Handler = (e: React.PointerEvent<HTMLDivElement>) => void

export interface Scrub {
  /** Where releasing now would seek to; null when not dragging. */
  scrubT: number | null
  handlers: {
    onPointerDown: Handler
    onPointerMove: Handler
    onPointerUp: Handler
    onPointerCancel: Handler
    onLostPointerCapture: Handler
  }
}

/**
 * Press-drag-release on the timeline: shows the target time while dragging and seeks on release.
 * The drag state lives here so pointer moves re-render only the timeline, not the whole player.
 */
export function useScrub(timeAt: (clientX: number) => number, enabled: boolean, onSeek: (t: number) => void): Scrub {
  const [scrubT, setScrubT] = useState<number | null>(null)
  // The active pointer is the source of truth; scrubT only drives rendering.
  const pointer = useRef<number | null>(null)

  const onPointerDown: Handler = (e) => {
    if (!enabled || e.button !== 0 || pointer.current !== null) return
    pointer.current = e.pointerId
    capturePointer(e.currentTarget, e.pointerId)
    setScrubT(timeAt(e.clientX))
  }
  const onPointerMove: Handler = (e) => {
    if (e.pointerId === pointer.current) setScrubT(timeAt(e.clientX))
  }
  const onPointerUp: Handler = (e) => {
    if (e.pointerId !== pointer.current || e.button !== 0) return
    pointer.current = null
    onSeek(timeAt(e.clientX))
    setScrubT(null)
  }
  const onPointerCancel: Handler = (e) => {
    if (e.pointerId !== pointer.current) return
    pointer.current = null
    setScrubT(null)
  }
  return { scrubT, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture: onPointerCancel } }
}
