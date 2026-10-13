import type { RefObject } from 'react'
import { useStepper, type PendingStep } from './useStepper'

const SKIP_STEP_S = 10
/** Never land exactly on the end: that would count as a finished track. */
const END_MARGIN_S = 0.25

export type PendingSkip = PendingStep

/**
 * Relative seeking: each press moves the pending target by SKIP_STEP_S and one seek is applied
 * once presses stop. The landing point is relative to the position at the first press, so it can
 * trail "now + delta" by up to the debounce window.
 */
export function useSkip(
  seek: (t: number) => void,
  timeRef: RefObject<number>,
  duration: number,
  trackId: string
): { pending: PendingSkip | null; skip(direction: 1 | -1): void; cancel(): void } {
  const { pending, press, cancel } = useStepper({
    step: SKIP_STEP_S,
    min: 0,
    max: Math.max(0, duration - END_MARGIN_S),
    read: () => timeRef.current,
    apply: seek,
    resetKey: trackId
  })
  return { pending, skip: press, cancel }
}
