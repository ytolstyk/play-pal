/** localStorage that never throws: blocked or full storage just means the choice isn't remembered. */
export function loadStored<T>(key: string, ok: (v: unknown) => v is T, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    if (ok(v)) return v
  } catch {
    // storage unavailable: use the default
  }
  return fallback
}

export function saveStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // not persisted; the choice still applies for this session
  }
}
