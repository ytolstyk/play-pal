import { describe, expect, it } from 'vitest'
import { clampInt } from '../src/shared/guards'
import { readClock, readRect, readYtCommand, readYtPageClock } from '../src/shared/payloads'

const base = { t: 5, duration: 100, playing: true, rate: 1 }

describe('payload readers', () => {
  it('readClock needs a track id and sane numbers', () => {
    expect(readClock({ ...base, trackId: 'a' })).toEqual({ ...base, trackId: 'a' })
    expect(readClock(base)).toBeNull()
    expect(readClock({ ...base, trackId: 'a', t: NaN })).toBeNull()
    expect(readClock({ ...base, trackId: 'a', rate: 0 })).toBeNull()
    expect(readClock(null)).toBeNull()
  })
  it('clamps negative t and bad duration instead of rejecting', () => {
    expect(readClock({ ...base, trackId: 'a', t: -3, duration: NaN })).toMatchObject({ t: 0, duration: 0 })
  })
  it('readYtPageClock needs videoId and sentAt', () => {
    expect(readYtPageClock({ ...base, videoId: 'x', sentAt: 1 })).toMatchObject({ videoId: 'x', sentAt: 1 })
    expect(readYtPageClock({ ...base, videoId: null, sentAt: 1 })).toBeNull()
    expect(readYtPageClock({ ...base, videoId: 'x' })).toBeNull()
  })
  it('readYtCommand', () => {
    expect(readYtCommand({ cmd: 'play' })).toEqual({ cmd: 'play' })
    expect(readYtCommand({ cmd: 'seek', value: 12 })).toEqual({ cmd: 'seek', value: 12 })
    expect(readYtCommand({ cmd: 'seek', value: -1 })).toBeNull()
    expect(readYtCommand({ cmd: 'seek' })).toBeNull()
    expect(readYtCommand({ cmd: 'eval', value: 1 })).toBeNull()
  })
  it('readRect rejects degenerate or absurd rectangles', () => {
    expect(readRect({ x: 1, y: 2, width: 3, height: 4 })).toEqual({ x: 1, y: 2, width: 3, height: 4 })
    expect(readRect({ x: 1, y: 2, width: 0, height: 4 })).toBeNull()
    expect(readRect({ x: 1, y: 2, width: 1e9, height: 4 })).toBeNull()
    expect(readRect(null)).toBeNull()
  })
})

describe('clampInt', () => {
  it('rounds, clamps and maps junk to min', () => {
    expect(clampInt('5.6', 1, 16)).toBe(6)
    expect(clampInt('99', 1, 16)).toBe(16)
    expect(clampInt('', 1, 16)).toBe(1)
    expect(clampInt('abc', 0, 127)).toBe(0)
  })
})
