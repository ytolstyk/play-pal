import { describe, expect, it } from 'vitest'
import { outputIdFor, sameOutputs, selectableOutputs } from '../src/shared/audioOutput'
import { originOf, YT_ORIGIN } from '../src/shared/url'

const out = (deviceId: string, label: string, kind = 'audiooutput') => ({ kind, deviceId, label })

describe('selectableOutputs', () => {
  it('keeps named outputs and drops aliases, inputs, unnamed and over-long ones', () => {
    const list = selectableOutputs([
      out('default', 'Default - Speakers'),
      out('communications', 'Communications - Headset'),
      out('a', 'Speakers'),
      out('b', 'USB DAC'),
      out('c', ''),
      out('d', 'Mic', 'audioinput'),
      out('e', 'x'.repeat(201))
    ])
    expect(list).toEqual([
      { id: 'a', label: 'Speakers' },
      { id: 'b', label: 'USB DAC' }
    ])
  })
})

describe('outputIdFor', () => {
  const devices = [
    { id: 'a', label: 'Speakers' },
    { id: 'b', label: 'USB DAC' },
    { id: 'c', label: 'USB DAC' }
  ]
  it('finds the connected device by name, first match for duplicates', () => {
    expect(outputIdFor(devices, 'Speakers')).toBe('a')
    expect(outputIdFor(devices, 'USB DAC')).toBe('b')
  })
  it('falls back to the system default for no name or a missing device', () => {
    expect(outputIdFor(devices, '')).toBe('')
    expect(outputIdFor(devices, 'Unplugged')).toBe('')
    expect(outputIdFor([], 'Speakers')).toBe('')
  })
})

describe('sameOutputs', () => {
  it('compares ids and names in order', () => {
    const a = [{ id: '1', label: 'A' }]
    expect(sameOutputs(a, [{ id: '1', label: 'A' }])).toBe(true)
    expect(sameOutputs(a, [{ id: '1', label: 'B' }])).toBe(false)
    expect(sameOutputs(a, [])).toBe(false)
  })
})

describe('originOf', () => {
  it('reads a URL or permission origin, ignores the rest', () => {
    expect(originOf('https://music.youtube.com/')).toBe(YT_ORIGIN)
    expect(originOf('https://music.youtube.com/watch?v=x')).toBe(YT_ORIGIN)
    expect(originOf('https://evil.com')).not.toBe(YT_ORIGIN)
    expect(originOf('http://music.youtube.com')).not.toBe(YT_ORIGIN)
    expect(originOf('garbage')).toBeNull()
    expect(originOf(undefined)).toBeNull()
  })
})
