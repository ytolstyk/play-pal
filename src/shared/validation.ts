import { isCueColor, sortedByTime } from './cues'
import { isFiniteNumber, isObject, isVolume } from './guards'
import { isVideoId } from './url'
import {
  AUDIO_EXTENSIONS,
  MAX_CUES,
  MAX_LABEL,
  MAX_LEAD_MS,
  MAX_START_WAIT_MS,
  MAX_TITLE,
  MAX_TRACKS,
  MIDI_CHANNEL_MAX,
  MIDI_CHANNEL_MIN,
  MIDI_DATA_MAX,
  type Cue,
  type Library,
  type LoadResult,
  type MidiAction,
  type StartPreset,
  type Track
} from './types'

const ID = /^[A-Za-z0-9-]{1,64}$/
/** Absolute path; `//host/share` (UNC) is excluded so a stored path can never trigger an SMB fetch. */
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\/(?![\\/])|\\(?![\\/]))/
const MAX_PATH = 2048
const MAX_TIME_S = 24 * 60 * 60

const isInt = (v: unknown, min: number, max: number): boolean =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

export const hasAudioExtension = (path: string): boolean =>
  AUDIO_EXTENSIONS.includes(path.slice(path.lastIndexOf('.') + 1).toLowerCase())

export function validateAction(a: unknown): string[] {
  if (!isObject(a)) return ['action must be an object']
  const errors: string[] = []
  if (a.type !== 'cc' && a.type !== 'note') errors.push('type must be "cc" or "note"')
  if (!isInt(a.channel, MIDI_CHANNEL_MIN, MIDI_CHANNEL_MAX)) errors.push('channel must be 1-16')
  if (!isInt(a.number, 0, MIDI_DATA_MAX)) errors.push('number must be 0-127')
  if (!isInt(a.value, 0, MIDI_DATA_MAX)) errors.push('value must be 0-127')
  return errors
}

function validateCue(c: unknown): string[] {
  if (!isObject(c)) return ['cue must be an object']
  const errors: string[] = []
  if (typeof c.id !== 'string' || !ID.test(c.id)) errors.push('invalid cue id')
  if (!isFiniteNumber(c.time) || c.time < 0 || c.time > MAX_TIME_S) {
    errors.push('cue time out of range')
  }
  if (typeof c.label !== 'string' || c.label.length > MAX_LABEL) errors.push('invalid cue label')
  if (c.color !== undefined && !isCueColor(c.color)) errors.push('invalid cue color')
  errors.push(...validateAction(c.action))
  return errors
}

function validateStart(s: unknown): string[] {
  if (!isObject(s)) return ['start preset must be an object']
  const errors = validateAction(s.action).map((m) => `start preset: ${m}`)
  if (!isInt(s.waitMs, 0, MAX_START_WAIT_MS)) errors.push(`start wait must be 0-${MAX_START_WAIT_MS} ms`)
  return errors
}

function validateSource(s: unknown): string[] {
  if (!isObject(s)) return ['source must be an object']
  if (s.kind === 'file') {
    const ok =
      typeof s.path === 'string' && s.path.length <= MAX_PATH && ABSOLUTE_PATH.test(s.path) && hasAudioExtension(s.path)
    return ok ? [] : ['file source needs an absolute path to an audio file']
  }
  if (s.kind === 'ytmusic') return isVideoId(s.videoId) ? [] : ['invalid YouTube video id']
  return ['unknown source kind']
}

export function validateTrack(t: unknown): string[] {
  if (!isObject(t)) return ['track must be an object']
  const errors: string[] = []
  if (typeof t.id !== 'string' || !ID.test(t.id)) errors.push('invalid track id')
  if (typeof t.title !== 'string' || t.title.length > MAX_TITLE) errors.push('invalid title')
  errors.push(...validateSource(t.source))
  if (t.start !== undefined) errors.push(...validateStart(t.start))
  if (t.volume !== undefined && !isVolume(t.volume)) errors.push('volume must be 0-1')
  if (!Array.isArray(t.cues)) return [...errors, 'cues must be a list']
  if (t.cues.length > MAX_CUES) return [...errors, 'too many cues']
  t.cues.forEach((c, i) => errors.push(...validateCue(c).map((m) => `cue #${i + 1}: ${m}`)))
  const ids = t.cues.flatMap((c) => (isObject(c) && typeof c.id === 'string' ? [c.id] : []))
  if (new Set(ids).size !== ids.length) errors.push('duplicate cue ids')
  return errors
}

export function validateLibrary(raw: unknown): string[] {
  if (!isObject(raw)) return ['library must be an object']
  const errors: string[] = []
  if (!isInt(raw.leadMs, 0, MAX_LEAD_MS)) errors.push(`lead must be 0-${MAX_LEAD_MS} ms`)
  if (!Array.isArray(raw.tracks)) return [...errors, 'tracks must be a list']
  if (raw.tracks.length > MAX_TRACKS) return [...errors, 'too many tracks']
  raw.tracks.forEach((t, i) => errors.push(...validateTrack(t).map((m) => `track #${i + 1}: ${m}`)))
  const ids = raw.tracks.flatMap((t) => (isObject(t) && typeof t.id === 'string' ? [t.id] : []))
  if (new Set(ids).size !== ids.length) errors.push('duplicate track ids')
  return errors
}

const pickAction = (a: MidiAction): MidiAction => ({
  type: a.type,
  channel: a.channel,
  number: a.number,
  value: a.value
})
const pickStart = (s: StartPreset): StartPreset => ({ action: pickAction(s.action), waitMs: s.waitMs })
const pickCue = (c: Cue): Cue => ({ id: c.id, time: c.time, label: c.label, action: pickAction(c.action),
  ...(isCueColor(c.color) ? { color: c.color } : {})
})
const pickTrack = (t: Track): Track => ({
  id: t.id,
  title: t.title,
  source: t.source.kind === 'file' ? { kind: 'file', path: t.source.path } : { kind: 'ytmusic', videoId: t.source.videoId },
  cues: sortedByTime(t.cues.map(pickCue)),
  ...(t.start ? { start: pickStart(t.start) } : {}),
  ...(t.volume !== undefined ? { volume: t.volume } : {})
})

/** Re-picks known fields (nothing extra from the renderer is persisted) and sorts cues by time. Validate first. */
export const sanitizeLibrary = (lib: Library): Library => ({
  leadMs: lib.leadMs,
  tracks: lib.tracks.map(pickTrack)
})

export const emptyLibrary = (): Library => ({ tracks: [], leadMs: 0 })

/** Lenient read of a stored file: bad tracks are dropped with a warning instead of failing the load. */
export function parseLibraryFile(raw: unknown): LoadResult {
  if (!isObject(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.tracks)) {
    return { ...emptyLibrary(), warnings: ['library file had an unexpected format and was reset'] }
  }
  const warnings: string[] = []
  const seen = new Set<string>()
  const tracks: Track[] = []
  raw.tracks.slice(0, MAX_TRACKS).forEach((t, i) => {
    const errors = validateTrack(t)
    const id = isObject(t) && typeof t.id === 'string' ? t.id : null
    if (errors.length > 0 || id === null || seen.has(id)) {
      warnings.push(`dropped track #${i + 1}: ${errors[0] ?? 'duplicate id'}`)
      return
    }
    seen.add(id)
    tracks.push(t as unknown as Track)
  })
  const leadMs = isInt(raw.leadMs, 0, MAX_LEAD_MS) ? (raw.leadMs as number) : 0
  return { ...sanitizeLibrary({ tracks, leadMs }), warnings }
}
