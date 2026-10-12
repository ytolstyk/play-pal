import { BAND_COUNT, type Scene } from './scene'

export interface Colors {
  primary: string
  secondary: string
}

/** Drawers are given the context already scaled to CSS pixels and cleared. State between frames lives in `memory`. */
export interface Frame {
  g: CanvasRenderingContext2D
  w: number
  h: number
  s: Scene
  c: Colors
  dt: number
}

type Drawer = (f: Frame, memory: Memory) => void

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  size: number
  hot: boolean
}

export interface Memory {
  particles: Particle[]
}

export const createMemory = (): Memory => ({ particles: [] })

const TAU = Math.PI * 2
const MAX_PARTICLES = 250

const gradient = (g: CanvasRenderingContext2D, y0: number, y1: number, c: Colors): CanvasGradient => {
  const grad = g.createLinearGradient(0, y0, 0, y1)
  grad.addColorStop(0, c.secondary)
  grad.addColorStop(1, c.primary)
  return grad
}

const bars: Drawer = ({ g, w, h, s, c }) => {
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
    g.roundRect(x, floor - bh, bw, bh, Math.min(4, bw / 2))
    g.fill()
    g.globalAlpha = 1
    g.fillRect(x, floor - s.caps[band] * (h - 30) - 5, bw, 2)
  }
}

const scope: Drawer = ({ g, w, h, s, c }) => {
  const mid = h / 2
  const amp = h * (0.28 + s.bass * 0.3)
  const n = s.wave.length
  const trace = (scale: number): void => {
    g.beginPath()
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * w
      const y = mid + s.wave[i] * amp * scale
      if (i === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
  }
  g.lineJoin = 'round'
  // The glow is a wide, faint stroke under the line (shadowBlur is far costlier every frame).
  const line = 2.5 + s.pulse * 3
  const strokeTrace = (colour: string, width: number, alpha: number, scale: number): void => {
    g.strokeStyle = colour
    g.lineWidth = width
    g.globalAlpha = alpha
    trace(scale)
    g.stroke()
  }
  strokeTrace(c.secondary, 8, 0.12, -0.7)
  strokeTrace(c.secondary, 2, 0.5, -0.7)
  strokeTrace(c.primary, line * 3.5, 0.15, 1)
  strokeTrace(c.primary, line, 1, 1)
  g.globalAlpha = 1
}

const radial: Drawer = ({ g, w, h, s, c }) => {
  const cx = w / 2
  const cy = h / 2
  const base = Math.min(w, h) * (0.2 + s.pulse * 0.025)
  const reach = Math.min(w, h) * 0.26
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
      const len = 4 + s.bands[i] * reach
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

const sparks: Drawer = ({ g, w, h, s, c, dt }, memory) => {
  const ps = memory.particles
  const cx = w / 2
  const cy = h / 2
  const spawn = (n: number, speed: number, hot: boolean): void => {
    for (let i = 0; i < n && ps.length < MAX_PARTICLES; i++) {
      const a = Math.random() * TAU
      const v = speed * (0.4 + Math.random() * 0.6)
      ps.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, size: 1.5 + Math.random() * 3, hot })
    }
  }
  const scale = Math.min(w, h)
  if (s.beat) spawn(Math.round(24 + s.bass * 40), scale * (0.7 + s.bass), true)
  spawn(Math.round(s.treble * 4), scale * 0.35, false)

  g.globalCompositeOperation = 'lighter'
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i]
    p.life -= dt * 0.7
    if (p.life <= 0) {
      ps[i] = ps[ps.length - 1]
      ps.pop()
      continue
    }
    p.vx *= 1 - dt * 0.8
    p.vy *= 1 - dt * 0.8
    p.x += p.vx * dt
    p.y += p.vy * dt
    g.globalAlpha = p.life
    g.fillStyle = p.hot ? c.primary : c.secondary
    g.beginPath()
    g.arc(p.x, p.y, p.size * (0.4 + p.life), 0, TAU)
    g.fill()
  }
  const r = scale * (0.07 + s.pulse * 0.08 + s.bass * 0.04)
  const glow = g.createRadialGradient(cx, cy, 0, cx, cy, r * 2.2)
  glow.addColorStop(0, c.primary)
  glow.addColorStop(0.4, c.secondary)
  glow.addColorStop(1, 'transparent')
  g.globalAlpha = 0.35 + s.pulse * 0.5
  g.fillStyle = glow
  g.beginPath()
  g.arc(cx, cy, r * 2.2, 0, TAU)
  g.fill()
  g.globalAlpha = 1
  g.globalCompositeOperation = 'source-over'
}

/** The one place a visualizer is registered. */
const REGISTRY = {
  bars: { label: 'Bars', draw: bars },
  scope: { label: 'Scope', draw: scope },
  radial: { label: 'Radial', draw: radial },
  sparks: { label: 'Sparks', draw: sparks }
} as const

export type VizKind = keyof typeof REGISTRY

export const VISUALIZERS = (Object.keys(REGISTRY) as VizKind[]).map((kind) => ({ kind, label: REGISTRY[kind].label }))
export const isVizKind = (v: unknown): v is VizKind => typeof v === 'string' && Object.hasOwn(REGISTRY, v)
export const drawerFor = (kind: VizKind): Drawer => REGISTRY[kind].draw
