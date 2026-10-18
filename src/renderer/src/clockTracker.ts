/** The clock differs from where the last update was heading by more than this: a seek. */
const JUMP_S = 0.5
/** No clock update for this long: the page is paused, reset or on another song. */
const MAX_AGE_S = 0.4

export interface ClockReading {
  /** Best estimate of the position right now, seconds. */
  t: number
  /** The position jumped since the last reading (seek or loop). */
  jumped: boolean
  /** The clock has stopped updating. */
  stale: boolean
}

/**
 * Turns a clock that updates every 50-100 ms into a position that can be read at any moment by
 * extrapolating from the last update, and notices seeks and a clock that went quiet.
 */
export class ClockTracker {
  private t: number
  private at: number

  constructor(t: number, now: number) {
    this.t = t
    this.at = now
  }

  /** `clockT` is the clock's current value, `now` a monotonic time in ms, `rate` the playback rate. */
  read(clockT: number, now: number, rate: number): ClockReading {
    let jumped = false
    if (clockT !== this.t) {
      jumped = Math.abs(clockT - (this.t + ((now - this.at) / 1000) * rate)) > JUMP_S
      this.t = clockT
      this.at = now
    }
    const age = (now - this.at) / 1000
    return { t: this.t + age * rate, jumped, stale: age > MAX_AGE_S }
  }
}
