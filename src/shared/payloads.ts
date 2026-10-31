import { isFiniteNumber, isObject, isVolume } from './guards'
import { MAX_DEVICE_LABEL, MAX_TITLE, type ClockSample, type PlaybackState, type Rect, type YtCommand } from './types'

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
  /** The user clicked or typed in the page moments ago, so a change of video was probably theirs. */
  userActive: boolean
  /** The page's now-playing title; only sent while it plays a video other than the one it was opened for. */
  title?: string
}

/** Clock from the YouTube Music page (untrusted content; shape-checked only). */
export function readYtPageClock(raw: unknown): YtPageClock | null {
  const state = readPlayback(raw)
  if (!state || !isObject(raw) || typeof raw.videoId !== 'string' || !isFiniteNumber(raw.sentAt)) return null
  const clock: YtPageClock = { ...state, videoId: raw.videoId, sentAt: raw.sentAt, userActive: raw.userActive === true }
  // The title is uploader-controlled text shown in the app's own UI: no control or direction-changing characters.
  const title = typeof raw.title === 'string' ? raw.title.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, MAX_TITLE) : ''
  if (title) clock.title = title
  return clock
}

export function readYtCommand(raw: unknown): YtCommand | null {
  if (!isObject(raw)) return null
  const { cmd, value } = raw
  if (cmd === 'play' || cmd === 'pause' || cmd === 'release-volume') return { cmd }
  if ((cmd === 'seek' || cmd === 'rate') && isFiniteNumber(value) && value >= 0) return { cmd, value }
  if (cmd === 'volume' && isVolume(value)) return { cmd, value }
  if ((cmd === 'analyse' || cmd === 'limiter') && (value === 0 || value === 1)) return { cmd, value }
  if (cmd === 'output' && typeof value === 'string' && value.length <= MAX_DEVICE_LABEL) return { cmd, value }
  return null
}

export function readRect(raw: unknown): Rect | null {
  if (!isObject(raw)) return null
  const { x, y, width, height } = raw
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) return null
  if (width <= 0 || height <= 0 || [x, y, width, height].some((n) => Math.abs(n) > MAX_RECT)) return null
  return { x, y, width, height }
}
