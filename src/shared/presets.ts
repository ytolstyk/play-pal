import { CUE_COLORS, isAutoCueLabel, sameAction } from './cues'
import type { Cue, MidiAction, Track } from './types'

/** A named segment (label, colour, MIDI action) that other cues can copy. Derived from the library, never stored. */
export interface CuePreset extends Pick<Cue, 'label' | 'color' | 'action'> {
  /** Identifies this exact label, colour and message; stable across edits elsewhere. */
  id: string
  /** Cues (or `startPresetSourceId`s) that carry exactly this preset. */
  sourceIds: string[]
}

/** Start presets are not cues, so they get an id of their own (one per track). */
export const startPresetSourceId = (trackId: string): string => `start:${trackId}`

const collator = new Intl.Collator()

// \u0000 cannot occur in a label, so two different segments never share an id.
const presetId = (label: string, color: string | undefined, a: MidiAction): string =>
  `${label}\u0000${color ?? ''}\u0000${a.type}${a.channel}.${a.number}.${a.value}`

/**
 * Every named cue and start preset in the library as a preset, identical ones merged, sorted by name.
 * Cues still carrying the name "Add cue here" gave them are skipped: the user has not named those.
 * Following the library means a new segment is selectable as soon as it is named, with no separate list to keep.
 */
export function collectPresets(tracks: readonly Track[]): CuePreset[] {
  const byId = new Map<string, CuePreset>()
  const add = (sourceId: string, label: string | undefined, color: string | undefined, action: MidiAction): void => {
    const name = label?.trim()
    if (!name || isAutoCueLabel(name)) return
    const id = presetId(name, color, action)
    const found = byId.get(id)
    if (found) found.sourceIds.push(sourceId)
    else byId.set(id, { id, label: name, color, action: { ...action }, sourceIds: [sourceId] })
  }
  for (const t of tracks) {
    if (t.start) add(startPresetSourceId(t.id), t.start.label, t.start.color, t.start.action)
    for (const c of t.cues) add(c.id, c.label, c.color, c.action)
  }
  return [...byId.values()].sort((a, b) => collator.compare(a.label, b.label))
}

const sameStrings = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((s, i) => s === b[i])

/** Whether two preset lists are interchangeable, so a caller can keep the old array (and skip re-rendering menus) after an unrelated edit. */
export const samePresets = (a: readonly CuePreset[], b: readonly CuePreset[]): boolean =>
  a.length === b.length &&
  a.every(
    (p, i) =>
      p.label === b[i].label &&
      p.color === b[i].color &&
      sameAction(p.action, b[i].action) &&
      sameStrings(p.sourceIds, b[i].sourceIds)
  )

/** The presets a cue can pick: not one it already carries (picking it would change nothing). */
export const presetsFor = (presets: readonly CuePreset[], sourceId: string): CuePreset[] =>
  presets.filter((p) => !p.sourceIds.includes(sourceId))

/** What picking a preset writes into a cue or start preset (the action is copied, never shared). */
export const presetFields = (p: CuePreset): Pick<Cue, 'label' | 'color' | 'action'> => ({
  label: p.label,
  color: p.color,
  action: { ...p.action }
})

/** Menu text, e.g. `Lead · Coral · CC ch1 #20 =127`; the colour keeps same-named presets apart. */
export const describePreset = (p: CuePreset): string => {
  const color = p.color ? `${CUE_COLORS.find((c) => c.hex === p.color)?.name ?? p.color} · ` : ''
  const { type, channel, number, value } = p.action
  return `${p.label} · ${color}${type === 'note' ? 'Note' : 'CC'} ch${channel} #${number} =${value}`
}
