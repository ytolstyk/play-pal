import { useCallback, useEffect, useRef, useState } from 'react'
import type { Library } from '../../../shared/types'

const SAVE_DEBOUNCE_MS = 400

export interface LibraryApi {
  library: Library | null
  warnings: string[]
  saveError: string | null
  /** Applies `change` to the latest library. `immediate` saves now and resolves to whether it stuck. */
  update(change: (lib: Library) => Library, immediate?: boolean): Promise<boolean>
}

/** Library state owned here; main persists it (debounced, or at once when a caller needs it durable). */
export function useLibrary(): LibraryApi {
  const [library, setLibrary] = useState<Library | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [saveError, setSaveError] = useState<string | null>(null)
  const latest = useRef<Library | null>(null)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const persist = useCallback(async (lib: Library): Promise<boolean> => {
    dirty.current = false
    const result = await window.api.saveLibrary(lib)
    // A failed save stays dirty so the unload flush tries again.
    if (!result.ok && latest.current === lib) dirty.current = true
    setSaveError(result.ok ? null : result.errors.join('; '))
    return result.ok
  }, [])

  useEffect(() => {
    void window.api.loadLibrary().then(({ warnings: w, ...lib }) => {
      latest.current = lib
      setLibrary(lib)
      setWarnings(w)
    })
  }, [])

  // Don't lose an edit made in the last debounce window when the window closes.
  useEffect(() => {
    const flush = (): void => {
      if (dirty.current && latest.current) void persist(latest.current)
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [persist])

  const update = useCallback(
    (change: (lib: Library) => Library, immediate = false): Promise<boolean> => {
      if (!latest.current) return Promise.resolve(false)
      const next = change(latest.current)
      latest.current = next
      dirty.current = true
      setLibrary(next)
      clearTimeout(timer.current)
      if (immediate) return persist(next)
      timer.current = setTimeout(() => void persist(next), SAVE_DEBOUNCE_MS)
      return Promise.resolve(true)
    },
    [persist]
  )

  return { library, warnings, saveError, update }
}
