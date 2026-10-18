import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { clampView, fullView, isZoomed, panBy as panView, viewShowing, zoomAt, type View } from '../timelineView'

export interface TimelineViewApi {
  view: View
  /** The latest view, readable straight after a change (state lags a render behind). */
  viewRef: RefObject<View>
  zoomed: boolean
  /** While on, a zoomed view moves along with the playhead. Scrolling by hand turns it off. */
  follow: boolean
  setFollow(on: boolean): void
  /** `factor` > 1 zooms in, < 1 out; `anchor` (seconds) keeps its screen position. */
  zoomBy(factor: number, anchor: number): void
  /** Moves the view without touching `follow` (the view following something on its own). */
  pan(seconds: number): void
  /** The user scrolled: moves the view and stops following the playhead. */
  scrollBy(seconds: number): void
  scrollTo(start: number): void
  /** Brings `t` back on screen if it left it (used by follow). */
  reveal(t: number): void
  reset(): void
}

/** Which stretch of the track the timeline shows. Null state means the whole track. */
export function useTimelineView(duration: number): TimelineViewApi {
  const [zoom, setZoom] = useState<View | null>(null)
  const [follow, setFollow] = useState(true)
  const view = useMemo(() => (zoom ? clampView(zoom, duration) : fullView(duration)), [zoom, duration])
  // `commit` writes the ref at once so a gesture sees its own change; this catches a changed duration.
  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
  }, [view])

  const commit = useCallback(
    (next: View): void => {
      viewRef.current = next
      setZoom(isZoomed(next, duration) ? next : null)
    },
    [duration]
  )

  const zoomBy = useCallback((factor: number, anchor: number) => commit(zoomAt(viewRef.current, duration, factor, anchor)), [commit, duration])
  const pan = useCallback((seconds: number) => commit(panView(viewRef.current, duration, seconds)), [commit, duration])
  const scrollBy = useCallback(
    (seconds: number) => {
      pan(seconds)
      setFollow(false)
    },
    [pan]
  )
  const scrollTo = useCallback((start: number) => scrollBy(start - viewRef.current.start), [scrollBy])
  const reveal = useCallback(
    (t: number) => {
      const next = viewShowing(viewRef.current, duration, t)
      if (next) commit(next)
    },
    [commit, duration]
  )
  const reset = useCallback(() => {
    commit(fullView(duration))
    setFollow(true)
  }, [commit, duration])

  return { view, viewRef, zoomed: isZoomed(view, duration), follow, setFollow, zoomBy, pan, scrollBy, scrollTo, reveal, reset }
}
