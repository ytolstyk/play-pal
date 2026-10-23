import { describe, expect, it } from 'vitest'
import { ANALYSER_MAX_DB, ANALYSER_MIN_DB, FREQ_BINS } from '../src/shared/audio'
import { BAND_VIEWS, displayBins, isWaveView, WAVE_VIEWS } from '../src/shared/waveDisplay'
import {
  bandLevels,
  binCount,
  decodeWaveFile,
  encodeWaveFile,
  isWaveBins,
  levelOf,
  MAX_WAVE_BYTES,
  WAVE_BANDS,
  WAVE_BAND_EDGES_HZ,
  WAVE_BINS_PER_SECOND,
  WAVE_FILE_FORMAT,
  WaveRecorder
} from '../src/shared/waveform'

const BPS = WAVE_BINS_PER_SECOND
const flat = (level: number): number[] => new Array<number>(WAVE_BANDS).fill(level)
/** Bytes of band `band` in a recording. */
const bandOf = (r: WaveRecorder, band: number): Uint8Array => r.bins.subarray(band * r.binTotal, (band + 1) * r.binTotal)

/** A spectrum with `byte` in bins [from, to) and silence elsewhere. */
function spectrum(from: number, to: number, byte: number): Uint8Array {
  const freq = new Uint8Array(FREQ_BINS)
  freq.fill(byte, from, to)
  return freq
}

describe('bandLevels', () => {
  const out = new Float64Array(WAVE_BANDS)

  it('puts energy in the band it falls in and none in the others', () => {
    bandLevels(spectrum(1, 4, 200), 1, out) // ~100-170 Hz: bass
    expect(out[0]).toBeGreaterThan(0.5)
    expect(out[1]).toBeLessThan(0.1)
    expect(out[3]).toBeLessThan(0.1)
    bandLevels(spectrum(120, 300, 200), 1, out) // 5-13 kHz: high
    expect(out[3]).toBeGreaterThan(0.5)
    expect(out[0]).toBeLessThan(0.1)
  })

  it('divides the volume back out', () => {
    bandLevels(spectrum(1, 4, 150), 1, out)
    const full = out[0]
    bandLevels(spectrum(1, 4, 150 - 15), 0.5, out) // 6 dB down is ~15 bytes, so a lower byte at half volume reads the same
    expect(out[0]).toBeGreaterThan(full - 0.1)
    bandLevels(spectrum(1, 4, 150), 0.5, out)
    expect(out[0]).toBeGreaterThan(full)
  })

  it('treats a volume that is not a number as full volume', () => {
    bandLevels(spectrum(1, 4, 150), 1, out)
    const full = out[0]
    bandLevels(spectrum(1, 4, 150), NaN, out)
    expect(out[0]).toBe(full)
  })

  it('reads silence as 0', () => {
    bandLevels(new Uint8Array(FREQ_BINS), 1, out)
    for (const level of out) expect(level).toBeCloseTo(0, 6)
  })
})

describe('WaveRecorder', () => {
  it('sizes itself from the duration', () => {
    expect(binCount(0)).toBe(0)
    expect(binCount(NaN)).toBe(0)
    expect(new WaveRecorder(10).bins.length).toBe(10 * BPS * WAVE_BANDS)
  })

  it('stores silence as a recorded level, distinct from nothing recorded', () => {
    const r = new WaveRecorder(10)
    r.recordLevels(1, flat(0))
    expect(r.bins[BPS]).toBe(1)
    expect(r.bins[0]).toBe(0)
    expect(levelOf(r.bins[BPS])).toBe(0)
  })

  it('keeps the loudest level seen in a bin within a session', () => {
    const r = new WaveRecorder(10)
    r.recordLevels(2, flat(0.8))
    r.recordLevels(2.01, flat(0.2))
    expect(levelOf(r.bins[2 * BPS])).toBeCloseTo(0.8, 1)
  })

  it('leaves bins from an earlier session alone and fills only the gaps', () => {
    const first = new WaveRecorder(10)
    first.recordLevels(1, flat(0.5))
    const again = new WaveRecorder(10, first.bins)
    const before = again.bins[BPS]
    expect(again.recordLevels(1, flat(1))).toBe(false)
    expect(again.bins[BPS]).toBe(before)
    expect(again.recordLevels(3, flat(0.4))).toBe(true)
  })

  it('keeps each band apart and the loudest level per band within a bin', () => {
    const r = new WaveRecorder(10)
    r.recordLevels(2, [0.2, 0.4, 0.6, 0.8])
    r.recordLevels(2.01, [0.9, 0.1, 0.1, 0.1])
    const at = (band: number): number => levelOf(bandOf(r, band)[2 * BPS])
    expect([at(0), at(1), at(2), at(3)].map((v) => Math.round(v * 10))).toEqual([9, 4, 6, 8])
  })

  it('reloads a saved recording band by band', () => {
    const first = new WaveRecorder(10)
    first.recordLevels(1, [0.2, 0.4, 0.6, 0.8])
    const again = new WaveRecorder(10, first.bins)
    for (let band = 0; band < WAVE_BANDS; band++) expect(Array.from(bandOf(again, band))).toEqual(Array.from(bandOf(first, band)))
    expect(again.coverage).toBeCloseTo(first.coverage)
  })

  it('ignores a recording from before there were bands', () => {
    const legacy = new Uint8Array(10 * BPS).fill(100)
    expect(new WaveRecorder(10, legacy).coverage).toBe(0)
  })

  it('treats a bin missing from one band as missing from all', () => {
    const first = new WaveRecorder(10)
    first.recordLevels(1, flat(0.5))
    first.recordLevels(2, flat(0.5))
    const damaged = first.bins.slice()
    damaged[3 * first.binTotal + BPS] = 0 // band 3 lost its bin at 1 s
    const again = new WaveRecorder(10, damaged)
    expect(again.hasGap(1, 1.01)).toBe(true)
    expect(bandOf(again, 0)[BPS]).toBe(0)
    expect(bandOf(again, 0)[2 * BPS]).not.toBe(0)
  })

  it('ignores a saved recording of a different length', () => {
    const other = new WaveRecorder(30)
    other.recordLevels(1, flat(0.5))
    expect(new WaveRecorder(10, other.bins).coverage).toBe(0)
  })

  it('joins nearby samples but not across a seek', () => {
    const r = new WaveRecorder(60)
    r.recordLevels(1, flat(0.5))
    r.recordLevels(1 + 3 / BPS, flat(0.5))
    expect(bandOf(r, 0).slice(BPS, BPS + 4).every((b) => b !== 0)).toBe(true)
    r.recordLevels(30, flat(0.5))
    expect(r.bins[BPS + 10]).toBe(0)
    expect(r.bins[30 * BPS - 2]).toBe(0)
  })

  it('does not join a sample to the one before a break()', () => {
    const r = new WaveRecorder(60)
    r.recordLevels(1, flat(0.5))
    r.startNewStretch()
    r.recordLevels(1 + 3 / BPS, flat(0.5))
    expect(r.bins[BPS + 1]).toBe(0)
  })

  it('reports completion once everything but a short tail is recorded', () => {
    const r = new WaveRecorder(4)
    const n = r.binTotal
    for (let i = 0; i < n - 4; i++) r.recordLevels((i + 0.5) / BPS, flat(0.3))
    expect(r.complete).toBe(false)
    r.recordLevels((n - 4 + 0.5) / BPS, flat(0.3))
    expect(r.complete).toBe(true)
    expect(new WaveRecorder(4).complete).toBe(false)
    expect(new WaveRecorder(0).complete).toBe(false)
  })

  it('ignores positions that make no sense', () => {
    const r = new WaveRecorder(4)
    expect(r.recordLevels(-1, flat(0.5))).toBe(false)
    expect(r.recordLevels(NaN, flat(0.5))).toBe(false)
    expect(r.recordLevels(999, flat(0.5))).toBe(true) // past the end lands in the last bin
    expect(bandOf(r, 0)[r.binTotal - 1]).not.toBe(0)
  })
})

describe('wave files', () => {
  it('round-trips a recording', () => {
    const r = new WaveRecorder(10)
    r.recordLevels(1, flat(0.5))
    expect(Array.from(decodeWaveFile(encodeWaveFile(r.bins)) ?? [])).toEqual(Array.from(r.bins))
  })

  it('reads a file in another format, or an empty one, as not recorded', () => {
    expect(decodeWaveFile(new Uint8Array(0))).toBeNull()
    expect(decodeWaveFile(new Uint8Array(10 * BPS).fill(100))).toBeNull() // before there were bands
    const file = encodeWaveFile(new Uint8Array(8))
    file[3]++ // the format number
    expect(decodeWaveFile(file)).toBeNull()
    // A file from before there was a header that happens to begin with the format number.
    const legacy = new Uint8Array(9).fill(100)
    legacy[0] = WAVE_FILE_FORMAT
    expect(decodeWaveFile(legacy)).toBeNull()
    expect(decodeWaveFile(encodeWaveFile(new Uint8Array(0)))).toBeNull()
  })

  it('accepts only whole bands within the size limit', () => {
    expect(isWaveBins(new Uint8Array(WAVE_BANDS * 5))).toBe(true)
    expect(isWaveBins(new Uint8Array(WAVE_BANDS * 5 + 1))).toBe(false)
    expect(isWaveBins(new Uint8Array(MAX_WAVE_BYTES + WAVE_BANDS))).toBe(false)
    expect(isWaveBins([1, 2, 3, 4])).toBe(false)
  })
})

describe('wave files', () => {
  // The recorded levels mean something only for these bands and this dB scale; change either and WAVE_FILE_FORMAT must go up.
  it('has a format number for the bands and scale it holds', () => {
    expect(`${WAVE_FILE_FORMAT}:${ANALYSER_MIN_DB}..${ANALYSER_MAX_DB}:${WAVE_BAND_EDGES_HZ.join(',')}`).toBe(
      '3:-100..0:30,200,800,4000,16000'
    )
  })
})

describe('wave views', () => {
  it('has a view for every band, and no more', () => {
    expect(BAND_VIEWS.length).toBe(WAVE_BANDS)
    expect(WAVE_VIEWS.map((v) => v.value)).toEqual(['mix', ...BAND_VIEWS])
  })
  it('recognises only its own names', () => {
    expect(isWaveView('mix')).toBe(true)
    expect(isWaveView('treble')).toBe(false)
    expect(isWaveView(null)).toBe(false)
  })
})

describe('displayBins', () => {
  /** A track of `seconds`, each band's level given per second by `level(band, second)`. */
  function track(seconds: number, level: (band: number, second: number) => number): Uint8Array {
    const r = new WaveRecorder(seconds)
    for (let i = 0; i < seconds * BPS; i++) {
      const second = Math.floor(i / BPS)
      r.recordLevels((i + 0.5) / BPS, Array.from({ length: WAVE_BANDS }, (_, b) => level(b, second)))
    }
    return r.bins
  }

  it('stretches a loud band that only moves a little over the full height', () => {
    const bins = track(40, (b, s) => (b === 0 ? 0.9 + (s % 2 === 0 ? 0.06 : -0.06) : 0.5))
    const shown = displayBins(bins, 'bass')
    const lows = shown.filter((v) => v > 0 && v < 100).length
    const highs = shown.filter((v) => v > 200).length
    expect(lows).toBeGreaterThan(0)
    expect(highs).toBeGreaterThan(0)
  })

  it('leaves unrecorded bins at 0', () => {
    const r = new WaveRecorder(10)
    r.recordLevels(1, flat(0.5))
    const shown = displayBins(r.bins, 'mix')
    expect(shown.length).toBe(r.binTotal)
    expect(shown[0]).toBe(0)
    expect(shown[BPS]).not.toBe(0)
  })

  it('lets the band that moves decide the mix', () => {
    // Bass is constant; the high band is silent for 20 s, then loud.
    const bins = track(40, (b, s) => (b === 0 ? 0.8 : b === 3 ? (s < 20 ? 0.1 : 0.7) : 0.5))
    const shown = displayBins(bins, 'mix')
    const quiet = shown[5 * BPS]
    const loud = shown[30 * BPS]
    expect(loud - quiet).toBeGreaterThan(150)
  })

  it('shows an entirely flat track as a steady middle, not as a spike or nothing', () => {
    const shown = displayBins(track(20, () => 0.6), 'mix')
    const mid = shown[10 * BPS]
    expect(mid).toBeGreaterThan(60)
    expect(mid).toBeLessThan(200)
    expect(shown[3 * BPS]).toBe(mid)
  })

  it('still shows a few recorded bins at the start of a long track', () => {
    // 10 h: far more bins than are measured, so the few recorded ones must not be stepped over.
    const r = new WaveRecorder(36_000)
    for (let i = 0; i < 50; i++) r.recordLevels((1000 + i + 0.5) / BPS, [0.2 + (i % 5) / 10, 0.5, 0.5, 0.5])
    for (const view of ['bass', 'mix'] as const) {
      const shown = displayBins(r.bins, view)
      expect(shown.slice(1000, 1050).every((v) => v > 0)).toBe(true)
    }
  })

  it('handles an empty recording', () => {
    expect(displayBins(new Uint8Array(0), 'mix').length).toBe(0)
    expect(displayBins(new WaveRecorder(10).bins, 'high').every((v) => v === 0)).toBe(true)
  })
})
