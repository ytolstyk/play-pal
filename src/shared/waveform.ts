import { FREQ_BINS } from './audio'
import { clamp } from './guards'
import { MAX_TIME_S } from './types'

/** Resolution of a track's recorded waveform: one level byte per bin, per frequency band. */
export const WAVE_BINS_PER_SECOND = 25
export const MAX_WAVE_BINS = MAX_TIME_S * WAVE_BINS_PER_SECOND

/**
 * Frequency bands recorded for every bin, as [from, to) in Hz: the kick and bass, the body of guitars,
 * keys and vocals, their bite, and cymbals/air. A file holds them one after another (band 0's bins, then band 1's...).
 */
export const WAVE_BAND_EDGES_HZ = [30, 200, 800, 4000, 16000] as const
export const WAVE_BANDS = WAVE_BAND_EDGES_HZ.length - 1
export const MAX_WAVE_BYTES = MAX_WAVE_BINS * WAVE_BANDS
/**
 * Written ahead of a recording on disk: a magic and a format number. Bump the number whenever the bands,
 * their edges or the level scale change, so old files read as "not recorded". The magic keeps a file from
 * before there was a header (which began with a level byte) from passing as a current one.
 */
const WAVE_FILE_MAGIC = [0x50, 0x50, 0x57] as const // "PPW"
export const WAVE_FILE_FORMAT = 2
const WAVE_FILE_HEADER = [...WAVE_FILE_MAGIC, WAVE_FILE_FORMAT]

/** A bin value of 0 means "not recorded yet"; recorded levels are 1-255. */
export const MAX_LEVEL_BYTE = 255
/** The analyser maps this dB range onto its 0-255 spectrum bytes (the Web Audio defaults, which no feed changes). */
const ANALYSER_MIN_DB = -100
const ANALYSER_MAX_DB = -30
const ANALYSER_RANGE_DB = ANALYSER_MAX_DB - ANALYSER_MIN_DB
/** The feeds' sample rate is not sent along with a frame; the usual one puts the band edges within a few percent. */
const ASSUMED_SAMPLE_RATE = 44_100
/** Quietest volume divided back out (about -60 dB); below it the level would be amplified into noise. */
const MIN_VOLUME = 1e-3
/** Consecutive samples this many bins apart are one stretch of playback; a wider gap is a seek. */
const MAX_FILL_BINS = 4
/** A saved recording this much shorter or longer than the track is still taken as its recording (duration rounding). */
const SAVED_LENGTH_TOLERANCE_BINS = 2
/** A track counts as fully recorded with this many bins missing: the last sample of a song rarely lands in its final bin. */
const SLACK_BINS = 3

/** Bins per band of a recording (bands lie one after another). */
export const binTotalOf = (bins: Uint8Array): number => Math.floor(bins.length / WAVE_BANDS)

/** One band of a recording, without copying it. */
export const bandSlice = (bins: Uint8Array, band: number): Uint8Array => {
  const n = binTotalOf(bins)
  return bins.subarray(band * n, (band + 1) * n)
}

/** Whether `bytes` could be a recording: whole bands, and not more than a track can have. */
export const isWaveBins = (bytes: unknown): bytes is Uint8Array =>
  bytes instanceof Uint8Array && bytes.length <= MAX_WAVE_BYTES && bytes.length % WAVE_BANDS === 0

/** A recording as stored in a file: the header, then the bins. */
export function encodeWaveFile(bins: Uint8Array): Uint8Array {
  const file = new Uint8Array(WAVE_FILE_HEADER.length + bins.length)
  file.set(WAVE_FILE_HEADER)
  file.set(bins, WAVE_FILE_HEADER.length)
  return file
}

/** The bins of a stored file, or null for one that is not in the current format (including recordings from before there were bands). */
export function decodeWaveFile(file: Uint8Array): Uint8Array | null {
  if (file.length <= WAVE_FILE_HEADER.length || WAVE_FILE_HEADER.some((byte, i) => file[i] !== byte)) return null
  const bins = file.subarray(WAVE_FILE_HEADER.length)
  return isWaveBins(bins) ? bins : null
}

/** Spectrum bin where each band starts, with the end of the last band after it. */
const BAND_BIN_EDGES = WAVE_BAND_EDGES_HZ.map((hz) => clamp(Math.round((hz / (ASSUMED_SAMPLE_RATE / 2)) * FREQ_BINS), 1, FREQ_BINS))
/** Power of a spectrum byte, so bands are averaged as energy rather than as decibels. */
const POWER_OF_BYTE = Float64Array.from({ length: MAX_LEVEL_BYTE + 1 }, (_, b) =>
  Math.pow(10, (ANALYSER_MIN_DB + (b / MAX_LEVEL_BYTE) * ANALYSER_RANGE_DB) / 10)
)

export const binCount = (duration: number): number =>
  Number.isFinite(duration) && duration > 0 ? Math.min(MAX_WAVE_BINS, Math.ceil(duration * WAVE_BINS_PER_SECOND)) : 0

/**
 * Level 0-1 of each band of an analyser spectrum, on a dB scale (so a quiet instrument entering still moves it),
 * written into `out`. The analyser hears the track after the volume, so `volume` (0-1) is divided back out.
 */
export function bandLevels(freq: Uint8Array, volume: number, out: Float64Array): void {
  const volumeDb = 20 * Math.log10(Number.isFinite(volume) ? clamp(volume, MIN_VOLUME, 1) : 1) // amplitude ratio
  for (let band = 0; band < WAVE_BANDS; band++) {
    const from = BAND_BIN_EDGES[band]
    const to = Math.min(freq.length, BAND_BIN_EDGES[band + 1])
    if (to <= from) {
      out[band] = 0
      continue
    }
    let power = 0
    for (let i = from; i < to; i++) power += POWER_OF_BYTE[freq[i]]
    const db = 10 * Math.log10(power / (to - from)) - volumeDb // power ratio
    out[band] = clamp((db - ANALYSER_MIN_DB) / ANALYSER_RANGE_DB, 0, 1)
  }
}

/** A 0-1 level as a recorded byte (1-255; 0 is reserved for "not recorded"). */
export const encodeLevel = (level: number): number => 1 + Math.round(clamp(level, 0, 1) * (MAX_LEVEL_BYTE - 1))

/** A recorded byte (1-255) back to a 0-1 level. */
export const levelOf = (bin: number): number => (bin - 1) / (MAX_LEVEL_BYTE - 1)

/**
 * Fills a waveform as a track plays. Bins recorded in an earlier session are kept as they are;
 * within one session a bin keeps the loudest level seen, so replaying a stretch never lowers it.
 * `bins` holds `binTotal` bins of band 0, then of band 1, and so on; a bin is recorded in all bands at once.
 */
export class WaveRecorder {
  readonly bins: Uint8Array
  readonly binTotal: number
  private readonly writtenThisSession: Uint8Array
  private readonly encoded = new Uint8Array(WAVE_BANDS)
  private recordedCount = 0
  private lastBin = -1

  /** `saved` is a previous recording; it is used only when it is about as long as the track. */
  constructor(duration: number, saved?: Uint8Array | null) {
    const n = binCount(duration)
    this.binTotal = n
    this.bins = new Uint8Array(n * WAVE_BANDS)
    this.writtenThisSession = new Uint8Array(n)
    if (saved && isWaveBins(saved) && Math.abs(binTotalOf(saved) - n) <= SAVED_LENGTH_TOLERANCE_BINS) this.load(saved)
  }

  /** Copies a saved recording in. A bin missing from any band counts as missing from all, so every recorded bin is whole. */
  private load(saved: Uint8Array): void {
    const n = this.binTotal
    const copied = Math.min(n, binTotalOf(saved))
    for (let band = 0; band < WAVE_BANDS; band++) this.bins.set(bandSlice(saved, band).subarray(0, copied), this.indexOf(band, 0))
    for (let bin = 0; bin < n; bin++) {
      let whole = true
      for (let band = 0; band < WAVE_BANDS; band++) whole &&= this.bins[this.indexOf(band, bin)] !== 0
      if (whole) this.recordedCount++
      else for (let band = 0; band < WAVE_BANDS; band++) this.bins[this.indexOf(band, bin)] = 0
    }
  }

  private indexOf(band: number, bin: number): number {
    return band * this.binTotal + bin
  }

  /** Band 0 is always written with the other bands (and `load` keeps it so), so it says whether a bin is recorded. */
  private isRecorded(bin: number): boolean {
    return this.bins[this.indexOf(0, bin)] !== 0
  }

  get complete(): boolean {
    return this.binTotal > 0 && this.recordedCount >= this.binTotal - SLACK_BINS
  }

  /** Share of the track recorded so far, 0-1. */
  get coverage(): number {
    return this.binTotal > 0 ? this.recordedCount / this.binTotal : 0
  }

  /** Whether any bin overlapping [from, to) seconds is still unrecorded. */
  hasGap(from: number, to: number): boolean {
    const end = Math.min(this.binTotal, Math.ceil(to * WAVE_BINS_PER_SECOND))
    for (let i = Math.max(0, Math.floor(from * WAVE_BINS_PER_SECOND)); i < end; i++) if (!this.isRecorded(i)) return true
    return false
  }

  /** The playhead jumped (seek, loop): the next sample must not be joined to the previous one. */
  startNewStretch(): void {
    this.lastBin = -1
  }

  /** Records the levels (0-1, one per band) heard at track time `t`. Returns whether any bin changed. */
  recordLevels(t: number, levels: ArrayLike<number>): boolean {
    const n = this.binTotal
    if (n === 0 || !Number.isFinite(t) || t < 0) return false
    const bin = Math.min(n - 1, Math.floor(t * WAVE_BINS_PER_SECOND))
    for (let band = 0; band < WAVE_BANDS; band++) this.encoded[band] = encodeLevel(levels[band] ?? 0)
    const continuesStretch = this.lastBin >= 0 && bin > this.lastBin && bin - this.lastBin <= MAX_FILL_BINS
    const from = continuesStretch ? this.lastBin + 1 : bin
    this.lastBin = bin
    let changed = false
    for (let i = from; i <= bin; i++) changed = this.write(i) || changed
    return changed
  }

  private write(bin: number): boolean {
    const wasRecorded = this.isRecorded(bin)
    if (wasRecorded && this.writtenThisSession[bin] === 0) return false // from an earlier session
    this.writtenThisSession[bin] = 1
    let changed = false
    for (let band = 0; band < WAVE_BANDS; band++) {
      const i = this.indexOf(band, bin)
      if (this.encoded[band] > this.bins[i]) {
        this.bins[i] = this.encoded[band]
        changed = true
      }
    }
    if (!wasRecorded) this.recordedCount++
    return changed
  }
}
