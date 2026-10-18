import { clamp } from '../../shared/guards'

/** The stretch of the track the timeline shows, in seconds. */
export interface View {
  start: number
  span: number
}

/** Zoomed in this far, the timeline shows this many seconds (or the whole track, if shorter). */
export const MIN_SPAN_S = 2
/** One zoom button press or key press. */
export const ZOOM_STEP = 1.5
/** Spans closer than this are the same span (floating-point slack). */
const VIEW_EPSILON = 1e-6
const WHEEL_ZOOM_PER_PX = 0.002
const PINCH_ZOOM_PER_PX = 0.01
const DOM_DELTA_LINE = 1
const DOM_DELTA_PAGE = 2
const WHEEL_LINE_PX = 33
const WHEEL_PAGE_PX = 400
/** Dragging a cue this close to either edge of the timeline scrolls it. */
export const EDGE_PUSH_PX = 28

export const fullView = (duration: number): View => ({ start: 0, span: Math.max(0, duration) })

/** The shortest span the view may be zoomed to. */
export const minSpan = (duration: number): number => Math.min(MIN_SPAN_S, duration)

export function clampView(v: View, duration: number): View {
  const span = Math.min(duration, Math.max(minSpan(duration), v.span))
  return { start: Math.min(duration - span, Math.max(0, v.start)), span }
}

export const isZoomed = (v: View, duration: number): boolean => v.span < duration - VIEW_EPSILON

export const canZoomIn = (v: View, duration: number): boolean => v.span > minSpan(duration) + VIEW_EPSILON

export const zoomFactor = (v: View, duration: number): number => (v.span > 0 ? duration / v.span : 1)

/** Where `x` (seconds) is on screen, 0-1 across the view; outside that range when off screen. */
export const fractionOf = (v: View, x: number): number => (v.span > 0 ? (x - v.start) / v.span : 0)

/** Scales the visible span by 1/`factor` (>1 zooms in), keeping the time at `anchor` under the same screen position. */
export function zoomAt(v: View, duration: number, factor: number, anchor: number): View {
  if (duration <= 0 || !(factor > 0)) return v // `!(x > 0)` also rejects NaN
  const at = v.span > 0 ? clamp(fractionOf(v, anchor), 0, 1) : 0.5
  const span = Math.min(duration, Math.max(minSpan(duration), v.span / factor))
  return clampView({ start: anchor - at * span, span }, duration)
}

export const panBy = (v: View, duration: number, seconds: number): View =>
  clampView({ start: v.start + seconds, span: v.span }, duration)

/** Where to move a zoomed view so that `t` is back on screen (a little in from the left), or null if it already is. */
export function viewShowing(v: View, duration: number, t: number, lead = 0.1): View | null {
  if (t >= v.start && t <= v.start + v.span) return null
  return clampView({ start: t - v.span * lead, span: v.span }, duration)
}

export interface WheelInput {
  deltaX: number
  deltaY: number
  deltaMode: number
  shiftKey: boolean
  ctrlKey: boolean
  clientX: number
}

export type WheelIntent = { kind: 'pan'; seconds: number } | { kind: 'zoom'; factor: number; anchor: number }

/**
 * What a wheel event means over a plot `plot.width` px wide starting at `plot.left`: sideways (or
 * shift) scrolling pans, vertical scrolling zooms at the pointer (up is in), pinch zooms faster.
 */
export function wheelIntent(e: WheelInput, plot: { left: number; width: number }, v: View): WheelIntent {
  const unit = e.deltaMode === DOM_DELTA_LINE ? WHEEL_LINE_PX : e.deltaMode === DOM_DELTA_PAGE ? WHEEL_PAGE_PX : 1
  const dx = e.deltaX * unit
  const dy = e.deltaY * unit
  const sideways = Math.abs(dx) > Math.abs(dy)
  if (e.shiftKey || sideways) return { kind: 'pan', seconds: ((sideways ? dx : dy) / plot.width) * v.span }
  const anchor = v.start + clamp((e.clientX - plot.left) / plot.width, 0, 1) * v.span
  return { kind: 'zoom', factor: Math.exp(-dy * (e.ctrlKey ? PINCH_ZOOM_PER_PX : WHEEL_ZOOM_PER_PX)), anchor }
}

/** How hard a pointer at `x` pushes the view: -1 (hard left) to 1 (hard right), 0 away from the edges. */
export function edgePush(x: number, left: number, right: number): number {
  const intoLeft = 1 - (x - left) / EDGE_PUSH_PX
  const intoRight = 1 - (right - x) / EDGE_PUSH_PX
  if (intoLeft > 0) return -Math.min(1, intoLeft)
  if (intoRight > 0) return Math.min(1, intoRight)
  return 0
}
