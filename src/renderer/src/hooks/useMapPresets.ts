import { useEffect, useState } from 'react'
import { sameMapPresets, type MapPreset } from '../../../shared/neuralMap'
import { isWindowActive, subscribeWindowActive } from '../windowActivity'

/**
 * The messages Neural DSP plugins listen to (their MIDI map files), read when the app starts and each time
 * its window comes to the front, so a map saved in the plugin shows up without a restart.
 * The array keeps its identity while the files are unchanged.
 */
export function useMapPresets(): readonly MapPreset[] {
  const [presets, setPresets] = useState<readonly MapPreset[]>([])
  useEffect(() => {
    let live = true
    let reading = false
    let again = false
    const refresh = (): void => {
      // Coming back from a DAW sends several "active" signals; one read at a time, with one more if asked meanwhile.
      if (reading) {
        again = true
        return
      }
      reading = true
      window.api
        .listMidiMaps()
        .then((next) => live && setPresets((prev) => (sameMapPresets(prev, next) ? prev : next)))
        .catch(() => undefined)
        .finally(() => {
          reading = false
          if (again && live) {
            again = false
            refresh()
          }
        })
    }
    refresh()
    const off = subscribeWindowActive(() => isWindowActive() && refresh())
    return () => {
      live = false
      off()
    }
  }, [])
  return presets
}
