import { CUE_COLORS } from '../../../shared/cues'

interface Props {
  color: string | undefined
  onChange(color: string | undefined): void
}

export function ColorSwatches({ color, onChange }: Props): React.JSX.Element {
  return (
    <div className="swatches" role="group" aria-label="Color">
      {CUE_COLORS.map((col) => (
        <button
          key={col.hex}
          aria-pressed={color === col.hex}
          aria-label={col.name}
          title={col.name}
          className={color === col.hex ? 'swatch on' : 'swatch'}
          style={{ background: col.hex }}
          onClick={() => onChange(color === col.hex ? undefined : col.hex)}
        />
      ))}
    </div>
  )
}
