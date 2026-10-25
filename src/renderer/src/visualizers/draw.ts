import { WAVE_SAMPLES } from '../../../shared/audio'
import { BAND_COUNT, type SceneView } from './scene'
import { createSparksMemory, drawSparks, isSparksActive } from './sparks'

export interface Colors {
  primary: string
  secondary: string
}

/** Drawers are given the context already scaled to CSS pixels and cleared. State between frames lives in `memory`. */
export interface Frame {
  g: CanvasRenderingContext2D
  w: number
  h: number
  s: SceneView
  c: Colors
  dt: number
}

/**
 * A drawer paints one frame (inside the host's save/restore, so it may change the transform and compositing).
 * Any state it keeps between frames is its own; `isActive` says whether that state still has motion to play out,
 * so the host knows not to stop the animation loop yet.
 */
export interface Drawer {
  draw(f: Frame): void
  isActive(): boolean
}

type DrawFn = (f: Frame) => void

const stateless = (draw: DrawFn) => (): Drawer => ({ draw, isActive: () => false })

const sparksDrawer = (): Drawer => {
  const memory = createSparksMemory()
  return { draw: (f) => drawSparks(f, memory), isActive: () => isSparksActive(memory) }
}

const TAU = Math.PI * 2

const gradient = (g: CanvasRenderingContext2D, y0: number, y1: number, c: Colors): CanvasGradient => {
  const grad = g.createLinearGradient(0, y0, 0, y1)
  grad.addColorStop(0, c.secondary)
  grad.addColorStop(1, c.primary)
  return grad
}

const bars: DrawFn = ({ g, w, h, s, c }) => {
  const count = 48
  const gap = Math.max(2, w / count / 5)
  const bw = (w - gap * (count + 1)) / count
  const floor = h - 10
  g.fillStyle = gradient(g, 0, h, c)
  for (let i = 0; i < count; i++) {
    const band = Math.floor((i / count) * BAND_COUNT)
    const v = s.bands[band]
    const x = gap + i * (bw + gap)
    const bh = Math.max(3, v * (h - 30))
    g.globalAlpha = 0.55 + v * 0.45
    g.beginPath()
    g.roundRect(x, floor - bh, Math.max(1, bw), bh, Math.max(0, Math.min(4, bw / 2)))
    g.fill()
    g.globalAlpha = 1
    g.fillRect(x, floor - s.caps[band] * (h - 30) - 5, bw, 2)
  }
}

const SCOPE_POINTS = Math.min(256, WAVE_SAMPLES / 2)

/** Index of the first rising zero crossing, so each frame starts at the same phase and the trace holds still. */
const triggerIndex = (wave: Float32Array): number => {
  const limit = wave.length - SCOPE_POINTS
  for (let i = 1; i < limit; i++) if (wave[i - 1] < 0 && wave[i] >= 0) return i
  return 0
}

const scope: DrawFn = ({ g, w, h, s, c }) => {
  const mid = h / 2
  const amp = h * (0.2 + s.bass * 0.12)
  const start = triggerIndex(s.wave)
  const trace = (): void => {
    g.beginPath()
    let prev = 0
    for (let i = 0; i < SCOPE_POINTS; i++) {
      // Light smoothing takes the fizz off the line without hiding the shape.
      const v = (prev + s.wave[start + i]) / 2
      prev = s.wave[start + i]
      const y = mid + Math.max(-1, Math.min(1, v)) * amp
      const x = (i / (SCOPE_POINTS - 1)) * w
      if (i === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
  }
  g.lineJoin = 'round'
  g.lineCap = 'round'
  g.strokeStyle = c.primary
  // The glow is a wide, faint stroke under the line (shadowBlur is far costlier every frame).
  trace()
  g.lineWidth = 9
  g.globalAlpha = 0.12 + s.pulse * 0.1
  g.stroke()
  g.lineWidth = 2 + s.pulse * 1.5
  g.globalAlpha = 1
  g.stroke()
}

const radial: DrawFn = ({ g, w, h, s, c }) => {
  const cx = w / 2
  const cy = h / 2
  const base = Math.min(w, h) * (0.2 + s.pulse * 0.025)
  const reach = Math.min(w, h) * 0.3
  const spin = s.time * 0.15
  g.lineCap = 'round'
  g.lineWidth = Math.max(2, (TAU * base) / (BAND_COUNT * 2) / 1.6)
  // One path per colour: two stroke calls instead of one per spoke.
  const spokes: [string, Path2D][] = [
    [c.secondary, new Path2D()],
    [c.primary, new Path2D()]
  ]
  for (const side of [1, -1]) {
    for (let i = 0; i < BAND_COUNT; i++) {
      // Each half sweeps the spectrum once, so the ring is mirrored.
      const angle = spin + side * ((i + 0.5) / BAND_COUNT) * Math.PI
      const len = 3 + s.bands[i] * s.bands[i] * reach
      const path = spokes[i % 2][1]
      path.moveTo(cx + Math.cos(angle) * base, cy + Math.sin(angle) * base)
      path.lineTo(cx + Math.cos(angle) * (base + len), cy + Math.sin(angle) * (base + len))
    }
  }
  for (const [colour, path] of spokes) {
    g.strokeStyle = colour
    g.stroke(path)
  }
  const core = g.createRadialGradient(cx, cy, 0, cx, cy, base)
  core.addColorStop(0, c.primary)
  core.addColorStop(1, 'transparent')
  g.globalAlpha = 0.25 + s.bass * 0.55
  g.fillStyle = core
  g.beginPath()
  g.arc(cx, cy, base, 0, TAU)
  g.fill()
  g.globalAlpha = 1
}

/** The one place a visualizer is registered. */
const REGISTRY = {
  bars: { label: 'Bars', create: stateless(bars) },
  scope: { label: 'Scope', create: stateless(scope) },
  radial: { label: 'Radial', create: stateless(radial) },
  sparks: { label: 'Sparks', create: sparksDrawer }
} as const

export type VizKind = keyof typeof REGISTRY

export const VISUALIZERS = (Object.keys(REGISTRY) as VizKind[]).map((kind) => ({ kind, label: REGISTRY[kind].label }))
export const isVizKind = (v: unknown): v is VizKind => typeof v === 'string' && Object.hasOwn(REGISTRY, v)
/** A drawer with no history, for a visualizer to run from the start. */
export const createDrawer = (kind: VizKind): Drawer => REGISTRY[kind].create()
