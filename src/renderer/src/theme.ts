import { isObject } from '../../shared/guards'

export interface Theme {
  /** Main trim colour: buttons, selection, played bar. #rrggbb */
  primary: string
  /** Second trim colour: wires, glows, fired cues. #rrggbb */
  secondary: string
}

export interface ThemePreset extends Theme {
  name: string
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  { name: 'Amber & Cyan', primary: '#ffb23e', secondary: '#3ee0ff' },
  { name: 'Synthwave', primary: '#ff4fa3', secondary: '#9d6bff' },
  { name: 'Matrix', primary: '#3dff8a', secondary: '#12b3a0' },
  { name: 'Ice', primary: '#5cc8ff', secondary: '#b9a6ff' },
  { name: 'Ember', primary: '#ff6a3d', secondary: '#ffd23e' },
  { name: 'Neon Lime', primary: '#c6ff3e', secondary: '#ff4fd8' }
]

export const DEFAULT_THEME: Theme = THEME_PRESETS[0]

const STORAGE_KEY = 'play-pal.theme'
const HEX = /^#[0-9a-f]{6}$/i

export const isHexColor = (v: unknown): v is string => typeof v === 'string' && HEX.test(v)

const channels = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]

/** Dark ink on light colours, light ink on dark ones (WCAG relative luminance). */
export function inkFor(hex: string): string {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35 ? '#10100c' : '#ffffff'
}

export const rgba = (hex: string, alpha: number): string => {
  const [r, g, b] = channels(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function applyTheme({ primary, secondary }: Theme): void {
  const s = document.documentElement.style
  s.setProperty('--accent', primary)
  s.setProperty('--accent-ink', inkFor(primary))
  s.setProperty('--accent-soft', rgba(primary, 0.22))
  s.setProperty('--accent-2', secondary)
  s.setProperty('--accent-2-soft', rgba(secondary, 0.16))
}

export function loadTheme(): Theme {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (isObject(raw)) {
      const { primary, secondary } = raw
      if (isHexColor(primary) && isHexColor(secondary)) return { primary, secondary }
    }
  } catch {
    // unreadable or blocked storage: fall back to the default
  }
  return DEFAULT_THEME
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(theme))
  } catch {
    // theme just won't persist
  }
}
