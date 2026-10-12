import { clampInt } from '../../../shared/guards'
import { MIDI_CHANNEL_MAX, MIDI_CHANNEL_MIN, MIDI_DATA_MAX, type MidiAction } from '../../../shared/types'

interface Props {
  action: MidiAction
  onChange(action: MidiAction): void
}

/** Editor for one raw MIDI action (type, channel, number, value) plus a Test button. */
export function ActionFields({ action, onChange }: Props): React.JSX.Element {
  const set = (change: Partial<MidiAction>): void => onChange({ ...action, ...change })
  return (
    <>
      <select
        value={action.type}
        aria-label="MIDI type"
        onChange={(e) => set({ type: e.target.value === 'note' ? 'note' : 'cc' })}
      >
        <option value="cc">CC</option>
        <option value="note">Note</option>
      </select>
      <label className="num">
        ch
        <input
          type="number"
          min={MIDI_CHANNEL_MIN}
          max={MIDI_CHANNEL_MAX}
          value={action.channel}
          onChange={(e) => set({ channel: clampInt(e.target.value, MIDI_CHANNEL_MIN, MIDI_CHANNEL_MAX) })}
        />
      </label>
      <label className="num">
        #
        <input
          type="number"
          min={0}
          max={MIDI_DATA_MAX}
          value={action.number}
          onChange={(e) => set({ number: clampInt(e.target.value, 0, MIDI_DATA_MAX) })}
        />
      </label>
      <label className="num">
        val
        <input
          type="number"
          min={0}
          max={MIDI_DATA_MAX}
          value={action.value}
          onChange={(e) => set({ value: clampInt(e.target.value, 0, MIDI_DATA_MAX) })}
        />
      </label>
      <button className="ghost small" onClick={() => void window.api.testAction(action)}>
        Test
      </button>
    </>
  )
}
