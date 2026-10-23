import { memo, useEffect, useRef } from 'react'
import { levelOf, WAVE_BINS_PER_SECOND } from '../../../shared/waveform'
import type { DisplayBins } from '../../../shared/waveDisplay'
import type { View } from '../timelineView'

interface Props {
  bins: DisplayBins | null
  /** Changes when more of the track was recorded and `bins` was derived again. */
  revision: number
  view: View
  tone: 'idle' | 'played'
  className?: string
}

const BAR_PX = 3
const GAP_PX = 1
const PITCH_PX = BAR_PX + GAP_PX
/** Vertical room left above and below the tallest bar. */
const PAD_PX = 3

const TONE_VAR = { idle: '--muted', played: '--accent' } as const
const TONE_FALLBACK = { idle: '#8b909c', played: '#ffb23e' } as const
/** Half the height of the flat line drawn where nothing is recorded, and the least a recorded bar shows. */
const MIN_HALF_BAR_PX = 0.5
/** Bin `i` stands for the span [i, i + 1), so its middle is half a bin in. */
const BIN_MIDDLE = 0.5

/** Peak drawn faintly behind the average of the same stretch: the peak keeps hits visible, the average shows what is sustained. */
const PEAK_ALPHA = 0.35

interface BarLevels {
  peak: number
  mean: number
}

/** The level byte `fraction` (0-1) of the way from `a` to `b`, a missing one (0) leaving the other as it is. */
function interpolateBytes(a: number, b: number, fraction: number): number {
  if (a === 0) return b
  if (b === 0) return a
  return a + (b - a) * fraction
}

/** Fills `out` with the peak and average level 0-1 over bin positions [from, to) (fractional); false where nothing was recorded (a bin of 0). */
function levelsBetween(bins: DisplayBins, from: number, to: number, out: BarLevels): boolean {
  if (to - from >= 1) {
    let peak = 0
    let sum = 0
    let count = 0
    const end = Math.min(bins.length, Math.ceil(to))
    for (let i = Math.max(0, Math.floor(from)); i < end; i++) {
      const byte = bins[i]
      if (byte === 0) continue
      if (byte > peak) peak = byte
      sum += byte
      count++
    }
    if (count === 0) return false
    out.peak = levelOf(peak)
    out.mean = levelOf(sum / count)
    return true
  }
  // Narrower than a bin (zoomed in): blend the two nearest bins instead of drawing steps.
  const centre = (from + to) / 2 - BIN_MIDDLE
  const left = Math.floor(centre)
  const a = bins[left] ?? 0
  const b = bins[left + 1] ?? 0
  if (a === 0 && b === 0) return false
  out.peak = levelOf(interpolateBytes(a, b, centre - left))
  out.mean = out.peak
  return true
}

function paint(g: CanvasRenderingContext2D, w: number, h: number, { bins, view }: Pick<Props, 'bins' | 'view'>, fill: string): void {
  g.clearRect(0, 0, w, h)
  g.fillStyle = fill
  const secondsPerPx = view.span / w
  const mid = h / 2
  const room = Math.max(1, mid - PAD_PX)
  const columns = Math.ceil(w / PITCH_PX)
  const peaks = new Float32Array(columns)
  const means = new Float32Array(columns)
  const levels: BarLevels = { peak: 0, mean: 0 }
  for (let c = 0; c < columns; c++) {
    const t0 = view.start + c * PITCH_PX * secondsPerPx
    const recorded = bins !== null && levelsBetween(bins, t0 * WAVE_BINS_PER_SECOND, (t0 + PITCH_PX * secondsPerPx) * WAVE_BINS_PER_SECOND, levels)
    // Unrecorded stretches show as a flat line, so it is clear where the song has not been heard yet.
    peaks[c] = recorded ? Math.max(MIN_HALF_BAR_PX, levels.peak * room) : MIN_HALF_BAR_PX
    means[c] = recorded ? Math.max(MIN_HALF_BAR_PX, levels.mean * room) : MIN_HALF_BAR_PX
  }
  g.globalAlpha = PEAK_ALPHA
  g.beginPath()
  for (let c = 0; c < columns; c++) if (peaks[c] > means[c]) g.rect(c * PITCH_PX, mid - peaks[c], BAR_PX, peaks[c] * 2)
  g.fill()
  g.globalAlpha = 1
  g.beginPath()
  for (let c = 0; c < columns; c++) g.rect(c * PITCH_PX, mid - means[c], BAR_PX, means[c] * 2)
  g.fill()
}

/** Peaks and valleys of the recorded waveform over the visible stretch of the track. */
export const WaveCanvas = memo(function WaveCanvas(props: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const latest = useRef(props)
  const redraw = useRef<() => void>(() => undefined)

  useEffect(() => {
    const canvas = canvasRef.current
    const g = canvas?.getContext('2d')
    if (!canvas || !g) return
    let size = { w: 0, h: 0 }
    let fill = ''
    let fillTone: Props['tone'] | null = null
    const draw = (): void => {
      if (latest.current.tone !== fillTone) return readFill()
      if (size.w >= 1 && size.h >= 1) paint(g, size.w, size.h, latest.current, fill)
    }
    // Read on mount, on a theme change and when the tone changes, not per paint: it forces a style recalculation.
    const readFill = (): void => {
      fillTone = latest.current.tone
      fill = getComputedStyle(document.documentElement).getPropertyValue(TONE_VAR[fillTone]).trim() || TONE_FALLBACK[fillTone]
      draw()
    }
    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1
      const r = canvas.getBoundingClientRect()
      size = { w: r.width, h: r.height }
      // Assigning either dimension reallocates and clears the canvas, so only do it on a real change.
      const px = { w: Math.max(1, Math.round(r.width * dpr)), h: Math.max(1, Math.round(r.height * dpr)) }
      if (canvas.width !== px.w) canvas.width = px.w
      if (canvas.height !== px.h) canvas.height = px.h
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw()
    }
    redraw.current = draw
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(canvas)
    // The theme colours live on <html style>; repaint when they change.
    const themeObserver = new MutationObserver(readFill)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
    readFill()
    resize()
    return () => {
      resizeObserver.disconnect()
      themeObserver.disconnect()
      redraw.current = () => undefined
    }
  }, [])

  useEffect(() => {
    latest.current = props
    redraw.current()
  }, [props.bins, props.revision, props.view.start, props.view.span, props.tone])

  return <canvas ref={canvasRef} className={props.className ?? 'wave'} aria-hidden="true" />
})
