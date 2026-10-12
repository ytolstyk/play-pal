import { START_CUE_ID, START_PRESET_LABEL, sortedByTime } from '../shared/cues'
import type { ClockSample, Cue, StartPreset } from '../shared/types'

/** A sample further than this from where we expected the player to be means the user seeked or looped. */
const SEEK_TOLERANCE_S = 0.3
const PAUSED_TOLERANCE_S = 0.02
/** Landing within this long after a cue means the user aimed at that cue, so it fires even if already loaded. */
const JUST_PAST_CUE_S = 1
/** Re-sending an already loaded cue is rate-limited so scrubbing can't flood the plugin with preset loads. */
const REFIRE_MIN_MS = 250
/** No sample for this long means the player is gone (crash, hang, YouTube moved on): stop extrapolating. */
const STALE_MS = 2000
/** How often a cue whose MIDI failed (port down) is retried. */
const RETRY_MS = 100

/** Id of the pseudo-cue that stands for the track's start preset. */
export { START_CUE_ID }

interface Base {
  t: number
  /** Monotonic ms when `t` was observed (main-process clock). */
  at: number
  playing: boolean
  rate: number
}

/**
 * Turns player position samples into cue firings. Pure: time is passed in, firing is a callback.
 *
 * Between samples the position is extrapolated from the last one, so firing does not depend on
 * how often the player reports. A jump (seek/loop/track change) never replays the cues it skipped;
 * it fires only the cue that should be active at the new position, and only if that preset isn't already loaded
 * or the position is just past the cue (a seek aimed at it).
 * Crossing a cue during playback always fires, so looping a section re-fires its cues.
 */
export class CueRunner {
  private trackId: string | null = null
  private cues: Cue[] = []
  private leadS = 0
  private base: Base | null = null
  /** Cues at or before this position (including lead) have been handled. */
  private cursor = 0
  /** Cue whose preset is currently loaded (last fired or restored). */
  private activeId: string | null = null
  /** A cue that crossed but couldn't be sent yet; retried until it goes out or something newer replaces it. */
  private pending: { cue: Cue; lastTry: number } | null = null
  private lastEmitAt = -Infinity
  /** The track's start preset, resent when the user rewinds to before the first cue. */
  private start: Cue | null = null

  /** `fire` reports whether the MIDI actually went out; a failed send leaves the cue unfired. */
  constructor(private readonly fire: (cue: Cue) => boolean) {}

  select(trackId: string | null, cues: Cue[], start: StartPreset | null = null): void {
    this.trackId = trackId
    this.cues = sortedByTime(cues)
    this.base = null
    this.cursor = 0
    this.activeId = null
    this.pending = null
    this.lastEmitAt = -Infinity
    this.start = this.startCue(start)
  }

  private startCue(start: StartPreset | null): Cue | null {
    return start
      ? { id: START_CUE_ID, time: 0, label: start.label || START_PRESET_LABEL, action: start.action, ...(start.color ? { color: start.color } : {}) }
      : null
  }

  /** Cues edited while a track is open; position and "already fired" state are kept. */
  setCues(cues: Cue[], start: StartPreset | null = null): void {
    // An edited or removed start preset is no longer the loaded one: the next rewind must resend.
    if (this.activeId === START_CUE_ID && JSON.stringify(start?.action ?? null) !== JSON.stringify(this.start?.action ?? null)) {
      this.activeId = null
    }
    this.start = this.startCue(start)
    const loaded = this.cues.find((c) => c.id === this.activeId)
    this.cues = sortedByTime(cues)
    // The loaded preset was edited or deleted: a later seek into its section must resend, not be deduped.
    const now = this.cues.find((c) => c.id === this.activeId)
    if (loaded && JSON.stringify(now?.action) !== JSON.stringify(loaded.action)) this.activeId = null
    const p = this.pending
    if (p) {
      const edited = p.cue.id === START_CUE_ID ? this.start : this.cues.find((c) => c.id === p.cue.id)
      if (!edited) this.pending = null
      else p.cue = edited
    }
  }

  /**
   * Something outside the cues (the start preset) replaced the loaded preset. Forget the cue (the start preset is now the loaded one), and treat the
   * next sample as a fresh start so a cue at the very beginning is fired once playback begins.
   */
  presetReplaced(): void {
    this.activeId = this.start ? START_CUE_ID : null
    this.base = null
    this.pending = null
  }

  setLeadMs(ms: number): void {
    this.leadS = ms / 1000
  }

  sample(s: ClockSample, now: number): void {
    if (s.trackId !== this.trackId) return
    const jumped = this.base === null || this.isJump(s, now)
    // Only a rewind can be aimed at a cue already behind us; a forward jump (stall, ad) stays in its section.
    const rewound = this.base !== null && s.t < this.positionAt(now)
    this.base = { t: s.t, at: now, playing: s.playing, rate: s.rate }
    if (!jumped) return
    this.cursor = s.t + this.leadS
    this.pending = null // a retry from before the jump would load the wrong section's preset
    const active = this.lastCueAtOrBefore(this.cursor)
    if (!active) {
      // Rewound to before the first cue: the song's opening preset applies again.
      if (rewound && this.start && this.activeId !== START_CUE_ID) this.emit(this.start, now)
      return
    }
    // The same preset is already loaded; don't resend it on every seek within one section,
    // unless the seek landed right at its start (restarting that section).
    const restart = rewound && this.cursor - active.time <= JUST_PAST_CUE_S && now - this.lastEmitAt >= REFIRE_MIN_MS
    if (active.id !== this.activeId || restart) this.emit(active, now)
  }

  /** The player is no longer reporting for this track (e.g. YouTube auto-advanced). */
  halt(): void {
    if (this.base) this.base = { ...this.base, playing: false }
  }

  tick(now: number): void {
    this.retryPending(now)
    if (!this.base?.playing) return
    if (now - this.base.at > STALE_MS) {
      this.halt()
      return
    }
    const pos = this.positionAt(now) + this.leadS
    if (pos <= this.cursor) return
    // If several were crossed at once (a stalled timer), earlier presets are already stale: keep the last.
    let latest: Cue | null = null
    for (const c of this.cues) {
      if (c.time > pos) break
      if (c.time > this.cursor) latest = c
    }
    this.cursor = pos
    if (latest) this.emit(latest, now)
  }

  private isJump(s: ClockSample, now: number): boolean {
    const base = this.base
    if (!base) return true
    const expected = this.positionAt(now)
    return Math.abs(s.t - expected) > (base.playing ? SEEK_TOLERANCE_S : PAUSED_TOLERANCE_S)
  }

  private positionAt(now: number): number {
    const base = this.base
    if (!base) return 0
    return base.playing ? base.t + ((now - base.at) / 1000) * base.rate : base.t
  }

  private lastCueAtOrBefore(pos: number): Cue | null {
    let found: Cue | null = null
    for (const c of this.cues) {
      if (c.time > pos) break
      found = c
    }
    return found
  }

  private emit(cue: Cue, now: number): void {
    if (this.fire(cue)) {
      this.activeId = cue.id
      this.lastEmitAt = now
      this.pending = null
    } else {
      this.pending = { cue, lastTry: now }
    }
  }

  private retryPending(now: number): void {
    const p = this.pending
    if (!p || now - p.lastTry < RETRY_MS) return
    p.lastTry = now
    if (this.fire(p.cue)) {
      this.activeId = p.cue.id
      this.pending = null
    }
  }
}
