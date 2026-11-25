import { actionKey, sameAction } from './cues'
import { MIDI_CHANNEL_MAX, MIDI_CHANNEL_MIN, MIDI_DATA_MAX, type MidiAction } from './types'

/**
 * A MIDI message a Neural DSP plugin reacts to, read from one of its MIDI map files
 * (`~/Library/Application Support/Neural DSP/<plugin>/MIDI/*.xml`). The files name no presets,
 * only numeric ids, so a preset-jump is labelled by its CC number.
 */
export interface MapPreset {
  /** The plugin's folder name, e.g. `Archetype Misha Mansoor X`. */
  plugin: string
  label: string
  action: MidiAction
}

/** What a map file asks the plugin to do (the only routing kinds known so far). */
type RoutingKind = 'next' | 'previous' | 'jump'

/** Sent value: the files hold a `value`/`data2` whose meaning is unknown, so use a plain "button down". */
const TRIGGER_VALUE = MIDI_DATA_MAX

// Every quantifier is bounded (and a tag cannot contain `<`), so a damaged or hostile file costs a fixed
// number of steps per position instead of rescanning to its end: the scan stays linear. Real tags are ~150 characters.
const ROUTING = /<routing(?=[\s/>])([^<>]{0,512})>/g
const ATTRIBUTE = /([A-Za-z_][\w-]{0,31})="([^"]{0,64})"/g

function attributes(source: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const [, name, value] of source.matchAll(ATTRIBUTE)) found.set(name, value)
  return found
}

const TYPE_JUMP = 'cc_preset'
const TYPE_STEP = 'cc_preset_inc'
/** `midiChannel` value meaning every channel. */
const ANY_CHANNEL = 0

function kindOf(type: string | undefined, step: string | undefined): RoutingKind | null {
  if (type === TYPE_JUMP) return 'jump'
  if (type !== TYPE_STEP) return null
  if (step === '1') return 'next'
  return step === '-1' ? 'previous' : null
}

/** An attribute that is plain decimal digits (`Number()` alone would read '' as 0 and '0x10' as 16). */
function wholeNumber(value: string | undefined): number | null {
  const text = value?.trim()
  return text !== undefined && /^-?\d{1,4}$/.test(text) ? Number(text) : null
}

/** The file without its `<!-- -->` comments, whose routings are switched off. Linear even if a comment never closes. */
function withoutComments(xml: string): string {
  let out = ''
  let from = 0
  for (;;) {
    const open = xml.indexOf('<!--', from)
    if (open < 0) return out + xml.slice(from)
    out += xml.slice(from, open)
    const close = xml.indexOf('-->', open + 4)
    if (close < 0) return out
    from = close + 3
  }
}

const LABELS = { next: 'Next preset', previous: 'Previous preset' } as const
const KIND_ORDER: Record<RoutingKind, number> = { next: 0, previous: 1, jump: 2 }

/** The enabled CC routings of one map file, as presets; anything else in the file is ignored. */
export function parseNeuralMap(xml: string, plugin: string): MapPreset[] {
  const found: { kind: RoutingKind; preset: MapPreset }[] = []
  for (const [, body] of withoutComments(xml).matchAll(ROUTING)) {
    const attr = attributes(body)
    const kind = kindOf(attr.get('type'), attr.get('preset'))
    if (!kind || attr.get('enabled') === '0') continue
    const cc = wholeNumber(attr.get('data1'))
    const channel = attr.has('midiChannel') ? wholeNumber(attr.get('midiChannel')) : ANY_CHANNEL
    if (cc === null || cc < 0 || cc > MIDI_DATA_MAX) continue
    if (channel === null || (channel !== ANY_CHANNEL && (channel < MIDI_CHANNEL_MIN || channel > MIDI_CHANNEL_MAX))) continue
    found.push({
      kind,
      preset: {
        plugin,
        label: kind === 'jump' ? `Preset CC ${cc}` : LABELS[kind],
        // Channel 0 means "any channel" in the files, and any channel includes the first.
        action: {
          type: 'cc',
          channel: channel === ANY_CHANNEL ? MIDI_CHANNEL_MIN : channel,
          number: cc,
          value: TRIGGER_VALUE
        }
      }
    })
  }
  return found.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.preset.action.number - b.preset.action.number).map((f) => f.preset)
}

/** The same message from several maps (they usually overlap) listed once. */
export function mergeMapPresets(lists: readonly (readonly MapPreset[])[]): MapPreset[] {
  const seen = new Set<string>()
  const merged: MapPreset[] = []
  for (const preset of lists.flat()) {
    const key = `${preset.plugin}\u0000${preset.label}\u0000${actionKey(preset.action)}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(preset)
  }
  return merged
}

/** Whether two lists are the same messages, so a caller can keep the array it has. */
export const sameMapPresets = (a: readonly MapPreset[], b: readonly MapPreset[]): boolean =>
  a.length === b.length && a.every((p, i) => p.plugin === b[i].plugin && p.label === b[i].label && sameAction(p.action, b[i].action))
