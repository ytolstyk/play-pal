/**
 * Audio output selection on AudioContext (Chromium 110+), which this TypeScript's DOM lib does not declare.
 * Delete once the lib does.
 */
interface AudioContextOptions {
  sinkId?: string
}

interface AudioContext {
  readonly sinkId: string | { type: 'none' }
  /** '' is the system default; rejects when the device is gone or not permitted. */
  setSinkId(sinkId: string): Promise<void>
}
