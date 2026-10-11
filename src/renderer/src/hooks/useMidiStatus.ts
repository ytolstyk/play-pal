import { useEffect, useState } from 'react'
import type { MidiStatus } from '../../../shared/types'

export function useMidiStatus(): MidiStatus {
  const [status, setStatus] = useState<MidiStatus>({ state: 'lost', name: null })
  useEffect(() => {
    void window.api.getMidiStatus().then((s) => s && setStatus(s))
    return window.api.onMidiStatus(setStatus)
  }, [])
  return status
}
