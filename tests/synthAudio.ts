import { ANALYSER_MAX_DB, ANALYSER_MIN_DB, FFT_SIZE, FREQ_BINS, SMOOTHING, WAVE_SAMPLES, type AudioFrame } from '../src/shared/audio'

export const SAMPLE_RATE = 44_100

const BLACKMAN = Float64Array.from({ length: FFT_SIZE }, (_, n) => {
  const a = 0.16
  return (1 - a) / 2 - 0.5 * Math.cos((2 * Math.PI * n) / FFT_SIZE) + (a / 2) * Math.cos((4 * Math.PI * n) / FFT_SIZE)
})

/** Magnitude spectrum of the FFT_SIZE samples ending at `end`, the way an AnalyserNode takes it (before smoothing). */
function magnitudes(signal: Float32Array, end: number): Float64Array {
  const re = new Float64Array(FFT_SIZE)
  const im = new Float64Array(FFT_SIZE)
  for (let i = 0; i < FFT_SIZE; i++) re[i] = (signal[end - FFT_SIZE + i] ?? 0) * BLACKMAN[i]
  for (let i = 1, j = 0; i < FFT_SIZE; i++) {
    let bit = FFT_SIZE >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) [re[i], re[j], im[i], im[j]] = [re[j], re[i], im[j], im[i]]
  }
  for (let len = 2; len <= FFT_SIZE; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    for (let i = 0; i < FFT_SIZE; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k)
        const wi = Math.sin(ang * k)
        const a = i + k
        const b = a + len / 2
        const tr = re[b] * wr - im[b] * wi
        const ti = re[b] * wi + im[b] * wr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
      }
    }
  }
  return Float64Array.from({ length: FREQ_BINS }, (_, k) => Math.hypot(re[k], im[k]) / FFT_SIZE)
}

/** Turns audio into the frames an AnalyserNode would hand the visualizer, one per `fps`th of a second. */
export function analyse(signal: Float32Array, fps = 60): AudioFrame[] {
  const hop = Math.round(SAMPLE_RATE / fps)
  const smoothed = new Float64Array(FREQ_BINS)
  const frames: AudioFrame[] = []
  for (let end = FFT_SIZE; end <= signal.length; end += hop) {
    const mags = magnitudes(signal, end)
    const freq = new Uint8Array(FREQ_BINS)
    for (let k = 0; k < FREQ_BINS; k++) {
      smoothed[k] = SMOOTHING * smoothed[k] + (1 - SMOOTHING) * mags[k]
      const db = 20 * Math.log10(Math.max(smoothed[k], 1e-12))
      freq[k] = Math.max(0, Math.min(255, Math.round(((db - ANALYSER_MIN_DB) / (ANALYSER_MAX_DB - ANALYSER_MIN_DB)) * 255)))
    }
    frames.push({ freq, wave: new Uint8Array(WAVE_SAMPLES).fill(128) })
  }
  return frames
}

/** Deterministic noise in -1..1. */
function noise(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return (s / 0xffffffff) * 2 - 1
  }
}

export interface Song {
  signal: Float32Array
  /** Times in seconds of each kind of hit. */
  kicks: number[]
  snares: number[]
  hats: number[]
}

/**
 * A 120 bpm pattern: a bass note that never stops, a kick on every beat, a snare on 2 and 4, hats on the eighths.
 * `seconds` of it; `from` is when the drums come in (before it only the bass note plays).
 */
export function song(seconds: number, from = 0): Song {
  const signal = new Float32Array(Math.round(seconds * SAMPLE_RATE))
  const rand = noise(7)
  const kicks: number[] = []
  const snares: number[] = []
  const hats: number[] = []
  for (let i = 0; i < signal.length; i++) signal[i] = 0.25 * Math.sin((2 * Math.PI * 55 * i) / SAMPLE_RATE)
  const add = (at: number, length: number, voice: (t: number) => number): void => {
    for (let i = 0, n = Math.round(length * SAMPLE_RATE); i < n; i++) {
      const idx = Math.round(at * SAMPLE_RATE) + i
      if (idx < signal.length) signal[idx] += voice(i / SAMPLE_RATE)
    }
  }
  for (let beat = 0; beat * 0.5 + from < seconds - 0.3; beat++) {
    const t = from + beat * 0.5
    kicks.push(t)
    add(t, 0.2, (x) => 0.7 * Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-x * 40)) * x) * Math.exp(-x * 18))
    if (beat % 2 === 1) {
      snares.push(t)
      add(t, 0.15, (x) => 0.35 * rand() * Math.exp(-x * 25))
    }
    for (const offset of [0, 0.25]) {
      hats.push(t + offset)
      let prev = 0
      add(t + offset, 0.05, (x) => {
        const n = rand()
        const hp = n - prev // crude high-pass
        prev = n
        return 0.2 * hp * Math.exp(-x * 80)
      })
    }
  }
  return { signal, kicks, snares, hats }
}
