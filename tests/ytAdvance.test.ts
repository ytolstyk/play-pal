import { describe, expect, it } from 'vitest'
import { isAutoAdvance, showsTrackAlive, YT_RECENT_MS } from '../src/shared/ytAdvance'

describe('isAutoAdvance', () => {
  it('is a leave soon after playing with nobody active in the page', () => {
    expect(isAutoAdvance(null, 1000, 1040)).toBe(true)
    expect(isAutoAdvance(null, 1000, 1000 + YT_RECENT_MS)).toBe(true)
  })
  it('is not when the user clicked or typed in the page recently, even in the page before a full load', () => {
    expect(isAutoAdvance(1000, 1000, 1040)).toBe(false)
    expect(isAutoAdvance(1000, 1500, 1000 + YT_RECENT_MS)).toBe(false)
  })
  it('is once that activity is old enough to be unrelated', () => {
    expect(isAutoAdvance(1000, 7000, 1000 + YT_RECENT_MS + 1)).toBe(true)
  })
  it('is not when the track page was not playing, or stopped a while ago', () => {
    expect(isAutoAdvance(null, null, 1040)).toBe(false)
    expect(isAutoAdvance(null, 1000, 1000 + YT_RECENT_MS + 1)).toBe(false)
  })
})

describe('showsTrackAlive', () => {
  it('is playing, or finished at the end of the track', () => {
    expect(showsTrackAlive({ t: 10, duration: 200, playing: true })).toBe(true)
    expect(showsTrackAlive({ t: 200, duration: 200, playing: false })).toBe(true)
  })
  it('pins the end slack', () => {
    expect(showsTrackAlive({ t: 199.5, duration: 200, playing: false })).toBe(true)
    expect(showsTrackAlive({ t: 199.4, duration: 200, playing: false })).toBe(false)
  })
  it('is not a paused page mid-track, or one with no length yet', () => {
    expect(showsTrackAlive({ t: 10, duration: 200, playing: false })).toBe(false)
    expect(showsTrackAlive({ t: 0, duration: 0, playing: false })).toBe(false)
  })
})
