import type { Cue } from './types'

export const sortedByTime = (cues: readonly Cue[]): Cue[] => [...cues].sort((a, b) => a.time - b.time)

/**
 * Selectable cue colours: the cue marker and the timeline segment up to the next cue use them.
 * Persisted by hex (any #rrggbb stays valid); not the theme palette.
 */
export const CUE_COLORS: readonly { name: string; hex: string }[] = [
  { name: 'Coral', hex: '#ff7a6b' },
  { name: 'Amber', hex: '#ffb23e' },
  { name: 'Lime', hex: '#a6e04a' },
  { name: 'Teal', hex: '#2fd3b0' },
  { name: 'Sky', hex: '#4fb6ff' },
  { name: 'Violet', hex: '#a98bff' },
  { name: 'Pink', hex: '#ff6fb5' }
]

const HEX_COLOR = /^#[0-9a-f]{6}$/i

/** Shape check only, so retuning the palette never invalidates saved cues; still safe to put in CSS. */
export const isCueColor = (v: unknown): v is string => typeof v === 'string' && HEX_COLOR.test(v)

/** Cue defaults for the first cue of a track. */
export const DEFAULT_CUE_ACTION = { type: 'cc', channel: 1, number: 20, value: 127 } as const
