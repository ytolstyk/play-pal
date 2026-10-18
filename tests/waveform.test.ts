import { describe, expect, it } from 'vitest'
import { binCount, displayCeiling, levelOf, peakLevel, WAVE_BINS_PER_SECOND, WaveRecorder } from '../src/shared/waveform'

const BPS = WAVE_BINS_PER_SECOND

describe('peakLevel', () => {
  it('is 0 for silence and 1 for full swing', () => {
    expect(peakLevel(new Uint8Array(64).fill(128))).toBe(0)
    expect(peakLevel(Uint8Array.from([128, 0, 128]))).toBe(1)
    expect(peakLevel(Uint8Array.from([128, 192, 128]))).toBeCloseTo(0.5)
  })
})

describe('WaveRecorder', () => {
  it('sizes itself from the duration', () => {
    expect(binCount(0)).toBe(0)
    expect(binCount(NaN)).toBe(0)
    expect(new WaveRecorder(10).bins.length).toBe(10 * BPS)
  })

  it('stores silence as a recorded level, distinct from nothing recorded', () => {
    const r = new WaveRecorder(10)
    r.recordLevel(1, 0)
    expect(r.bins[BPS]).toBe(1)
    expect(r.bins[0]).toBe(0)
    expect(levelOf(r.bins[BPS])).toBe(0)
  })

  it('keeps the loudest level seen in a bin within a session', () => {
    const r = new WaveRecorder(10)
    r.recordLevel(2, 0.8)
    r.recordLevel(2.01, 0.2)
    expect(levelOf(r.bins[2 * BPS])).toBeCloseTo(0.8, 1)
  })

  it('leaves bins from an earlier session alone and fills only the gaps', () => {
    const first = new WaveRecorder(10)
    first.recordLevel(1, 0.5)
    const again = new WaveRecorder(10, first.bins)
    const before = again.bins[BPS]
    expect(again.recordLevel(1, 1)).toBe(false)
    expect(again.bins[BPS]).toBe(before)
    expect(again.recordLevel(3, 0.4)).toBe(true)
  })

  it('ignores a saved recording of a different length', () => {
    const other = new WaveRecorder(30)
    other.recordLevel(1, 0.5)
    expect(new WaveRecorder(10, other.bins).coverage).toBe(0)
  })

  it('joins nearby samples but not across a seek', () => {
    const r = new WaveRecorder(60)
    r.recordLevel(1, 0.5)
    r.recordLevel(1 + 3 / BPS, 0.5)
    expect(r.bins.slice(BPS, BPS + 4).every((b) => b !== 0)).toBe(true)
    r.recordLevel(30, 0.5)
    expect(r.bins[BPS + 10]).toBe(0)
    expect(r.bins[30 * BPS - 2]).toBe(0)
  })

  it('does not join a sample to the one before a break()', () => {
    const r = new WaveRecorder(60)
    r.recordLevel(1, 0.5)
    r.startNewStretch()
    r.recordLevel(1 + 3 / BPS, 0.5)
    expect(r.bins[BPS + 1]).toBe(0)
  })

  it('reports completion once everything but a short tail is recorded', () => {
    const r = new WaveRecorder(4)
    const n = r.bins.length
    for (let i = 0; i < n - 4; i++) r.recordLevel((i + 0.5) / BPS, 0.3)
    expect(r.complete).toBe(false)
    r.recordLevel((n - 4 + 0.5) / BPS, 0.3)
    expect(r.complete).toBe(true)
    expect(new WaveRecorder(4).complete).toBe(false)
    expect(new WaveRecorder(0).complete).toBe(false)
  })

  it('ignores positions that make no sense', () => {
    const r = new WaveRecorder(4)
    expect(r.recordLevel(-1, 0.5)).toBe(false)
    expect(r.recordLevel(NaN, 0.5)).toBe(false)
    expect(r.recordLevel(999, 0.5)).toBe(true) // past the end lands in the last bin
    expect(r.bins[r.bins.length - 1]).not.toBe(0)
  })
})

describe('displayCeiling', () => {
  it('is not pulled up by a single spike', () => {
    const r = new WaveRecorder(40)
    for (let i = 0; i < 39 * BPS; i++) r.recordLevel((i + 0.5) / BPS, 0.4)
    r.recordLevel(10, 1)
    expect(displayCeiling(r.bins)).toBeLessThan(0.5)
  })
  it('is 1 with nothing recorded', () => {
    expect(displayCeiling(new Uint8Array(10))).toBe(1)
  })
})
