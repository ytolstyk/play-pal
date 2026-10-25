import { describe, expect, it } from 'vitest'
import { FREQ_BINS, readAudioFrame, WAVE_SAMPLES } from '../src/shared/audio'
import { readYtCommand } from '../src/shared/payloads'
import { createDrawer } from '../src/renderer/src/visualizers/draw'
import { MAX_PARTICLES } from '../src/renderer/src/visualizers/sparks'
import { RAMP_STEPS, rampFor, toneIndex } from '../src/renderer/src/visualizers/palette'
import { advance, BAND_COUNT, createScene, isAtRest } from '../src/renderer/src/visualizers/scene'
import { analyse, song } from './synthAudio'

const frame = (level: number) => ({
  freq: new Uint8Array(FREQ_BINS).fill(level),
  wave: new Uint8Array(WAVE_SAMPLES).fill(128)
})

describe('readAudioFrame', () => {
  it('accepts correctly sized byte arrays', () => {
    expect(readAudioFrame(frame(10))).not.toBeNull()
  })
  it('rejects wrong sizes and types', () => {
    expect(readAudioFrame({ freq: new Uint8Array(3), wave: new Uint8Array(WAVE_SAMPLES) })).toBeNull()
    expect(readAudioFrame({ freq: new Array(FREQ_BINS).fill(0), wave: new Uint8Array(WAVE_SAMPLES) })).toBeNull()
    expect(readAudioFrame(null)).toBeNull()
  })
})

describe('analyse command', () => {
  it('takes only 0 or 1', () => {
    expect(readYtCommand({ cmd: 'analyse', value: 1 })).toEqual({ cmd: 'analyse', value: 1 })
    expect(readYtCommand({ cmd: 'analyse', value: 2 })).toBeNull()
  })
})

describe('visualizer scene', () => {
  it('lifts quiet input, fires on a loud bass jump, and settles to rest on silence', () => {
    const scene = createScene(WAVE_SAMPLES)
    for (let i = 0; i < 30; i++) advance(scene, frame(0), 1 / 60)
    expect(isAtRest(scene)).toBe(true)

    for (let i = 0; i < 30; i++) advance(scene, frame(60), 1 / 60)
    expect(scene.bands.length).toBe(BAND_COUNT)
    expect(Math.max(...scene.bands)).toBeGreaterThan(0.8) // auto-gain lifts a quiet signal

    for (let i = 0; i < 30; i++) advance(scene, frame(0), 1 / 60)
    let beats = 0
    for (let i = 0; i < 30; i++) {
      advance(scene, frame(200), 1 / 60)
      if (scene.beat) beats++
    }
    expect(beats).toBeGreaterThan(0)

    for (let i = 0; i < 300; i++) advance(scene, null, 1 / 60)
    expect(isAtRest(scene)).toBe(true)
  })

  it('flags a surge when a quiet passage jumps to loud, but not for steady loudness', () => {
    const scene = createScene(WAVE_SAMPLES)
    for (let i = 0; i < 240; i++) advance(scene, frame(40), 1 / 60)
    let surges = 0
    for (let i = 0; i < 60; i++) {
      advance(scene, frame(255), 1 / 60)
      if (scene.surge >= 1) surges++
    }
    expect(surges).toBe(1)
    for (let i = 0; i < 600; i++) advance(scene, frame(255), 1 / 60)
    surges = 0
    for (let i = 0; i < 120; i++) {
      advance(scene, frame(255), 1 / 60)
      if (scene.surge >= 1) surges++
    }
    expect(surges).toBe(0)
  })

  it('does not flag a surge when playback starts from silence', () => {
    const scene = createScene(WAVE_SAMPLES)
    for (let i = 0; i < 120; i++) advance(scene, frame(0), 1 / 60)
    let surges = 0
    for (let i = 0; i < 300; i++) {
      advance(scene, frame(255), 1 / 60)
      if (scene.surge >= 1) surges++
    }
    expect(surges).toBe(0)
  })
})

describe('visualizer scene on a drum pattern over a held bass note', () => {
  const lead = 4 // seconds of bass alone before the drums come in
  const music = song(16, lead)
  const frames = analyse(music.signal)

  const run = (): { hits: Record<'kick' | 'snare' | 'hat', number[]>; bass: number[] } => {
    const scene = createScene(WAVE_SAMPLES)
    const hits = { kick: [] as number[], snare: [] as number[], hat: [] as number[] }
    const bass: number[] = []
    frames.forEach((f, i) => {
      advance(scene, f, 1 / 60)
      const t = i / 60
      if (scene.beat) hits.kick.push(t)
      if (scene.hit) hits.snare.push(t)
      if (scene.hat) hits.hat.push(t)
      if (t > lead + 2) bass.push(scene.bass)
    })
    return { hits, bass }
  }
  const settled = (times: number[]): number[] => times.filter((t) => t > lead + 2)
  const expected = (times: number[]): number => times.filter((t) => t > lead + 2 && t < 15.5).length

  it('catches the kicks, snares and hats, each as its own hit', () => {
    const { hits } = run()
    // Within a hit or two of the real count: nothing is missed wholesale, and a kick is not also counted as a snare.
    expect(Math.abs(settled(hits.kick).length - expected(music.kicks))).toBeLessThanOrEqual(2)
    expect(Math.abs(settled(hits.snare).length - expected(music.snares))).toBeLessThanOrEqual(2)
    expect(Math.abs(settled(hits.hat).length - expected(music.hats))).toBeLessThanOrEqual(3)
  })

  it('does not fire on the held note alone', () => {
    const { hits } = run()
    // Only the sound starting may count; the steady bass for the next seconds must not.
    for (const times of Object.values(hits)) expect(times.filter((t) => t > 1 && t < lead - 0.1).length).toBe(0)
  })

  it('keeps the bass moving rather than pinned at the top', () => {
    const { bass } = run()
    expect(Math.max(...bass)).toBeGreaterThan(0.3)
    expect(Math.min(...bass)).toBeLessThan(0.25)
    expect(bass.filter((b) => b > 0.9).length / bass.length).toBeLessThan(0.05)
  })
})

describe('visualizer palette', () => {
  it('runs from the primary hue to the secondary and has a paler copy', () => {
    const ramp = rampFor('#ffb23e', '#3ee0ff')
    expect(ramp.tones.length).toBe(RAMP_STEPS)
    expect(ramp.hot.length).toBe(RAMP_STEPS)
    const hue = (c: string): number => Number(/hsl\((\d+)/.exec(c)?.[1])
    expect(hue(ramp.tones[0])).toBeCloseTo(38, -1)
    expect(hue(ramp.tones[RAMP_STEPS - 1])).toBeCloseTo(190, -1)
    expect(new Set(ramp.tones).size).toBeGreaterThan(RAMP_STEPS / 2)
  })
  it('spreads two themes of neighbouring hues, and falls back to the default theme for a colour that is not #rrggbb', () => {
    const near = rampFor('#ff4fa3', '#ff6a3d')
    expect(new Set(near.tones).size).toBeGreaterThan(RAMP_STEPS / 2)
    expect(rampFor('red', 'blue').tones).toEqual(rampFor('#ffb23e', '#3ee0ff').tones)
  })
  it('clamps tone positions to the ramp', () => {
    expect(toneIndex(-1)).toBe(0)
    expect(toneIndex(2)).toBe(RAMP_STEPS - 1)
  })
})

describe('sparks drawer', () => {
  /** A canvas context that accepts any call, counting the segments drawn and noting any that aren't finite numbers. */
  const stubContext = (): { g: CanvasRenderingContext2D; segments: () => number; resetSegments: () => void; bad: () => number } => {
    let segments = 0
    let bad = 0
    const g = new Proxy({} as Record<string, unknown>, {
      get: (target, key: string) => {
        if (key === 'moveTo' || key === 'lineTo') {
          return (...xy: number[]) => {
            if (key === 'moveTo') segments++
            if (!xy.every(Number.isFinite)) bad++
          }
        }
        if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => ({ addColorStop: () => undefined })
        return key in target ? target[key] : () => undefined
      },
      set: (target, key: string, value) => ((target[key] = value), true)
    }) as unknown as CanvasRenderingContext2D
    return { g, segments: () => segments, resetSegments: () => (segments = 0), bad: () => bad }
  }

  it('throws particles on the hits, keeps them bounded and finite, and dies down afterwards', () => {
    const music = song(10, 2)
    const scene = createScene(WAVE_SAMPLES)
    const drawer = createDrawer('sparks')
    const { g, segments, resetSegments, bad } = stubContext()
    const colors = { primary: '#ffb23e', secondary: '#3ee0ff' }
    const coronaSpokes = BAND_COUNT * 2
    let most = 0
    for (const f of analyse(music.signal)) {
      advance(scene, f, 1 / 60)
      resetSegments()
      drawer.draw({ g, w: 800, h: 500, s: scene, c: colors, dt: 1 / 60 })
      most = Math.max(most, segments() - coronaSpokes)
    }
    expect(most).toBeGreaterThan(100)
    expect(most).toBeLessThanOrEqual(MAX_PARTICLES)
    expect(bad()).toBe(0)
    expect(drawer.isActive()).toBe(true)

    for (let i = 0; i < 600; i++) {
      advance(scene, null, 1 / 60)
      drawer.draw({ g, w: 800, h: 500, s: scene, c: colors, dt: 1 / 60 })
    }
    expect(drawer.isActive()).toBe(false)
    expect(isAtRest(scene)).toBe(true)
  })

  it('has state only for Sparks', () => {
    expect(createDrawer('bars').isActive()).toBe(false)
  })
})
