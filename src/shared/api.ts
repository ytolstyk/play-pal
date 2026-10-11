import type {
  ClockSample,
  Track,
  Library,
  LoadResult,
  MidiAction,
  MidiStatus,
  PlaybackState,
  Rect,
  SaveResult,
  YtCommand
} from './types'

/** Contract the preload exposes to the renderer as `window.api`. */
export interface Api {
  loadLibrary(): Promise<LoadResult>
  saveLibrary(library: Library): Promise<SaveResult>
  /** Native file dialog; null when cancelled. */
  pickAudioFile(): Promise<string | null>
  /**
   * The open track, as the renderer sees it (null = none). Main arms cues from this directly, so
   * firing never depends on a save having succeeded; call again on every edit. Also loads or
   * unloads the YouTube Music view when the source changes.
   */
  armTrack(track: Track | null): void
  /** Applies the fire-early offset immediately (saving it is separate). */
  setLead(ms: number): void
  /** Position of a local-file track, reported by the renderer's audio element. */
  sendClock(sample: ClockSample): void
  /** Position of a YouTube Music track, pushed from main. */
  onPlayback(cb: (s: PlaybackState) => void): () => void
  /** A cue just sent its MIDI (by id). */
  onCueFired(cb: (cueId: string) => void): () => void
  /** Where the YouTube Music view sits in the window; null hides it. */
  setYtBounds(rect: Rect | null): void
  ytCommand(command: YtCommand): void
  testAction(action: MidiAction): Promise<void>
  getMidiStatus(): Promise<MidiStatus>
  onMidiStatus(cb: (s: MidiStatus) => void): () => void
  reconnect(): Promise<void>
}
