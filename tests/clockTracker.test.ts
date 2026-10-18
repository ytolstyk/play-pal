import { describe, expect, it } from 'vitest'
import { ClockTracker } from '../src/renderer/src/clockTracker'

describe('ClockTracker', () => {
  it('extrapolates between clock updates at the playback rate', () => {
    const c = new ClockTracker(10, 0)
    expect(c.read(10, 100, 1).t).toBeCloseTo(10.1)
    expect(c.read(10, 100, 2).t).toBeCloseTo(10.2)
  })

  it('takes a clock update that matches the extrapolation as continuous', () => {
    const c = new ClockTracker(10, 0)
    const r = c.read(10.1, 100, 1)
    expect(r.jumped).toBe(false)
    expect(r.t).toBeCloseTo(10.1)
  })

  it('notices a seek in either direction', () => {
    expect(new ClockTracker(10, 0).read(30, 100, 1).jumped).toBe(true)
    expect(new ClockTracker(10, 0).read(2, 100, 1).jumped).toBe(true)
  })

  it('reports a clock that stopped updating as stale', () => {
    const c = new ClockTracker(10, 0)
    expect(c.read(10, 300, 1).stale).toBe(false)
    expect(c.read(10, 500, 1).stale).toBe(true)
    expect(c.read(10.6, 600, 1).stale).toBe(false)
  })
})
