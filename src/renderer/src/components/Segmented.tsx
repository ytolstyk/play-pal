interface Props<T extends string> {
  label: string
  options: readonly { value: T; label: string }[]
  value: T
  onChange(value: T): void
}

/** A row of toggle buttons where exactly one is pressed. */
export function Segmented<T extends string>({ label, options, value, onChange }: Props<T>): React.JSX.Element {
  return (
    <div className="view-bar" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'primary' : ''} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
