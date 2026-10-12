import { useCallback, useEffect, useRef, useState } from 'react'
import { applyTheme, loadTheme, saveTheme, type Theme } from '../theme'

const SAVE_DEBOUNCE_MS = 250

/** Applying during the first render (not an effect) avoids a flash of the default colours. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => {
    const initial = loadTheme()
    applyTheme(initial)
    return initial
  })
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pending = useRef<Theme | null>(null)

  const flush = useCallback(() => {
    clearTimeout(saveTimer.current)
    if (pending.current) saveTheme(pending.current)
    pending.current = null
  }, [])
  useEffect(() => flush, [flush])

  // The colour picker fires continuously while dragging: apply live, persist once it settles.
  const setTheme = useCallback(
    (next: Theme) => {
      applyTheme(next)
      setThemeState(next)
      pending.current = next
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(flush, SAVE_DEBOUNCE_MS)
    },
    [flush]
  )
  return [theme, setTheme]
}
