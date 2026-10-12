import { isFiniteNumber, isObject, isVolume } from './guards'
import type { ClockSample, PlaybackState, Rect, YtCommand } from './types'

const MAX_RECT = 20000

/** Position fields shared by every clock source. */
export function readPlayback(raw: unknown): PlaybackState | null {
  if (!isObject(raw)) return null
  const { t, duration, playing, rate } = raw
  if (!isFiniteNumber(t) || typeof playing !== 'boolean' || !isFiniteNumber(rate) || rate <= 0) return null
  return { t: Math.max(0, t), duration: isFiniteNumber(duration) && duration > 0 ? duration : 0, playing, rate }
}

/** Clock from the renderer's audio element. */
export function readClock(raw: unknown): ClockSample | null {
  const state = readPlayback(raw)
  if (!state || !isObject(raw) || typeof raw.trackId !== 'string') return null
  return { trackId: raw.trackId, ...state }
}

export interface YtPageClock extends PlaybackState {
  videoId: string
  /** Wall-clock ms when the page read the position. */
  sentAt: number
}

/** Clock from the YouTube Music page (untrusted content; shape-checked only). */
export function readYtPageClock(raw: unknown): YtPageClock | null {
  const state = readPlayback(raw)
  if (!state || !isObject(raw) || typeof raw.videoId !== 'string' || !isFiniteNumber(raw.sentAt)) return null
  return { ...state, videoId: raw.videoId, sentAt: raw.sentAt }
}

export function readYtCommand(raw: unknown): YtCommand | null {
  if (!isObject(raw)) return null
  const { cmd, value } = raw
  if (cmd === 'play' || cmd === 'pause' || cmd === 'release-volume') return { cmd }
  if ((cmd === 'seek' || cmd === 'rate') && isFiniteNumber(value) && value >= 0) return { cmd, value }
  if (cmd === 'volume' && isVolume(value)) return { cmd, value }
  if ((cmd === 'analyse' || cmd === 'limiter') && (value === 0 || value === 1)) return { cmd, value }
  return null
}

export function readRect(raw: unknown): Rect | null {
  if (!isObject(raw)) return null
  const { x, y, width, height } = raw
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) return null
  if (width <= 0 || height <= 0 || [x, y, width, height].some((n) => Math.abs(n) > MAX_RECT)) return null
  return { x, y, width, height }
}
