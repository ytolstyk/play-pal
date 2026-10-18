import { useCallback, useEffect, type RefObject } from 'react'
import { isTypingTarget } from '../keyboard'
import { ZOOM_STEP, wheelIntent } from '../timelineView'
import type { Clock } from './usePlayback'
import type { TimelineViewApi } from './useTimelineView'

interface Options {
  stageRef: RefObject<HTMLElement | null>
  plotRef: RefObject<HTMLElement | null>
  view: TimelineViewApi
  clock: Clock
  duration: number
  /** False while a modal is open: the zoom keys are ignored. */
  keysEnabled: boolean
}

/**
 * Scroll wheel and keyboard control of the view: scroll zooms at the pointer, sideways scroll
 * pans, +/- zoom and 0 shows the whole track. Returns a zoom that centres on the playhead.
 */
export function useTimelineGestures({ stageRef, plotRef, view, clock, duration, keysEnabled }: Options): { zoomAtPlayhead(factor: number): void } {
  const { viewRef, zoomBy, scrollBy, reset } = view

  /** Zooms around the playhead if it is on screen, else around the middle. */
  const zoomAtPlayhead = useCallback(
    (factor: number): void => {
      const current = viewRef.current
      const playhead = clock.get()
      const onScreen = playhead >= current.start && playhead <= current.start + current.span
      zoomBy(factor, onScreen ? playhead : current.start + current.span / 2)
    },
    [clock, viewRef, zoomBy]
  )

  // Needs a non-passive listener, or the page would scroll along with the zoom.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || duration <= 0) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const plot = plotRef.current?.getBoundingClientRect()
      if (!plot || plot.width <= 0) return
      const intent = wheelIntent(e, plot, viewRef.current)
      if (intent.kind === 'pan') scrollBy(intent.seconds)
      else zoomBy(intent.factor, intent.anchor)
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [stageRef, plotRef, duration, viewRef, scrollBy, zoomBy])

  useEffect(() => {
    if (!keysEnabled || duration <= 0) return
    const onKey = (e: KeyboardEvent): void => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '+' || e.key === '=') zoomAtPlayhead(ZOOM_STEP)
      else if (e.key === '-' || e.key === '_') zoomAtPlayhead(1 / ZOOM_STEP)
      else if (e.key === '0') reset()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keysEnabled, duration, zoomAtPlayhead, reset])

  return { zoomAtPlayhead }
}
