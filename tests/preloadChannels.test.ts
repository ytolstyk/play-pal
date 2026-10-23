import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ANALYSER_MAX_DB, ANALYSER_MIN_DB, AUDIO_FRAME_MS, FFT_SIZE, SMOOTHING } from '../src/shared/audio'
import { YT_PAGE } from '../src/shared/ipc'

describe('yt preload channel literals', () => {
  it('match YT_PAGE (the preload cannot import it)', () => {
    const src = readFileSync(new URL('../src/preload/yt.ts', import.meta.url), 'utf8')
    expect(src).toContain(`const CLOCK = '${YT_PAGE.clock}'`)
    expect(src).toContain(`const COMMAND = '${YT_PAGE.command}'`)
    expect(src).toContain(`const AUDIO = '${YT_PAGE.audio}'`)
  })

  it('analyser constants match shared/audio.ts', () => {
    const src = readFileSync(new URL('../src/preload/yt.ts', import.meta.url), 'utf8')
    expect(src).toContain(`const FFT_SIZE = ${FFT_SIZE}`)
    expect(src).toContain(`const SMOOTHING = ${SMOOTHING}`)
    expect(src).toContain(`const AUDIO_FRAME_MS = ${AUDIO_FRAME_MS}`)
    expect(src).toContain(`const ANALYSER_MIN_DB = ${ANALYSER_MIN_DB}`)
    expect(src).toContain(`const ANALYSER_MAX_DB = ${ANALYSER_MAX_DB}`)
    expect(src).toContain('analyser.minDecibels = ANALYSER_MIN_DB')
    expect(src).toContain('analyser.maxDecibels = ANALYSER_MAX_DB')
  })
})
