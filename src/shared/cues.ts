import type { Cue } from './types'

export const sortedByTime = (cues: readonly Cue[]): Cue[] => [...cues].sort((a, b) => a.time - b.time)

/** Cue defaults for the first cue of a track. */
export const DEFAULT_CUE_ACTION = { type: 'cc', channel: 1, number: 20, value: 127 } as const
