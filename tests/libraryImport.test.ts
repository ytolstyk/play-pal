import { describe, expect, it } from 'vitest'
import { importLibrary } from '../src/shared/libraryImport'
import { validateLibrary } from '../src/shared/validation'
import type { Track } from '../src/shared/types'

const cue = { id: 'c1', time: 12.5, label: 'Lead', action: { type: 'cc', channel: 1, number: 20, value: 127 } }
const track = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 't1',
  title: 'Song',
  source: { kind: 'file', path: '/Users/me/song.mp3' },
  cues: [cue],
  ...over
})
const file = (tracks: unknown[], over: Record<string, unknown> = {}): Record<string, unknown> => ({ schemaVersion: 1, leadMs: 40, tracks, ...over })

describe('importLibrary', () => {
  it('reads a current file without warnings', () => {
    const r = importLibrary(file([track()]))
    expect(r?.warnings).toEqual([])
    expect(r?.tracks[0].cues).toEqual([cue])
    expect(r?.leadMs).toBe(40)
  })

  it('accepts a file with no version, with a warning, and a bare list of tracks', () => {
    const r = importLibrary({ tracks: [track()] })
    expect(r?.tracks).toHaveLength(1)
    expect(r?.warnings).toHaveLength(1)
    expect(importLibrary([track()])?.tracks).toHaveLength(1)
  })

  it('reads a newer format as far as it is understood and says so', () => {
    const r = importLibrary(file([track({ futureField: 1 })], { schemaVersion: 7 }))
    expect(r?.tracks).toHaveLength(1)
    expect(r?.tracks[0]).not.toHaveProperty('futureField')
    expect(r?.warnings[0]).toContain('newer')
  })

  it('repairs what can be repaired instead of dropping the track', () => {
    const r = importLibrary(
      file([
        track({
          title: 'x'.repeat(500),
          volume: 4,
          cues: [
            { ...cue, time: -3, action: { type: 'cc', channel: 99, number: 20.4, value: 127 }, color: 'red' },
            { ...cue, time: 5 } // duplicate id
          ]
        })
      ])
    )
    const t = r?.tracks[0] as Track
    expect(t.title).toHaveLength(200)
    expect(t).not.toHaveProperty('volume')
    expect(t.cues.map((c) => c.time)).toEqual([0, 5])
    expect(new Set(t.cues.map((c) => c.id)).size).toBe(2)
    expect(t.cues[0].action).toEqual({ type: 'cc', channel: 16, number: 20, value: 127 })
    expect(t.cues[0]).not.toHaveProperty('color')
    expect(r?.warnings).toEqual([expect.stringContaining('repaired track #1')])
    expect(validateLibrary({ tracks: r?.tracks, leadMs: r?.leadMs })).toEqual([])
  })

  it('drops cues without a usable action or time, and gives a lost id a new one', () => {
    const r = importLibrary(file([track({ id: 'bad id!', cues: [{ ...cue, action: null }, { ...cue, time: 'soon' }, cue] })]))
    expect(r?.tracks[0].cues).toHaveLength(1)
    expect(r?.tracks[0].id).toBe('track-1')
  })

  it('gives a duplicate track a new id and drops one with no usable source', () => {
    const r = importLibrary(file([track(), track(), track({ id: 't3', source: { kind: 'file', path: 'nope.txt' } })]))
    expect(r?.tracks.map((t) => t.id)).toEqual(['t1', 'track-1'])
    expect(r?.warnings.some((w) => w.startsWith('dropped track #3'))).toBe(true)
  })

  it('clamps the lead and rejects data that is not a library', () => {
    expect(importLibrary(file([], { leadMs: 99999 }))?.leadMs).toBe(1000)
    for (const junk of [null, 'x', 42, {}, { tracks: 'no' }]) expect(importLibrary(junk)).toBeNull()
  })

  it('loses no field of a fully populated track when it has to be repaired', () => {
    const full = track({
      title: 'x'.repeat(300), // forces the repair path
      volume: 0.5,
      start: { action: { type: 'note', channel: 2, number: 3, value: 4 }, waitMs: 800, label: 'Clean', color: '#4fb6ff' },
      cues: [{ ...cue, color: '#ff7a6b' }]
    })
    const t = importLibrary(file([full]))?.tracks[0] as Track
    expect(t.volume).toBe(0.5)
    expect(t.start).toEqual(full.start)
    expect(t.cues[0]).toEqual({ ...cue, color: '#ff7a6b' })
    expect(t.source).toEqual(full.source)
  })
})
