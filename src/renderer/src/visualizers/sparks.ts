import { clamp } from '../../../shared/guards'
import { BAND_COUNT, type SceneView } from './scene'
import type { Frame } from './draw'
import { RAMP_STEPS, rampFor, toneIndex, type Ramp } from './palette'

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  /** 1 when thrown, 0 when gone. */
  life: number
  /** Life lost per second. */
  fade: number
  /** Stroke width in px when new. */
  size: number
  /** Index into the palette: where along the spectrum (low to high) the sound that made it sits. */
  tone: number
  /** Drawn in the paler, brighter colour. */
  hot: boolean
  /** Length of the trail in seconds of travel; 0 draws a dot. */
  streak: number
  /** Share of its speed lost per second. */
  drag: number
  /** Upward acceleration in px/s². */
  lift: number
  /** Which way the mids curl it round the centre (1 or -1), 0 for none. */
  curl: number
  /** Offset into its twinkle or sway. */
  phase: number
}

/** An expanding shockwave ring. */
export interface Ring {
  r: number
  life: number
  speed: number
  width: number
  tone: number
}

export interface SparksMemory {
  particles: Particle[]
  rings: Ring[]
  /** Turn of the spectrum corona, radians, and how fast it is turning. */
  spin: number
  spinVel: number
  /** Fraction of an ember owed from earlier frames. */
  emberDebt: number
  /** Edge flash from the last kick or surge, 0-1, and its tone. */
  flash: number
  flashTone: number
}

export const createSparksMemory = (): SparksMemory => ({
  particles: [],
  rings: [],
  spin: 0,
  spinVel: 0,
  emberDebt: 0,
  flash: 0,
  flashTone: 0
})

const TAU = Math.PI * 2
export const MAX_PARTICLES = 1100
/** Embers are scenery: they leave room for hits. */
const MAX_EMBER_FILL = 700
const MAX_RINGS = 10
const MAX_BAND_SPARKS_PER_FRAME = 14
/** Band flux (see Scene.bandFlux) to sparks: a note that rises by this much throws one spark. */
const FLUX_PER_SPARK = 0.07
const EMBERS_PER_S = 70
const SPIN_REST = 0.22
const SPIN_FOLLOW_PER_S = 1.5
const TREBLE_SPIN = 0.9
const FLASH_DECAY_PER_S = 3.2
const FLASH_ALPHA = 0.3
const FLASH_MIN = 0.01
const RING_FADE_PER_S = 1.5
const RING_ALPHA = 0.75
const SHAKE = 0.014
const SHAKE_MIN_PX = 0.05

/** Core and corona radius as a share of the canvas's short side; a kick swells it. */
const CORE_BASE = 0.09
const CORE_PULSE = 0.05
const CORONA_REACH = 0.28
const CORONA_ALPHA_MIN = 0.3
/** Spokes are this many times thinner than the room they have around the core. */
const SPOKE_CROWDING = 1.5

/** A canvas stroke can't be a zero-length line; this much extra keeps a dot from vanishing. */
const MIN_STROKE_PX = 0.01
const MIN_SWIRL_RADIUS_PX = 8
const SWIRL_BASE = 0.35
const SWIRL_PER_MID = 2.4
const EMBER_SWAY = 0.5
const EMBER_SWAY_HZ = 2.2
const TWINKLE_HZ = 45
const TWINKLE_DEPTH = 0.35
const ALPHA_GAIN = 1.4
const WIDTH_MIN = 0.45
const WIDTH_LIFE = 0.65

/** Strokes are batched by colour, alpha and width, each rounded to one of these steps, so a frame costs a few hundred strokes at most instead of one per particle (about 2x fewer on typical music). */
const ALPHA_STEPS = 5
const WIDTH_LEVELS = [0.5, 0.8, 1.3, 2, 3, 4.5, 7, 11, 17] as const
const BUCKETS = 2 * RAMP_STEPS * ALPHA_STEPS * WIDTH_LEVELS.length
const bucketOf = new Uint16Array(MAX_PARTICLES)
const bucketSize = new Uint16Array(BUCKETS + 1)
const bucketStart = new Uint16Array(BUCKETS + 1)
const drawOrder = new Uint16Array(MAX_PARTICLES)

/** What each effect throws. Ranges are [min, max]; speeds are in canvas-widths per second; fades are life per second. */
const KICK = {
  burst: [26, 60], // particles: base, extra at full power
  speed: [0.25, 0.7],
  tone: [0, 0.22],
  orbs: 4,
  orbSize: [9, 15],
  orbSpeed: [0.1, 0.3],
  ring: { speed: 0.8, extraSpeed: 0.7, width: 4, extraWidth: 7, tone: 0.05 },
  spin: [0.8, 2.4]
} as const
const SNARE = {
  streaks: [10, 14],
  speed: [0.9, 1.4],
  extraSpeed: 0.7,
  tone: [0.35, 0.62],
  streak: 0.075,
  size: [1.5, 3],
  fade: [1.1, 1.8],
  ring: { speed: 0.65, width: 2.5, tone: 0.5 },
  spin: [0.5, 1]
} as const
const HAT = {
  glitter: [6, 9],
  from: [1, 2.2], // start radius, in core radii
  speed: [0.7, 1.7],
  tone: [0.72, 1],
  size: [1, 2.2],
  fade: [2.2, 3.6]
} as const
const SURGE = {
  count: 320,
  speed: [0.3, 2.3],
  size: [2, 5.5],
  fade: [0.5, 1],
  hotEvery: 3,
  rings: [
    { speed: 1.9, width: 11, tone: 0 },
    { speed: 1.35, width: 7, tone: 0.5 },
    { speed: 0.9, width: 4, tone: 1 }
  ],
  spin: 5
} as const
const NOTE = { start: 1.5, speed: [0.25, 0.6], extraSpeed: 0.4, size: [1.2, 3], fade: [1.1, 2], hotAbove: 0.8 } as const
const EMBER = { speed: [0.12, 0.4], size: [1, 2.6], fade: [0.3, 0.6], drag: 0.15, lift: 0.1, below: 4 } as const

/** Ramp index of each band, so the corona doesn't work it out for every spoke every frame. */
const BAND_TONE = Uint8Array.from({ length: BAND_COUNT }, (_, i) => toneIndex(i / (BAND_COUNT - 1)))

const rand = (a: number, b: number): number => a + Math.random() * (b - a)
const range = ([a, b]: readonly [number, number] | readonly number[], k = Math.random()): number => a + k * (b - a)
const sign = (): number => (Math.random() < 0.5 ? -1 : 1)
/** x rounded up or down at random, so a fraction becomes a count that averages x. */
const roundRandomly = (x: number): number => Math.floor(x) + (Math.random() < x % 1 ? 1 : 0)

const coreRadius = (s: SceneView, scale: number): number => scale * (CORE_BASE + s.pulse * CORE_PULSE)

interface Shot {
  x: number
  y: number
  angle: number
  speed: number
  tone: number
  size?: number
  hot?: boolean
  fade?: number
  streak?: number
  drag?: number
  lift?: number
  curl?: number
}

const room = (m: SparksMemory): number => MAX_PARTICLES - m.particles.length

function emit(m: SparksMemory, s: Shot): void {
  if (room(m) <= 0) return
  m.particles.push({
    x: s.x,
    y: s.y,
    vx: Math.cos(s.angle) * s.speed,
    vy: Math.sin(s.angle) * s.speed,
    life: 1,
    fade: s.fade ?? rand(0.7, 1.3),
    size: s.size ?? rand(1.5, 4),
    tone: toneIndex(s.tone),
    hot: s.hot ?? false,
    streak: s.streak ?? 0,
    drag: s.drag ?? 0.8,
    lift: s.lift ?? 0,
    curl: s.curl ?? sign(),
    phase: Math.random() * TAU
  })
}

function ring(m: SparksMemory, r: number, speed: number, width: number, tone: number): void {
  if (m.rings.length < MAX_RINGS) m.rings.push({ r, life: 1, speed, width, tone: toneIndex(tone) })
}

/** Kick: a heavy low-coloured burst, a ring, a few fat slow orbs, and a punch of light at the edges. */
function spawnKick(m: SparksMemory, { w, h, s }: Frame, scale: number): void {
  const [cx, cy, p] = [w / 2, h / 2, s.beatPower]
  const burst = Math.min(room(m), Math.round(KICK.burst[0] + p * KICK.burst[1]))
  for (let i = 0; i < burst; i++) {
    emit(m, { x: cx, y: cy, angle: rand(0, TAU), speed: scale * rand(KICK.speed[0], KICK.speed[1] + p), tone: range(KICK.tone), streak: 0.03, fade: rand(0.8, 1.4) })
  }
  for (let i = 0; i < KICK.orbs; i++) {
    const size = range(KICK.orbSize) * (0.6 + p)
    emit(m, { x: cx, y: cy, angle: rand(0, TAU), speed: scale * range(KICK.orbSpeed), tone: rand(0, 0.12), size, fade: 2, drag: 2 })
  }
  const r = KICK.ring
  ring(m, coreRadius(s, scale), scale * (r.speed + p * r.extraSpeed), r.width + p * r.extraWidth, r.tone)
  m.flash = Math.max(m.flash, p)
  m.flashTone = r.tone
  m.spinVel += sign() * (KICK.spin[0] + p * (KICK.spin[1] - KICK.spin[0]))
}

/** Snare/clap: a fan of long streaks in the middle of the spectrum, evenly spread so it reads as a star. */
function spawnSnare(m: SparksMemory, { w, h, s }: Frame, scale: number): void {
  const [cx, cy, p] = [w / 2, h / 2, s.hitPower]
  const n = Math.min(room(m), Math.round(SNARE.streaks[0] + p * SNARE.streaks[1]))
  const turn = rand(0, TAU)
  for (let i = 0; i < n; i++) {
    const speed = scale * rand(SNARE.speed[0], SNARE.speed[1] + p * SNARE.extraSpeed)
    emit(m, { x: cx, y: cy, angle: turn + (i / n) * TAU + rand(-0.08, 0.08), speed, tone: range(SNARE.tone), streak: SNARE.streak, size: range(SNARE.size), fade: range(SNARE.fade), drag: 1.4 })
  }
  ring(m, coreRadius(s, scale), scale * SNARE.ring.speed, SNARE.ring.width, SNARE.ring.tone)
  m.spinVel += sign() * (SNARE.spin[0] + p * (SNARE.spin[1] - SNARE.spin[0]))
}

/** Cymbal/hat: bright glitter flicked off a ring around the core, in the high colours and white-hot. */
function spawnHat(m: SparksMemory, { w, h, s }: Frame, scale: number): void {
  const [cx, cy, p] = [w / 2, h / 2, s.hatPower]
  const core = coreRadius(s, scale)
  const n = Math.min(room(m), Math.round(HAT.glitter[0] + p * HAT.glitter[1]))
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU)
    const r = core * range(HAT.from)
    emit(m, {
      x: cx + Math.cos(a) * r,
      y: cy + Math.sin(a) * r,
      angle: a + rand(-0.4, 0.4),
      speed: scale * range(HAT.speed),
      tone: range(HAT.tone),
      hot: true,
      streak: 0.05,
      size: range(HAT.size),
      fade: range(HAT.fade),
      drag: 1.8
    })
  }
}

/** The music just got far louder: everything at once, in every colour. */
function spawnSurge(m: SparksMemory, { w, h, s }: Frame, scale: number): void {
  const [cx, cy] = [w / 2, h / 2]
  const n = Math.min(room(m), SURGE.count)
  for (let i = 0; i < n; i++) {
    emit(m, { x: cx, y: cy, angle: rand(0, TAU), speed: scale * range(SURGE.speed), tone: Math.random(), hot: i % SURGE.hotEvery === 0, streak: 0.04, size: range(SURGE.size), fade: range(SURGE.fade) })
  }
  for (const r of SURGE.rings) ring(m, coreRadius(s, scale), scale * r.speed, r.width, r.tone)
  m.flash = 1
  m.flashTone = 0.5
  m.spinVel += sign() * SURGE.spin
}

/** Notes: each band that just rose throws a spark from its own place on the corona, in its own colour. */
function spawnNotes(m: SparksMemory, { w, h, s }: Frame, scale: number): void {
  const [cx, cy] = [w / 2, h / 2]
  const start = coreRadius(s, scale) * NOTE.start
  let thrown = 0
  for (let i = 0; i < BAND_COUNT && thrown < MAX_BAND_SPARKS_PER_FRAME; i++) {
    const t = i / (BAND_COUNT - 1)
    const n = Math.min(roundRandomly(s.bandFlux[i] / FLUX_PER_SPARK), MAX_BAND_SPARKS_PER_FRAME - thrown)
    for (let k = 0; k < n; k++) {
      // Lows sit at the bottom of the ring, highs at the top, mirrored left and right.
      const a = Math.PI / 2 + sign() * t * Math.PI + m.spin
      const speed = scale * (range(NOTE.speed) + t * NOTE.extraSpeed)
      emit(m, { x: cx + Math.cos(a) * start, y: cy + Math.sin(a) * start, angle: a + rand(-0.25, 0.25), speed, tone: t, streak: 0.045, size: range(NOTE.size), fade: range(NOTE.fade), hot: t > NOTE.hotAbove })
    }
    thrown += n
  }
}

/** Embers drift up from the floor in proportion to how much is going on, coloured by where they rise. */
function spawnEmbers(m: SparksMemory, { w, h, s, dt }: Frame, scale: number): void {
  m.emberDebt += EMBERS_PER_S * s.energy * dt
  while (m.emberDebt >= 1) {
    m.emberDebt--
    if (m.particles.length > MAX_EMBER_FILL) {
      m.emberDebt = 0
      return
    }
    const x = rand(0, w)
    emit(m, { x, y: h + EMBER.below, angle: -Math.PI / 2, speed: scale * range(EMBER.speed), tone: x / w, size: range(EMBER.size), fade: range(EMBER.fade), drag: EMBER.drag, lift: scale * EMBER.lift, curl: 0 })
  }
}

/** Whether anything thrown is still flying, ringing or flashing. */
export const isSparksActive = (m: SparksMemory): boolean => m.particles.length + m.rings.length > 0 || m.flash > FLASH_MIN

function drawFlash(g: CanvasRenderingContext2D, w: number, h: number, flash: number, colour: string): void {
  if (flash <= FLASH_MIN) return
  const edge = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.hypot(w, h) / 2)
  edge.addColorStop(0, 'transparent')
  edge.addColorStop(1, colour)
  g.globalAlpha = Math.min(1, flash * FLASH_ALPHA)
  g.fillStyle = edge
  g.fillRect(0, 0, w, h)
}

function drawRings(g: CanvasRenderingContext2D, m: SparksMemory, ramp: Ramp, cx: number, cy: number, dt: number): void {
  for (let i = m.rings.length - 1; i >= 0; i--) {
    const wave = m.rings[i]
    wave.life -= dt * RING_FADE_PER_S
    if (wave.life <= 0) {
      removeAt(m.rings, i)
      continue
    }
    wave.r += wave.speed * dt
    g.globalAlpha = wave.life * RING_ALPHA
    g.strokeStyle = ramp.hot[wave.tone]
    g.lineWidth = wave.width * wave.life
    g.beginPath()
    g.arc(cx, cy, wave.r, 0, TAU)
    g.stroke()
  }
}

/** Removes entry `i` by moving the last one into its place (order doesn't matter: everything is additive). */
function removeAt<T>(list: T[], i: number): void {
  list[i] = list[list.length - 1]
  list.pop()
}

/** Moves every particle on by `dt` and drops the dead. */
function stepParticles({ s, dt }: Frame, m: SparksMemory, cx: number, cy: number, scale: number): void {
  const swirl = scale * (SWIRL_BASE + s.mid * SWIRL_PER_MID)
  for (let i = m.particles.length - 1; i >= 0; i--) {
    const p = m.particles[i]
    p.life -= dt * p.fade
    if (p.life <= 0) {
      removeAt(m.particles, i)
      continue
    }
    const slow = Math.max(0, 1 - dt * p.drag)
    p.vx *= slow
    p.vy *= slow
    p.vy -= p.lift * dt
    if (p.curl !== 0) {
      // The mids bend the whole field into a swirl; embers (curl 0) sway on their own instead.
      const dx = p.x - cx
      const dy = p.y - cy
      const r = Math.max(MIN_SWIRL_RADIUS_PX, Math.sqrt(dx * dx + dy * dy))
      p.vx += (-dy / r) * p.curl * swirl * dt * p.life
      p.vy += (dx / r) * p.curl * swirl * dt * p.life
    } else {
      p.vx += Math.sin(s.time * EMBER_SWAY_HZ + p.phase) * scale * EMBER_SWAY * dt
    }
    p.x += p.vx * dt
    p.y += p.vy * dt
  }
}

/** The index of the entry of `WIDTH_LEVELS` nearest `width`. */
function widthStep(width: number): number {
  let best = 0
  while (best < WIDTH_LEVELS.length - 1 && width > (WIDTH_LEVELS[best] + WIDTH_LEVELS[best + 1]) / 2) best++
  return best
}

const alphaOf = (p: Particle, time: number): number => Math.min(1, p.life * ALPHA_GAIN) * (p.hot ? 1 - TWINKLE_DEPTH + TWINKLE_DEPTH * Math.sin(time * TWINKLE_HZ + p.phase) : 1)

/** Strokes every particle, those alike in colour, alpha and width together in one path. */
function strokeParticles(g: CanvasRenderingContext2D, m: SparksMemory, ramp: Ramp, time: number): void {
  const ps = m.particles
  bucketSize.fill(0)
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i]
    const alpha = clamp(Math.ceil(alphaOf(p, time) * ALPHA_STEPS), 1, ALPHA_STEPS) - 1
    const width = widthStep(p.size * (WIDTH_MIN + p.life * WIDTH_LIFE))
    const key = ((((p.hot ? 1 : 0) * RAMP_STEPS + p.tone) * ALPHA_STEPS + alpha) * WIDTH_LEVELS.length + width) | 0
    bucketOf[i] = key
    bucketSize[key]++
  }
  let at = 0
  for (let k = 0; k < BUCKETS; k++) {
    bucketStart[k] = at
    at += bucketSize[k]
  }
  for (let i = 0; i < ps.length; i++) drawOrder[bucketStart[bucketOf[i]]++] = i
  g.lineCap = 'round'
  let from = 0
  let styled = -1 // the colour and alpha last set, so a bucket that shares them with the one before skips setting them
  let widthSet = -1
  for (let k = 0; k < BUCKETS; k++) {
    const to = from + bucketSize[k]
    if (to === from) continue
    const width = k % WIDTH_LEVELS.length
    const look = Math.floor(k / WIDTH_LEVELS.length)
    if (look !== styled) {
      const alpha = look % ALPHA_STEPS
      const tone = Math.floor(look / ALPHA_STEPS) % RAMP_STEPS
      g.globalAlpha = (alpha + 1) / ALPHA_STEPS
      g.strokeStyle = look >= BUCKETS / WIDTH_LEVELS.length / 2 ? ramp.hot[tone] : ramp.tones[tone]
      styled = look
    }
    if (width !== widthSet) {
      g.lineWidth = WIDTH_LEVELS[width]
      widthSet = width
    }
    g.beginPath()
    for (let j = from; j < to; j++) {
      const p = ps[drawOrder[j]]
      g.moveTo(p.x - p.vx * p.streak - MIN_STROKE_PX, p.y - p.vy * p.streak)
      g.lineTo(p.x, p.y)
    }
    g.stroke()
    from = to
  }
}

/** The spectrum as a corona of spokes round the core, coloured low to high; it turns, and kicks and snares spin it faster. */
function drawCorona({ g, s }: Frame, m: SparksMemory, ramp: Ramp, cx: number, cy: number, scale: number): void {
  const base = coreRadius(s, scale)
  const reach = scale * CORONA_REACH
  g.lineCap = 'round'
  g.lineWidth = Math.max(2, (TAU * base) / (BAND_COUNT * 2) / SPOKE_CROWDING)
  for (let i = 0; i < BAND_COUNT; i++) {
    const level = s.bands[i]
    const len = 2 + level * level * reach
    g.globalAlpha = CORONA_ALPHA_MIN + level * (1 - CORONA_ALPHA_MIN)
    g.strokeStyle = ramp.tones[BAND_TONE[i]]
    g.beginPath()
    for (let mirror = 0; mirror < 2; mirror++) {
      const angle = Math.PI / 2 + m.spin + (mirror === 0 ? 1 : -1) * ((i + 0.5) / BAND_COUNT) * Math.PI
      const [cos, sin] = [Math.cos(angle), Math.sin(angle)]
      g.moveTo(cx + cos * base, cy + sin * base)
      g.lineTo(cx + cos * (base + len), cy + sin * (base + len))
    }
    g.stroke()
  }
}

function drawCore({ g, s }: Frame, ramp: Ramp, cx: number, cy: number, scale: number): void {
  const r = scale * (0.06 + s.pulse * 0.1 + s.bass * 0.04 + s.surge * 0.12)
  const glow = g.createRadialGradient(cx, cy, 0, cx, cy, r * 2.2)
  glow.addColorStop(0, ramp.hot[toneIndex(s.brightness)])
  glow.addColorStop(0.4, ramp.tones[toneIndex(s.brightness * 0.5)])
  glow.addColorStop(1, 'transparent')
  g.globalAlpha = Math.min(1, 0.4 + s.pulse * 0.5 + s.surge * 0.3)
  g.fillStyle = glow
  g.beginPath()
  g.arc(cx, cy, r * 2.2, 0, TAU)
  g.fill()
}

export function drawSparks(f: Frame, m: SparksMemory): void {
  const { g, w, h, s, c, dt } = f
  const ramp = rampFor(c.primary, c.secondary)
  const scale = Math.min(w, h)
  const cx = w / 2
  const cy = h / 2

  m.spinVel += (SPIN_REST + s.treble * TREBLE_SPIN - m.spinVel) * Math.min(1, SPIN_FOLLOW_PER_S * dt)
  m.spin += m.spinVel * dt
  m.flash = Math.max(0, m.flash - FLASH_DECAY_PER_S * dt)
  // A redraw without time passing (a resize) shows what is there; the frame's hits were already thrown the first time.
  if (dt > 0) {
    if (s.beat) spawnKick(m, f, scale)
    if (s.hit) spawnSnare(m, f, scale)
    if (s.hat) spawnHat(m, f, scale)
    if (s.surge >= 1) spawnSurge(m, f, scale)
    spawnNotes(m, f, scale)
    spawnEmbers(m, f, scale)
  }

  g.globalCompositeOperation = 'lighter'
  drawFlash(g, w, h, Math.max(m.flash, s.surge), ramp.tones[toneIndex(m.flashTone)])
  // A kick shakes everything but the flash.
  const shake = scale * SHAKE * s.pulse * s.pulse
  if (shake > SHAKE_MIN_PX) g.translate(rand(-shake, shake), rand(-shake, shake))
  drawRings(g, m, ramp, cx, cy, dt)
  stepParticles(f, m, cx, cy, scale)
  strokeParticles(g, m, ramp, s.time)
  drawCorona(f, m, ramp, cx, cy, scale)
  drawCore(f, ramp, cx, cy, scale)
  g.globalAlpha = 1
  g.globalCompositeOperation = 'source-over'
}
