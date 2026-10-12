import { clampInt } from '../../../shared/guards'
import { MAX_LEAD_MS, type MidiStatus } from '../../../shared/types'

interface Props {
  midi: MidiStatus
  leadMs: number
  messages: string[]
  settingsOpen: boolean
  onToggleSettings(): void
  onLeadChange(ms: number): void
}

export function StatusBar({ midi, leadMs, messages, settingsOpen, onToggleSettings, onLeadChange }: Props): React.JSX.Element {
  const open = midi.state === 'open'
  return (
    <footer className="statusbar">
      <span className={open ? 'dot ok' : 'dot bad'} />
      <span>{open ? `MIDI out: ${midi.name}` : 'MIDI port lost'}</span>
      {!open && <button className="small" onClick={() => void window.api.reconnect()}>Reconnect</button>}
      <label className="muted small lead">
        Fire cues
        <input
          type="number"
          min={0}
          max={MAX_LEAD_MS}
          step={10}
          value={leadMs}
          onChange={(e) => onLeadChange(clampInt(e.target.value, 0, MAX_LEAD_MS))}
        />
        ms early
      </label>
      <span className="messages small">{messages.join(' · ')}</span>
      <button className="ghost small gear" aria-expanded={settingsOpen} onClick={onToggleSettings} title="Settings">
        ⚙ Settings
      </button>
    </footer>
  )
}
