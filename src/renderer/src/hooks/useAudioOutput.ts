import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { outputIdFor, sameOutputs, selectableOutputs, type OutputDevice } from '../../../shared/audioOutput'
import { MAX_DEVICE_LABEL } from '../../../shared/types'
import { loadStored, saveStored } from '../storage'

const STORAGE_KEY = 'play-pal.output'

const isLabel = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_DEVICE_LABEL

export interface AudioOutput {
  /** Connected output devices. */
  devices: OutputDevice[]
  /** The chosen device's name; '' is the system default. Kept while that device is unplugged, so it comes back when plugged in. */
  choice: string
  /** The chosen device is not connected (false until the device list has loaded); audio plays on the system default meanwhile. */
  missing: boolean
  /** What to pass to setSinkId: the chosen device's id, or '' (the default) when it is not connected. */
  sinkId: string
  select(label: string): void
}

/**
 * Which output device audio plays on, remembered across launches by device name (two identical devices share a
 * name and so resolve to the first). Local files use the returned id; YouTube Music lives in another session
 * where ids differ, so it is told the name. An unplugged device falls back to the system default.
 */
export function useAudioOutput(): AudioOutput {
  const [choice, setChoice] = useState(() => loadStored(STORAGE_KEY, isLabel, ''))
  const [devices, setDevices] = useState<OutputDevice[] | null>(null)
  const latest = useRef(0)

  useEffect(() => {
    let alive = true
    const refresh = (): void => {
      const mine = ++latest.current // devicechange fires in bursts; only the newest listing counts
      navigator.mediaDevices.enumerateDevices().then(
        (all) => {
          if (!alive || mine !== latest.current) return
          const list = selectableOutputs(all)
          setDevices((prev) => (prev && sameOutputs(prev, list) ? prev : list))
        },
        (err) => console.warn('[output] could not list audio devices', err)
      )
    }
    refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => {
      alive = false
      navigator.mediaDevices.removeEventListener('devicechange', refresh)
    }
  }, [])

  useEffect(() => {
    window.api.ytCommand({ cmd: 'output', value: choice })
  }, [choice])

  const select = useCallback((label: string) => {
    setChoice(label)
    saveStored(STORAGE_KEY, label)
  }, [])

  return useMemo(() => {
    const list = devices ?? []
    const sinkId = outputIdFor(list, choice)
    return { devices: list, choice, missing: devices !== null && choice !== '' && sinkId === '', sinkId, select }
  }, [devices, choice, select])
}
