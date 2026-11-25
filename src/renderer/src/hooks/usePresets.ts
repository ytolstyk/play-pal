import { useEffect, useRef, useState } from 'react'
import { collectPresets, samePresets, type CuePreset } from '../../../shared/presets'
import type { Track } from '../../../shared/types'

/** Typing a label writes the library on every keystroke; a name counts as a preset once typing pauses. */
const SETTLE_MS = 400

/**
 * The library's presets. The array only changes when the presets do (a volume, time or title edit leaves
 * menus alone), and half-typed names never reach other cues' menus. The first library is read at once.
 */
export function usePresets(tracks: readonly Track[] | undefined): readonly CuePreset[] {
  const [presets, setPresets] = useState<readonly CuePreset[]>([])
  const loaded = useRef(false)
  useEffect(() => {
    if (!tracks) return
    const refresh = (): void => {
      const next = collectPresets(tracks)
      setPresets((prev) => (samePresets(prev, next) ? prev : next))
    }
    if (!loaded.current) {
      loaded.current = true
      refresh()
      return
    }
    const timer = setTimeout(refresh, SETTLE_MS)
    return () => clearTimeout(timer)
  }, [tracks])
  return presets
}
