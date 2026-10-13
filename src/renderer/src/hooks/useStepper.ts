import { useCallback, useEffect, useRef, useState } from 'react'

/** Presses closer together than this add up into one change. */
const STEP_DEBOUNCE_MS = 400

export interface PendingStep {
  /** Net change requested so far (negative = down/back), in the value's own units. */
  delta: number
  /** The value that will be applied, clamped to [min, max]. */
  target: number
}

interface Options {
  step: number
  min: number
  /** Read at press and fire time, so a late-arriving limit (e.g. duration) is honoured. */
  max: number
  /** The current value; captured at the first press of a burst. */
  read(): number
  apply(value: number): void
  /** A pending change is dropped when this changes (e.g. the track) and on unmount. */
  resetKey: string
}

/**
 * Debounced relative changes: each press moves a pending target by `step`, and `apply` runs once
 * presses stop. The base value is captured at the first press, so the value drifting meanwhile
 * (playback moving on) doesn't skew the result.
 */
export function useStepper(options: Options): { pending: PendingStep | null; press(direction: 1 | -1): void; cancel(): void } {
  const [pending, setPending] = useState<PendingStep | null>(null)
  const base = useRef(0)
  const steps = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef(options)
  latest.current = options

  const cancel = useCallback((): void => {
    clearTimeout(timer.current)
    timer.current = undefined
    setPending(null)
  }, [])

  const press = useCallback((direction: 1 | -1): void => {
    const { step, min, max, read } = latest.current
    if (max <= min) return
    if (!timer.current) {
      base.current = read()
      steps.current = 0
    }
    steps.current += direction
    // Counting whole steps keeps the delta free of float drift (20 × 0.05).
    const delta = Math.round(steps.current * step * 1000) / 1000
    const targetNow = (): number => {
      const { min: lo, max: hi } = latest.current
      return Math.round(Math.min(hi, Math.max(lo, base.current + delta)) * 1000) / 1000
    }
    setPending({ delta, target: targetNow() })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = undefined
      setPending(null)
      // Opposite presses that cancel out leave the value alone.
      if (steps.current !== 0) latest.current.apply(targetNow())
    }, STEP_DEBOUNCE_MS)
  }, [])

  const { resetKey } = options
  useEffect(() => cancel, [cancel, resetKey])

  return { pending, press, cancel }
}
