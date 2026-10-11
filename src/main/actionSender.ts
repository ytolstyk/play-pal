import { encodeNoteOff, encodeOn } from '../shared/midi-encode'
import { NOTE_OFF_DELAY_MS, type MidiAction } from '../shared/types'
import type { MidiPort } from './midi'

/** Sends a cue's MIDI. Notes get an automatic Note Off, like the controller's trigger mode. */
export class ActionSender {
  private readonly pendingOffs = new Map<ReturnType<typeof setTimeout>, number[]>()
  /** Note Offs that couldn't be sent because the port was down; delivered by retryOffs(). */
  private lostOffs: number[][] = []

  constructor(private readonly port: MidiPort) {}

  /** True when the message went out. */
  send(action: MidiAction): boolean {
    if (!this.port.send(encodeOn(action))) return false
    if (action.type !== 'note') return true
    const off = encodeNoteOff(action)
    const timer = setTimeout(() => {
      this.pendingOffs.delete(timer)
      if (!this.port.send(off)) this.lostOffs.push(off)
    }, NOTE_OFF_DELAY_MS)
    this.pendingOffs.set(timer, off)
    return true
  }

  /** Call when the port is back: releases notes whose Off was lost. */
  retryOffs(): void {
    const offs = this.lostOffs
    this.lostOffs = []
    for (const off of offs) if (!this.port.send(off)) this.lostOffs.push(off)
  }

  /** Sends any Note Offs still waiting, so quitting never leaves a note hanging. */
  flush(): void {
    this.retryOffs()
    for (const [timer, off] of this.pendingOffs) {
      clearTimeout(timer)
      this.port.send(off)
    }
    this.pendingOffs.clear()
  }
}
