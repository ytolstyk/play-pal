import { memo, useMemo, useState } from 'react'
import { describePreset, presetsFor, type CuePreset } from '../../../shared/presets'

const OWN_HEADING = 'Saved segments'

const optionOf = (p: CuePreset): React.JSX.Element => (
  <option key={p.id} value={p.id}>
    {describePreset(p)}
  </option>
)

/** The user's segments, then one heading per Neural DSP plugin; no headings while there are only the user's segments. */
function groupedOptions(presets: readonly CuePreset[]): React.JSX.Element[] | React.JSX.Element {
  const groups = new Map<string, CuePreset[]>()
  for (const p of presets) {
    const members = groups.get(p.group ?? '')
    if (members) members.push(p)
    else groups.set(p.group ?? '', [p])
  }
  if (groups.size === 1 && groups.has('')) return <>{presets.map(optionOf)}</>
  return [...groups].map(([group, members]) => (
    <optgroup key={group} label={group ? `${group} MIDI map` : OWN_HEADING}>
      {members.map(optionOf)}
    </optgroup>
  ))
}

/** Options appear only on an explicit open, so a stray letter on a focused menu cannot pick one. */
const OPEN_KEYS = ['Enter', ' ', 'ArrowDown', 'ArrowUp']

interface Props {
  presets: readonly CuePreset[]
  /** The cue (or start preset) being edited; presets it already carries are left out. */
  sourceId: string
  onPick(sourceId: string, preset: CuePreset): void
}

/**
 * Menu of saved segments; choosing one copies its name, colour and MIDI message. It always shows the
 * placeholder, so it acts as a command. Options exist only while the menu is in use, because every
 * cue row has one and a large library would otherwise put cues x presets options on the page.
 */
function PresetPickerImpl({ presets, sourceId, onPick }: Props): React.JSX.Element | null {
  const [active, setActive] = useState(false)
  const available = useMemo(() => presetsFor(presets, sourceId), [presets, sourceId])
  const menu = useMemo(() => (active ? groupedOptions(available) : null), [active, available])
  if (available.length === 0) return null
  return (
    <select
      className="preset-picker"
      value=""
      aria-label="Apply a preset"
      onMouseDown={() => setActive(true)}
      onKeyDown={(e) => OPEN_KEYS.includes(e.key) && setActive(true)}
      onBlur={() => setActive(false)}
      onChange={(e) => {
        const preset = available.find((p) => p.id === e.target.value)
        if (preset) onPick(sourceId, preset)
      }}
    >
      <option value="" disabled>
        Preset…
      </option>
      {active && menu}
    </select>
  )
}

export const PresetPicker = memo(PresetPickerImpl)
