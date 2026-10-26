import { describe, expect, it } from 'vitest'
import { isAutoAdvance, YT_RECENT_MS } from '../src/shared/ytAdvance'

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
