import { memo, useRef, useState } from 'react'
import { useClockTime, type Clock } from '../hooks/usePlayback'
import type { Cue } from '../../../shared/types'
import { formatTime } from '../../../shared/time'

interface Props {
  clock: Clock
  duration: number
  cues: Cue[]
  firedId: string | null
  onSeek(t: number): void
}

/**
 * Seek bar. Press-drag-release shows the target time while dragging and seeks on release. The drag
 * state lives here so pointer moves re-render only this component, not the whole player.
 */
export const Timeline = memo(function Timeline({ clock, duration, cues, firedId, onSeek }: Props): React.JSX.Element {
  const t = useClockTime(clock)
  const [scrubT, setScrubT] = useState<number | null>(null)
  // The active pointer is the source of truth; scrubT only drives rendering.
  const scrubPointer = useRef<number | null>(null)

  const timeAt = (e: React.PointerEvent<HTMLDivElement>): number => {
    const r = e.currentTarget.getBoundingClientRect()
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * duration
  }
  const scrubStart = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (duration <= 0 || e.button !== 0 || scrubPointer.current !== null) return
    scrubPointer.current = e.pointerId
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // pointer already gone; the drag still ends on pointerup/cancel
    }
    setScrubT(timeAt(e))
  }
  const scrubMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.pointerId === scrubPointer.current) setScrubT(timeAt(e))
  }
  const scrubEnd = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.pointerId !== scrubPointer.current || e.button !== 0) return
    scrubPointer.current = null
    onSeek(timeAt(e))
    setScrubT(null)
  }
  const scrubCancel = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.pointerId !== scrubPointer.current) return
    scrubPointer.current = null
    setScrubT(null)
  }
  const pct = (x: number): string => `${duration > 0 ? Math.min(100, (x / duration) * 100) : 0}%`

  return (
    <div
      className="timeline"
      role="slider"
      aria-label="Position"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(t)}
      onPointerDown={scrubStart}
      onPointerMove={scrubMove}
      onPointerUp={scrubEnd}
      onPointerCancel={scrubCancel}
      onLostPointerCapture={scrubCancel}
    >
      <div className="played" style={{ transform: `scaleX(${duration > 0 ? Math.min(1, t / duration) : 0})` }} />
      {cues.map((c) => (
        <div key={c.id} className={c.id === firedId ? 'marker fired' : 'marker'} style={{ left: pct(c.time) }} title={c.label} />
      ))}
      {scrubT !== null && (
        <>
          <div className="scrub-line" style={{ left: pct(scrubT) }} />
          <div className="scrub-time mono" style={{ left: `clamp(32px, ${pct(scrubT)}, calc(100% - 32px))` }}>
            {formatTime(scrubT)}
          </div>
        </>
      )}
    </div>
  )
})
