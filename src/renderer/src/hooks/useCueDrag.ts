import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { clamp } from '../../../shared/guards'
import { roundMs } from '../../../shared/time'
import type { Cue } from '../../../shared/types'
import { capturePointer, releasePointer } from '../pointer'
import { edgePush, isZoomed, type View } from '../timelineView'

/** How fast a cue held at the edge scrolls a zoomed timeline, in screens per second. */
const AUTOPAN_SPANS_PER_S = 0.6
/** Longest frame step fed to the auto-pan, so a stalled frame doesn't make the view jump. */
const MAX_FRAME_S = 0.1

type Handler = (e: React.PointerEvent<HTMLDivElement>) => void

export interface GrabHandlers {
  onPointerDown: Handler
  onPointerMove: Handler
  onPointerUp: Handler
  onPointerCancel: Handler
  onLostPointerCapture: Handler
}

export interface CueDrag {
  id: string
  /** Where the cue would land if released now. */
  t: number
}

interface Grab {
  pointerId: number
  id: string
  /** Cue time minus the time under the pointer when it was picked up, so the cue doesn't jump to the pointer. */
  offset: number
  origin: number
  clientX: number
  el: HTMLElement
}

interface Options {
  /** Track time under a pointer x, within what is on screen. */
  timeAt(clientX: number): number
  duration: number
  plotRef: RefObject<HTMLElement | null>
  viewRef: RefObject<View>
  /** Scrolls the view on its own (not a scroll by the user). */
  pan(seconds: number): void
  onMove(id: string, time: number): void
}

/**
 * Picking a cue up by its handle and moving it. The cue shows where it would land while dragging
 * and is committed on release; Escape drops it, and holding it at an edge scrolls a zoomed timeline.
 */
export function useCueDrag({ timeAt, duration, plotRef, viewRef, pan, onMove }: Options): {
  drag: CueDrag | null
  handlersFor(cue: Cue): GrabHandlers
} {
  const [drag, setDrag] = useState<CueDrag | null>(null)
  const grabRef = useRef<Grab | null>(null)
  const dragging = drag !== null

  const landingTime = useCallback(
    (grab: Grab, clientX: number): number => roundMs(clamp(timeAt(clientX) + grab.offset, 0, duration)),
    [timeAt, duration]
  )

  const cancel = useCallback(() => {
    const grab = grabRef.current
    if (!grab) return
    grabRef.current = null
    setDrag(null)
    releasePointer(grab.el, grab.pointerId)
  }, [])

  const handlersFor = (cue: Cue): GrabHandlers => {
    const onPointerDown: Handler = (e) => {
      if (e.button !== 0 || grabRef.current) return
      e.preventDefault()
      capturePointer(e.currentTarget, e.pointerId)
      grabRef.current = {
        pointerId: e.pointerId,
        id: cue.id,
        offset: cue.time - timeAt(e.clientX),
        origin: cue.time,
        clientX: e.clientX,
        el: e.currentTarget
      }
      setDrag({ id: cue.id, t: cue.time })
    }
    const onPointerMove: Handler = (e) => {
      const grab = grabRef.current
      if (!grab || e.pointerId !== grab.pointerId) return
      grab.clientX = e.clientX
      setDrag({ id: grab.id, t: landingTime(grab, e.clientX) })
    }
    const onPointerUp: Handler = (e) => {
      const grab = grabRef.current
      if (!grab || e.pointerId !== grab.pointerId || e.button !== 0) return
      const time = landingTime(grab, e.clientX)
      grabRef.current = null
      setDrag(null)
      if (time !== grab.origin) onMove(grab.id, time)
    }
    const onPointerCancel: Handler = (e) => {
      if (e.pointerId === grabRef.current?.pointerId) cancel()
    }
    return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture: onPointerCancel }
  }

  useEffect(() => {
    if (!dragging) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dragging, cancel])

  useEffect(() => {
    if (!dragging) return
    let raf = 0
    let last = performance.now()
    const step = (now: number): void => {
      raf = requestAnimationFrame(step)
      const dt = Math.min(MAX_FRAME_S, (now - last) / 1000)
      last = now
      const grab = grabRef.current
      if (!grab || !isZoomed(viewRef.current, duration)) return
      const rect = plotRef.current?.getBoundingClientRect()
      const push = rect ? edgePush(grab.clientX, rect.left, rect.right) : 0
      if (push === 0) return
      pan(push * viewRef.current.span * AUTOPAN_SPANS_PER_S * dt)
      const time = landingTime(grab, grab.clientX)
      setDrag((prev) => (prev && prev.t !== time ? { id: prev.id, t: time } : prev))
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [dragging, duration, pan, viewRef, plotRef, landingTime])

  return { drag, handlersFor }
}
