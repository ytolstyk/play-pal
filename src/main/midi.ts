import { Input, Output } from '@julusian/midi'
import { PORT_BASE_NAME, type PortState } from '../shared/types'

const MAX_SUFFIX = 6
const BASE_NAME_RETRIES = 3
const RETRY_DELAY_MS = 150

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface MidiPort {
  send(bytes: number[]): boolean
}

/**
 * The virtual CoreMIDI output. Never throws: failures flip the state to `lost`.
 * Reconnects are serialized; extra triggers coalesce into at most one retry.
 * (Same approach as the midi-controller app's port, under its own name.)
 */
export class VirtualPort implements MidiPort {
  private out: Output | null = null
  private current: PortState = 'lost'
  private portName: string | null = null
  private inflight: Promise<boolean> | null = null
  private queued = false

  constructor(private readonly onChange: () => void) {}

  state(): PortState {
    return this.current
  }
  name(): string | null {
    return this.portName
  }

  send(bytes: number[]): boolean {
    if (this.current !== 'open' || !this.out) return false
    try {
      this.out.sendMessage(bytes)
      return true
    } catch {
      this.current = 'lost'
      this.onChange()
      return false
    }
  }

  /** (Re)open under the base name. Safe to call from any trigger. */
  reconnect(): Promise<boolean> {
    if (this.inflight) {
      this.queued = true
      return this.inflight
    }
    const run = this.openFresh()
      .then((ok) => {
        this.onChange()
        return ok
      })
      .finally(() => {
        this.inflight = null
        if (this.queued) {
          this.queued = false
          void this.reconnect()
        }
      })
    this.inflight = run
    return run
  }

  close(): void {
    this.closeQuietly()
    this.current = 'lost'
  }

  private closeQuietly(): void {
    try {
      this.out?.closePort()
    } catch {
      // a dead handle may throw; nothing more to do
    }
    this.out = null
  }

  /** Open under the base name; fall back to a numeric suffix if a same-named source already exists. */
  private async openFresh(): Promise<boolean> {
    this.closeQuietly()
    this.current = 'lost'
    for (let n = 1; n <= MAX_SUFFIX; n++) {
      const name = n === 1 ? PORT_BASE_NAME : `${PORT_BASE_NAME} ${n}`
      const attempts = n === 1 ? BASE_NAME_RETRIES : 1
      for (let a = 0; a < attempts; a++) {
        if (this.tryOpen(name)) return true
        if (a < attempts - 1) await sleep(RETRY_DELAY_MS)
      }
    }
    this.portName = null
    return false
  }

  private tryOpen(name: string): boolean {
    let out: Output | null = null
    try {
      out = new Output()
      out.openVirtualPort(name)
      // CoreMIDI happily creates duplicates; ours is the only one if the name appears once.
      if (Input.getPortNames().filter((p) => p === name).length > 1) {
        out.closePort()
        return false
      }
      this.out = out
      this.current = 'open'
      this.portName = name
      return true
    } catch {
      try {
        out?.closePort()
      } catch {
        // ignore
      }
      return false
    }
  }
}
