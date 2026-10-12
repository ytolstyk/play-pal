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
/** Levels below this fraction of full scale read as zero, and the rest is curved, so loud music still has peaks and valleys. */
const CONTRAST_FLOOR = 0.3
const CONTRAST_POWER = 1.8
const MID_FROM_BAND = 14
const MID_TO_BAND = 40
const MID_AVG_FOLLOW_PER_S = 3
const HIT_RATIO = 1.5
const HIT_FLOOR = 0.25
const HIT_GAP_S = 0.1
const ENERGY_FAST_PER_S = 8
const ENERGY_SLOW_PER_S = 0.5
const SURGE_RATIO = 1.5
const SURGE_MIN_RISE = 0.1
/** A surge needs music already settled at a steady level; a track starting from silence is a start, not a change. */
const SURGE_MIN_BASE = 0.05
const SURGE_SETTLED_RATIO = 1.2
const SURGE_GAP_S = 1.2
const SURGE_DECAY_PER_S = 1.5

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
  /** True on the one frame a mid-range transient (snare, clap) was detected. */
  hit: boolean
  /** Jumps to 1 when the music suddenly gets much louder than it has been, then decays. */
  surge: number
  peak: number
  bassAvg: number
  midAvg: number
  energyFast: number
  energySlow: number
  /** True once loudness has held steady, so a later jump counts as a change in the music. */
  surgeArmed: boolean
  sinceBeat: number
  sinceHit: number
  sinceSurge: number
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
  hit: false,
  surge: 0,
  peak: MIN_PEAK,
  bassAvg: 0,
  midAvg: 0,
  energyFast: 0,
  energySlow: 0,
  surgeArmed: false,
  sinceBeat: 0,
  sinceHit: 0,
  sinceSurge: 0
})

/** Band edges on a log axis; band i covers bins [EDGES[i], EDGES[i + 1]). */
const EDGES = Int16Array.from({ length: BAND_COUNT + 1 }, (_, i) => Math.floor(Math.pow(TOP_BIN, i / BAND_COUNT)))

/** Folds one analyser frame (or silence, for null) into the scene. `dt` is seconds since the last call. */
export function advance(scene: Scene, frame: AudioFrame | null, dt: number): void {
  scene.time += dt
  scene.sinceBeat += dt
  scene.sinceHit += dt
  scene.sinceSurge += dt

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
    const target = contrast(raw[i] * gain)
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

  const mid = mean(scene.bands, MID_FROM_BAND, MID_TO_BAND)
  scene.hit = mid > HIT_FLOOR && mid > scene.midAvg * HIT_RATIO && scene.sinceHit > HIT_GAP_S
  if (scene.hit) scene.sinceHit = 0
  scene.midAvg += (mid - scene.midAvg) * Math.min(1, MID_AVG_FOLLOW_PER_S * dt)

  // Fast vs slow loudness: a quiet passage dropping into a loud one pushes the fast average far above the slow one.
  const e = scene.energy
  scene.energyFast += (e - scene.energyFast) * Math.min(1, ENERGY_FAST_PER_S * dt)
  if (scene.energySlow < SURGE_MIN_BASE) scene.surgeArmed = false
  else if (scene.energyFast < scene.energySlow * SURGE_SETTLED_RATIO) scene.surgeArmed = true
  const surging =
    scene.surgeArmed &&
    scene.energyFast > scene.energySlow * SURGE_RATIO &&
    scene.energyFast - scene.energySlow > SURGE_MIN_RISE &&
    scene.sinceSurge > SURGE_GAP_S
  if (surging) {
    scene.surge = 1
    scene.sinceSurge = 0
  } else {
    scene.surge = Math.max(0, scene.surge - SURGE_DECAY_PER_S * dt)
  }
  scene.energySlow += (e - scene.energySlow) * Math.min(1, ENERGY_SLOW_PER_S * dt)
}

const contrast = (level: number): number =>
  Math.pow(Math.max(0, Math.min(1, (level - CONTRAST_FLOOR) / (1 - CONTRAST_FLOOR))), CONTRAST_POWER)

/** True once the scene has settled to silence, so the render loop can stop. */
export const isAtRest = (scene: Scene, particles = 0): boolean =>
  scene.energy < ENERGY_REST && scene.pulse < ENERGY_REST && scene.surge < ENERGY_REST && particles === 0

function mean(a: Float32Array, from: number, to: number): number {
  let s = 0
  for (let i = from; i < to; i++) s += a[i]
  return s / Math.max(1, to - from)
}
