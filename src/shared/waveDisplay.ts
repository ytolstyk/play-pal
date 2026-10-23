import { clamp } from './guards'
import { bandSlice, encodeLevel, MAX_LEVEL_BYTE, WAVE_BANDS } from './waveform'

/** The views of a single band, in the order the bands are recorded. */
export const BAND_VIEWS = ['bass', 'lowmid', 'mid', 'high'] as const

/** What the timeline draws: every band blended into one, or a single band. */
export type WaveView = 'mix' | (typeof BAND_VIEWS)[number]

export const WAVE_VIEWS: readonly { value: WaveView; label: string; title: string }[] = [
  { value: 'mix', label: 'Mix', title: 'All bands, those that change more counting for more' },
  { value: 'bass', label: 'Bass', title: 'Kick and bass, 30–200 Hz' },
  { value: 'lowmid', label: 'Low-mid', title: 'Body of guitars, keys, vocals and snare, 200–800 Hz' },
  { value: 'mid', label: 'Mid', title: 'Bite of guitars, vocals and snare, 0.8–4 kHz' },
  { value: 'high', label: 'High', title: 'Cymbals, hi-hats and air, 4–16 kHz' }
]

export const isWaveView = (v: unknown): v is WaveView => WAVE_VIEWS.some((o) => o.value === v)

declare const displayBrand: unique symbol
/**
 * One band of bytes ready to draw: 0 where nothing was recorded, else 1-255 as a share of the full height.
 * Only `displayBins` makes one, so a raw recording (several bands in a row) can't be drawn by mistake.
 */
export type DisplayBins = Uint8Array & { readonly [displayBrand]: true }

/** The quietest and loudest bins are left out when deciding what fills the height, so one spike or dropout doesn't flatten the rest. */
const LOW_PERCENTILE = 0.05
const HIGH_PERCENTILE = 0.98
/** Level bytes (about 2.5 per dB, so 8 dB) the stretch never magnifies past, so a band that hardly moves doesn't have its noise blown up. */
const MIN_SPREAD = 20
/**
 * After the stretch, levels are raised to this power, so what a band sustains sits low and only hits and strums
 * reach the top; at 1 a band that is always near its loudest draws as a solid block.
 */
const EXPANSION = 1.6
/** Percentiles and spread are read off about this many evenly spaced bins, so a long track costs no more to measure than a short one. */
const MAX_STAT_SAMPLES = 8192
/** With fewer recorded bins than this in the sample (a track just started), every bin is read instead. */
const MIN_STAT_SAMPLES = 256

interface Curve {
  /** Level byte -> displayed byte; entry 0 (unrecorded) stays 0. */
  lut: Uint8Array
  /** How much the band moved, as the standard deviation of its recorded level bytes. */
  deviation: number
}

/** The level byte at or below which `share` of the `total` recorded bins lie (bytes 1-255; 0 is "unrecorded"). */
function percentileOf(counts: Uint32Array, total: number, share: number): number {
  const target = total * share
  let seen = 0
  for (let v = 1; v <= MAX_LEVEL_BYTE; v++) {
    seen += counts[v]
    if (seen >= target) return v
  }
  return MAX_LEVEL_BYTE
}

/** Histogram and moments of the recorded level bytes among every `stride`th bin. */
function sample(values: Uint8Array, stride: number): { counts: Uint32Array; total: number; sum: number; sumSquares: number } {
  const counts = new Uint32Array(MAX_LEVEL_BYTE + 1)
  let total = 0
  let sum = 0
  let sumSquares = 0
  for (let i = 0; i < values.length; i += stride) {
    const v = values[i]
    if (v === 0) continue
    counts[v]++
    total++
    sum += v
    sumSquares += v * v
  }
  return { counts, total, sum, sumSquares }
}

/**
 * How to spread the span between a band's quiet and loud levels over the full height, so a band that
 * sits near its top all song still shows its dips, then raise the result to `expansion` (1 leaves it as stretched).
 */
function curveOf(values: Uint8Array, expansion: number): Curve {
  const lut = new Uint8Array(MAX_LEVEL_BYTE + 1)
  // An odd stride cannot lock onto a steady beat, which would sample the same phase of it throughout.
  let stride = Math.max(1, Math.ceil(values.length / MAX_STAT_SAMPLES)) | 1
  let { counts, total, sum, sumSquares } = sample(values, stride)
  if (total < MIN_STAT_SAMPLES && stride > 1) ({ counts, total, sum, sumSquares } = sample(values, (stride = 1)))
  if (total === 0) return { lut, deviation: 0 }
  const mean = sum / total
  const deviation = Math.sqrt(Math.max(0, sumSquares / total - mean * mean))
  const low = percentileOf(counts, total, LOW_PERCENTILE)
  const high = percentileOf(counts, total, HIGH_PERCENTILE)
  const window = Math.max(MIN_SPREAD, high - low)
  // A band too flat to stretch is centred (before the expansion) rather than pinned to the floor.
  const floor = low - (window - (high - low)) / 2
  for (let v = 1; v <= MAX_LEVEL_BYTE; v++) {
    const position = clamp((v - floor) / window, 0, 1)
    lut[v] = encodeLevel(position ** expansion)
  }
  return { lut, deviation }
}

function applyCurve(values: Uint8Array, lut: Uint8Array): DisplayBins {
  const out = new Uint8Array(values.length)
  for (let i = 0; i < values.length; i++) out[i] = lut[values[i]]
  return out as DisplayBins // branded here: the only place one is made
}

/**
 * Every band at once, those that move more counting for more, then stretched again since averaging narrows the range.
 * Only that last pass expands, so the mix is bent once, like a single band.
 */
function blend(bands: readonly Uint8Array[]): DisplayBins {
  const curves = bands.map((band) => curveOf(band, 1))
  const total = curves.reduce((sum, c) => sum + c.deviation, 0)
  const shares = curves.map((c) => (total > 0 ? c.deviation / total : 1 / bands.length))
  const mixed = new Uint8Array(bands[0].length)
  for (let i = 0; i < mixed.length; i++) {
    if (bands[0][i] === 0) continue // recorded in every band at once (see WaveRecorder)
    let level = 0
    for (let b = 0; b < bands.length; b++) level += shares[b] * curves[b].lut[bands[b][i]]
    mixed[i] = clamp(Math.round(level), 1, MAX_LEVEL_BYTE)
  }
  return applyCurve(mixed, curveOf(mixed, EXPANSION).lut)
}

/**
 * Recorded bins (WAVE_BANDS bands one after another, see WaveRecorder) as the one band of bytes the timeline draws.
 * Levels are relative to the band's own range over the whole track, not absolute loudness.
 */
export function displayBins(bins: Uint8Array, view: WaveView): DisplayBins {
  const single = BAND_VIEWS.findIndex((v) => v === view)
  if (single >= 0) {
    const band = bandSlice(bins, single)
    return applyCurve(band, curveOf(band, EXPANSION).lut)
  }
  return blend(Array.from({ length: WAVE_BANDS }, (_, b) => bandSlice(bins, b)))
}
