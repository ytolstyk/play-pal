import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readNeuralMaps } from '../src/main/neuralMaps'
import { mergeMapPresets, parseNeuralMap, sameMapPresets } from '../src/shared/neuralMap'

const xml = (...routings: string[]): string => `<?xml version="1.0"?>\n<midi>\n  <routings>\n${routings.join('\n')}\n  </routings>\n</midi>`
const jump = (cc: number, extra = ''): string =>
  `<routing type="cc_preset" target="-5580995273650807116" midiChannel="0"\n data1="${cc}" data2="0" value="0.0" enabled="1" ${extra}/>`
const inc = (preset: number, cc: number): string =>
  `<routing type="cc_preset_inc" preset="${preset}" midiChannel="0" data1="${cc}" data2="0" enabled="1"/>`

describe('parseNeuralMap', () => {
  it('reads next, previous and jump routings, next and previous first', () => {
    const presets = parseNeuralMap(xml(jump(21), jump(11), inc(-1, 1), inc(1, 0)), 'Plugin')
    expect(presets.map((p) => p.label)).toEqual(['Next preset', 'Previous preset', 'Preset CC 11', 'Preset CC 21'])
    expect(presets[0].action).toEqual({ type: 'cc', channel: 1, number: 0, value: 127 })
    expect(presets[0].plugin).toBe('Plugin')
  })

  it('maps channel 0 (any) to 1 and keeps a specific channel', () => {
    const [any, ch5] = parseNeuralMap(xml(jump(1), jump(2).replace('midiChannel="0"', 'midiChannel="5"')), 'P')
    expect([any.action.channel, ch5.action.channel]).toEqual([1, 5])
  })

  it('skips disabled routings, other kinds, and out-of-range CCs', () => {
    const presets = parseNeuralMap(
      xml(jump(5).replace('enabled="1"', 'enabled="0"'), '<routing type="cc_param" data1="9" enabled="1"/>', jump(200), jump(7)),
      'P'
    )
    expect(presets.map((p) => p.action.number)).toEqual([7])
  })

  it('returns nothing for a file that is not a map', () => {
    expect(parseNeuralMap('not xml at all', 'P')).toEqual([])
  })
})

describe('mergeMapPresets', () => {
  it('lists the same message from several maps once', () => {
    const a = parseNeuralMap(xml(jump(11), jump(12)), 'P')
    const b = parseNeuralMap(xml(jump(12), jump(13)), 'P')
    expect(mergeMapPresets([a, b]).map((p) => p.action.number)).toEqual([11, 12, 13])
  })

  it('keeps the same message of different plugins apart', () => {
    expect(mergeMapPresets([parseNeuralMap(xml(jump(11)), 'A'), parseNeuralMap(xml(jump(11)), 'B')])).toHaveLength(2)
  })
})

describe('readNeuralMaps', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'neural-'))
  })
  afterEach(() => rm(root, { recursive: true, force: true }))

  it('reads the MIDI folder of each plugin and merges its maps', async () => {
    await mkdir(join(root, 'Archetype A', 'MIDI'), { recursive: true })
    await mkdir(join(root, 'Archetype B', 'MIDI'), { recursive: true })
    await mkdir(join(root, 'Archetype C'), { recursive: true }) // no MIDI folder yet
    await writeFile(join(root, 'Archetype A', 'MIDI', 'one.xml'), xml(jump(11), jump(12)))
    await writeFile(join(root, 'Archetype A', 'MIDI', 'two.xml'), xml(jump(12)))
    await writeFile(join(root, 'Archetype A', 'MIDI', 'notes.txt'), xml(jump(99)))
    await writeFile(join(root, 'Archetype B', 'MIDI', 'one.xml'), xml(inc(1, 0)))
    const found = await readNeuralMaps(root)
    expect(found.map((p) => `${p.plugin}:${p.label}`)).toEqual(['Archetype A:Preset CC 11', 'Archetype A:Preset CC 12', 'Archetype B:Next preset'])
  })

  it('returns nothing when Neural DSP is not installed', async () => {
    expect(await readNeuralMaps(join(root, 'missing'))).toEqual([])
  })
})

describe('damaged or switched-off routings', () => {
  it('ignores routings inside comments, even a comment that never closes', () => {
    expect(parseNeuralMap(`<midi><!-- ${jump(5)} -->${jump(6)}<!-- ${jump(7)}`, 'P').map((p) => p.action.number)).toEqual([6])
  })

  it('does not take another element whose name starts with routing', () => {
    expect(parseNeuralMap(jump(5).replace('<routing', '<routing-x'), 'P')).toEqual([])
  })

  it('skips empty or missing numbers instead of reading them as 0', () => {
    const noCc = jump(5).replace('data1="5"', 'data1=""')
    const missingCc = jump(5).replace('data1="5"', '')
    expect(parseNeuralMap(xml(noCc, missingCc), 'P')).toEqual([])
  })

  it('skips a channel outside 1-16 rather than moving it, and treats a missing one as any', () => {
    const wrong = jump(5).replace('midiChannel="0"', 'midiChannel="40"')
    const none = jump(6).replace('midiChannel="0"', '')
    const [only] = parseNeuralMap(xml(wrong, none), 'P')
    expect([only.action.number, only.action.channel]).toEqual([6, 1])
  })
})

describe('sameMapPresets and hostile input', () => {
  it('compares plugin, label and message', () => {
    const a = parseNeuralMap(xml(jump(11)), 'P')
    expect(sameMapPresets(a, parseNeuralMap(xml(jump(11)), 'P'))).toBe(true)
    expect(sameMapPresets(a, parseNeuralMap(xml(jump(12)), 'P'))).toBe(false)
    expect(sameMapPresets(a, parseNeuralMap(xml(jump(11)), 'Q'))).toBe(false)
    expect(sameMapPresets(a, [])).toBe(false)
  })

  it('scans a file full of unterminated tags in linear time', () => {
    const start = performance.now()
    expect(parseNeuralMap('<routing '.repeat(30_000), 'P')).toEqual([])
    expect(performance.now() - start).toBeLessThan(500)
  })
})

describe('hostile files stay cheap to scan', () => {
  const quick = (input: string): void => {
    const start = performance.now()
    expect(parseNeuralMap(input, 'P')).toEqual([])
    expect(performance.now() - start).toBeLessThan(200)
  }

  it('a long run with no closing quote or bracket', () => quick(`<routing ${'a'.repeat(250_000)}`))
  it('a closed tag whose body is one huge word', () => quick(`<routing ${'a'.repeat(250_000)}>`))
  it('an attribute name that never reaches its value', () => quick(`<routing ${'a="" '.repeat(1)}${'b'.repeat(250_000)}="`))
  it('thousands of unclosed attribute quotes', () => quick(`<routing ${'a="'.repeat(120_000)}`))
})
