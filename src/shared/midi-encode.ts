import type { MidiAction } from './types'

const CC_STATUS = 0xb0
const NOTE_ON_STATUS = 0x90
const NOTE_OFF_STATUS = 0x80

const status = (base: number, channel: number): number => base | ((channel - 1) & 0x0f)

export function encodeOn(a: MidiAction): number[] {
  return [status(a.type === 'cc' ? CC_STATUS : NOTE_ON_STATUS, a.channel), a.number, a.value]
}

/** Only meaningful for notes; CCs have no "off". */
export const encodeNoteOff = (a: MidiAction): number[] => [status(NOTE_OFF_STATUS, a.channel), a.number, 0]
