export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** A playback volume: 0 (silent) to 1 (full). */
export const isVolume = (v: unknown): v is number => isFiniteNumber(v) && v >= 0 && v <= 1

export const clamp = (x: number, min: number, max: number): number => Math.min(max, Math.max(min, x))

/** Rounds to an int in [min, max]; anything unparseable becomes `min`. */
export function clampInt(value: string | number, min: number, max: number): number {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min
}
