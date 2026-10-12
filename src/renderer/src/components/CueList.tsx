import { memo } from 'react'
import type { Cue } from '../../../shared/types'
import { sortedByTime } from '../../../shared/cues'
import { formatTime, parseTime } from '../../../shared/time'
import { MAX_LABEL } from '../../../shared/types'
import { ActionFields } from './ActionFields'

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
          <ActionFields action={c.action} onChange={(action) => onChange(c.id, { action })} />
          <button className="ghost small" aria-label="Delete cue" onClick={() => onDelete(c.id)}>
            ✕
          </button>
        </li>
      ))}
    </ul>
  )
}

export const CueList = memo(CueListImpl)
