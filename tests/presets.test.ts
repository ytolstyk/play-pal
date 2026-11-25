import { describe, expect, it } from 'vitest'
import { autoCueLabel, isAutoCueLabel } from '../src/shared/cues'
import { collectPresets, describePreset, presetFields, presetsFor, samePresets, startPresetSourceId } from '../src/shared/presets'
import type { Cue, MidiAction, Track } from '../src/shared/types'

const cc = (number: number, channel = 1): MidiAction => ({ type: 'cc', channel, number, value: 127 })
const cue = (id: string, label: string, action = cc(20), color?: string): Cue => ({ id, time: 0, label, action, color })
const track = (id: string, cues: Cue[], start?: Track['start']): Track => ({
  id,
  title: id,
  source: { kind: 'file', path: `/${id}.mp3` },
  cues,
  start
})

describe('collectPresets', () => {
  it('offers every named cue across tracks, sorted by name', () => {
    const presets = collectPresets([track('a', [cue('1', 'Solo', cc(21))]), track('b', [cue('2', 'Clean', cc(22))])])
    expect(presets.map((p) => p.label)).toEqual(['Clean', 'Solo'])
  })

  it('skips auto-named and blank cues', () => {
    expect(collectPresets([track('a', [cue('1', 'Cue 3'), cue('2', '  ')])])).toEqual([])
  })

  it('merges identical segments and keeps their sources', () => {
    const presets = collectPresets([
      track('a', [cue('1', 'Lead', cc(20), '#ff7a6b')]),
      track('b', [cue('2', 'Lead', cc(20), '#ff7a6b')])
    ])
    expect(presets).toHaveLength(1)
    expect(presets[0].sourceIds).toEqual(['1', '2'])
  })

  it('keeps segments that differ in colour or message apart', () => {
    const presets = collectPresets([
      track('a', [cue('1', 'Lead', cc(20)), cue('2', 'Lead', cc(20, 2)), cue('3', 'Lead', cc(20), '#ff7a6b')])
    ])
    expect(presets).toHaveLength(3)
  })

  it('includes a named start preset but not an unnamed one', () => {
    const named = collectPresets([track('a', [], { action: cc(5), waitMs: 0, label: 'Intro' })])
    expect(named[0].sourceIds).toEqual([startPresetSourceId('a')])
    expect(collectPresets([track('a', [], { action: cc(5), waitMs: 0 })])).toEqual([])
  })
})

describe('presetsFor', () => {
  it('hides a preset only the editing cue provides, keeps one shared with another', () => {
    const presets = collectPresets([track('a', [cue('1', 'Solo', cc(21)), cue('2', 'Lead'), cue('3', 'Lead')])])
    expect(presetsFor(presets, '1').map((p) => p.label)).toEqual(['Lead'])
    expect(presetsFor(presets, '2').map((p) => p.label)).toEqual(['Solo'])
  })

  it('does the same for a start preset', () => {
    const presets = collectPresets([track('a', [cue('1', 'Solo', cc(21))], { action: cc(5), waitMs: 0, label: 'Intro' })])
    expect(presetsFor(presets, startPresetSourceId('a')).map((p) => p.label)).toEqual(['Solo'])
  })
})

describe('describePreset and presetFields', () => {
  it('names the colour so same-named presets differ, and copies the action', () => {
    const [p] = collectPresets([track('a', [cue('1', 'Lead', cc(20), '#ff7a6b')])])
    expect(describePreset(p)).toBe('Lead · Coral · CC ch1 #20 =127')
    expect(presetFields(p).action).toEqual(p.action)
    expect(presetFields(p).action).not.toBe(p.action)
  })

  it('merges names that differ only by surrounding spaces', () => {
    expect(collectPresets([track('a', [cue('1', ' Lead '), cue('2', 'Lead')])])).toHaveLength(1)
  })
})

describe('auto labels', () => {
  it('recognises the name Add cue here gives', () => {
    expect(isAutoCueLabel(autoCueLabel(7))).toBe(true)
    expect(isAutoCueLabel('Cue Lead')).toBe(false)
  })
})

describe('samePresets', () => {
  it('is true for equal lists and false once a label, colour, message or source changes', () => {
    const make = (label: string, n = 20, id = '1'): ReturnType<typeof collectPresets> =>
      collectPresets([track('a', [cue(id, label, cc(n))])])
    expect(samePresets(make('Lead'), make('Lead'))).toBe(true)
    expect(samePresets(make('Lead'), make('Solo'))).toBe(false)
    expect(samePresets(make('Lead'), make('Lead', 21))).toBe(false)
    expect(samePresets(make('Lead'), make('Lead', 20, '2'))).toBe(false)
    expect(samePresets(make('Lead'), [])).toBe(false)
  })
})
