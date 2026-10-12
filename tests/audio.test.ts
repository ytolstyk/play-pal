import { describe, expect, it } from 'vitest'
import { FREQ_BINS, readAudioFrame, WAVE_SAMPLES } from '../src/shared/audio'
import { readYtCommand } from '../src/shared/payloads'
import { advance, BAND_COUNT, createScene, isAtRest } from '../src/renderer/src/visualizers/scene'

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
  it('normalises quiet input, fires on a bass jump, and settles to rest on silence', () => {
    const scene = createScene(WAVE_SAMPLES)
    for (let i = 0; i < 30; i++) advance(scene, frame(0), 1 / 60)
    expect(isAtRest(scene)).toBe(true)

    let beats = 0
    for (let i = 0; i < 30; i++) {
      advance(scene, frame(60), 1 / 60)
      if (scene.beat) beats++
    }
    expect(scene.bands.length).toBe(BAND_COUNT)
    expect(Math.max(...scene.bands)).toBeGreaterThan(0.8) // auto-gain lifts a quiet signal
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
