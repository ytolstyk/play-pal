import { memo, type CSSProperties, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PendingSkip } from '../hooks/useSkip'
import { useCueDrag, type CueDrag } from '../hooks/useCueDrag'
import { useScrub } from '../hooks/useScrub'
import { useTimelineGestures } from '../hooks/useTimelineGestures'
import { useTimelineView } from '../hooks/useTimelineView'
import { useClockTime, type Clock } from '../hooks/usePlayback'
import type { Waveform } from '../hooks/useWaveform'
import { fractionOf } from '../timelineView'
import { START_CUE_ID, sortedByTime } from '../../../shared/cues'
import { clamp } from '../../../shared/guards'
import type { Cue } from '../../../shared/types'
import { formatTime } from '../../../shared/time'
import { displayBins, isWaveView, type WaveView } from '../../../shared/waveDisplay'
import { loadStored, saveStored } from '../storage'
import { TimelineOverview } from './TimelineOverview'
import { TimelineToolbar } from './TimelineToolbar'
import { WaveCanvas } from './WaveCanvas'

interface Props {
  clock: Clock
  duration: number
  cues: Cue[]
  startColor?: string
  firedId: string | null
  /** A keyboard skip waiting to be applied: shown as a target line and a "+20s" badge. */
  pendingSkip: PendingSkip | null
  playing: boolean
  wave: Waveform
  /** False while a modal is open: the zoom keys are ignored. */
  keysEnabled: boolean
  onSeek(t: number): void
  onMoveCue(id: string, time: number): void
}

interface Marker {
  at: number
  label: string
}

const WAVE_VIEW_KEY = 'waveView'

const skipLabel = ({ delta, target }: PendingSkip): string => `${delta < 0 ? '−' : '+'}${Math.abs(delta)}s · ${formatTime(target)}`

/** The line and label shown at a target time: a cue drag wins over a scrub, and a scrub over a pending keyboard skip. */
function activeMarker(drag: CueDrag | null, scrubT: number | null, pendingSkip: PendingSkip | null): Marker | null {
  if (drag) return { at: drag.t, label: formatTime(drag.t) }
  if (scrubT !== null) return { at: scrubT, label: formatTime(scrubT) }
  if (pendingSkip) return { at: pendingSkip.target, label: skipLabel(pendingSkip) }
  return null
}

// The cast is safe: `--cue` is a custom property, which CSSProperties just doesn't know about.
const cueStyle = (color: string | undefined, left: string): CSSProperties => ({ left, ...(color ? ({ '--cue': color } as CSSProperties) : {}) })

/**
 * Waveform seek bar. Press-drag-release on the waveform seeks. Cues are moved by their handles
 * under the waveform, never by the waveform itself. Scroll to zoom (or +/-), scroll sideways to pan.
 */
export const Timeline = memo(function Timeline({
  clock,
  duration,
  cues,
  startColor,
  firedId,
  pendingSkip,
  playing,
  wave,
  keysEnabled,
  onSeek,
  onMoveCue
}: Props): React.JSX.Element {
  const playhead = useClockTime(clock)
  const view = useTimelineView(duration)
  const stageRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<HTMLDivElement>(null)
  const revision = useSyncExternalStore(wave.subscribe, wave.revision)
  const recorded = wave.recorder?.bins ?? null
  const [waveView, setWaveView] = useState<WaveView>(() => loadStored(WAVE_VIEW_KEY, isWaveView, 'mix'))

  /** Track time under a pointer x, within what is on screen. */
  const timeAt = useCallback(
    (clientX: number): number => {
      const rect = plotRef.current?.getBoundingClientRect()
      const current = view.viewRef.current
      if (!rect || rect.width <= 0) return 0
      return current.start + clamp((clientX - rect.left) / rect.width, 0, 1) * current.span
    },
    [view.viewRef]
  )
  const { scrubT, handlers: scrubHandlers } = useScrub(timeAt, duration > 0, onSeek)
  const { drag, handlersFor } = useCueDrag({ timeAt, duration, plotRef, viewRef: view.viewRef, pan: view.pan, onMove: onMoveCue })
  const { zoomAtPlayhead } = useTimelineGestures({ stageRef, plotRef, view, clock, duration, keysEnabled })

  // While playing, a zoomed view turns the page when the playhead runs off it (unless the user is busy or scrolled away).
  const { follow, zoomed, reveal } = view
  const busy = drag !== null || scrubT !== null
  useEffect(() => {
    if (follow && playing && zoomed && !busy) reveal(playhead)
  }, [playhead, follow, playing, zoomed, busy, reveal])

  // The cue being dragged shows where it would land, so lines, colours and the order of segments follow it.
  const shown = useMemo(() => (drag ? cues.map((c) => (c.id === drag.id ? { ...c, time: drag.t } : c)) : cues), [cues, drag])
  const segments = useMemo(
    () => [...(startColor ? [{ id: START_CUE_ID, time: 0, color: startColor }] : []), ...sortedByTime(shown)],
    [shown, startColor]
  )
  // `recorded` is edited in place, so `revision` is what says it changed.
  const bins = useMemo(() => (recorded ? displayBins(recorded, waveView) : null), [recorded, revision, waveView])
  const chooseWaveView = useCallback((v: WaveView) => {
    setWaveView(v)
    saveStored(WAVE_VIEW_KEY, v)
  }, [])

  const fraction = (x: number): number => fractionOf(view.view, x)
  const pct = (x: number): string => `${fraction(x) * 100}%`
  const onScreen = (x: number): boolean => fraction(x) >= 0 && fraction(x) <= 1
  const visibleCues = shown.filter((c) => onScreen(c.time))
  const marker = activeMarker(drag, scrubT, pendingSkip)
  const played = clamp(fraction(playhead), 0, 1)

  return (
    <div className="timeline-block">
      <div className="timeline-stage" ref={stageRef}>
        <div
          id="timeline"
          className="timeline"
          role="slider"
          aria-label="Position"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(playhead)}
          {...scrubHandlers}
        >
          <div className="timeline-plot" ref={plotRef}>
            {segments.map((c, i) => {
              if (!c.color) return null
              const from = fraction(c.time)
              const to = fraction(segments[i + 1]?.time ?? duration)
              if (to <= 0 || from >= 1) return null
              return <div key={c.id} className="segment" style={{ left: `${clamp(from, 0, 1) * 100}%`, right: `${(1 - clamp(to, 0, 1)) * 100}%`, background: c.color }} />
            })}
            <div className="played" style={{ transform: `scaleX(${played})`, ...(onScreen(playhead) ? {} : { borderRightWidth: 0 }) }} />
            <WaveCanvas bins={bins} revision={revision} view={view.view} tone="idle" />
            <div className="wave-clip" style={{ clipPath: `inset(0 ${(1 - played) * 100}% 0 0)` }}>
              <WaveCanvas bins={bins} revision={revision} view={view.view} tone="played" />
            </div>
            {visibleCues.map((c) => (
              <div key={c.id} className={c.id === firedId ? 'marker fired' : 'marker'} style={cueStyle(c.color, pct(c.time))} />
            ))}
            {marker && onScreen(marker.at) && <div className="scrub-line" style={{ left: pct(marker.at) }} />}
          </div>
          {marker && (
            <div className="scrub-time mono" style={{ left: `clamp(34px, ${fraction(marker.at) * 100}%, calc(100% - 34px))` }}>
              {marker.label}
            </div>
          )}
        </div>
        {/* Below the waveform on purpose: a cue can only be picked up here, so clicking to seek never moves one. */}
        <div className="handle-lane">
          {visibleCues.map((c) => (
            <div
              key={c.id}
              className={c.id === drag?.id ? 'handle dragging' : 'handle'}
              style={cueStyle(c.color, pct(c.time))}
              title={`${c.label} · ${formatTime(c.time)}. Drag to move`}
              aria-label={`Move cue ${c.label}`}
              {...handlersFor(c)}
            />
          ))}
        </div>
      </div>
      {zoomed && <TimelineOverview bins={bins} revision={revision} duration={duration} view={view.view} t={playhead} onPan={view.scrollTo} />}
      <TimelineToolbar
        view={view.view}
        duration={duration}
        zoomed={zoomed}
        follow={follow}
        coverage={wave.recorder?.coverage ?? 0}
        hasWaveform={bins !== null}
        waveView={waveView}
        onWaveView={chooseWaveView}
        onZoom={zoomAtPlayhead}
        onReset={view.reset}
        onFollow={view.setFollow}
      />
    </div>
  )
})
