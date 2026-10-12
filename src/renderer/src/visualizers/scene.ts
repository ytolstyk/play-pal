import type { AudioFrame } from '../../../shared/audio'

export const BAND_COUNT = 64
/** Spectrum range shown: bin 1 (~43 Hz) to this bin (~17 kHz at 44.1 kHz). */
const TOP_BIN = 400
const BASS_BANDS = 6
const BEAT_RATIO = 1.35
const BEAT_FLOOR = 0.3
const BEAT_GAP_S = 0.15
const PULSE_DECAY_PER_S = 5
const RISE_PER_S = 40
const FALL_PER_S = 7
/** Level treated as "full scale"; follows the music so quiet tracks and low volumes still fill the view. */
const MIN_PEAK = 0.25
const PEAK_DECAY_PER_S = 0.1
const ENERGY_REST = 0.01
const CAP_FALL_PER_S = 0.6
const BASS_AVG_FOLLOW_PER_S = 3
const TREBLE_START_BAND = 38

/** Everything a drawer needs for one frame. Mutated in place by `advance`. */
export interface Scene {
  /** Spectrum on a log frequency axis, 0-1 after auto-gain, smoothed. */
  bands: Float32Array
  /** Slowly falling maximum of each band, for peak caps. */
  caps: Float32Array
  /** Scratch: this frame's raw per-band levels. */
  raw: Float32Array
  /** Waveform, -1..1. */
  wave: Float32Array
  /** Low-frequency energy, 0-1. */
  bass: number
  /** High-frequency energy, 0-1. */
  treble: number
  /** Jumps to 1 on a detected beat, then decays. */
  pulse: number
  /** True on the one frame a beat was detected. */
  beat: boolean
  /** Seconds since the scene started (for slow motion). */
  time: number
  /** Mean band level; used to know when everything has gone quiet. */
  energy: number
  peak: number
  bassAvg: number
  sinceBeat: number
}

export const createScene = (waveSamples: number): Scene => ({
  bands: new Float32Array(BAND_COUNT),
  caps: new Float32Array(BAND_COUNT),
  raw: new Float32Array(BAND_COUNT),
  wave: new Float32Array(waveSamples),
  bass: 0,
  treble: 0,
  pulse: 0,
  beat: false,
  time: 0,
  energy: 0,
  peak: MIN_PEAK,
  bassAvg: 0,
  sinceBeat: 0
})

/** Band edges on a log axis; band i covers bins [EDGES[i], EDGES[i + 1]). */
const EDGES = Int16Array.from({ length: BAND_COUNT + 1 }, (_, i) => Math.floor(Math.pow(TOP_BIN, i / BAND_COUNT)))

/** Folds one analyser frame (or silence, for null) into the scene. `dt` is seconds since the last call. */
export function advance(scene: Scene, frame: AudioFrame | null, dt: number): void {
  scene.time += dt
  scene.sinceBeat += dt

  const raw = scene.raw
  raw.fill(0)
  if (frame) {
    for (let i = 0; i < BAND_COUNT; i++) {
      const from = Math.min(frame.freq.length - 1, Math.max(1, EDGES[i]))
      const to = Math.max(from + 1, EDGES[i + 1])
      let max = 0
      for (let b = from; b < to && b < frame.freq.length; b++) max = Math.max(max, frame.freq[b])
      raw[i] = max / 255
    }
    for (let i = 0; i < scene.wave.length; i++) scene.wave[i] = ((frame.wave[i] ?? 128) - 128) / 128
  } else {
    scene.wave.fill(0)
  }

  let loudest = 0
  for (let i = 0; i < BAND_COUNT; i++) loudest = Math.max(loudest, raw[i])
  scene.peak = Math.max(MIN_PEAK, loudest, scene.peak * (1 - PEAK_DECAY_PER_S * dt))
  const gain = 1 / scene.peak

  const rise = Math.min(1, RISE_PER_S * dt)
  const fall = Math.min(1, FALL_PER_S * dt)
  let sum = 0
  for (let i = 0; i < BAND_COUNT; i++) {
    const target = Math.min(1, raw[i] * gain)
    const k = target > scene.bands[i] ? rise : fall
    scene.bands[i] += (target - scene.bands[i]) * k
    scene.caps[i] = Math.max(scene.bands[i], scene.caps[i] - dt * CAP_FALL_PER_S)
    sum += scene.bands[i]
  }
  scene.energy = sum / BAND_COUNT
  scene.bass = mean(scene.bands, 0, BASS_BANDS)
  scene.treble = mean(scene.bands, TREBLE_START_BAND, BAND_COUNT)

  scene.beat = scene.bass > BEAT_FLOOR && scene.bass > scene.bassAvg * BEAT_RATIO && scene.sinceBeat > BEAT_GAP_S
  if (scene.beat) {
    scene.pulse = 1
    scene.sinceBeat = 0
  } else {
    scene.pulse = Math.max(0, scene.pulse - PULSE_DECAY_PER_S * dt)
  }
  scene.bassAvg += (scene.bass - scene.bassAvg) * Math.min(1, BASS_AVG_FOLLOW_PER_S * dt)
}

/** True once the scene has settled to silence, so the render loop can stop. */
export const isAtRest = (scene: Scene, particles = 0): boolean =>
  scene.energy < ENERGY_REST && scene.pulse < ENERGY_REST && particles === 0

function mean(a: Float32Array, from: number, to: number): number {
  let s = 0
  for (let i = from; i < to; i++) s += a[i]
  return s / Math.max(1, to - from)
}
