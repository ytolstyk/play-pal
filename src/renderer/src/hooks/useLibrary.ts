import { useCallback, useEffect, useRef, useState } from 'react'
import type { Library, RestoreResult } from '../../../shared/types'

const SAVE_DEBOUNCE_MS = 400

export interface LibraryApi {
  library: Library | null
  warnings: string[]
  saveError: string | null
  /** Applies `change` to the latest library. `immediate` saves now and resolves to whether it stuck. */
  update(change: (lib: Library) => Library, immediate?: boolean): Promise<boolean>
  /**
   * Runs a restore or import done by main and shows the library it returns. A save still waiting
   * is made first, so it is in the copy main keeps of what gets replaced; edits during the run are
   * refused, and a second run while one is going resolves to null. Resolves to the run's result.
   */
  replace(run: () => Promise<RestoreResult | null>): Promise<RestoreResult | null>
}

/** Library state owned here; main persists it (debounced, or at once when a caller needs it durable). */
export function useLibrary(): LibraryApi {
  const [library, setLibrary] = useState<Library | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [saveError, setSaveError] = useState<string | null>(null)
  const latest = useRef<Library | null>(null)
  const dirty = useRef(false)
  /** A restore or import is running: edits made meanwhile would be lost under it, so they are refused. */
  const replacing = useRef(false)
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
      if (!latest.current || replacing.current) return Promise.resolve(false)
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

  const replace = useCallback(
    async (run: () => Promise<RestoreResult | null>): Promise<RestoreResult | null> => {
      if (replacing.current) return null
      replacing.current = true
      // Main keeps a copy of the current file before replacing it, so what is still waiting goes into that file first.
      clearTimeout(timer.current)
      let result: RestoreResult | null
      try {
        if (dirty.current && latest.current) await persist(latest.current)
        result = await run()
      } catch (err) {
        result = { ok: false, errors: [err instanceof Error ? err.message : String(err)], warnings: [], tracks: 0 }
      } finally {
        replacing.current = false
      }
      if (result?.ok) {
        latest.current = result.library
        setLibrary(result.library)
        setWarnings([])
        setSaveError(null)
      }
      return result
    },
    [persist]
  )

  return { library, warnings, saveError, update, replace }
}
