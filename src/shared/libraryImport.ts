import { isCueColor } from './cues'
import { clamp, clampInt, isFiniteNumber, isObject, isVolume } from './guards'
import { emptyLibrary, isTrackId, sanitizeLibrary, validateTrack } from './validation'
import {
  MAX_CUES,
  MAX_LABEL,
  MAX_LEAD_MS,
  MAX_START_WAIT_MS,
  MAX_TIME_S,
  MAX_TITLE,
  MAX_TRACKS,
  MIDI_CHANNEL_MAX,
  MIDI_CHANNEL_MIN,
  MIDI_DATA_MAX,
  SCHEMA_VERSION,
  type Cue,
  type LoadResult,
  type MidiAction,
  type StartPreset,
  type Track
} from './types'

const FALLBACK_TITLE = 'Untitled'

/** An id for something that lost (or duplicated) its own: `prefix-1`, `prefix-2`, ... unused in `taken`. */
function freshId(prefix: string, taken: ReadonlySet<string>): string {
  let n = 1
  while (taken.has(`${prefix}-${n}`)) n++
  return `${prefix}-${n}`
}

const unusedId = (id: unknown, prefix: string, taken: ReadonlySet<string>): string =>
  isTrackId(id) && !taken.has(id) ? id : freshId(prefix, taken)

const clippedText = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')

const clampedInt = (v: unknown, min: number, max: number): number | null => (isFiniteNumber(v) ? clampInt(v, min, max) : null)

function repairAction(a: unknown): MidiAction | null {
  if (!isObject(a) || (a.type !== 'cc' && a.type !== 'note')) return null
  const channel = clampedInt(a.channel, MIDI_CHANNEL_MIN, MIDI_CHANNEL_MAX)
  const number = clampedInt(a.number, 0, MIDI_DATA_MAX)
  const value = clampedInt(a.value, 0, MIDI_DATA_MAX)
  return channel === null || number === null || value === null ? null : { type: a.type, channel, number, value }
}

function repairCue(c: unknown, takenCueIds: ReadonlySet<string>): Cue | null {
  if (!isObject(c) || !isFiniteNumber(c.time)) return null
  const action = repairAction(c.action)
  if (!action) return null
  return {
    id: unusedId(c.id, 'cue', takenCueIds),
    time: clamp(c.time, 0, MAX_TIME_S),
    label: clippedText(c.label, MAX_LABEL),
    action,
    ...(isCueColor(c.color) ? { color: c.color } : {})
  }
}

function repairStart(s: unknown): StartPreset | undefined {
  if (!isObject(s)) return undefined
  const action = repairAction(s.action)
  if (!action) return undefined
  const label = clippedText(s.label, MAX_LABEL).trim()
  return {
    action,
    waitMs: clampedInt(s.waitMs, 0, MAX_START_WAIT_MS) ?? 0,
    ...(label ? { label } : {}),
    ...(isCueColor(s.color) ? { color: s.color } : {})
  }
}

/** Fixes what can be fixed (out-of-range numbers, overlong text, lost ids, bad optional fields); null if the track is unusable. */
function repairTrack(t: unknown, takenTrackIds: ReadonlySet<string>): Track | null {
  if (!isObject(t)) return null
  const cues: Cue[] = []
  const cueIds = new Set<string>()
  for (const raw of Array.isArray(t.cues) ? t.cues.slice(0, MAX_CUES) : []) {
    const cue = repairCue(raw, cueIds)
    if (!cue) continue
    cueIds.add(cue.id)
    cues.push(cue)
  }
  const start = repairStart(t.start)
  const candidate = {
    id: unusedId(t.id, 'track', takenTrackIds),
    title: clippedText(t.title, MAX_TITLE) || FALLBACK_TITLE,
    source: t.source,
    cues,
    ...(start ? { start } : {}),
    ...(isVolume(t.volume) ? { volume: t.volume } : {})
  }
  // The source is the one thing that cannot be guessed; the full check catches it.
  return validateTrack(candidate).length === 0 ? (candidate as unknown as Track) : null
}

function versionWarning(version: unknown): string | null {
  if (version === undefined) return 'library file had no format version; read as the current one'
  if (typeof version !== 'number' || version < 1) return 'library file had an unrecognised format version; read as the current one'
  if (version > SCHEMA_VERSION) return `library file is from a newer Play Pal (format ${version}); only the parts this version knows were read`
  return null
}

/** The track as it will be kept (untouched if valid, repaired if not) or null if unusable, with the warning to show for it. */
function importTrack(raw: unknown, index: number, takenTrackIds: ReadonlySet<string>): { track: Track | null; warning: string | null } {
  const problems = validateTrack(raw)
  const isDuplicate = isObject(raw) && typeof raw.id === 'string' && takenTrackIds.has(raw.id)
  // Safe cast: validateTrack found nothing wrong with `raw`.
  if (problems.length === 0 && !isDuplicate) return { track: raw as unknown as Track, warning: null }
  const reason = problems[0] ?? 'duplicate id'
  const track = repairTrack(raw, takenTrackIds)
  return track
    ? { track, warning: `repaired track #${index + 1}: ${reason}` }
    : { track: null, warning: `dropped track #${index + 1}: ${problems[0] ?? 'unusable'}` }
}

/**
 * Reads a stored library of any age or provenance into the current format, keeping as much as
 * can be kept. A bare list of tracks counts too. A track that fails validation is repaired
 * where possible and dropped (with a warning) where not. Null when the data is not a library at
 * all. A format change adds its upgrade step here, before the track loop.
 */
export function importLibrary(raw: unknown): LoadResult | null {
  const file: Record<string, unknown> | null = Array.isArray(raw) ? { tracks: raw } : isObject(raw) ? raw : null
  if (!file || !Array.isArray(file.tracks)) return null
  const warnings: string[] = []
  const versionNote = versionWarning(file.schemaVersion)
  if (versionNote) warnings.push(versionNote)
  if (file.tracks.length > MAX_TRACKS) warnings.push(`only the first ${MAX_TRACKS} tracks were read`)

  const takenTrackIds = new Set<string>()
  const tracks: Track[] = []
  file.tracks.slice(0, MAX_TRACKS).forEach((rawTrack, i) => {
    const { track, warning } = importTrack(rawTrack, i, takenTrackIds)
    if (warning) warnings.push(warning)
    if (!track) return
    takenTrackIds.add(track.id)
    tracks.push(track)
  })
  const leadMs = clampedInt(file.leadMs, 0, MAX_LEAD_MS) ?? 0
  return { ...sanitizeLibrary({ tracks, leadMs }), warnings }
}

/** Lenient read of a stored file; an unrecognisable one reads as an empty library with a warning. */
export const parseLibraryFile = (raw: unknown): LoadResult =>
  importLibrary(raw) ?? { ...emptyLibrary(), warnings: ['library file had an unexpected format and was reset'] }
