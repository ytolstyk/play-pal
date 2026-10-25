import { clamp } from '../../../shared/guards'
import { channels, DEFAULT_THEME, isHexColor } from '../theme'

/** Colours stepped along the spectrum, from the theme's primary (lows) to its secondary (highs), and a paler copy of each. */
export interface Ramp {
  /** `steps` colours, index 0 for the lowest frequencies. */
  tones: string[]
  /** The same hues pushed towards white, for the sharp, bright hits (cymbals, flashes). */
  hot: string[]
}

export const RAMP_STEPS = 16
/** A theme whose two colours are close in hue still gets a ramp this wide, continuing in the direction from primary to secondary. */
const MIN_HUE_SPAN = 90
const MIN_SATURATION = 0.75
const LIGHTNESS = 0.58
const HOT_LIGHTNESS = 0.82

interface Hsl {
  h: number
  s: number
  l: number
}

function toHsl(hex: string): Hsl {
  const [r, g, b] = channels(hex).map((c) => c / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const l = (max + min) / 2
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let sector: number
  if (max === r) sector = ((g - b) / d) % 6
  else if (max === g) sector = (b - r) / d + 2
  else sector = (r - g) / d + 4
  return { h: (sector * 60 + 360) % 360, s, l }
}

const css = (h: number, s: number, l: number): string => `hsl(${Math.round(((h % 360) + 360) % 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`

let cached: { primary: string; secondary: string; ramp: Ramp } | null = null

/** The ramp for a theme (rebuilt only when the colours change). A colour that isn't #rrggbb falls back to the default theme's. */
export function rampFor(primary: string, secondary: string): Ramp {
  if (cached?.primary === primary && cached.secondary === secondary) return cached.ramp
  const valid = isHexColor(primary) && isHexColor(secondary)
  const from = toHsl(valid ? primary : DEFAULT_THEME.primary)
  const to = toHsl(valid ? secondary : DEFAULT_THEME.secondary)
  // The short way round the hue wheel, widened if the theme's colours are neighbours.
  let arc = ((to.h - from.h + 540) % 360) - 180
  if (Math.abs(arc) < MIN_HUE_SPAN) arc = arc < 0 ? -MIN_HUE_SPAN : MIN_HUE_SPAN
  const saturation = Math.max(MIN_SATURATION, from.s, to.s)
  const tones: string[] = []
  const hot: string[] = []
  for (let i = 0; i < RAMP_STEPS; i++) {
    const hue = from.h + (arc * i) / (RAMP_STEPS - 1)
    tones.push(css(hue, saturation, LIGHTNESS))
    hot.push(css(hue, saturation, HOT_LIGHTNESS))
  }
  const ramp = { tones, hot }
  cached = { primary, secondary, ramp }
  return ramp
}

/** Ramp index for a position 0 (lowest) to 1 (highest) along the spectrum. */
export const toneIndex = (t: number): number => clamp(Math.round(t * (RAMP_STEPS - 1)), 0, RAMP_STEPS - 1)
