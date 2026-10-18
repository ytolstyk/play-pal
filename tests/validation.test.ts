import { describe, expect, it } from 'vitest'
import { parseLibraryFile } from '../src/shared/libraryImport'
import { sanitizeLibrary, validateAction, validateLibrary } from '../src/shared/validation'
import { parseVideoId } from '../src/shared/url'
import { formatTime, parseTime } from '../src/shared/time'
import type { Library, Track } from '../src/shared/types'

const track = (over: Partial<Track> = {}): Track => ({
  id: 't1',
  title: 'Song',
  source: { kind: 'file', path: '/Users/me/song.mp3' },
  cues: [{ id: 'c1', time: 12.5, label: 'Lead', action: { type: 'cc', channel: 1, number: 20, value: 127 } }],
  ...over
})
const lib = (tracks: Track[] = [track()], leadMs = 0): Library => ({ tracks, leadMs })

describe('validateLibrary', () => {
  it('accepts a well-formed library', () => {
    expect(validateLibrary(lib())).toEqual([])
  })
  it.each([
    ['relative path', track({ source: { kind: 'file', path: 'song.mp3' } })],
    ['non-audio extension', track({ source: { kind: 'file', path: '/etc/passwd' } })],
    ['bad video id', track({ source: { kind: 'ytmusic', videoId: 'short' } })],
    ['overlong title', track({ title: 'x'.repeat(201) })],
    ['UNC path', track({ source: { kind: 'file', path: '//host/share/song.mp3' } })],
    ['negative cue time', track({ cues: [{ ...track().cues[0], time: -1 }] })],
    ['midi value out of range', track({ cues: [{ ...track().cues[0], action: { type: 'cc', channel: 1, number: 20, value: 200 } }] })],
    ['channel 0', track({ cues: [{ ...track().cues[0], action: { type: 'cc', channel: 0, number: 1, value: 1 } }] })]
  ])('rejects %s', (_name, t) => {
    expect(validateLibrary(lib([t])).length).toBeGreaterThan(0)
  })
  it('rejects duplicate track ids and bad lead', () => {
    expect(validateLibrary(lib([track(), track()]))).toContain('duplicate track ids')
    expect(validateLibrary(lib([], 5000)).length).toBeGreaterThan(0)
  })
  it('rejects non-objects', () => {
    expect(validateLibrary(null).length).toBeGreaterThan(0)
    expect(validateAction('x').length).toBeGreaterThan(0)
  })
})

describe('start preset', () => {
  const start = { action: { type: 'cc', channel: 1, number: 20, value: 5 }, waitMs: 800 } as const

  it('accepts a valid start preset and keeps it through sanitizing', () => {
    const l = lib([track({ start })])
    expect(validateLibrary(l)).toEqual([])
    expect(sanitizeLibrary(l).tracks[0].start).toEqual(start)
  })

  it('rejects a bad action or wait', () => {
    expect(validateLibrary(lib([track({ start: { ...start, waitMs: 99999 } })])).length).toBeGreaterThan(0)
    expect(validateLibrary(lib([track({ start: { ...start, action: { ...start.action, value: 200 } } })])).length).toBeGreaterThan(0)
  })

  it('leaves tracks without one unchanged', () => {
    expect('start' in sanitizeLibrary(lib()).tracks[0]).toBe(false)
  })
})

describe('sanitizeLibrary', () => {
  it('drops unknown fields and sorts cues by time', () => {
    const t = track({
      cues: [
        { id: 'b', time: 20, label: 'b', action: { type: 'note', channel: 2, number: 1, value: 100 } },
        { id: 'a', time: 5, label: 'a', action: { type: 'cc', channel: 1, number: 1, value: 1 } }
      ]
    })
    const dirty = { ...lib([{ ...t, extra: 1 } as Track]), more: true } as Library
    const clean = sanitizeLibrary(dirty)
    expect(clean).not.toHaveProperty('more')
    expect(clean.tracks[0]).not.toHaveProperty('extra')
    expect(clean.tracks[0].cues.map((c) => c.id)).toEqual(['a', 'b'])
  })
})

describe('parseLibraryFile', () => {
  it('keeps valid tracks and drops bad ones with a warning', () => {
    const result = parseLibraryFile({
      schemaVersion: 1,
      leadMs: 50,
      tracks: [track(), track({ id: 't2', source: { kind: 'file', path: 'relative.mp3' } })]
    })
    expect(result.tracks.map((t) => t.id)).toEqual(['t1'])
    expect(result.leadMs).toBe(50)
    expect(result.warnings).toHaveLength(1)
  })
  it('resets an unrecognised file', () => {
    expect(parseLibraryFile({ nope: true }).tracks).toEqual([])
  })
})

describe('parseVideoId', () => {
  it.each([
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVM', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?t=3', 'dQw4w9WgXcQ']
  ])('extracts from %s', (url, id) => {
    expect(parseVideoId(url)).toBe(id)
  })
  it.each(['dQw4w9WgXcQ', 'http://music.youtube.com/watch?v=dQw4w9WgXcQ', 'https://evil.com/watch?v=dQw4w9WgXcQ', 'https://music.youtube.com/watch?v=x', 'nope'])(
    'rejects %s',
    (input) => {
      expect(parseVideoId(input)).toBeNull()
    }
  )
})

describe('time', () => {
  it('formats and parses', () => {
    expect(formatTime(83.5)).toBe('1:23.500')
    expect(formatTime(-3)).toBe('0:00.000')
    expect(parseTime('1:23.5')).toBe(83.5)
    expect(parseTime('83.5')).toBe(83.5)
    expect(parseTime('1:02:03')).toBe(3723)
    expect(parseTime('abc')).toBeNull()
    expect(parseTime('-1')).toBeNull()
    expect(parseTime('')).toBeNull()
  })
})
