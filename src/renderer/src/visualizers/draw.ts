import { WAVE_SAMPLES } from '../../../shared/audio'
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

/** An expanding shockwave ring. */
export interface Ring {
  r: number
  life: number
  speed: number
  width: number
}

export interface Memory {
  particles: Particle[]
  rings: Ring[]
}

export const createMemory = (): Memory => ({ particles: [], rings: [] })

const TAU = Math.PI * 2
const MAX_PARTICLES = 600
const MAX_RINGS = 8

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

const scope: Drawer = ({ g, w, h, s, c }) => {
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

const radial: Drawer = ({ g, w, h, s, c }) => {
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

const sparks: Drawer = ({ g, w, h, s, c, dt }, memory) => {
  const ps = memory.particles
  const rings = memory.rings
  const cx = w / 2
  const cy = h / 2
  const scale = Math.min(w, h)
  const spawn = (n: number, speed: number, hot: boolean, size = 1): void => {
    for (let i = 0; i < n && ps.length < MAX_PARTICLES; i++) {
      const a = Math.random() * TAU
      const v = speed * (0.3 + Math.random() * 0.7)
      ps.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, size: (1.5 + Math.random() * 3) * size, hot })
    }
  }
  const ring = (speed: number, width: number): void => {
    if (rings.length < MAX_RINGS) rings.push({ r: scale * 0.05, life: 1, speed, width })
  }
  // Kick: a burst scaled by how hard it hit. Snare/clap: a cooler, smaller one. Sudden loudness: everything at once.
  if (s.beat) {
    spawn(Math.round(40 + s.bass * 90), scale * (0.9 + s.bass * 1.2), true)
    ring(scale * 1.1, 3 + s.bass * 4)
  }
  if (s.hit) {
    spawn(Math.round(20 + s.treble * 30), scale * 0.8, false)
    ring(scale * 0.8, 2)
  }
  if (s.surge >= 1) {
    spawn(260, scale * 2, true, 1.5)
    spawn(120, scale * 1.2, false, 1.3)
    ring(scale * 1.8, 10)
    ring(scale * 1.2, 5)
  }
  spawn(Math.round(s.treble * 4), scale * 0.35, false)

  g.globalCompositeOperation = 'lighter'
  if (s.surge > 0) {
    // A flash that fades with the surge.
    g.globalAlpha = s.surge * 0.35
    g.fillStyle = c.primary
    g.fillRect(0, 0, w, h)
  }
  for (let i = rings.length - 1; i >= 0; i--) {
    const rg = rings[i]
    rg.life -= dt * 1.4
    if (rg.life <= 0) {
      rings[i] = rings[rings.length - 1]
      rings.pop()
      continue
    }
    rg.r += rg.speed * dt
    g.globalAlpha = rg.life * 0.7
    g.strokeStyle = c.secondary
    g.lineWidth = rg.width * rg.life
    g.beginPath()
    g.arc(cx, cy, rg.r, 0, TAU)
    g.stroke()
  }
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
  const r = scale * (0.07 + s.pulse * 0.14 + s.bass * 0.05 + s.surge * 0.15)
  const glow = g.createRadialGradient(cx, cy, 0, cx, cy, r * 2.2)
  glow.addColorStop(0, c.primary)
  glow.addColorStop(0.4, c.secondary)
  glow.addColorStop(1, 'transparent')
  g.globalAlpha = Math.min(1, 0.35 + s.pulse * 0.5 + s.surge * 0.3)
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
