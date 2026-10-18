import type { AudioFrame } from './audio'
import type {
  ClockSample,
  Track,
  Library,
  LoadResult,
  BackupInfo,
  RestoreResult,
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
  /** Copies of the library file kept before it was overwritten or reset, newest first. */
  listBackups(): Promise<BackupInfo[]>
  /** Replaces the library with a backup (the current one is kept as a backup first); the result carries the library now in force. */
  restoreBackup(id: string): Promise<RestoreResult>
  /** Picks a library file of any age and imports it as `restoreBackup` does; null when cancelled. */
  importLibraryFile(): Promise<RestoreResult | null>
  /** Native file dialog; null when cancelled. */
  pickAudioFile(): Promise<string | null>
  /**
   * The open track, as the renderer sees it (null = none). Main arms cues from this directly, so
   * firing never depends on a save having succeeded; call again on every edit. Also loads or
   * unloads the YouTube Music view when the source changes.
   */
  armTrack(track: Track | null): void
  /**
   * Sends the armed track's start preset and resolves once its wait has elapsed, i.e. when
   * playback may begin. False if the track has none or the MIDI didn't go out.
   */
  sendStartPreset(trackId: string): Promise<boolean>
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
  /** Navigates the YouTube Music view back to the armed track's page (the user may have wandered off). */
  ytReturn(): void
  /** Spectrum/waveform frames of the YouTube Music track, while analysis is on (see the `analyse` command). */
  onAudioFrame(cb: (f: AudioFrame) => void): () => void
  /** A track's recorded waveform (see shared/waveform.ts); null if none was saved. */
  loadWaveform(trackId: string): Promise<Uint8Array | null>
  /** Stores a library track's waveform (beside the library file, not in it); resolves to whether it was kept. */
  saveWaveform(trackId: string, bins: Uint8Array): Promise<boolean>
  testAction(action: MidiAction): Promise<void>
  getMidiStatus(): Promise<MidiStatus>
  onMidiStatus(cb: (s: MidiStatus) => void): () => void
  reconnect(): Promise<void>
}
