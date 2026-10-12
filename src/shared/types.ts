export type MidiMessageType = 'cc' | 'note'

/** What a cue sends. Notes send On, then Off after NOTE_OFF_DELAY_MS (trigger style). */
export interface MidiAction {
  type: MidiMessageType
  /** MIDI_CHANNEL_MIN-MIDI_CHANNEL_MAX */
  channel: number
  /** CC or note number, 0-127 */
  number: number
  /** CC value or note velocity, 0-127 */
  value: number
}

export interface Cue {
  id: string
  /** Seconds from the start of the track. */
  time: number
  label: string
  action: MidiAction
  /** One of CUE_COLORS (#rrggbb). Absent means the theme accent. */
  color?: string
}

export type TrackSource =
  | { kind: 'file'; path: string }
  | { kind: 'ytmusic'; videoId: string }

/** Sent when playback starts from the beginning; playback begins `waitMs` later so the preset can load. */
export interface StartPreset {
  action: MidiAction
  waitMs: number
}

export interface Track {
  id: string
  title: string
  source: TrackSource
  cues: Cue[]
  start?: StartPreset
  /** Playback volume, 0-1. Absent means full. */
  volume?: number
}

export interface Library {
  tracks: Track[]
  /** Cues fire this many ms early to cover preset load time. */
  leadMs: number
}

export interface LibraryFile extends Library {
  schemaVersion: 1
}

export interface LoadResult extends Library {
  warnings: string[]
}

export interface SaveResult {
  ok: boolean
  errors: string[]
}

export type PortState = 'open' | 'lost'

export interface MidiStatus {
  state: PortState
  name: string | null
}

/** Player position as reported by a source (renderer `<audio>` or the YouTube Music page). */
export interface PlaybackState {
  t: number
  duration: number
  playing: boolean
  rate: number
}

export interface ClockSample extends PlaybackState {
  trackId: string
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type YtCommand =
  | { cmd: 'play' }
  | { cmd: 'pause' }
  | { cmd: 'seek'; value: number }
  | { cmd: 'rate'; value: number }
  | { cmd: 'volume'; value: number }

export const DEFAULT_VOLUME = 1
export const PORT_BASE_NAME = 'Play-Pal'
export const NOTE_OFF_DELAY_MS = 100
export const MAX_LEAD_MS = 1000
export const MAX_START_WAIT_MS = 5000
export const DEFAULT_START_WAIT_MS = 1000
export const MIDI_CHANNEL_MIN = 1
export const MIDI_CHANNEL_MAX = 16
export const MIDI_DATA_MAX = 127
export const MAX_TITLE = 200
export const MAX_LABEL = 100
export const MAX_TRACKS = 500
export const MAX_CUES = 200
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'aif', 'aiff']
