import { describe, expect, it } from 'vitest'
import { autoCueLabel, isAutoCueLabel } from '../src/shared/cues'
import { collectPresets, describePreset, presetFields, presetsFor, samePresets, startPresetSourceId, withMapPresets } from '../src/shared/presets'
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

describe('withMapPresets', () => {
  const map = { plugin: 'Archetype X', label: 'Preset CC 21', action: { type: 'cc', channel: 1, number: 21, value: 127 } } as const

  it('lists map entries after the user segments, under the plugin heading', () => {
    const own = collectPresets([track('a', [cue('1', 'Solo', cc(30))])])
    const all = withMapPresets(own, [map])
    expect(all.map((p) => p.label)).toEqual(['Solo', 'Preset CC 21'])
    expect(all[1].group).toBe('Archetype X')
    expect(all[1].sourceIds).toEqual([])
  })

  it('does not list a cue that only repeats a map entry', () => {
    const own = collectPresets([track('a', [cue('1', 'Preset CC 21', cc(21, 1) )])])
    expect(withMapPresets(own, [{ ...map, action: { ...map.action, value: 127 } }]).filter((p) => p.label === 'Preset CC 21')).toHaveLength(1)
  })

  it('keeps a map entry out of the menu of a cue that already carries it', () => {
    const own = collectPresets([track('a', [cue('1', 'Preset CC 21', cc(21)), cue('2', 'Solo', cc(30))])])
    const all = withMapPresets(own, [map])
    expect(presetsFor(all, '1').map((p) => p.label)).toEqual(['Solo'])
    expect(presetsFor(all, '2').map((p) => p.label)).toEqual(['Preset CC 21'])
  })

  it('treats a coloured cue carrying a map message as carrying that entry, with no second row', () => {
    const own = collectPresets([
      track('a', [cue('1', 'Preset CC 21', cc(21), '#ff7a6b'), cue('2', 'Preset CC 21', cc(21), '#4fb6ff'), cue('3', 'Preset CC 21', cc(21))])
    ])
    const all = withMapPresets(own, [map])
    expect(all.filter((p) => p.group === undefined && !p.color)).toHaveLength(0) // the colourless duplicate folds into the map entry
    for (const id of ['1', '2', '3']) expect(presetsFor(all, id).filter((p) => p.group === 'Archetype X')).toHaveLength(0)
    expect(presetsFor(all, '9').filter((p) => p.group === 'Archetype X')).toHaveLength(1)
  })

  it('leaves a cue its colour when a map entry is picked, but a segment brings its own', () => {
    const [fromMap] = withMapPresets([], [map])
    expect('color' in presetFields(fromMap)).toBe(false)
    const [segment] = collectPresets([track('a', [cue('1', 'Lead', cc(20), '#ff7a6b')])])
    expect(presetFields(segment).color).toBe('#ff7a6b')
  })

  it('returns the same array when there are no maps', () => {
    const own = collectPresets([track('a', [cue('1', 'Solo')])])
    expect(withMapPresets(own, [])).toBe(own)
  })
})
