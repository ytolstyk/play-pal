import { memo } from 'react'
import type { Cue, MidiAction } from '../../../shared/types'
import { sortedByTime } from '../../../shared/cues'
import { clampInt } from '../../../shared/guards'
import { formatTime, parseTime } from '../../../shared/time'
import { MAX_LABEL, MIDI_CHANNEL_MAX, MIDI_CHANNEL_MIN, MIDI_DATA_MAX } from '../../../shared/types'

interface Props {
  cues: Cue[]
  firedId: string | null
  onChange(id: string, change: Partial<Cue>): void
  onDelete(id: string): void
  onSeek(t: number): void
}

function TimeInput({ time, onCommit }: { time: number; onCommit(t: number): void }): React.JSX.Element {
  // Uncontrolled and keyed by `time`: a committed edit remounts it with the formatted value.
  return (
    <input
      className="time mono"
      key={time}
      defaultValue={formatTime(time)}
      aria-label="Cue time"
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      onBlur={(e) => {
        const t = parseTime(e.target.value)
        if (t === null) e.target.value = formatTime(time)
        else if (t !== time) onCommit(t)
      }}
    />
  )
}

function CueListImpl({ cues, firedId, onChange, onDelete, onSeek }: Props): React.JSX.Element {
  if (cues.length === 0) {
    return <p className="muted empty">No cues yet. Press M (or “Add cue here”) while the track plays.</p>
  }
  const sorted = sortedByTime(cues)
  const setAction = (c: Cue, change: Partial<MidiAction>): void =>
    onChange(c.id, { action: { ...c.action, ...change } })

  return (
    <ul className="cues">
      {sorted.map((c) => (
        <li key={c.id} className={c.id === firedId ? 'fired' : undefined}>
          <button className="ghost small" title="Jump here" onClick={() => onSeek(c.time)}>
            ▶
          </button>
          <TimeInput time={c.time} onCommit={(t) => onChange(c.id, { time: t })} />
          <input
            className="label"
            value={c.label}
            placeholder="Label (e.g. Lead)"
            maxLength={MAX_LABEL}
            aria-label="Cue label"
            onChange={(e) => onChange(c.id, { label: e.target.value })}
          />
          <select
            value={c.action.type}
            aria-label="MIDI type"
            onChange={(e) => setAction(c, { type: e.target.value === 'note' ? 'note' : 'cc' })}
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
              value={c.action.channel}
              onChange={(e) => setAction(c, { channel: clampInt(e.target.value, MIDI_CHANNEL_MIN, MIDI_CHANNEL_MAX) })}
            />
          </label>
          <label className="num">
            #
            <input
              type="number"
              min={0}
              max={MIDI_DATA_MAX}
              value={c.action.number}
              onChange={(e) => setAction(c, { number: clampInt(e.target.value, 0, MIDI_DATA_MAX) })}
            />
          </label>
          <label className="num">
            val
            <input
              type="number"
              min={0}
              max={MIDI_DATA_MAX}
              value={c.action.value}
              onChange={(e) => setAction(c, { value: clampInt(e.target.value, 0, MIDI_DATA_MAX) })}
            />
          </label>
          <button className="ghost small" onClick={() => void window.api.testAction(c.action)}>
            Test
          </button>
          <button className="ghost small" aria-label="Delete cue" onClick={() => onDelete(c.id)}>
            ✕
          </button>
        </li>
      ))}
    </ul>
  )
}

export const CueList = memo(CueListImpl)
