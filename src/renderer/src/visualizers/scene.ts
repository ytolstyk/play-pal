import type { AudioFrame } from '../../../shared/audio'
import { clamp } from '../../../shared/guards'

export const BAND_COUNT = 64
/** Spectrum range shown: bin 1 (~43 Hz) to this bin (~17 kHz at 44.1 kHz). */
const TOP_BIN = 400
/** Spectrum bins where the bands the drawers care about change over: kick and bass below the first, cymbals above the second. */
const BASS_TO_BIN = 5
const HIGH_FROM_BIN = 116

const BYTE_MAX = 255
const WAVE_MIDPOINT = 128
const PULSE_DECAY_PER_S = 5
/** A kick sets the pulse to at least this, rising to 1 for the hardest. */
const PULSE_MIN = 0.55
const RISE_PER_S = 40
const FALL_PER_S = 9
/** Level treated as "full scale"; follows the music so quiet tracks and low volumes still fill the view. */
const MIN_PEAK = 0.25
const PEAK_DECAY_PER_S = 0.1
const ENERGY_REST = 0.01
const CAP_FALL_PER_S = 0.6
/** A band shows only what rises above this share of the loudest band, so a quiet band's noise stays at zero. */
const SHAPE_FLOOR = 0.4
/**
 * A band's height is its place in the spectrum times how far it is above its own recent average, so a bass line that
 * hums all song settles low and only each new hit or note lifts it; at rest `PUNCH_BASE` of the height shows.
 */
const PUNCH_BASE = 0.3
const PUNCH_RANGE = 0.2
const BAND_AVG_FOLLOW_PER_S = 1.5
const SURGE_RATIO = 1.35
const SURGE_MIN_RISE = 0.06
const ENERGY_FAST_PER_S = 8
const ENERGY_SLOW_PER_S = 0.5
/** A surge needs music already settled at a steady level; a track starting from silence is a start, not a change. */
const SURGE_MIN_BASE = 0.1
const SURGE_SETTLED_RATIO = 1.3
const SURGE_GAP_S = 1.2
const SURGE_DECAY_PER_S = 1.5

/**
 * A hit is a jump in spectral flux (how much the spectrum rose this frame) well above what that zone usually does.
 * Levels are raised to FLUX_POWER first: the analyser's dB scale lets the faint click of a kick, leaking across every
 * band, rise as far as a snare does; weighting by loudness leaves only what is actually heard.
 */
const FLUX_POWER = 3
/** The least flux that counts as a hit, per zone: a held bass note already sits high, so a kick rises less than a snare does. */
const KICK_FLUX_FLOOR = 0.04
const SNARE_FLUX_FLOOR = 0.1
const HAT_FLUX_FLOOR = 0.08
/** A kick's click also excites the mids; for this long after one, a snare has to rise this many times higher to count as its own hit. */
const KICK_SPILL_S = 0.06
const KICK_SPILL_RATIO = 2
const ONSET_SENSITIVITY = 2
const ONSET_FOLLOW_PER_S = 2.5
const ONSET_PEAK_DECAY_PER_S = 0.3
const ONSET_PEAK_MIN = 0.2
const KICK_GAP_S = 0.12
const SNARE_GAP_S = 0.1
const HAT_GAP_S = 0.05
const BRIGHTNESS_FOLLOW_PER_S = 3
/** The weakest detected hit still counts for this much of full strength. */
const POWER_MIN = 0.3

/** Running statistics of one zone's flux, enough to tell a hit from the zone's usual movement. */
interface Onset {
  avg: number
  dev: number
  peak: number
  since: number
}

const createOnset = (): Onset => ({ avg: 0, dev: 0, peak: ONSET_PEAK_MIN, since: 0 })

/** Everything a drawer needs for one frame. Mutated in place by `advance`. */
export interface Scene {
  /** Spectrum on a log frequency axis, 0-1: how far each band is above its own recent level. Smoothed. */
  bands: Float32Array
  /** Slowly falling maximum of each band, for peak caps. */
  caps: Float32Array
  /** Scratch: this frame's raw per-band levels. */
  raw: Float32Array
  /** Waveform, -1..1. */
  wave: Float32Array
  /** How much each band rose this frame, by loudness-weighted level, 0-1 (the build-up behind a hit; 0 for a steady note). */
  bandFlux: Float32Array
  /** Low-frequency level, 0-1. */
  bass: number
  /** Mid-range level, 0-1. */
  mid: number
  /** High-frequency level, 0-1. */
  treble: number
  /** Where the sound sits between dark (0) and bright (1), smoothed. */
  brightness: number
  /** Jumps to 1 on a detected kick, then decays. */
  pulse: number
  /** True on the one frame a kick was detected. */
  beat: boolean
  /** True on the one frame a snare/clap was detected. */
  hit: boolean
  /** True on the one frame a hi-hat or cymbal was detected. */
  hat: boolean
  /** How hard the detected kick/snare/hat was, 0-1 (0 on frames without one). */
  beatPower: number
  hitPower: number
  hatPower: number
  /** Seconds since the scene started (for slow motion). */
  time: number
  /** Mean band level; used to know when everything has gone quiet. */
  energy: number
  /** Jumps to 1 when the music suddenly gets much louder than it has been, then decays. */
  surge: number
  peak: number
  /** Per-band average the bands are measured against. */
  bandAvg: Float32Array
  /** Last frame's loudness-weighted levels, for the flux. */
  prevHeard: Float32Array
  /** False while there is no signal, so the first frame after one only sets `prevHeard` rather than counting as a hit. */
  primed: boolean
  kick: Onset
  snare: Onset
  cymbal: Onset
  loudnessFast: number
  loudnessSlow: number
  /** True once loudness has held steady, so a later jump counts as a change in the music. */
  surgeArmed: boolean
  sinceSurge: number
}

/** Keys of `Scene` that are the analyser's own working state; drawers are not given them. */
type Internal = 'raw' | 'bandAvg' | 'prevHeard' | 'primed' | 'kick' | 'snare' | 'cymbal' | 'loudnessFast' | 'loudnessSlow' | 'surgeArmed' | 'sinceSurge' | 'peak'

/** What a drawer may read of the scene. */
export type SceneView = Readonly<Omit<Scene, Internal>>

export const createScene = (waveSamples: number): Scene => ({
  bands: new Float32Array(BAND_COUNT),
  caps: new Float32Array(BAND_COUNT),
  raw: new Float32Array(BAND_COUNT),
  wave: new Float32Array(waveSamples),
  bandFlux: new Float32Array(BAND_COUNT),
  bass: 0,
  mid: 0,
  treble: 0,
  brightness: 0,
  pulse: 0,
  beat: false,
  hit: false,
  hat: false,
  beatPower: 0,
  hitPower: 0,
  hatPower: 0,
  time: 0,
  energy: 0,
  surge: 0,
  peak: MIN_PEAK,
  bandAvg: new Float32Array(BAND_COUNT),
  prevHeard: new Float32Array(BAND_COUNT),
  primed: false,
  kick: createOnset(),
  snare: createOnset(),
  cymbal: createOnset(),
  loudnessFast: 0,
  loudnessSlow: 0,
  surgeArmed: false,
  sinceSurge: 0
})

/**
 * Band edges on a log axis; band i covers bins [EDGES[i], EDGES[i + 1]). Where the log axis would put several bands
 * on one bin (the low end, a bin being ~43 Hz) each gets a bin of its own instead of all showing the same one.
 */
const EDGES = (() => {
  const edges = new Int16Array(BAND_COUNT + 1)
  edges[0] = 1
  for (let i = 1; i <= BAND_COUNT; i++) edges[i] = Math.max(edges[i - 1] + 1, Math.floor(Math.pow(TOP_BIN, i / BAND_COUNT)))
  return edges
})()

/** The first band that starts at or above `bin`. */
const bandFrom = (bin: number): number => {
  let band = 0
  while (band < BAND_COUNT && EDGES[band] < bin) band++
  return band
}

const BASS_END = bandFrom(BASS_TO_BIN)
const HIGH_START = bandFrom(HIGH_FROM_BIN)

/** Folds one analyser frame (or silence, for null) into the scene. `dt` is seconds since the last call. */
export function advance(scene: Scene, frame: AudioFrame | null, dt: number): void {
  scene.time += dt
  scene.sinceSurge += dt
  readFrame(scene, frame)
  updateFlux(scene, frame !== null)
  const loudness = updateLoudness(scene, dt)
  updateBands(scene, dt)
  detectHits(scene, dt)
  updateSurge(scene, loudness, dt)
}

/** The frame's spectrum folded into bands (0-1, `raw`) and its waveform (-1..1). */
function readFrame(scene: Scene, frame: AudioFrame | null): void {
  const { raw } = scene
  raw.fill(0)
  if (!frame) {
    scene.wave.fill(0)
    return
  }
  const lastBin = frame.freq.length - 1
  for (let i = 0; i < BAND_COUNT; i++) {
    const from = Math.min(lastBin, Math.max(1, EDGES[i]))
    const to = Math.min(frame.freq.length, Math.max(from + 1, EDGES[i + 1]))
    let max = 0
    for (let b = from; b < to; b++) max = Math.max(max, frame.freq[b])
    raw[i] = max / BYTE_MAX
  }
  for (let i = 0; i < scene.wave.length; i++) scene.wave[i] = ((frame.wave[i] ?? WAVE_MIDPOINT) - WAVE_MIDPOINT) / WAVE_MIDPOINT
}

/** Spectral flux: only rises count, so a note that sustains adds nothing after its first frame. */
function updateFlux(scene: Scene, hasSignal: boolean): void {
  const { raw, prevHeard, bandFlux } = scene
  if (hasSignal && !scene.primed) for (let i = 0; i < BAND_COUNT; i++) prevHeard[i] = raw[i] ** FLUX_POWER
  scene.primed = hasSignal
  for (let i = 0; i < BAND_COUNT; i++) {
    const heard = raw[i] ** FLUX_POWER
    bandFlux[i] = Math.max(0, heard - prevHeard[i])
    prevHeard[i] = heard
  }
}

/** Follows the loudest band for the auto-gain and returns the mean raw level. */
function updateLoudness(scene: Scene, dt: number): number {
  let loudest = 0
  let total = 0
  for (const level of scene.raw) {
    loudest = Math.max(loudest, level)
    total += level
  }
  scene.peak = Math.max(MIN_PEAK, loudest, scene.peak * (1 - PEAK_DECAY_PER_S * dt))
  return total / BAND_COUNT
}

/** Smoothed band heights, their peak caps, and the bass/mid/treble levels and brightness drawn from them. */
function updateBands(scene: Scene, dt: number): void {
  const { raw, bands, caps, bandAvg } = scene
  const rise = Math.min(1, RISE_PER_S * dt)
  const fall = Math.min(1, FALL_PER_S * dt)
  const follow = Math.min(1, BAND_AVG_FOLLOW_PER_S * dt)
  let sum = 0
  let weighted = 0
  for (let i = 0; i < BAND_COUNT; i++) {
    const shape = clamp((raw[i] / scene.peak - SHAPE_FLOOR) / (1 - SHAPE_FLOOR), 0, 1)
    const punch = clamp(PUNCH_BASE + (raw[i] - bandAvg[i]) / PUNCH_RANGE, 0, 1)
    bandAvg[i] += (raw[i] - bandAvg[i]) * follow
    const target = shape * punch
    bands[i] += (target - bands[i]) * (target > bands[i] ? rise : fall)
    caps[i] = Math.max(bands[i], caps[i] - dt * CAP_FALL_PER_S)
    sum += bands[i]
    weighted += bands[i] * i
  }
  scene.energy = sum / BAND_COUNT
  scene.bass = mean(bands, 0, BASS_END)
  scene.mid = mean(bands, BASS_END, HIGH_START)
  scene.treble = mean(bands, HIGH_START, BAND_COUNT)
  const centroid = sum > 0 ? weighted / sum / (BAND_COUNT - 1) : 0
  scene.brightness += (centroid - scene.brightness) * Math.min(1, BRIGHTNESS_FOLLOW_PER_S * dt)
}

/** Kick, snare and hat onsets for this frame, and the kick's pulse. */
function detectHits(scene: Scene, dt: number): void {
  const { bandFlux } = scene
  scene.beatPower = detect(scene.kick, zoneFlux(bandFlux, 0, BASS_END), dt, KICK_GAP_S, KICK_FLUX_FLOOR)
  const spill = scene.kick.since < KICK_SPILL_S ? KICK_SPILL_RATIO : 1
  scene.hitPower = detect(scene.snare, zoneFlux(bandFlux, BASS_END, HIGH_START), dt, SNARE_GAP_S, SNARE_FLUX_FLOOR, spill)
  scene.hatPower = detect(scene.cymbal, zoneFlux(bandFlux, HIGH_START, BAND_COUNT), dt, HAT_GAP_S, HAT_FLUX_FLOOR)
  scene.beat = scene.beatPower > 0
  scene.hit = scene.hitPower > 0
  scene.hat = scene.hatPower > 0
  scene.pulse = scene.beat ? Math.max(scene.pulse, PULSE_MIN + (1 - PULSE_MIN) * scene.beatPower) : Math.max(0, scene.pulse - PULSE_DECAY_PER_S * dt)
}

/** Fast vs slow loudness: a quiet passage dropping into a loud one pushes the fast average far above the slow one. */
function updateSurge(scene: Scene, loudness: number, dt: number): void {
  scene.loudnessFast += (loudness - scene.loudnessFast) * Math.min(1, ENERGY_FAST_PER_S * dt)
  if (scene.loudnessSlow < SURGE_MIN_BASE) scene.surgeArmed = false
  else if (scene.loudnessFast < scene.loudnessSlow * SURGE_SETTLED_RATIO) scene.surgeArmed = true
  const jumped = scene.loudnessFast > scene.loudnessSlow * SURGE_RATIO && scene.loudnessFast - scene.loudnessSlow > SURGE_MIN_RISE
  if (scene.surgeArmed && jumped && scene.sinceSurge > SURGE_GAP_S) {
    scene.surge = 1
    scene.sinceSurge = 0
  } else {
    scene.surge = Math.max(0, scene.surge - SURGE_DECAY_PER_S * dt)
  }
  scene.loudnessSlow += (loudness - scene.loudnessSlow) * Math.min(1, ENERGY_SLOW_PER_S * dt)
}

/** Strength 0-1 of a hit in this zone this frame, or 0 when `flux` is no more than the zone usually moves. */
function detect(zone: Onset, flux: number, dt: number, gap: number, floor: number, harder = 1): number {
  zone.since += dt
  const threshold = Math.max(floor, zone.avg + ONSET_SENSITIVITY * zone.dev) * harder
  zone.peak = Math.max(ONSET_PEAK_MIN, flux, zone.peak * (1 - ONSET_PEAK_DECAY_PER_S * dt))
  let power = 0
  if (flux > threshold && zone.since > gap) {
    power = clamp(POWER_MIN + ((1 - POWER_MIN) * flux) / zone.peak, 0, 1)
    zone.since = 0
  }
  const follow = Math.min(1, ONSET_FOLLOW_PER_S * dt)
  zone.dev += (Math.abs(flux - zone.avg) - zone.dev) * follow
  zone.avg += (flux - zone.avg) * follow
  return power
}

/** How much bands [from, to) rose together; scaled by the square root of their number so a wide zone isn't diluted. */
function zoneFlux(flux: Float32Array, from: number, to: number): number {
  let s = 0
  for (let i = from; i < to; i++) s += flux[i]
  return s / Math.sqrt(Math.max(1, to - from))
}

/** True once the scene has settled to silence, so the render loop can stop. */
export const isAtRest = (scene: SceneView): boolean => scene.energy < ENERGY_REST && scene.pulse < ENERGY_REST && scene.surge < ENERGY_REST

function mean(a: Float32Array, from: number, to: number): number {
  let s = 0
  for (let i = from; i < to; i++) s += a[i]
  return s / Math.max(1, to - from)
}
