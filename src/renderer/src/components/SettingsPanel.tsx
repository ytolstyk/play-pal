import { useEffect } from 'react'
import { THEME_PRESETS, type Theme } from '../theme'

interface Props {
  theme: Theme
  onChange(theme: Theme): void
  limiter: boolean
  onLimiterChange(on: boolean): void
  onClose(): void
}

const sameColor = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

export function SettingsPanel({ theme, onChange, limiter, onLimiterChange, onClose }: Props): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <section className="settings" role="dialog" aria-label="Settings">
        <header>
          <h2>Settings</h2>
          <button className="ghost small" onClick={onClose} aria-label="Close settings">
            ✕
          </button>
        </header>
        <h3 className="muted small">Colour scheme</h3>
        <ul className="presets">
          {THEME_PRESETS.map((p) => {
            const active = sameColor(p.primary, theme.primary) && sameColor(p.secondary, theme.secondary)
            return (
              <li key={p.name}>
                <button
                  className={active ? 'preset active' : 'preset'}
                  aria-pressed={active}
                  onClick={() => onChange({ primary: p.primary, secondary: p.secondary })}
                >
                  <span className="swatches">
                    <i style={{ background: p.primary }} />
                    <i style={{ background: p.secondary }} />
                  </span>
                  {p.name}
                </button>
              </li>
            )
          })}
        </ul>
        <div className="custom">
          <label>
            <input type="color" value={theme.primary} onChange={(e) => onChange({ ...theme, primary: e.target.value })} />
            Primary trim
          </label>
          <label>
            <input type="color" value={theme.secondary} onChange={(e) => onChange({ ...theme, secondary: e.target.value })} />
            Secondary trim
          </label>
        </div>
        <h3 className="muted small">YouTube Music audio</h3>
        <div className="custom">
          <label title="Compresses sudden loud peaks. Adds a little loudness and latency.">
            <input type="checkbox" checked={limiter} onChange={(e) => onLimiterChange(e.target.checked)} />
            Limiter (tames loud bursts)
          </label>
        </div>
      </section>
    </>
  )
}
