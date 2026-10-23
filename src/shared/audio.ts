import { isObject } from './guards'

/** Analyser size shared by every audio source feeding the visualizer. */
export const FFT_SIZE = 1024
/** Analyser smoothing; the YouTube page preload repeats it as a literal (kept in sync by a test). */
export const SMOOTHING = 0.6
/**
 * The dB range the analyser maps onto its 0-255 spectrum bytes; the YouTube page preload repeats it as literals.
 * The Web Audio default tops out at -30 dB, which loud bass exceeds, so it reads as a solid ceiling. 0 dB is full scale,
 * which a bin of real music stays well under.
 */
export const ANALYSER_MIN_DB = -100
export const ANALYSER_MAX_DB = 0
export const FREQ_BINS = FFT_SIZE / 2
export const WAVE_SAMPLES = FFT_SIZE / 2
/** How often the YouTube page sends a frame while the visualizer is showing. */
export const AUDIO_FRAME_MS = 33

/** One analyser snapshot: byte spectrum (0-255 per bin) and a slice of the waveform (128 = silence). */
export interface AudioFrame {
  freq: Uint8Array
  wave: Uint8Array
}

/** Frame from the YouTube Music page (untrusted content; shape-checked only). */
export function readAudioFrame(raw: unknown): AudioFrame | null {
  if (!isObject(raw)) return null
  const { freq, wave } = raw
  if (!(freq instanceof Uint8Array) || freq.length !== FREQ_BINS) return null
  if (!(wave instanceof Uint8Array) || wave.length !== WAVE_SAMPLES) return null
  return { freq, wave }
}
