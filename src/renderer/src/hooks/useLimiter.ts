import { useCallback, useEffect, useState } from 'react'
import { loadStored, saveStored } from '../storage'

const STORAGE_KEY = 'play-pal.limiter'

const isFlag = (v: unknown): v is '0' | '1' => v === '0' || v === '1'

/** Whether YouTube Music's audio goes through the limiter; remembered across launches. */
export function useLimiter(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => loadStored(STORAGE_KEY, isFlag, '0') === '1')

  // Main replays the last value to each new page; this also covers the first load.
  useEffect(() => {
    window.api.ytCommand({ cmd: 'limiter', value: on ? 1 : 0 })
  }, [on])

  const set = useCallback((next: boolean) => {
    setOn(next)
    saveStored(STORAGE_KEY, next ? '1' : '0')
  }, [])
  return [on, set]
}
