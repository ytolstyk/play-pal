import { clamp } from './guards'
import { MAX_TIME_S } from './types'

/** Resolution of a track's recorded waveform: one level byte per bin. */
export const WAVE_BINS_PER_SECOND = 25
export const MAX_WAVE_BINS = MAX_TIME_S * WAVE_BINS_PER_SECOND

/** A bin value of 0 means "not recorded yet"; recorded levels are 1-255. */
const MAX_LEVEL_BYTE = 255
/** Time-domain samples are unsigned bytes centred on this value. */
const WAVE_CENTER = 128
/** Consecutive samples this many bins apart are one stretch of playback; a wider gap is a seek. */
const MAX_FILL_BINS = 4
/** A saved recording this much shorter or longer than the track is still taken as its recording (duration rounding). */
const SAVED_LENGTH_TOLERANCE_BINS = 2
/** Quietest loudness the display stretches to full height. */
const MIN_DISPLAY_CEILING = 0.05
/** A track counts as fully recorded with this many bins missing: the last sample of a song rarely lands in its final bin. */
const SLACK_BINS = 3

export const binCount = (duration: number): number =>
  Number.isFinite(duration) && duration > 0 ? Math.min(MAX_WAVE_BINS, Math.ceil(duration * WAVE_BINS_PER_SECOND)) : 0

/** Loudest sample of an analyser time-domain slice, 0-1. */
export function peakLevel(wave: Uint8Array): number {
  let peak = 0
  for (let i = 0; i < wave.length; i++) {
    const d = Math.abs(wave[i] - WAVE_CENTER)
    if (d > peak) peak = d
  }
  return Math.min(1, peak / WAVE_CENTER)
}

/** A 0-1 level as a recorded byte (1-255; 0 is reserved for "not recorded"). */
export const encodeLevel = (level: number): number => 1 + Math.round(clamp(level, 0, 1) * (MAX_LEVEL_BYTE - 1))

/** A recorded byte (1-255) back to a 0-1 level. */
export const levelOf = (bin: number): number => (bin - 1) / (MAX_LEVEL_BYTE - 1)

/**
 * Fills a waveform as a track plays. Bins recorded in an earlier session are kept as they are;
 * within one session a bin keeps the loudest level seen, so replaying a stretch never lowers it.
 */
export class WaveRecorder {
  readonly bins: Uint8Array
  private readonly writtenThisSession: Uint8Array
  private recordedCount = 0
  private lastBin = -1

  /** `saved` is a previous recording; it is used only when it is about as long as the track. */
  constructor(duration: number, saved?: Uint8Array | null) {
    const n = binCount(duration)
    this.bins = new Uint8Array(n)
    this.writtenThisSession = new Uint8Array(n)
    if (saved && Math.abs(saved.length - n) <= SAVED_LENGTH_TOLERANCE_BINS) this.bins.set(saved.subarray(0, n))
    for (const b of this.bins) if (b !== 0) this.recordedCount++
  }

  get complete(): boolean {
    return this.bins.length > 0 && this.recordedCount >= this.bins.length - SLACK_BINS
  }

  /** Share of the track recorded so far, 0-1. */
  get coverage(): number {
    return this.bins.length > 0 ? this.recordedCount / this.bins.length : 0
  }

  /** Whether any bin overlapping [from, to) seconds is still unrecorded. */
  hasGap(from: number, to: number): boolean {
    const end = Math.min(this.bins.length, Math.ceil(to * WAVE_BINS_PER_SECOND))
    for (let i = Math.max(0, Math.floor(from * WAVE_BINS_PER_SECOND)); i < end; i++) if (this.bins[i] === 0) return true
    return false
  }

  /** The playhead jumped (seek, loop): the next sample must not be joined to the previous one. */
  startNewStretch(): void {
    this.lastBin = -1
  }

  /** Records the level (0-1) heard at track time `t`. Returns whether any bin changed. */
  recordLevel(t: number, level: number): boolean {
    const n = this.bins.length
    if (n === 0 || !Number.isFinite(t) || t < 0) return false
    const bin = Math.min(n - 1, Math.floor(t * WAVE_BINS_PER_SECOND))
    const value = encodeLevel(level)
    const continuesStretch = this.lastBin >= 0 && bin > this.lastBin && bin - this.lastBin <= MAX_FILL_BINS
    const from = continuesStretch ? this.lastBin + 1 : bin
    this.lastBin = bin
    let changed = false
    for (let i = from; i <= bin; i++) changed = this.write(i, value) || changed
    return changed
  }

  private write(bin: number, value: number): boolean {
    const old = this.bins[bin]
    if (old !== 0 && this.writtenThisSession[bin] === 0) return false // from an earlier session
    this.writtenThisSession[bin] = 1
    if (value <= old) return false
    this.bins[bin] = value
    if (old === 0) this.recordedCount++
    return true
  }
}

/** Loudness the display treats as full height: a high percentile, so one spike doesn't flatten the rest. */
export function displayCeiling(bins: Uint8Array, percentile = 0.98): number {
  const counts = new Uint32Array(MAX_LEVEL_BYTE + 1)
  let total = 0
  for (const b of bins) {
    if (b === 0) continue
    counts[b]++
    total++
  }
  if (total === 0) return 1
  const target = total * percentile
  let seen = 0
  for (let v = 1; v <= MAX_LEVEL_BYTE; v++) {
    seen += counts[v]
    if (seen >= target) return Math.max(MIN_DISPLAY_CEILING, levelOf(v))
  }
  return 1
}
