import { memo, useEffect, useRef } from 'react'
import { levelOf, WAVE_BINS_PER_SECOND } from '../../../shared/waveform'
import type { View } from '../timelineView'

interface Props {
  bins: Uint8Array | null
  /** Changes when bins were filled in, since the array itself is edited in place. */
  revision: number
  view: View
  /** Loudness drawn at full height. */
  ceiling: number
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

/** Level 0-1 at bin position [from, to) (fractional), or null where nothing was recorded (a bin of 0). */
function levelBetween(bins: Uint8Array, from: number, to: number): number | null {
  if (to - from >= 1) {
    let peak = 0
    const end = Math.min(bins.length, Math.ceil(to))
    for (let i = Math.max(0, Math.floor(from)); i < end; i++) if (bins[i] > peak) peak = bins[i]
    return peak === 0 ? null : levelOf(peak)
  }
  // Narrower than a bin (zoomed in): blend the two nearest bins instead of drawing steps.
  const centre = (from + to) / 2 - BIN_MIDDLE
  const i = Math.floor(centre)
  const a = bins[i] ?? 0
  const b = bins[i + 1] ?? 0
  if (a === 0 && b === 0) return null
  if (a === 0 || b === 0) return levelOf(a || b)
  const f = centre - i
  return levelOf(a + (b - a) * f)
}

function paint(g: CanvasRenderingContext2D, w: number, h: number, props: Props, fill: string): void {
  g.clearRect(0, 0, w, h)
  const { bins, view, ceiling } = props
  g.fillStyle = fill
  const secondsPerPx = view.span / w
  const mid = h / 2
  const room = Math.max(1, mid - PAD_PX)
  for (let x = 0; x < w; x += PITCH_PX) {
    const t0 = view.start + x * secondsPerPx
    const level = bins ? levelBetween(bins, t0 * WAVE_BINS_PER_SECOND, (t0 + PITCH_PX * secondsPerPx) * WAVE_BINS_PER_SECOND) : null
    // Unrecorded stretches show as a flat line, so it is clear where the song has not been heard yet.
    const half = level === null ? MIN_HALF_BAR_PX : Math.max(MIN_HALF_BAR_PX, Math.min(1, level / ceiling) * room)
    g.fillRect(x, mid - half, BAR_PX, half * 2)
  }
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
  }, [props.bins, props.revision, props.view.start, props.view.span, props.ceiling, props.tone])

  return <canvas ref={canvasRef} className={props.className ?? 'wave'} aria-hidden="true" />
})
