import { useEffect, useRef } from 'react'
import { WAVE_SAMPLES } from '../../../shared/audio'
import { DEFAULT_THEME } from '../theme'
import type { AudioFeed } from '../hooks/useAudioFeed'
import { createDrawer, type Colors, type VizKind } from '../visualizers/draw'
import { advance, createScene, isAtRest } from '../visualizers/scene'
import { isWindowActive, subscribeWindowActive } from '../windowActivity'

interface Props {
  feed: AudioFeed
  kind: VizKind
  playing: boolean
}

/** Longest step fed to the animation, so a stalled tab doesn't make everything jump on return. */
const MAX_DT_S = 0.1
const COLOR_REFRESH_MS = 500
/**
 * Pixel density the canvas is drawn at, however sharp the display. The motion is soft glow and fast strokes, so a
 * 2x display loses nothing visible, while the fill work and the canvas's backing memory drop by almost half.
 */
const MAX_DPR = 1.5
/**
 * Frames closer than this are skipped: a 120 Hz display would otherwise double the drawing for motion nobody can tell apart.
 * Well under 1000/60 so 60 Hz timestamp jitter never drops a frame, and over half of 1000/144 so a 144 Hz display still halves.
 */
const MIN_FRAME_MS = 12

const readColors = (): Colors => {
  const style = getComputedStyle(document.documentElement)
  return {
    primary: style.getPropertyValue('--accent').trim() || DEFAULT_THEME.primary,
    secondary: style.getPropertyValue('--accent-2').trim() || DEFAULT_THEME.secondary
  }
}

/**
 * Canvas that dances to the feed. The animation loop runs only while playing in the window in front,
 * plus the moments it takes to settle to silence afterwards. Behind a DAW it draws nothing at all.
 */
export function Visualizer({ feed, kind, playing }: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Kept across kind changes so switching doesn't make the motion restart from nothing.
  const scene = useRef(createScene(WAVE_SAMPLES))
  const playingRef = useRef(playing)
  const wake = useRef<() => void>(() => undefined)

  useEffect(() => {
    const canvas = canvasRef.current
    const g = canvas?.getContext('2d')
    if (!canvas || !g) return
    const drawer = createDrawer(kind) // nothing thrown by another drawer carries over
    let size = { w: 0, h: 0 }
    let colors = readColors()
    let colorsAt = 0
    let raf = 0
    let last = 0
    let warned = false

    const resize = (): void => {
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1)
      const r = canvas.getBoundingClientRect()
      const px = { w: Math.max(1, Math.round(r.width * dpr)), h: Math.max(1, Math.round(r.height * dpr)) }
      size = { w: r.width, h: r.height }
      // Assigning either dimension reallocates and clears the canvas, so only do it on a real change.
      if (canvas.width !== px.w) canvas.width = px.w
      if (canvas.height !== px.h) canvas.height = px.h
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      render(0) // a resized canvas is blank until redrawn, even when the loop is idle
    }

    const render = (dt: number): void => {
      // The first animation frame can precede the first layout pass; drawing at size 0 only produces errors.
      if (size.w < 1 || size.h < 1) return
      advance(scene.current, feed.read(), dt)
      g.clearRect(0, 0, size.w, size.h)
      g.save() // a drawer that throws midway must not leave additive blending or alpha behind
      try {
        drawer.draw({ g, w: size.w, h: size.h, s: scene.current, c: colors, dt })
      } finally {
        g.restore()
      }
    }

    const loop = (now: number): void => {
      if (last && now - last < MIN_FRAME_MS) {
        raf = requestAnimationFrame(loop)
        return
      }
      const dt = last ? Math.min(MAX_DT_S, (now - last) / 1000) : 0
      last = now
      if (now - colorsAt > COLOR_REFRESH_MS) {
        colors = readColors()
        colorsAt = now
      }
      try {
        render(dt)
      } catch (err) {
        // One bad frame must not end the animation for good.
        if (!warned) console.warn('[visualizer] draw failed', err)
        warned = true
      }
      // Idle: let it fall to silence, then stop drawing until playback resumes.
      raf = playingRef.current || !(isAtRest(scene.current) && !drawer.isActive()) ? requestAnimationFrame(loop) : 0
    }

    const start = (): void => {
      if (raf || !isWindowActive()) return
      last = 0
      raf = requestAnimationFrame(loop)
    }
    const onActivity = (): void => {
      if (!isWindowActive()) {
        cancelAnimationFrame(raf)
        raf = 0
      } else start()
    }

    wake.current = start
    const observer = new ResizeObserver(resize) // also fires once on observe, which does the first draw
    observer.observe(canvas)
    start()
    const unsubscribe = subscribeWindowActive(onActivity)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      unsubscribe()
    }
  }, [feed, kind])

  // Playback resuming restarts a loop that had settled to rest.
  useEffect(() => {
    playingRef.current = playing
    if (playing) wake.current()
  }, [playing])

  return <canvas ref={canvasRef} className="viz-canvas" aria-label="Audio visualizer" role="img" />
}
