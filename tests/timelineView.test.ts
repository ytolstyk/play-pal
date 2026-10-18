import { describe, expect, it } from 'vitest'
import {
  canZoomIn,
  clampView,
  edgePush,
  EDGE_PUSH_PX,
  fullView,
  MIN_SPAN_S,
  panBy,
  viewShowing,
  wheelIntent,
  zoomAt
} from '../src/renderer/src/timelineView'

describe('timeline view', () => {
  const D = 200
  it('zooms around the anchor, keeping it under the same screen position', () => {
    const v = zoomAt(fullView(D), D, 4, 100)
    expect(v.span).toBeCloseTo(50)
    expect((100 - v.start) / v.span).toBeCloseTo(0.5)
    const edge = zoomAt(fullView(D), D, 4, 0)
    expect(edge.start).toBe(0)
  })
  it('never zooms out past the track or in past the minimum', () => {
    expect(zoomAt(fullView(D), D, 0.5, 10).span).toBe(D)
    expect(zoomAt({ start: 0, span: 3 }, D, 100, 1).span).toBe(MIN_SPAN_S)
    expect(clampView({ start: 0, span: 1 }, 1).span).toBe(1)
  })
  it('pans within the track', () => {
    const v = { start: 10, span: 50 }
    expect(panBy(v, D, -100).start).toBe(0)
    expect(panBy(v, D, 1000).start).toBe(D - 50)
  })
  it('brings the playhead back into a view it left', () => {
    const v = { start: 10, span: 50 }
    expect(viewShowing(v, D, 30)).toBeNull()
    const next = viewShowing(v, D, 100)
    expect(next && next.start).toBeCloseTo(95)
    expect(viewShowing(v, D, 199)?.start).toBe(D - 50)
  })
})

describe('wheelIntent', () => {
  const plot = { left: 100, width: 1000 }
  const view = { start: 50, span: 100 }
  const wheel = { deltaX: 0, deltaY: 0, deltaMode: 0, shiftKey: false, ctrlKey: false, clientX: 600 }

  it('zooms in on scroll up and out on scroll down, around the pointer', () => {
    const up = wheelIntent({ ...wheel, deltaY: -100 }, plot, view)
    const down = wheelIntent({ ...wheel, deltaY: 100 }, plot, view)
    expect(up).toMatchObject({ kind: 'zoom', anchor: 100 })
    expect(up.kind === 'zoom' && up.factor).toBeGreaterThan(1)
    expect(down.kind === 'zoom' && down.factor).toBeLessThan(1)
  })
  it('pans on sideways scroll and on shift+scroll', () => {
    expect(wheelIntent({ ...wheel, deltaX: 100 }, plot, view)).toEqual({ kind: 'pan', seconds: 10 })
    expect(wheelIntent({ ...wheel, deltaY: -50, shiftKey: true }, plot, view)).toEqual({ kind: 'pan', seconds: -5 })
  })
  it('counts lines and pages as more than pixels, and pinch as a stronger zoom', () => {
    const px = wheelIntent({ ...wheel, deltaY: -1 }, plot, view)
    const line = wheelIntent({ ...wheel, deltaY: -1, deltaMode: 1 }, plot, view)
    const pinch = wheelIntent({ ...wheel, deltaY: -1, ctrlKey: true }, plot, view)
    const factor = (i: ReturnType<typeof wheelIntent>): number => (i.kind === 'zoom' ? i.factor : 0)
    expect(factor(line)).toBeGreaterThan(factor(px))
    expect(factor(pinch)).toBeGreaterThan(factor(px))
  })
})

describe('edgePush', () => {
  it('is 0 away from the edges and ramps up toward them', () => {
    expect(edgePush(500, 0, 1000)).toBe(0)
    expect(edgePush(0, 0, 1000)).toBe(-1)
    expect(edgePush(-50, 0, 1000)).toBe(-1)
    expect(edgePush(1000, 0, 1000)).toBe(1)
    expect(edgePush(EDGE_PUSH_PX / 2, 0, 1000)).toBeCloseTo(-0.5)
    expect(edgePush(1000 - EDGE_PUSH_PX / 2, 0, 1000)).toBeCloseTo(0.5)
  })
})

describe('canZoomIn', () => {
  it('stops at the minimum span', () => {
    expect(canZoomIn({ start: 0, span: 10 }, 100)).toBe(true)
    expect(canZoomIn({ start: 0, span: MIN_SPAN_S }, 100)).toBe(false)
    expect(canZoomIn(fullView(1), 1)).toBe(false)
  })
})
