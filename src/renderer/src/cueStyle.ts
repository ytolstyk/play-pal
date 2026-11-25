import type { CSSProperties } from 'react'

/** Position and colour of a cue's marker. The cast is safe: `--cue` is a custom property, which CSSProperties just doesn't know about. */
export const cueStyle = (color: string | undefined, left: string): CSSProperties => ({ left, ...(color ? ({ '--cue': color } as CSSProperties) : {}) })
