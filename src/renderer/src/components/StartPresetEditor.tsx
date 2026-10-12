import { DEFAULT_CUE_ACTION, START_PRESET_LABEL } from '../../../shared/cues'
import { clampInt } from '../../../shared/guards'
import { DEFAULT_START_WAIT_MS, MAX_LABEL, MAX_START_WAIT_MS, type StartPreset } from '../../../shared/types'
import { ActionFields } from './ActionFields'
import { ColorSwatches } from './ColorSwatches'

interface Props {
  start: StartPreset | undefined
  onChange(start: StartPreset | undefined): void
}

/** Optional per-track preset that is sent, then waited out, before playback starts from the beginning. */
export function StartPresetEditor({ start, onChange }: Props): React.JSX.Element {
  return (
    <div className="start-preset">
      <label>
        <input
          type="checkbox"
          checked={start !== undefined}
          onChange={(e) =>
            onChange(e.target.checked ? { action: DEFAULT_CUE_ACTION, waitMs: DEFAULT_START_WAIT_MS } : undefined)
          }
        />
        Start preset
      </label>
      {start ? (
        <>
          <input
            className="label"
            value={start.label ?? ''}
            placeholder={START_PRESET_LABEL}
            maxLength={MAX_LABEL}
            aria-label="Start preset name"
            onChange={(e) => onChange({ ...start, label: e.target.value || undefined })}
          />
          <ColorSwatches color={start.color} onChange={(color) => onChange({ ...start, color })} />
          <ActionFields action={start.action} onChange={(action) => onChange({ ...start, action })} />
          <label className="num">
            then wait
            <input
              type="number"
              min={0}
              max={MAX_START_WAIT_MS}
              step={100}
              value={start.waitMs}
              onChange={(e) => onChange({ ...start, waitMs: clampInt(e.target.value, 0, MAX_START_WAIT_MS) })}
            />
            ms
          </label>
        </>
      ) : (
        <span className="muted small">Set a preset before playback starts from the beginning.</span>
      )}
    </div>
  )
}
